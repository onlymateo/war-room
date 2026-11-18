/**
 * Types shared between the server and the web UI.
 * Keep this file free of runtime dependencies.
 */

export type Autonomy = "assisted" | "semi" | "autonomous";
export type CostStrategy = "quality" | "balanced" | "economy" | "strict";
export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "blocked";

/**
 * What a cost figure means. Never mix them up in the UI:
 * - api_billed: pay-per-use API; cost = provider token counts x known price.
 * - subscription: covered by a flat subscription (e.g. Claude Pro/Max via Claude Code);
 *   costUsd, when present, is the API-equivalent value reported by the tool, NOT money spent.
 * - local: local model (Ollama...), no per-token cost.
 * - unknown: tokens and/or price unavailable.
 */
export type CostKind = "api_billed" | "subscription" | "local" | "unknown";

export type AuthMode = "api_key" | "none" | "cli_subscription";

export interface ModelCapabilities {
  vision?: boolean;
  pdf?: boolean;
  tools?: boolean;
  streaming?: boolean;
  /** Supports reasoning-effort control (low..max). */
  effort?: boolean;
  /** Accepts temperature. */
  temperature?: boolean;
}

export interface AgentParams {
  temperature?: number;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export interface AgentPermissions {
  /** Read the War Room brief, shared memory and collective thread. */
  readWarRoomContext: boolean;
  /** Read files attached to the War Room. */
  readFiles: boolean;
  /** MCP tools may be called (still limited to assigned servers). */
  useMcp: boolean;
  /** Orchestrator only: may dispatch work to agents without asking. */
  dispatchWithoutApproval: boolean;
}

export const DEFAULT_PERMISSIONS: AgentPermissions = {
  readWarRoomContext: true,
  readFiles: true,
  useMcp: false,
  dispatchWithoutApproval: false,
};

export type CollectiveMode = "auto" | "all" | "direct" | "debate" | "synthesis";

export interface RoutingPlan {
  reasoning: string;
  answerDirectly: boolean;
  steps: { agentId: string; agentName: string; instruction: string }[];
  synthesize: boolean;
}

export interface MessageMeta {
  /** Collective chat: which mode produced this message. */
  mode?: CollectiveMode;
  /** Orchestrator routing plan attached to a plan message. */
  plan?: RoutingPlan;
  planStatus?: "pending_approval" | "approved" | "rejected" | "executed";
  /** Agent message: instruction it received from the orchestrator. */
  instruction?: string;
  kind?: "plan" | "agent_reply" | "synthesis" | "debate_round" | "direct_answer" | "note";
  /** Plan message: the user message it answers. */
  userMessageId?: string;
  /** Agent message: the task row created for it. */
  taskId?: string;
  round?: number;
  /** Attachments that could not be sent to the model, with the reason. */
  skippedAttachments?: { id: string; name: string; reason: string }[];
  usage?: UsageSummary;
}

export interface UsageSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number | null;
  costKind: CostKind;
  latencyMs: number | null;
  contextTokens: number | null;
  contextWindow: number | null;
}

/** Events streamed (SSE) to the browser while a chat / war room run executes. */
export type RunEvent =
  | { type: "message_created"; message: MessageDTO }
  | { type: "delta"; messageId: string; text: string }
  | { type: "status"; messageId?: string; agentId?: string; status: string }
  | { type: "message_done"; message: MessageDTO }
  | { type: "plan"; message: MessageDTO }
  | { type: "notice"; level: "info" | "warning" | "error"; text: string }
  | { type: "error"; error: string; messageId?: string }
  | { type: "run_done" };

export interface MessageDTO {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  agentId: string | null;
  content: string;
  status: "complete" | "streaming" | "error" | "aborted" | "pending";
  error: string | null;
  providerId: string | null;
  modelId: string | null;
  attachmentIds: string[];
  meta: MessageMeta;
  createdAt: number;
}

export interface ProviderDTO {
  id: string;
  name: string;
  kind: "anthropic" | "openai_compatible" | "claude_cli";
  authMode: AuthMode;
  description: string;
  accessNotes: string;
  subscriptionNotes: string;
  docsUrl: string;
  defaultBaseUrl: string | null;
  requiresSecret: boolean;
  configured: boolean;
  enabled: boolean;
  secretHint: string | null;
  baseUrl: string | null;
  config: Record<string, unknown>;
  status: "unknown" | "ok" | "error";
  lastError: string | null;
  lastCheckedAt: number | null;
  modelCount: number;
}

export interface ModelDTO {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: ModelCapabilities;
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
  priceSource: string | null;
  tier: "economy" | "balanced" | "premium" | null;
  source: "catalog" | "discovered" | "manual";
  enabled: boolean;
}

export interface FileDTO {
  id: string;
  name: string;
  mime: string;
  size: number;
  extraction: "text" | "none" | "unsupported" | "failed";
  hasText: boolean;
  projectId: string | null;
  warRoomId: string | null;
  conversationId: string | null;
  tags: string[];
  createdAt: number;
}
