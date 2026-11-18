# Providers, subscriptions and APIs

WAR ROOM only uses official access methods. No authentication is faked, and no subscription token is extracted or reused.

## Claude

| Access | What it is | In WAR ROOM |
|---|---|---|
| **Claude Pro/Max subscription** | Gives access to claude.ai, the apps and **Claude Code**. Does **not** include the Anthropic API. | **"Claude Code"** provider: WAR ROOM runs the official `claude -p --output-format stream-json` command installed on your machine. Authentication is the one you set up in Claude Code; WAR ROOM never reads your credentials. Usage counts toward your plan's limits (5-hour and weekly windows), which WAR ROOM tracks from what Claude Code reports. |
| **Anthropic API** | An `sk-ant-…` key from console.anthropic.com, billed per token. | **"Anthropic API"** provider. Streaming through the official SDK, automatic prompt caching, exact tokens and cost. |

Limitations of the Claude Code bridge:

- Image and PDF attachments are not forwarded: only extracted text is, and the interface says so.
- The history is sent as a transcript on every call.
- If `ANTHROPIC_API_KEY` is set in your environment, Claude Code would bill the API. WAR ROOM removes that variable from the CLI's environment, unless you turn off the "Force subscription" option.

## Other providers

| Provider | Official access used | Consumer subscription |
|---|---|---|
| OpenAI | API key (platform.openai.com) | ChatGPT Plus/Pro does not include the API. The Codex CLI accepts a ChatGPT sign-in: a bridge similar to Claude Code is possible later, but it is **not implemented**. |
| Google Gemini | AI Studio key (limited free tier), OpenAI-compatible endpoint | Google AI subscriptions do not provide an API key. |
| Mistral | La Plateforme key | Le Chat Pro does not include the API. |
| DeepSeek | Prepaid API key | — |
| xAI | API key | SuperGrok / X Premium do not include the API. |
| OpenRouter | API key (prepaid credits) | The actual cost is returned by OpenRouter and used as is. |
| Ollama | Local server at `localhost:11434` | Free. |

For these providers, model prices are **not** prefilled: check them and enter them on the Models & Providers page. Without a price, the cost shown stays "unknown". Prefilled Claude prices come from Anthropic's price list as of November 3, 2026.

## Adding a provider

1. Add its definition in `server/providers/catalog.ts`.
2. If it exposes an OpenAI-compatible API, nothing else is needed. Otherwise, implement `ProviderAdapter` (`server/providers/types.ts`) and register it in `server/providers/registry.ts`.
