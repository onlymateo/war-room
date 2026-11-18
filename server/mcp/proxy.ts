import crypto from "node:crypto";
import { Hono } from "hono";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { env } from "../env";
import { executeAgentTool, type ToolRunContext } from "./tools";

/**
 * WAR ROOM as an MCP server, for the Claude Code CLI bridge.
 *
 * The CLI runs its own tool loop, so instead of letting it spawn the user's MCP
 * servers directly (which would bypass WAR ROOM's permissions and approvals),
 * each CLI call receives a one-off URL `/api/mcp-proxy/<token>` exposing only
 * the tools of that agent. Every call lands in `executeAgentTool`. The token is
 * random, lives only for the duration of the reply, and the API listens on
 * 127.0.0.1 only.
 */

const sessions = new Map<string, ToolRunContext>();

export function registerProxySession(ctx: ToolRunContext) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, ctx);
  return {
    url: `http://127.0.0.1:${env.port}/api/mcp-proxy/${token}`,
    dispose: () => sessions.delete(token),
  };
}

export const mcpProxyRoutes = new Hono();

mcpProxyRoutes.all("/mcp-proxy/:token", async (c) => {
  const ctx = sessions.get(c.req.param("token"));
  if (!ctx) return c.json({ error: "Unknown or expired session" }, 404);

  const server = new Server({ name: "warroom", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ctx.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" } })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const out = await executeAgentTool(ctx, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>);
    return { content: [{ type: "text" as const, text: out.text }], isError: out.isError };
  });
  // Stateless: a fresh server/transport per HTTP request, JSON responses.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    void transport.close();
    void server.close();
  }
});
