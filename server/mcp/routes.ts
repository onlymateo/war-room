import { Hono } from "hono";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { encryptSecret } from "../lib/crypto";
import { badRequest, body, notFound } from "../lib/http";
import { newId, now } from "../lib/ids";
import { callTool, connect, disconnect, logsOf, McpPermissionError, statusOf } from "./manager";
import { listPendingApprovals, resolveApproval } from "./approvals";

export const mcpRoutes = new Hono();

/** Human approvals for sensitive tools requested by agents. */
mcpRoutes.get("/tool-approvals", (c) => c.json(listPendingApprovals()));

mcpRoutes.post("/tool-approvals/:id", async (c) => {
  const { approve } = await body(c, z.object({ approve: z.boolean() }));
  if (!resolveApproval(c.req.param("id"), approve)) badRequest("This request was already answered, cancelled or expired.");
  return c.json({ ok: true });
});

const serverInput = z.object({
  name: z.string().min(1).max(100),
  transport: z.enum(["stdio", "http"]),
  command: z.string().max(500).nullable().optional(),
  args: z.array(z.string().max(1000)).max(50).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().url().nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  sensitiveTools: z.array(z.string()).max(200).optional(),
});

function publicView(row: typeof schema.mcpServers.$inferSelect) {
  // Env vars and headers may hold secrets: only their names are exposed.
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args,
    url: row.url,
    hasEnv: !!row.encryptedEnv,
    hasHeaders: !!row.encryptedHeaders,
    enabled: row.enabled,
    sensitiveTools: row.sensitiveTools,
    createdAt: row.createdAt,
    ...statusOf(row.id),
  };
}

mcpRoutes.get("/mcp", async (c) => {
  const rows = await db.select().from(schema.mcpServers).orderBy(asc(schema.mcpServers.name));
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, mcpServers: schema.agents.mcpServers, useMcp: schema.agents.permissions }).from(schema.agents);
  return c.json(
    rows.map((r) => ({
      ...publicView(r),
      agents: agents.filter((a) => a.mcpServers.includes(r.id)).map((a) => ({ id: a.id, name: a.name, allowed: a.useMcp.useMcp })),
    })),
  );
});

mcpRoutes.post("/mcp", async (c) => {
  const input = await body(c, serverInput);
  if (input.transport === "stdio" && !input.command) badRequest("A command is required for STDIO servers.");
  if (input.transport === "http" && !input.url) badRequest("A URL is required for HTTP servers.");
  const ts = now();
  const row = {
    id: newId("mcp"),
    name: input.name,
    transport: input.transport,
    command: input.command ?? null,
    args: input.args ?? [],
    encryptedEnv: input.env && Object.keys(input.env).length ? encryptSecret(JSON.stringify(input.env)) : null,
    url: input.url ?? null,
    encryptedHeaders: input.headers && Object.keys(input.headers).length ? encryptSecret(JSON.stringify(input.headers)) : null,
    enabled: input.enabled ?? true,
    sensitiveTools: input.sensitiveTools ?? [],
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(schema.mcpServers).values(row);
  return c.json(publicView(row));
});

mcpRoutes.patch("/mcp/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, serverInput.partial());
  const { env, headers, ...rest } = input;
  await db
    .update(schema.mcpServers)
    .set({
      ...rest,
      ...(env ? { encryptedEnv: Object.keys(env).length ? encryptSecret(JSON.stringify(env)) : null } : {}),
      ...(headers ? { encryptedHeaders: Object.keys(headers).length ? encryptSecret(JSON.stringify(headers)) : null } : {}),
      updatedAt: now(),
    })
    .where(eq(schema.mcpServers.id, id));
  const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, id) });
  if (!row) notFound("MCP server");
  return c.json(publicView(row!));
});

mcpRoutes.delete("/mcp/:id", async (c) => {
  const id = c.req.param("id");
  await disconnect(id);
  await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
  return c.json({ ok: true });
});

mcpRoutes.post("/mcp/:id/connect", async (c) => {
  const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, c.req.param("id")) });
  if (!row) notFound("MCP server");
  await connect(row!);
  return c.json(publicView(row!));
});

mcpRoutes.post("/mcp/:id/disconnect", async (c) => {
  await disconnect(c.req.param("id"));
  const row = await db.query.mcpServers.findFirst({ where: eq(schema.mcpServers.id, c.req.param("id")) });
  if (!row) notFound("MCP server");
  return c.json(publicView(row!));
});

mcpRoutes.get("/mcp/:id/logs", (c) => c.json(logsOf(c.req.param("id"))));

/** Manual tool run from the UI by the user (a human is present, so this counts as confirmed). */
mcpRoutes.post("/mcp/:id/tools/:tool", async (c) => {
  const input = await body(c, z.object({ args: z.record(z.string(), z.unknown()).default({}) }));
  try {
    const result = await callTool({ serverId: c.req.param("id"), tool: c.req.param("tool"), args: input.args, agentId: null, confirmed: true });
    return c.json(result);
  } catch (err) {
    if (err instanceof McpPermissionError) badRequest(err.message);
    throw err;
  }
});
