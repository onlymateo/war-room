# WAR ROOM

Centre de commandement personnel pour orchestrer plusieurs IA : War Rooms par projet, orchestrateur, agents spécialisés, chats indépendants, Skills, serveurs MCP, mémoire et suivi précis de la consommation.

Application **locale** : l'API n'écoute que sur `127.0.0.1`, les données restent dans `data/`.

## Démarrage

Prérequis : Node.js 22+ (testé avec Node 26) et npm.

```bash
npm install
```

```bash
npm run dev
```

Ouvrir http://127.0.0.1:5317 (interface Vite, rechargement à chaud). L'API tourne sur le port 4317.

Mode « production » local (un seul port) :

```bash
npm run build
```

```bash
npm start
```

puis http://127.0.0.1:4317.

Autres commandes : `npm test` (tests unitaires), `npm run typecheck`, `npm run db:generate` (nouvelle migration après modification de `server/db/schema.ts`).

## Connecter vos IA

Page **Models & Providers** :

| Fournisseur | Accès | Remarque |
|---|---|---|
| **Claude Code (abonnement Pro/Max)** | Commande officielle `claude` en mode non interactif | Utilise votre abonnement. Il faut que Claude Code soit installé et connecté (`claude` puis `/login`). |
| Anthropic API | Clé API | Facturée au token, indépendante de l'abonnement Claude. |
| OpenAI, Gemini, Mistral, DeepSeek, xAI, OpenRouter | Clé API | Endpoints compatibles OpenAI. Les modèles sont découverts via l'API du fournisseur. |
| Ollama | Local, sans clé | Gratuit, hors ligne. |
| Personnalisé | URL + clé optionnelle | LM Studio, vLLM, LiteLLM… |

Ce que les abonnements permettent réellement est détaillé dans [docs/PROVIDERS.md](docs/PROVIDERS.md).

## Parcours type

1. Connecter un fournisseur (par exemple Claude Code).
2. Créer une War Room : brief, orchestrateur, autonomie, stratégie de coût, budget.
3. L'orchestrateur analyse le brief : équipe proposée, tâches, Skills (vérifiés dans votre inventaire réel), serveurs MCP, risques, questions.
4. Valider les agents à créer (leur modèle est choisi selon la stratégie de coût).
5. Discuter dans la conversation collective : mode Auto (l'orchestrateur choisit les agents), Ciblé (`@Agent`), Tous, Débat, Synthèse.
6. Discuter individuellement avec chaque agent, suivre les tâches, le journal et la consommation.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) : architecture, décisions, modules, sécurité.
- [docs/PROVIDERS.md](docs/PROVIDERS.md) : fournisseurs, abonnements et API.
- [docs/STATUS.md](docs/STATUS.md) : ce qui est implémenté, ce qui ne l'est pas encore.
