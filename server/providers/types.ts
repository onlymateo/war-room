import type { AgentParams, AuthMode, ModelCapabilities } from "../../shared/types";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; base64: string; name: string }
  | { type: "pdf"; base64: string; name: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: ContentPart[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface GenerateRequest {
  model: string;
  system?: string;
  messages: ChatTurn[];
  params?: AgentParams;
  signal?: AbortSignal;
  /** API providers: tools the model may call; `runTool` executes them (permissions enforced by the caller). */
  tools?: ToolSpec[];
  runTool?: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
  /** Max model round-trips caused by tool use in one reply. */
  maxToolRounds?: number;
  /** Claude Code CLI: URL of the WAR ROOM MCP proxy exposing this agent's tools. */
  mcpProxyUrl?: string;
}

/** Usage exactly as reported by the provider; undefined/null means "not reported". */
export interface ProviderUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  /** Cost reported by the provider/tool itself (e.g. Claude Code `total_cost_usd`, OpenRouter `usage.cost`). */
  reportedCostUsd?: number | null;
  /** Subscription quota info when the tool exposes it (Claude Code rate_limit_event). */
  rateLimit?: Record<string, unknown> | null;
}

export type StreamEvent =
  | { type: "text"; delta: string }
  /** Emitted once per model round-trip; the caller sums them. */
  | { type: "usage"; usage: ProviderUsage }
  | { type: "done"; stopReason: string | null; modelUsed?: string };

export interface ResolvedCredentials {
  secret: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
}

export interface DiscoveredModel {
  modelId: string;
  displayName: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
}

export interface ProviderAdapter {
  stream(req: GenerateRequest, creds: ResolvedCredentials): AsyncIterable<StreamEvent>;
  /** Query the provider for its model list. Return null if the provider has no listing endpoint. */
  listModels(creds: ResolvedCredentials): Promise<DiscoveredModel[] | null>;
  /** Cheap connectivity/auth check. Throws a user-readable error on failure. */
  test(creds: ResolvedCredentials): Promise<string>;
}

export interface CatalogModel {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: ModelCapabilities;
  tier: "economy" | "balanced" | "premium";
  /** USD / 1M tokens. Only set when known from an authoritative, dated source. */
  price?: { input: number; output: number; cacheRead?: number; cacheWrite?: number; source: string };
}

export interface ProviderDefinition {
  id: string;
  name: string;
  kind: "anthropic" | "openai_compatible" | "claude_cli";
  authMode: AuthMode;
  description: string;
  /** How access works technically (API key, local server, official CLI...). */
  accessNotes: string;
  /** What a consumer subscription does / does not give you for this provider. */
  subscriptionNotes: string;
  docsUrl: string;
  defaultBaseUrl: string | null;
  requiresSecret: boolean;
  /** For openai_compatible: which field caps output length. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** What cost a call on this provider represents. */
  costKind: "api_billed" | "subscription" | "local";
  catalog: CatalogModel[];
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: "auth" | "rate_limit" | "not_found" | "bad_request" | "unavailable" | "aborted" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
