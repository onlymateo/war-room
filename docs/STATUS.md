# État d'avancement

## Implémenté et testé de bout en bout

- **Fournisseurs** : Claude Code (abonnement), Anthropic API, endpoints compatibles OpenAI (OpenAI, Gemini, Mistral, DeepSeek, xAI, OpenRouter, Ollama, serveur personnalisé). Test de connexion, découverte des modèles, prix modifiables, clés chiffrées.
- **Chats indépendants** : streaming, changement de modèle en cours de conversation, paramètres (prompt système, effort, température, tokens max), renommer, archiver, supprimer, rechercher dans le contenu, pièces jointes.
- **War Rooms** :
  - création (brief, fichiers, orchestrateur, autonomie, stratégie, budget) ;
  - analyse du brief (équipe, tâches, Skills, MCP, risques, questions) et création de l'équipe proposée ;
  - agents entièrement configurables ;
  - conversation collective avec les modes Auto, Ciblé, Tous, Débat et Synthèse ;
  - validation humaine des plans ;
  - chats individuels avec chaque agent ;
  - vue organisationnelle et vue activité en temps réel ;
  - tâches en kanban, journal, consommation par agent et contexte.
- **Consommation** : tokens exacts par appel (entrée, sortie, cache), coûts typés, contexte utilisé par rapport à la fenêtre du modèle, budgets avec alertes à 50, 80 et 100 %, quota de l'abonnement Claude Code.
- **Optimisation** :
  - historique borné et compression automatique par résumé ;
  - modèle de routage et modèle de résumé moins chers, en option ;
  - choix des modèles par gamme selon la stratégie ;
  - cache de prompt Anthropic ;
  - plafonds d'agents et d'appels par message.
- **Skills** : inventaire réel (Skills Claude Code de l'utilisateur, marketplace de plugins, Skills WAR ROOM), installation dans WAR ROOM (confirmation requise pour une source non vérifiée), création de Skills personnalisés, injection dans le prompt des agents, recommandations comparées à l'inventaire.
- **MCP** : ajout de serveurs STDIO et HTTP, connexion et déconnexion, outils, ressources, prompts, journaux, test manuel des outils, outils sensibles, attribution aux agents.
- **Projets** : liste, détail, vues Synthèse, Kanban, Liste et Timeline, décisions, rattachement de War Rooms.
- **Fichiers et mémoire** : upload, aperçu, téléchargement, tags, extraction de texte (texte, code, CSV, JSON, PDF, DOCX), mémoire structurée par portée.
- **Interface** : thème sombre et clair, barre latérale repliable, recherche globale (Ctrl K), raccourcis, toasts, états vides, gestion des erreurs par page.

## Pas encore implémenté

| Fonctionnalité | Situation actuelle | Prochaine étape |
|---|---|---|
| Appels d'outils MCP **automatiques** par les agents pendant une conversation | Outils testables manuellement, permissions déjà appliquées côté serveur | Boucle `tool_use` dans les adaptateurs, avec une carte de confirmation dans le chat pour les outils sensibles |
| RAG vectoriel | Recherche par mots-clés, documents envoyés en texte | Embeddings et colonnes vecteur libSQL |
| Injection automatique des mémoires structurées (page Mémoire) | Seules la mémoire commune de la War Room, la mémoire de chaque agent et les résumés sont injectés | Récupération sélective par portée |
| Détection de contradictions dans la mémoire | — | Passe de vérification par un modèle économique |
| Réévaluation périodique des Skills | Analyse à la demande (bouton « Relancer l'analyse ») | Déclencheurs : nouvelle phase, nouveau langage détecté |
| Recherche de Skills sur Internet | Sources locales et marketplace officielle uniquement | Sources configurables et vérifiées |
| Excel (.xlsx) et archives | Stockés mais pas d'extraction de texte : l'interface l'indique | Extraction côté serveur |
| Vidéos | Stockées et prévisualisables, non transmises aux modèles : l'interface l'indique | Selon les modèles connectés |
| Bridge Codex CLI ou Gemini CLI (abonnements OpenAI et Google) | Non implémenté | Même approche que Claude Code |
| Historique des versions de fichiers, stockage S3 | Stockage local simple | Abstraction de stockage |
