import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { decryptSecret } from "../lib/crypto";
import { redact } from "../lib/logger";
import { scrubAllSecrets } from "../secrets/service";

/**
 * Connects to MCP servers with the official SDK and keeps the live clients in
 * memory. Supports STDIO (local processes) and Streamable HTTP (remote).
 * Tool execution goes through `callTool`, which enforces per-agent permissions
 * and confirmation of sensitive tools.
 */

type Row = typeof schema.mcpServers.$inferSelect;

interface Live {
  client: Client;
  status: "connecting" | "connected" | "error" | "disconnected";
  error: string | null;
  tools: { name: string; description?: string; inputSchema?: unknown }[];
  resources: { uri: string; name?: string; description?: string; mimeType?: string }[];
  prompts: { name: string; description?: string }[];
  logs: { at: number; level: "info" | "error"; text: string }[];
  serverInfo: { name?: string; version?: string } | null;
}

const live = new Map<string, Live>();

function pushLog(entry: Live, level: "info" | "error", text: string) {
  entry.logs.push({ at: Date.now(), level, text: redact(text).slice(0, 2000) });
  if (entry.logs.length > 200) entry.logs.splice(0, entry.logs.length - 200);
}

function decryptMap(payload: string | null): Record<string, string> {
  if (!payload) return {};
  try {
    return JSON.parse(decryptSecret(payload)) as Record<string, string>;
  } catch {
    return {};
  }
}

export function statusOf(id: string) {
  const l = live.get(id);
  return {
    status: l?.status ?? "disconnected",
    error: l?.error ?? null,
    tools: l?.tools ?? [],
    resources: l?.resources ?? [],
    prompts: l?.prompts ?? [],
    serverInfo: l?.serverInfo ?? null,
  };
}

/** Server logs for the UI, with any War Room secret value masked (a server may echo what it received). */
export async function logsOf(id: string) {
  const logs = live.get(id)?.logs ?? [];
  return Promise.all(logs.map(async (l) => ({ ...l, text: await scrubAllSecrets(l.text) })));
}

export async function connect(row: Row) {
  await disconnect(row.id);
  const client = new Client({ name: "war-room", version: "0.1.0" });
  const entry: Live = { client, status: "connecting", error: null, tools: [], resources: [], prompts: [], logs: [], serverInfo: null };
  live.set(row.id, entry);
  try {
    if (row.transport === "stdio") {
      if (!row.command) throw new Error("No command configured");
      const transport = new StdioClientTransport({
        command: row.command,
        args: row.args,
        env: { ...(process.env as Record<string, string>), ...decryptMap(row.encryptedEnv) },
        stderr: "pipe",
      });
      transport.stderr?.on("data", (d: Buffer) => pushLog(entry, "error", d.toString("utf8")));
      await client.connect(transport);
    } else {
      if (!row.url) throw new Error("No URL configured");
      const transport = new StreamableHTTPClientTransport(new URL(row.url), { requestInit: { headers: decryptMap(row.encryptedHeaders) } });
      await client.connect(transport);
    }
    const info = client.getServerVersion();
    entry.serverInfo = info ? { name: info.name, version: info.version } : null;
    const caps = client.getServerCapabilities() ?? {};
    if (caps.tools) entry.tools = (await client.listTools()).tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    if (caps.resources) entry.resources = (await client.listResources()).resources.map((r) => ({ uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType }));
    if (caps.prompts) entry.prompts = (await client.listPrompts()).prompts.map((p) => ({ name: p.name, description: p.description }));
    entry.status = "connected";
    pushLog(entry, "info", `Connected: ${entry.tools.length} tools, ${entry.resources.length} resources, ${entry.prompts.length} prompts`);
  } catch (err) {
    entry.status = "error";
    entry.error = err instanceof Error ? err.message : String(err);
    pushLog(entry, "error", entry.error);
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
  return statusOf(row.id);
}

export async function disconnect(id: string) {
  const l = live.get(id);
  if (!l) return;
  try {
    await l.client.close();
  } catch {
    /* ignore */
  }
  l.status = "disconnected";
  pushLog(l, "info", "Disconnected");
}

export class McpPermissionError extends Error {}

/**
 * Run an MCP tool on behalf of an agent. Refuses unless the agent has MCP
 * permission and the server is assigned to it; sensitive tools additionally
 * require `confirmed: true` (set only after a human approved in the UI).
 */
export async function callTool(opts: { serverId: string; tool: string; args: Record<string, unknown>; agentId: string | null; confirmed: boolean }) {
  const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, opts.serverId) });
  if (!row || !row.enabled) throw new McpPermissionError("MCP server not found or disabled");
  if (opts.agentId) {
    const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, opts.agentId) });
    if (!agent?.permissions.useMcp) throw new McpPermissionError(`${agent?.name ?? "This agent"} is not allowed to use MCP tools.`);
    if (!agent.mcpServers.includes(opts.serverId)) throw new McpPermissionError(`${agent.name} has no access to ${row.name}.`);
    const allowed = agent.mcpTools?.[opts.serverId];
    if (allowed !== undefined && !allowed.includes(opts.tool)) {
      throw new McpPermissionError(`${agent.name} is not allowed to use ${row.name} › ${opts.tool}.`);
    }
  }
  if (row.sensitiveTools.includes(opts.tool) && !opts.confirmed) {
    throw new McpPermissionError(`"${opts.tool}" is marked sensitive and needs your confirmation.`);
  }
  const l = live.get(opts.serverId);
  if (!l || l.status !== "connected") throw new McpPermissionError(`${row.name} is not connected.`);
  pushLog(l, "info", `call ${opts.tool} by ${opts.agentId ?? "user"}`);
  const result = await l.client.callTool({ name: opts.tool, arguments: opts.args });
  return result;
}

export async function connectEnabledServers() {
  const rows = await db.select().from(schema.mcpServers);
  await Promise.all(rows.filter((r) => r.enabled).map((r) => connect(r).catch(() => undefined)));
}
