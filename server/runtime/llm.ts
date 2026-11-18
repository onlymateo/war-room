import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { log } from "../lib/logger";
import { getProviderDef } from "../providers/catalog";
import { getAdapter, getModel, resolveCredentials } from "../providers/registry";
import type { ChatTurn, ProviderUsage } from "../providers/types";
import { ProviderError } from "../providers/types";
import { computeCost } from "../usage/cost";
import { assertWithinBudget } from "../usage/budget";
import type { AgentParams, UsageSummary } from "../../shared/types";
import { executeAgentTool, type ToolRunContext } from "../mcp/tools";
import { registerProxySession } from "../mcp/proxy";
import { assertClaudeAvailable, getLimitState, LimitPausedError, recordHardLimit, recordRateLimit } from "../limits/guard";

async function getToolRoundLimit(): Promise<number> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "orchestration.maxToolRounds") });
  return typeof row?.value === "number" ? row.value : 8;
}

export interface CallContext {
  conversationId?: string | null;
  messageId?: string | null;
  agentId?: string | null;
  warRoomId?: string | null;
  projectId?: string | null;
  purpose?: "chat" | "routing" | "synthesis" | "analysis" | "summary" | "debate" | "prompt";
}

export interface CallInput {
  providerId: string;
  modelId: string;
  system?: string;
  messages: ChatTurn[];
  params?: AgentParams;
  signal?: AbortSignal;
  context?: CallContext;
  onDelta?: (text: string) => void;
  /** MCP tools for this call (agent replies only). */
  toolContext?: ToolRunContext | null;
}

/** Sum per-round usage (tool loops make several API calls for one reply). Unknown stays unknown. */
export function addUsage(a: ProviderUsage | null, b: ProviderUsage): ProviderUsage {
  if (!a) return { ...b };
  const sum = (x?: number | null, y?: number | null) => (x == null && y == null ? null : (x ?? 0) + (y ?? 0));
  return {
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    cacheReadTokens: sum(a.cacheReadTokens, b.cacheReadTokens),
    cacheWriteTokens: sum(a.cacheWriteTokens, b.cacheWriteTokens),
    reportedCostUsd: sum(a.reportedCostUsd, b.reportedCostUsd),
    rateLimit: b.rateLimit ?? a.rateLimit ?? null,
  };
}

export interface CallResult {
  text: string;
  usage: UsageSummary;
  aborted: boolean;
}

export class ModelCallError extends Error {
  constructor(
    message: string,
    public readonly partialText: string,
    public readonly usage: UsageSummary,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ModelCallError";
  }
}

/**
 * The single entry point for every model call in WAR ROOM. It enforces budgets,
 * streams text, and records one usage_events row with the provider's real numbers.
 */
export async function callModel(input: CallInput): Promise<CallResult> {
  const ctx = input.context ?? {};
  await assertWithinBudget(ctx);
  // Subscription quota guard: refuses the call (cleanly) when a Claude window is about to run out.
  await assertClaudeAvailable(input.providerId);

  const def = getProviderDef(input.providerId);
  const model = await getModel(input.providerId, input.modelId);
  const creds = await resolveCredentials(input.providerId);
  const adapter = getAdapter(input.providerId);

  const started = now();
  let text = "";
  let usage: ProviderUsage | null = null;
  let lastRound: ProviderUsage | null = null;
  let status: "ok" | "error" | "aborted" = "ok";
  let error: unknown = null;

  // Tools: API providers run the loop in the adapter with our executor; the Claude Code
  // CLI gets a one-off MCP proxy URL that routes back to the same executor.
  const tc = input.toolContext && input.toolContext.tools.length ? input.toolContext : null;
  const proxy = tc && def.kind === "claude_cli" ? registerProxySession(tc) : null;
  const maxToolRounds = await getToolRoundLimit();

  try {
    for await (const ev of adapter.stream(
      {
        model: input.modelId,
        system: input.system,
        messages: input.messages,
        params: input.params,
        signal: input.signal,
        ...(tc && !proxy
          ? {
              tools: tc.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
              runTool: (name: string, args: Record<string, unknown>) => executeAgentTool(tc, name, args),
              maxToolRounds,
            }
          : {}),
        ...(proxy ? { mcpProxyUrl: proxy.url } : {}),
      },
      creds,
    )) {
      if (ev.type === "text") {
        text += ev.delta;
        input.onDelta?.(ev.delta);
      } else if (ev.type === "usage") {
        usage = addUsage(usage, ev.usage);
        lastRound = ev.usage;
      }
    }
  } catch (err) {
    error = err;
    status = err instanceof ProviderError && err.code === "aborted" ? "aborted" : "error";
  } finally {
    proxy?.dispose();
  }

  const cost = computeCost(def.costKind, usage, model ?? null, def.kind === "openai_compatible");
  // Context size is that of the last round (the largest prompt), not the sum of rounds.
  const lastContext = computeCost(def.costKind, lastRound, model ?? null, def.kind === "openai_compatible").contextTokens;
  cost.contextTokens = lastContext;
  const summary: UsageSummary = {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.cacheWriteTokens ?? null,
    costUsd: cost.costUsd,
    costKind: cost.costKind,
    latencyMs: now() - started,
    contextTokens: cost.contextTokens,
    contextWindow: model?.contextWindow ?? null,
  };

  try {
    await db.insert(schema.usageEvents).values({
      id: newId("use"),
      conversationId: ctx.conversationId ?? null,
      messageId: ctx.messageId ?? null,
      agentId: ctx.agentId ?? null,
      warRoomId: ctx.warRoomId ?? null,
      projectId: ctx.projectId ?? null,
      providerId: input.providerId,
      modelId: input.modelId,
      purpose: ctx.purpose ?? "chat",
      inputTokens: summary.inputTokens,
      outputTokens: summary.outputTokens,
      cacheReadTokens: summary.cacheReadTokens,
      cacheWriteTokens: summary.cacheWriteTokens,
      contextTokens: summary.contextTokens,
      costUsd: summary.costUsd,
      costKind: summary.costKind,
      latencyMs: summary.latencyMs,
      status,
      createdAt: now(),
    });
    if (usage?.rateLimit && def.kind === "claude_cli") {
      const value = { ...usage.rateLimit, observedAt: now() };
      await db
        .insert(schema.settings)
        .values({ key: "claude-code.rateLimit", value, updatedAt: now() })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now() } });
      await recordRateLimit(input.providerId, usage.rateLimit);
    }
  } catch (err) {
    log.error("Failed to record usage", err);
  }

  // A real call is the best connectivity check: reflect it in the provider status.
  try {
    await db
      .update(schema.providerConnections)
      .set(
        status === "ok"
          ? { status: "ok", lastError: null, lastCheckedAt: now() }
          : status === "error" && error instanceof ProviderError && (error.code === "auth" || error.code === "unavailable")
            ? { status: "error", lastError: error.message, lastCheckedAt: now() }
            : {},
      )
      .where(eq(schema.providerConnections.id, input.providerId));
  } catch {
    /* status is informative only */
  }

  if (status === "aborted") return { text, usage: summary, aborted: true };
  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof ProviderError ? error.code : "unknown";
    // Subscription quota refused the call: record it and pause cleanly instead of failing.
    if (def.kind === "claude_cli" && code === "rate_limit") {
      await recordHardLimit(input.providerId, message).catch(() => undefined);
      const state = await getLimitState(input.providerId);
      throw new LimitPausedError(`Limite Claude atteinte : ${message}`, state.resumeAt, text);
    }
    throw new ModelCallError(message, text, summary, code);
  }
  return { text, usage: summary, aborted: false };
}

/** Extract the first JSON object from a model reply (tolerates ```json fences and prose around it). */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = fenced ? [fenced[1], text] : [text];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1)) as T;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
