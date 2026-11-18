# Architecture

## Vue d'ensemble

```
web/ (Vite + React 19)  ──HTTP/SSE──►  server/ (Hono sur Node, 127.0.0.1:4317)  ──►  SQLite (libSQL) dans data/
                                              │
                                              ├─► Anthropic API (SDK officiel)
                                              ├─► API compatibles OpenAI (OpenAI, Gemini, Mistral, DeepSeek, xAI, OpenRouter, Ollama…)
                                              ├─► CLI officielle `claude` (abonnement Pro/Max)
                                              └─► Serveurs MCP (SDK officiel, STDIO / Streamable HTTP)
```

## Décisions

| Décision | Raison |
|---|---|
| **Serveur Node persistant (Hono) plutôt que Next.js** | Il faut garder en vie des processus MCP STDIO, des orchestrations longues et des flux SSE. Un processus unique et stable est plus fiable que des route handlers. L'interface est une SPA de bureau : le rendu serveur n'apporte rien. |
| **Vite + React + Tailwind v4 + composants façon shadcn (Radix)** | Rapide et léger. Composants écrits à la main dans `web/src/components/ui` pour garder la maîtrise du style (sobre, type Linear/Raycast). |
| **SQLite via libSQL + Drizzle** | Un fichier local, zéro service à installer, migrations versionnées (`drizzle/`). libSQL supporte nativement les vecteurs, ce qui prépare le RAG. |
| **Adaptateurs maison, pas de Vercel AI SDK ni LangGraph** | Deux adaptateurs couvrent tous les fournisseurs : SDK Anthropic officiel, et SDK `openai` pour les endpoints compatibles. On récupère ainsi les compteurs de tokens exacts (cache compris) sans couche intermédiaire. L'orchestration est un moteur explicite, plus simple à contrôler côté coûts qu'un framework de graphe. |
| **SSE pour le temps réel** | Flux unidirectionnel serveur → navigateur, suffisant pour le streaming des réponses. La déconnexion annule l'exécution côté serveur. |

## Modules serveur

| Dossier | Responsabilité |
|---|---|
| `server/providers` | Catalogue des fournisseurs, adaptateurs (Anthropic, OpenAI-compatible, Claude Code CLI), registre, tests de connexion, découverte des modèles. |
| `server/runtime/llm.ts` | **Point d'entrée unique de tout appel modèle** : vérifie les budgets, streame, enregistre une ligne `usage_events` avec les chiffres du fournisseur. |
| `server/chat` | Chats classiques et conversations individuelles avec un agent. `streamReply` est partagé par tous les types de conversation. |
| `server/orchestration` | Moteur de la conversation collective : routage par l'orchestrateur, exécution parallèle des agents, débat, synthèse, validation humaine, garde-fou contre les boucles. |
| `server/warrooms` | API des War Rooms, agents, tâches, journal ; analyse du brief et application de la proposition. |
| `server/memory` | Construction du contexte (budget de tokens, compression par résumé), mémoire structurée. |
| `server/usage` | Calcul des coûts, budgets, optimiseur (choix de modèle par gamme), agrégats. |
| `server/skills` | Inventaire des Skills (format Agent Skills), installation dans WAR ROOM, injection dans les prompts. |
| `server/mcp` | Connexion aux serveurs MCP, outils, ressources, prompts, journaux, contrôle des permissions. |
| `server/files` | Upload, validation, extraction de texte (texte, code, PDF, DOCX), préparation des pièces jointes par modèle. |
| `server/projects`, `server/system` | Projets, réglages, recherche globale, dashboard. |

## Orchestration (conversation collective)

1. Le message de l'utilisateur est enregistré.
2. **Mode Auto** : l'orchestrateur reçoit l'équipe et la demande, et renvoie un plan JSON : agents choisis, instruction pour chacun, synthèse ou non. L'appel est court (effort faible) et peut utiliser un modèle de routage moins cher (réglage `optimizer.routingModel`). Il peut décider de répondre seul.
3. **Validation** selon le niveau d'autonomie :
   - Assisté : tout plan attend l'accord de l'utilisateur.
   - Semi-autonome : accord demandé dès que le plan mobilise 3 agents ou plus.
   - Autonome : exécution directe.
4. Les agents s'exécutent en parallèle (3 au maximum à la fois). Une tâche est créée et suivie pour chaque mission.
5. L'orchestrateur synthétise s'il y a plusieurs réponses.
6. Garde-fous : nombre maximum d'agents par message (par War Room) et nombre maximum d'appels modèle par message (`orchestration.maxCallsPerRun`, 12 par défaut).

Autres modes :

- Ciblé (`@Agent`) ;
- Tous ;
- Débat : positions, puis confrontation, puis synthèse ;
- Synthèse.

## Contexte et coûts

- **Historique borné** : seuls les messages les plus récents tenant dans `context.maxHistoryTokens` (estimation) sont envoyés.
- **Compression** : au-delà de `context.compressThresholdTokens`, les anciens messages sont résumés une fois. Le résumé remplace ces messages dans les appels suivants ; l'historique complet reste en base et visible.
- **Pièces jointes à la demande** : les fichiers ne sont envoyés qu'avec le message auquel ils sont attachés ; les messages suivants les citent par leur nom.
- **Cache** : cache automatique des prompts sur l'API Anthropic. Les lectures de cache sont comptées à part.
- **Coûts honnêtes** : chaque coût porte un type.
  - `api_billed` : tokens exacts × prix connu.
  - `subscription` : couvert par l'abonnement. La valeur affichée est l'équivalent API indiqué par Claude Code, jamais présenté comme une dépense.
  - `local` : modèle local, sans coût par token.
  - `unknown` : prix ou tokens non disponibles ; aucun chiffre n'est inventé.
- **Budgets** : mensuel global, projet, War Room, agent. Ils sont vérifiés avant chaque appel et ne comptent que l'argent réellement facturé.

## Sécurité

- L'API écoute uniquement sur `127.0.0.1` et refuse les requêtes provenant d'une autre origine web (protection contre les sites qui appelleraient l'API locale).
- Clés API et variables sensibles MCP chiffrées en AES-256-GCM, avec une clé maître dans `data/master.key` (ou `WARROOM_MASTER_KEY`). Jamais renvoyées au navigateur ; masquées dans les journaux (`redact`).
- **Bridge Claude Code** : outils intégrés désactivés (`--tools ""`), aucun serveur MCP ni réglage utilisateur chargé, pas de persistance de session, exécution dans un dossier vide `data/cli-sandbox`.
- Fichiers : 50 Mo maximum, exécutables refusés, noms assainis. Le HTML et le SVG importés ne sont jamais affichés inline.
- **Anti-injection** : les documents sont encadrés par des balises `<document>` avec la consigne de ne pas suivre leurs instructions. Les messages des autres agents sont signalés comme de l'information. Les Skills tiers non vérifiés exigent une confirmation explicite.
- **MCP** : un agent ne peut appeler un outil que s'il a la permission MCP et que le serveur lui est attribué. Les outils marqués sensibles exigent une confirmation humaine.
- Aucun code produit par un agent n'est exécuté.
