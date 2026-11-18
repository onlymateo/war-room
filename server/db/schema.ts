import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";
import type {
  AgentParams,
  AgentPermissions,
  Autonomy,
  CostKind,
  CostStrategy,
  MessageMeta,
  ModelCapabilities,
  TaskStatus,
} from "../../shared/types";

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const ts = (name: string) => integer(name, { mode: "number" });

/** Key/value application settings (theme defaults, optimizer settings, ...). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: json<unknown>("value"),
  updatedAt: ts("updated_at").notNull(),
});

/** One row per configured provider. Secrets are encrypted (see server/lib/crypto.ts). */
export const providerConnections = sqliteTable("provider_connections", {
  id: text("id").primaryKey(), // provider id from the catalog, e.g. "anthropic"
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  encryptedSecret: text("encrypted_secret"),
  secretHint: text("secret_hint"),
  baseUrl: text("base_url"),
  config: json<Record<string, unknown>>("config").notNull().default({}),
  status: text("status").$type<"unknown" | "ok" | "error">().notNull().default("unknown"),
  lastError: text("last_error"),
  lastCheckedAt: ts("last_checked_at"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/** Known models per provider: from the built-in catalog, discovered via the provider API, or added manually. */
export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(), // `${providerId}:${modelId}`
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    contextWindow: integer("context_window"),
    maxOutputTokens: integer("max_output_tokens"),
    capabilities: json<ModelCapabilities>("capabilities").notNull(),
    /** USD per 1M tokens. null = unknown (never invented). */
    inputPrice: real("input_price"),
    outputPrice: real("output_price"),
    cacheReadPrice: real("cache_read_price"),
    cacheWritePrice: real("cache_write_price"),
    priceSource: text("price_source"), // e.g. "catalog 2026-11-03", "user"
    tier: text("tier").$type<"economy" | "balanced" | "premium" | null>(),
    source: text("source").$type<"catalog" | "discovered" | "manual">().notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("models_provider_idx").on(t.providerId)],
);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  objectives: text("objectives").notNull().default(""),
  status: text("status").$type<"active" | "paused" | "done" | "archived">().notNull().default("active"),
  budgetUsd: real("budget_usd"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const warRooms = sqliteTable("war_rooms", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  objective: text("objective").notNull().default(""),
  brief: text("brief").notNull().default(""),
  autonomy: text("autonomy").$type<Autonomy>().notNull().default("semi"),
  costStrategy: text("cost_strategy").$type<CostStrategy>().notNull().default("balanced"),
  budgetUsd: real("budget_usd"),
  /** Max agents the orchestrator may call for one user message (cost guard). */
  maxAgentsPerTurn: integer("max_agents_per_turn").notNull().default(3),
  communication: text("communication").notNull().default(""),
  sharedMemory: text("shared_memory").notNull().default(""),
  analysis: json<unknown>("analysis"),
  status: text("status").$type<"active" | "paused" | "archived">().notNull().default("active"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    warRoomId: text("war_room_id"),
    role: text("role").$type<"orchestrator" | "agent">().notNull().default("agent"),
    name: text("name").notNull(),
    icon: text("icon").notNull().default("bot"),
    color: text("color").notNull().default("slate"),
    description: text("description").notNull().default(""),
    function: text("function").notNull().default(""),
    personality: text("personality").notNull().default(""),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    systemPrompt: text("system_prompt").notNull().default(""),
    params: json<AgentParams>("params").notNull().default({}),
    skills: json<string[]>("skills").notNull().default([]),
    mcpServers: json<string[]>("mcp_servers").notNull().default([]),
    /**
     * Per-server tool allowlist: { [mcpServerId]: toolNames[] }. A server with no
     * entry exposes all its tools (backward compatible); an entry restricts to that list.
     */
    mcpTools: json<Record<string, string[]>>("mcp_tools").notNull().default({}),
    memory: text("memory").notNull().default(""),
    tokenLimit: integer("token_limit"),
    budgetUsd: real("budget_usd"),
    priority: integer("priority").notNull().default(0),
    permissions: json<AgentPermissions>("permissions").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("agents_war_room_idx").on(t.warRoomId)],
);

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<"chat" | "warroom" | "agent">().notNull(),
    warRoomId: text("war_room_id"),
    agentId: text("agent_id"),
    title: text("title").notNull(),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    params: json<AgentParams>("params").notNull().default({}),
    systemPrompt: text("system_prompt").notNull().default(""),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    /** Rolling summary of older messages (context compression). */
    summary: text("summary"),
    summaryUpTo: ts("summary_up_to"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("conversations_war_room_idx").on(t.warRoomId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    agentId: text("agent_id"),
    content: text("content").notNull().default(""),
    status: text("status").$type<"complete" | "streaming" | "error" | "aborted" | "pending">().notNull(),
    error: text("error"),
    providerId: text("provider_id"),
    modelId: text("model_id"),
    attachmentIds: json<string[]>("attachment_ids").notNull().default([]),
    meta: json<MessageMeta>("meta").notNull().default({}),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * One row per model call. Token counts are exactly what the provider returned
 * (null when the provider did not report them). Cost is computed from those
 * counts and the model price when both are known; costKind says what it means.
 */
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id"),
    messageId: text("message_id"),
    agentId: text("agent_id"),
    warRoomId: text("war_room_id"),
    projectId: text("project_id"),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    purpose: text("purpose").notNull().default("chat"), // chat | routing | synthesis | analysis | summary
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    cacheWriteTokens: integer("cache_write_tokens"),
    contextTokens: integer("context_tokens"),
    costUsd: real("cost_usd"),
    costKind: text("cost_kind").$type<CostKind>().notNull(),
    latencyMs: integer("latency_ms"),
    status: text("status").$type<"ok" | "error" | "aborted">().notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("usage_created_idx").on(t.createdAt), index("usage_war_room_idx").on(t.warRoomId)],
);

export const files = sqliteTable("files", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  projectId: text("project_id"),
  warRoomId: text("war_room_id"),
  conversationId: text("conversation_id"),
  tags: json<string[]>("tags").notNull().default([]),
  textContent: text("text_content"),
  extraction: text("extraction").$type<"text" | "none" | "unsupported" | "failed">().notNull(),
  createdAt: ts("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  warRoomId: text("war_room_id"),
  projectId: text("project_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").$type<TaskStatus>().notNull().default("todo"),
  priority: integer("priority").notNull().default(2),
  assigneeAgentId: text("assignee_agent_id"),
  dependsOn: json<string[]>("depends_on").notNull().default([]),
  result: text("result"),
  dueAt: ts("due_at"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const activity = sqliteTable(
  "activity",
  {
    id: text("id").primaryKey(),
    warRoomId: text("war_room_id"),
    projectId: text("project_id"),
    agentId: text("agent_id"),
    type: text("type").notNull(),
    summary: text("summary").notNull(),
    data: json<Record<string, unknown>>("data"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("activity_created_idx").on(t.createdAt)],
);

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  scope: text("scope").$type<"global" | "project" | "warroom" | "agent" | "conversation">().notNull(),
  scopeId: text("scope_id"),
  kind: text("kind").$type<"fact" | "decision" | "constraint" | "summary" | "note">().notNull(),
  content: text("content").notNull(),
  source: text("source").notNull().default("user"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * Subscription quota observations (Claude Code `rate_limit_event`), one row per
 * window per call. Used to predict when a window will run out.
 */
export const limitSnapshots = sqliteTable(
  "limit_snapshots",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull(),
    window: text("window").notNull(), // five_hour | seven_day
    utilization: real("utilization"), // 0..1, null if not reported
    resetsAt: ts("resets_at"), // ms
    status: text("status"), // allowed | allowed_warning | rejected | ...
    observedAt: ts("observed_at").notNull(),
  },
  (t) => [index("limit_snapshots_idx").on(t.providerId, t.window, t.observedAt)],
);

/** Work paused by the limit guard, to resume after the quota resets. */
export const pausedWork = sqliteTable("paused_work", {
  id: text("id").primaryKey(),
  kind: text("kind").$type<"chat" | "collective">().notNull(),
  warRoomId: text("war_room_id"),
  conversationId: text("conversation_id").notNull(),
  agentId: text("agent_id"),
  title: text("title").notNull(),
  payload: json<Record<string, unknown>>("payload").notNull(),
  reason: text("reason").notNull(),
  resetsAt: ts("resets_at"),
  status: text("status").$type<"paused" | "ready" | "resumed" | "cancelled">().notNull(),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

/** Progress reports of a War Room (daily, or generated on demand). */
export const roomReports = sqliteTable(
  "room_reports",
  {
    id: text("id").primaryKey(),
    warRoomId: text("war_room_id").notNull(),
    kind: text("kind").$type<"daily" | "manual">().notNull(),
    /** Local calendar day the daily report belongs to (YYYY-MM-DD). */
    day: text("day").notNull(),
    periodStart: ts("period_start").notNull(),
    periodEnd: ts("period_end").notNull(),
    markdown: text("markdown").notNull(),
    stats: json<Record<string, number>>("stats").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("room_reports_idx").on(t.warRoomId, t.day)],
);

export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  transport: text("transport").$type<"stdio" | "http">().notNull(),
  command: text("command"),
  args: json<string[]>("args").notNull().default([]),
  encryptedEnv: text("encrypted_env"),
  url: text("url"),
  encryptedHeaders: text("encrypted_headers"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /** Tool names that always need human confirmation before an agent can run them. */
  sensitiveTools: json<string[]>("sensitive_tools").notNull().default([]),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});
