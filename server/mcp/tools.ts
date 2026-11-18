import { eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { logActivity } from "../activity/log";
import { callTool, McpPermissionError, statusOf } from "./manager";
import { requestApproval } from "./approvals";
import type { RunEvent, ToolCallRecord } from "../../shared/types";

/**
 * Agent-facing tool gateway. Every MCP tool call made by an agent, whatever the
 * provider (Anthropic API, OpenAI-compatible, or the Claude Code CLI through the
 * WAR ROOM MCP proxy), goes through `executeAgentTool`, which:
 *  - only exposes tools of servers assigned to the agent, when it has the MCP permission;
 *  - asks the human before running tools marked sensitive;
 *  - truncates results so a tool cannot flood the context (and the bill);
 *  - records each call on the message and in the activity log.
 */

export interface AgentTool {
  /** Name shown to the model: `<server>__<tool>`, provider-safe (^[a-zA-Z0-9_-]{1,64}$). */
  name: string;
  serverId: string;
  serverName: string;
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  sensitive: boolean;
}

export interface ToolRunContext {
  agentId: string;
  agentName: string;
  warRoomId: string | null;
  messageId: string | null;
  tools: AgentTool[];
  calls: ToolCallRecord[];
  emit: (e: RunEvent) => void;
  signal?: AbortSignal;
  /** Hard cap on tool calls for one reply. */
  maxCalls: number;
}

export const MAX_TOOL_RESULT_CHARS = 20_000;

function slug(s: string, max: number) {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max) || "x";
}

/** Per-agent allowlist: no entry for the server = all its tools; an entry = only those. */
export function isToolAllowed(allowlist: Record<string, string[]> | null | undefined, serverId: string, tool: string): boolean {
  const list = allowlist?.[serverId];
  return list === undefined || list.includes(tool);
}

export function toolName(serverName: string, tool: string) {
  return `${slug(serverName, 20)}__${slug(tool, 41)}`.slice(0, 64);
}

/** Tools available to an agent right now (empty if it lacks permission or nothing is connected). */
export async function toolsForAgent(agentId: string): Promise<AgentTool[]> {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent?.permissions.useMcp || agent.mcpServers.length === 0) return [];
  const servers = await db.select().from(schema.mcpServers).where(inArray(schema.mcpServers.id, agent.mcpServers));
  const out: AgentTool[] = [];
  const seen = new Set<string>();
  for (const s of servers.filter((x) => x.enabled)) {
    const live = statusOf(s.id);
    if (live.status !== "connected") continue;
    for (const t of live.tools) {
      if (!isToolAllowed(agent.mcpTools, s.id, t.name)) continue;
      let name = toolName(s.name, t.name);
      while (seen.has(name)) name = `${name.slice(0, 60)}_${seen.size}`;
      seen.add(name);
      const schemaObj = (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : {}) as Record<string, unknown>;
      out.push({
        name,
        serverId: s.id,
        serverName: s.name,
        tool: t.name,
        description: `[${s.name}] ${t.description ?? t.name}`.slice(0, 1000),
        inputSchema: { type: "object", properties: {}, ...schemaObj },
        sensitive: s.sensitiveTools.includes(t.name),
      });
    }
  }
  return out;
}

/** Servers assigned to an agent that are not usable right now, so the UI can say why. */
export async function unavailableToolServers(agentId: string): Promise<string[]> {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent?.permissions.useMcp || agent.mcpServers.length === 0) return [];
  const servers = await db.select().from(schema.mcpServers).where(inArray(schema.mcpServers.id, agent.mcpServers));
  return servers.filter((s) => !s.enabled || statusOf(s.id).status !== "connected").map((s) => s.name);
}

/** Flatten MCP content items into text for the model. */
export function mcpResultToText(result: unknown): { text: string; isError: boolean } {
  const r = result as { content?: unknown[]; isError?: boolean; structuredContent?: unknown; toolResult?: unknown };
  const parts: string[] = [];
  for (const item of r?.content ?? []) {
    const it = item as { type?: string; text?: string; mimeType?: string; resource?: { text?: string; uri?: string }; uri?: string; name?: string };
    if (it.type === "text" && typeof it.text === "string") parts.push(it.text);
    else if (it.type === "image") parts.push(`[image ${it.mimeType ?? ""} returned by the tool — not forwarded]`);
    else if (it.type === "audio") parts.push(`[audio returned by the tool — not forwarded]`);
    else if (it.type === "resource") parts.push(it.resource?.text ?? `[resource ${it.resource?.uri ?? ""}]`);
    else if (it.type === "resource_link") parts.push(`[resource link: ${it.name ?? ""} ${it.uri ?? ""}]`);
  }
  if (!parts.length && r?.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  if (!parts.length && r?.toolResult !== undefined) parts.push(JSON.stringify(r.toolResult));
  let text = parts.join("\n").trim() || "(empty result)";
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    text = `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n[… result truncated by WAR ROOM: ${text.length - MAX_TOOL_RESULT_CHARS} more characters]`;
  }
  return { text, isError: !!r?.isError };
}

export async function executeAgentTool(ctx: ToolRunContext, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const tool = ctx.tools.find((t) => t.name === name);
  if (!tool) return { text: `Tool "${name}" is not available to you.`, isError: true };
  if (ctx.calls.length >= ctx.maxCalls) {
    return { text: `Tool call limit reached for this reply (${ctx.maxCalls}). Answer with what you have.`, isError: true };
  }
  const record: ToolCallRecord = {
    id: newId("tc"),
    serverId: tool.serverId,
    serverName: tool.serverName,
    tool: tool.tool,
    args,
    status: tool.sensitive ? "awaiting_approval" : "running",
    startedAt: now(),
  };
  ctx.calls.push(record);
  const update = (patch: Partial<ToolCallRecord>) => {
    Object.assign(record, patch);
    ctx.emit({ type: "tool_call", messageId: ctx.messageId, call: { ...record } });
  };
  update({});

  if (tool.sensitive) {
    const approved = await requestApproval(
      { messageId: ctx.messageId, agentId: ctx.agentId, agentName: ctx.agentName, serverName: tool.serverName, tool: tool.tool, args },
      ctx.signal,
      (request) => {
        record.approvalId = request.approvalId;
        ctx.emit({ type: "tool_approval", request });
      },
    );
    if (record.approvalId) ctx.emit({ type: "tool_approval_resolved", approvalId: record.approvalId, approved });
    if (!approved) {
      update({ status: "denied", resultPreview: "Refusé par l'utilisateur (ou délai dépassé).", durationMs: now() - record.startedAt });
      await logActivity({ type: "tool_denied", summary: `${ctx.agentName}: ${tool.serverName} › ${tool.tool} refusé`, warRoomId: ctx.warRoomId, agentId: ctx.agentId });
      return { text: "The user denied this tool call. Do not retry it; continue without it or ask the user.", isError: true };
    }
    update({ status: "running" });
  }

  try {
    const result = await callTool({ serverId: tool.serverId, tool: tool.tool, args, agentId: ctx.agentId, confirmed: tool.sensitive });
    const out = mcpResultToText(result);
    update({ status: out.isError ? "error" : "done", resultPreview: out.text.slice(0, 2000), durationMs: now() - record.startedAt });
    await logActivity({
      type: out.isError ? "tool_error" : "tool_call",
      summary: `${ctx.agentName}: ${tool.serverName} › ${tool.tool}`,
      warRoomId: ctx.warRoomId,
      agentId: ctx.agentId,
    });
    return out;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    update({ status: err instanceof McpPermissionError ? "denied" : "error", resultPreview: message, durationMs: now() - record.startedAt });
    return { text: `Tool error: ${message}`, isError: true };
  }
}
