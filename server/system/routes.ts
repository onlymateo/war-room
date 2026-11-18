import { Hono } from "hono";
import { z } from "zod";
import { desc, eq, like, or, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { body, badRequest } from "../lib/http";
import { now } from "../lib/ids";
import { env } from "../env";
import { listProviders } from "../providers/registry";
import { statusOf } from "../mcp/manager";

export const systemRoutes = new Hono();

/** Settings the UI may read/write. Anything else is rejected. */
const SETTINGS_SCHEMA = {
  "budget.monthlyUsd": z.number().min(0).nullable(),
  "context.maxHistoryTokens": z.number().int().min(2_000).max(500_000),
  "context.compressThresholdTokens": z.number().int().min(4_000).max(1_000_000),
  "orchestration.maxCallsPerRun": z.number().int().min(1).max(50),
  "optimizer.routingModel": z.object({ providerId: z.string(), modelId: z.string() }).nullable(),
  "optimizer.summaryModel": z.object({ providerId: z.string(), modelId: z.string() }).nullable(),
  "user.displayName": z.string().max(80),
} as const;

systemRoutes.get("/system/status", async (c) => {
  const providers = await listProviders();
  const mcpRows = await db.select().from(schema.mcpServers);
  const mcpStatuses = mcpRows.map((r) => statusOf(r.id).status);
  return c.json({
    version: "0.1.0",
    dataDir: env.dataDir,
    providers: {
      configured: providers.filter((p) => p.configured && p.enabled).length,
      ok: providers.filter((p) => p.status === "ok").length,
      error: providers.filter((p) => p.status === "error").length,
    },
    mcp: {
      total: mcpRows.length,
      connected: mcpStatuses.filter((s) => s === "connected").length,
      error: mcpStatuses.filter((s) => s === "error").length,
    },
  });
});

systemRoutes.get("/settings", async (c) => {
  const rows = await db.select().from(schema.settings);
  return c.json(Object.fromEntries(rows.filter((r) => r.key in SETTINGS_SCHEMA).map((r) => [r.key, r.value])));
});

systemRoutes.put("/settings/:key", async (c) => {
  const key = c.req.param("key") as keyof typeof SETTINGS_SCHEMA;
  const validator = SETTINGS_SCHEMA[key];
  if (!validator) badRequest("Unknown setting");
  const { value } = await body(c, z.object({ value: validator }));
  await db
    .insert(schema.settings)
    .values({ key, value, updatedAt: now() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now() } });
  return c.json({ key, value });
});

/** Global search across War Rooms, projects, agents, conversations, messages, files, tasks. */
systemRoutes.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  const p = `%${q}%`;
  const [rooms, projects, agents, convs, msgs, files, tasks] = await Promise.all([
    db.select({ id: schema.warRooms.id, title: schema.warRooms.name }).from(schema.warRooms).where(or(like(schema.warRooms.name, p), like(schema.warRooms.description, p))).limit(8),
    db.select({ id: schema.projects.id, title: schema.projects.name }).from(schema.projects).where(like(schema.projects.name, p)).limit(8),
    db.select({ id: schema.agents.id, title: schema.agents.name, warRoomId: schema.agents.warRoomId }).from(schema.agents).where(like(schema.agents.name, p)).limit(8),
    db.select({ id: schema.conversations.id, title: schema.conversations.title, kind: schema.conversations.kind, warRoomId: schema.conversations.warRoomId, agentId: schema.conversations.agentId }).from(schema.conversations).where(like(schema.conversations.title, p)).limit(8),
    db
      .select({ id: schema.messages.id, conversationId: schema.messages.conversationId, content: schema.messages.content, kind: schema.conversations.kind, warRoomId: schema.conversations.warRoomId, agentId: schema.conversations.agentId })
      .from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.conversations.id, schema.messages.conversationId))
      .where(like(schema.messages.content, p))
      .orderBy(desc(schema.messages.createdAt))
      .limit(10),
    db.select({ id: schema.files.id, title: schema.files.name }).from(schema.files).where(or(like(schema.files.name, p), like(schema.files.textContent, p))).limit(8),
    db.select({ id: schema.tasks.id, title: schema.tasks.title, warRoomId: schema.tasks.warRoomId }).from(schema.tasks).where(like(schema.tasks.title, p)).limit(8),
  ]);
  const snippet = (text: string) => {
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    return (i > 40 ? "…" : "") + text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ") + "…";
  };
  const convHref = (k: { kind: string; id?: string; conversationId?: string; warRoomId: string | null; agentId: string | null }) =>
    k.kind === "chat" ? `/chats/${k.conversationId ?? k.id}` : k.kind === "agent" ? `/warrooms/${k.warRoomId}/agents/${k.agentId}` : `/warrooms/${k.warRoomId}`;
  return c.json([
    ...rooms.map((r) => ({ type: "War Room", title: r.title, href: `/warrooms/${r.id}` })),
    ...projects.map((r) => ({ type: "Project", title: r.title, href: `/projects/${r.id}` })),
    ...agents.map((r) => ({ type: "Agent", title: r.title, href: r.warRoomId ? `/warrooms/${r.warRoomId}/agents/${r.id}` : "/agents" })),
    ...convs.map((r) => ({ type: "Conversation", title: r.title, href: convHref({ ...r }) })),
    ...msgs.map((m) => ({ type: "Message", title: snippet(m.content), href: convHref({ kind: m.kind, conversationId: m.conversationId, warRoomId: m.warRoomId, agentId: m.agentId }) })),
    ...files.map((r) => ({ type: "File", title: r.title, href: `/files?focus=${r.id}` })),
    ...tasks.map((r) => ({ type: "Task", title: r.title, href: r.warRoomId ? `/warrooms/${r.warRoomId}?tab=tasks` : "/projects" })),
  ]);
});

/** Dashboard: real numbers only. */
systemRoutes.get("/dashboard", async (c) => {
  const dayAgo = Date.now() - 86_400_000;
  const [rooms, projects, tasksInProgress, agentsCount, recentConvs, activity, usage24h] = await Promise.all([
    db.select().from(schema.warRooms).where(eq(schema.warRooms.status, "active")).orderBy(desc(schema.warRooms.updatedAt)).limit(6),
    db.select().from(schema.projects).where(eq(schema.projects.status, "active")).orderBy(desc(schema.projects.updatedAt)).limit(6),
    db.select().from(schema.tasks).where(eq(schema.tasks.status, "in_progress")).orderBy(desc(schema.tasks.updatedAt)).limit(10),
    db.select({ n: sql<number>`count(*)` }).from(schema.agents),
    db.select().from(schema.conversations).where(eq(schema.conversations.archived, false)).orderBy(desc(schema.conversations.updatedAt)).limit(6),
    db.select().from(schema.activity).orderBy(desc(schema.activity.createdAt)).limit(15),
    db
      .select({
        calls: sql<number>`count(*)`,
        inputTokens: sql<number | null>`sum(${schema.usageEvents.inputTokens})`,
        outputTokens: sql<number | null>`sum(${schema.usageEvents.outputTokens})`,
        billedUsd: sql<number>`coalesce(sum(case when ${schema.usageEvents.costKind} = 'api_billed' then ${schema.usageEvents.costUsd} end), 0)`,
        errors: sql<number>`sum(case when ${schema.usageEvents.status} = 'error' then 1 else 0 end)`,
      })
      .from(schema.usageEvents)
      .where(sql`${schema.usageEvents.createdAt} >= ${dayAgo}`),
  ]);
  return c.json({
    rooms,
    projects,
    tasksInProgress,
    agentCount: Number(agentsCount[0]?.n ?? 0),
    recentConversations: recentConvs,
    activity,
    usage24h: usage24h[0],
  });
});
