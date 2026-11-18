import type { CatalogModel, ProviderDefinition } from "./types";

/**
 * Built-in provider catalog.
 *
 * Prices are only included where they come from an authoritative, dated source
 * (Anthropic pricing as of 2026-11-03). Every other model price is left unknown
 * and can be filled in by the user on the Models & Providers page. Model lists
 * for non-Anthropic providers are discovered live from each provider's
 * /models endpoint once connected, rather than hard-coded here.
 */

const CLAUDE_PRICE_SOURCE = "Anthropic pricing, 2026-11-03";

const claudeCaps = { vision: true, pdf: true, tools: true, streaming: true, effort: true, temperature: false };

const CLAUDE_MODELS: CatalogModel[] = [
  {
    modelId: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: claudeCaps,
    tier: "premium",
    price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, source: CLAUDE_PRICE_SOURCE },
  },
  {
    modelId: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: claudeCaps,
    tier: "balanced",
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, source: CLAUDE_PRICE_SOURCE },
  },
  {
    modelId: "claude-haiku-5-5",
    displayName: "Claude Haiku 5.5",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: claudeCaps,
    tier: "economy",
    // Price valid for prompts up to 100K tokens ($0.50 / $2.50 beyond).
    price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, source: `${CLAUDE_PRICE_SOURCE} (prompts ≤100K tokens)` },
  },
  {
    modelId: "claude-fable-5-2",
    displayName: "Claude Fable 5.2",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    capabilities: claudeCaps,
    tier: "premium",
    price: { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10, source: CLAUDE_PRICE_SOURCE },
  },
];

/** Claude Code CLI models: same models, but usage is covered by the subscription, so no price is attached. */
const CLAUDE_CLI_MODELS: CatalogModel[] = CLAUDE_MODELS.map(({ price: _price, ...m }) => ({
  ...m,
  // Attachments are not passed through the CLI bridge yet (text extraction still works).
  capabilities: { ...m.capabilities, vision: false, pdf: false },
}));

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code (Pro/Max)",
    kind: "claude_cli",
    authMode: "cli_subscription",
    description: "Uses your Claude Pro/Max subscription through the official `claude` CLI, run locally in headless mode.",
    accessNotes:
      "WAR ROOM spawns the official Claude Code binary (`claude -p`) installed on this machine. Authentication is whatever you configured in Claude Code (`claude` then /login). WAR ROOM never reads or stores your OAuth tokens. Built-in tools, MCP servers, settings and slash commands are disabled for these calls, and the CLI runs in an empty sandbox folder.",
    subscriptionNotes:
      "Calls count against your Claude plan's usage limits (5-hour and weekly windows), not against API billing. The cost Claude Code reports is an API-equivalent value, shown as such, never as money spent. If ANTHROPIC_API_KEY is set in your environment, Claude Code would bill the API instead: WAR ROOM removes it from the CLI environment unless you disable that option.",
    docsUrl: "https://code.claude.com/docs/en/headless",
    defaultBaseUrl: null,
    requiresSecret: false,
    costKind: "subscription",
    catalog: CLAUDE_CLI_MODELS,
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    kind: "anthropic",
    authMode: "api_key",
    description: "Claude models through the Anthropic API (pay per token).",
    accessNotes: "Requires an API key from console.anthropic.com. Billed per token, separately from any Claude.ai subscription.",
    subscriptionNotes:
      "A Claude Pro/Max subscription does NOT include API access. Use the Claude Code provider to use your subscription.",
    docsUrl: "https://platform.claude.com/docs",
    defaultBaseUrl: null,
    requiresSecret: true,
    costKind: "api_billed",
    catalog: CLAUDE_MODELS,
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "GPT models through the OpenAI API.",
    accessNotes: "Requires an API key from platform.openai.com. Billed per token.",
    subscriptionNotes:
      "ChatGPT Plus/Pro subscriptions do not include API access. (OpenAI's Codex CLI can sign in with ChatGPT; a CLI bridge like the Claude Code one is not implemented yet.)",
    docsUrl: "https://platform.openai.com/docs",
    defaultBaseUrl: "https://api.openai.com/v1",
    requiresSecret: true,
    maxTokensField: "max_completion_tokens",
    costKind: "api_billed",
    catalog: [],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "Gemini models through Google AI Studio's OpenAI-compatible endpoint.",
    accessNotes: "Requires a Gemini API key from aistudio.google.com. A free tier with rate limits exists.",
    subscriptionNotes: "Google AI Pro/Ultra subscriptions do not provide an API key. Use an AI Studio key.",
    docsUrl: "https://ai.google.dev/gemini-api/docs/openai",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    requiresSecret: true,
    costKind: "api_billed",
    catalog: [],
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "Mistral models through La Plateforme.",
    accessNotes: "Requires an API key from console.mistral.ai.",
    subscriptionNotes: "Le Chat Pro does not include API access.",
    docsUrl: "https://docs.mistral.ai",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    requiresSecret: true,
    costKind: "api_billed",
    catalog: [],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "DeepSeek models through their OpenAI-compatible API.",
    accessNotes: "Requires an API key from platform.deepseek.com.",
    subscriptionNotes: "API access is prepaid and separate from the chat app.",
    docsUrl: "https://api-docs.deepseek.com",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    requiresSecret: true,
    costKind: "api_billed",
    catalog: [],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "Grok models through the xAI API.",
    accessNotes: "Requires an API key from console.x.ai.",
    subscriptionNotes: "SuperGrok / X Premium subscriptions do not include API access.",
    docsUrl: "https://docs.x.ai",
    defaultBaseUrl: "https://api.x.ai/v1",
    requiresSecret: true,
    costKind: "api_billed",
    catalog: [],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "Many providers' models behind one API key.",
    accessNotes: "Requires an API key from openrouter.ai. Prepaid credits.",
    subscriptionNotes: "Not a subscription: pay per token through OpenRouter credits.",
    docsUrl: "https://openrouter.ai/docs",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    requiresSecret: true,
    costKind: "api_billed",
    catalog: [],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    kind: "openai_compatible",
    authMode: "none",
    description: "Local models served by Ollama on this machine. Free, private, offline.",
    accessNotes: "Install Ollama and pull a model (`ollama pull <model>`). WAR ROOM talks to http://localhost:11434.",
    subscriptionNotes: "No subscription or API key: runs on your hardware.",
    docsUrl: "https://ollama.com",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresSecret: false,
    costKind: "local",
    catalog: [],
  },
  {
    id: "custom-openai",
    name: "Custom (OpenAI-compatible)",
    kind: "openai_compatible",
    authMode: "api_key",
    description: "Any server exposing an OpenAI-compatible /v1/chat/completions endpoint (LM Studio, vLLM, LiteLLM...).",
    accessNotes: "Set the base URL and, if the server needs one, an API key.",
    subscriptionNotes: "Depends on the server.",
    docsUrl: "https://platform.openai.com/docs/api-reference/chat",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresSecret: false,
    costKind: "api_billed",
    catalog: [],
  },
];

export function getProviderDef(id: string): ProviderDefinition {
  const def = PROVIDERS.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown provider: ${id}`);
  return def;
}
