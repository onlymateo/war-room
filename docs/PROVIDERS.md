# Fournisseurs, abonnements et API

WAR ROOM n'utilise que des accès officiels. Aucune authentification n'est simulée et aucun jeton d'abonnement n'est extrait ou réutilisé.

## Claude

| Accès | Ce que c'est | Dans WAR ROOM |
|---|---|---|
| **Abonnement Claude Pro/Max** | Donne accès à claude.ai, aux applications et à **Claude Code**. N'inclut **pas** l'API Anthropic. | Fournisseur **« Claude Code »** : WAR ROOM lance la commande officielle `claude -p --output-format stream-json` installée sur votre machine. L'authentification est celle que vous avez faite dans Claude Code ; WAR ROOM ne lit jamais vos identifiants. L'usage compte dans les limites de votre forfait (fenêtres de 5 h et hebdomadaire), qui s'affichent sur le Dashboard quand Claude Code les remonte. |
| **API Anthropic** | Clé `sk-ant-…` de console.anthropic.com, facturée au token. | Fournisseur **« Anthropic API »**. Streaming via le SDK officiel, cache de prompt automatique, tokens et coût exacts. |

Limites du bridge Claude Code :

- Les pièces jointes images et PDF ne sont pas transmises : seul le texte extrait l'est, et l'interface le signale.
- L'historique est envoyé sous forme de transcription à chaque appel.
- Si `ANTHROPIC_API_KEY` est défini dans votre environnement, Claude Code facturerait l'API. WAR ROOM retire cette variable de l'environnement de la CLI, sauf si vous désactivez l'option « Forcer l'abonnement ».

## Autres fournisseurs

| Fournisseur | Accès officiel utilisé | Abonnement grand public |
|---|---|---|
| OpenAI | Clé API (platform.openai.com) | ChatGPT Plus/Pro n'inclut pas l'API. La CLI Codex accepte une connexion ChatGPT : un bridge semblable à Claude Code est possible plus tard, mais il n'est **pas implémenté**. |
| Google Gemini | Clé AI Studio (offre gratuite limitée), endpoint compatible OpenAI | Les abonnements Google AI ne fournissent pas de clé API. |
| Mistral | Clé La Plateforme | Le Chat Pro n'inclut pas l'API. |
| DeepSeek | Clé API prépayée | — |
| xAI | Clé API | SuperGrok / X Premium n'incluent pas l'API. |
| OpenRouter | Clé API (crédits prépayés) | Le coût réel est renvoyé par OpenRouter et utilisé tel quel. |
| Ollama | Serveur local `localhost:11434` | Gratuit. |

Pour ces fournisseurs, les prix des modèles ne sont **pas** préremplis : vérifiez-les et saisissez-les sur la page Models & Providers. Sans prix, le coût affiché reste « inconnu ». Les prix Claude préremplis viennent de la grille Anthropic au 3 novembre 2026.

## Ajouter un fournisseur

1. Ajouter sa définition dans `server/providers/catalog.ts`.
2. S'il expose une API compatible OpenAI, rien d'autre à faire. Sinon, implémenter `ProviderAdapter` (`server/providers/types.ts`) et l'enregistrer dans `server/providers/registry.ts`.
