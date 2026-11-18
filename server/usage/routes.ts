import { Hono } from "hono";
import { and, desc, eq, gte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client";
import { monthSpend, startOfMonth, warRoomSpend, agentSpend, projectSpend } from "./budget";
import { STRATEGY_EXPLANATIONS, STRATEGY_EXPLANATIONS_FR } from "./optimizer";
import { serverLang } from "../lib/i18n";

export const usageRoutes = new Hono();

const u = schema.usageEvents;

/** Aggregates computed only from recorded provider data; nulls stay unknown (sum counts only known values). */
const aggregates = {
  calls: sql<number>`count(*)`,
  inputTokens: sql<number | null>`sum(${u.inputTokens})`,
  outputTokens: sql<number | null>`sum(${u.outputTokens})`,
  cacheReadTokens: sql<number | null>`sum(${u.cacheReadTokens})`,
  cacheWriteTokens: sql<number | null>`sum(${u.cacheWriteTokens})`,
  billedUsd: sql<number>`coalesce(sum(case when ${u.costKind} = 'api_billed' then ${u.costUsd} end), 0)`,
  subscriptionEquivUsd: sql<number>`coalesce(sum(case when ${u.costKind} = 'subscription' then ${u.costUsd} end), 0)`,
  unknownCostCalls: sql<number>`sum(case when ${u.costKind} = 'unknown' then 1 else 0 end)`,
  errors: sql<number>`sum(case when ${u.status} = 'error' then 1 else 0 end)`,
  avgLatencyMs: sql<number | null>`avg(${u.latencyMs})`,
};

usageRoutes.get("/usage/summary", async (c) => {
  const days = Math.min(Number(c.req.query("days") ?? 30), 365);
  const since = Date.now() - days * 86_400_000;
  const warRoomId = c.req.query("warRoomId");
  const conds: SQL[] = [gte(u.createdAt, since)];
  if (warRoomId) conds.push(eq(u.warRoomId, warRoomId));
  const where = and(...conds);

  const [totals] = await db.select(aggregates).from(u).where(where);
  const byModel = await db
    .select({ providerId: u.providerId, modelId: u.modelId, ...aggregates })
    .from(u)
    .where(where)
    .groupBy(u.providerId, u.modelId)
    .orderBy(desc(sql`count(*)`));
  const byAgent = await db
    .select({ agentId: u.agentId, name: schema.agents.name, ...aggregates })
    .from(u)
    .leftJoin(schema.agents, eq(schema.agents.id, u.agentId))
    .where(and(where, sql`${u.agentId} is not null`))
    .groupBy(u.agentId, schema.agents.name);
  const byRoom = await db
    .select({ warRoomId: u.warRoomId, name: schema.warRooms.name, ...aggregates })
    .from(u)
    .leftJoin(schema.warRooms, eq(schema.warRooms.id, u.warRoomId))
    .where(and(where, sql`${u.warRoomId} is not null`))
    .groupBy(u.warRoomId, schema.warRooms.name);
  const byPurpose = await db.select({ purpose: u.purpose, ...aggregates }).from(u).where(where).groupBy(u.purpose);
  const byDay = await db
    .select({
      day: sql<string>`strftime('%Y-%m-%d', ${u.createdAt} / 1000, 'unixepoch', 'localtime')`,
      ...aggregates,
    })
    .from(u)
    .where(where)
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return c.json({ days, totals, byModel, byAgent, byRoom, byPurpose, byDay });
});

usageRoutes.get("/usage/events", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const conversationId = c.req.query("conversationId");
  const rows = await db
    .select()
    .from(u)
    .where(conversationId ? eq(u.conversationId, conversationId) : undefined)
    .orderBy(desc(u.createdAt))
    .limit(limit);
  return c.json(rows);
});

/**
 * Context per conversation / agent: last call's exact prompt size (provider-reported)
 * against the model's known context window.
 */
usageRoutes.get("/usage/contexts", async (c) => {
  const warRoomId = c.req.query("warRoomId");
  const rows = await db
    .select({
      conversationId: u.conversationId,
      agentId: u.agentId,
      providerId: u.providerId,
      modelId: u.modelId,
      contextTokens: u.contextTokens,
      createdAt: u.createdAt,
      contextWindow: schema.models.contextWindow,
      agentName: schema.agents.name,
      title: schema.conversations.title,
    })
    .from(u)
    .leftJoin(schema.models, eq(schema.models.id, sql`${u.providerId} || ':' || ${u.modelId}`))
    .leftJoin(schema.agents, eq(schema.agents.id, u.agentId))
    .leftJoin(schema.conversations, eq(schema.conversations.id, u.conversationId))
    .where(and(eq(u.status, "ok"), eq(u.purpose, "chat"), warRoomId ? eq(u.warRoomId, warRoomId) : undefined))
    .orderBy(desc(u.createdAt))
    .limit(500);
  // Keep the latest call per (conversation, agent).
  const seen = new Set<string>();
  const latest = rows.filter((r) => {
    const key = `${r.conversationId}|${r.agentId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return c.json(latest.slice(0, 100));
});

usageRoutes.get("/usage/budgets", async (c) => {
  const monthly = await db.query.settings.findFirst({ where: eq(schema.settings.key, "budget.monthlyUsd") });
  const rooms = await db.select().from(schema.warRooms);
  const projects = await db.select().from(schema.projects);
  const agents = await db.select().from(schema.agents);
  const thresholds = [0.5, 0.8, 1];
  const level = (spent: number, limit: number | null) => {
    if (limit === null || limit <= 0) return null;
    const ratio = spent / limit;
    return thresholds.filter((t) => ratio >= t).pop() ?? 0;
  };
  const items: { scope: string; id: string | null; name: string; spentUsd: number; limitUsd: number | null; level: number | null }[] = [];
  const monthSpent = await monthSpend();
  const monthLimit = typeof monthly?.value === "number" ? monthly.value : null;
  items.push({ scope: "global", id: null, name: `Month since ${new Date(startOfMonth()).toLocaleDateString()}`, spentUsd: monthSpent, limitUsd: monthLimit, level: level(monthSpent, monthLimit) });
  for (const p of projects) {
    const s = await projectSpend(p.id);
    if (p.budgetUsd != null || s > 0) items.push({ scope: "project", id: p.id, name: p.name, spentUsd: s, limitUsd: p.budgetUsd, level: level(s, p.budgetUsd) });
  }
  for (const r of rooms) {
    const s = await warRoomSpend(r.id);
    if (r.budgetUsd != null || s > 0) items.push({ scope: "warroom", id: r.id, name: r.name, spentUsd: s, limitUsd: r.budgetUsd, level: level(s, r.budgetUsd) });
  }
  for (const a of agents) {
    if (a.budgetUsd == null) continue;
    const s = await agentSpend(a.id);
    items.push({ scope: "agent", id: a.id, name: a.name, spentUsd: s, limitUsd: a.budgetUsd, level: level(s, a.budgetUsd) });
  }
  const rateLimit = await db.query.settings.findFirst({ where: eq(schema.settings.key, "claude-code.rateLimit") });
  return c.json({ items, claudeCodeRateLimit: rateLimit?.value ?? null, strategies: (await serverLang()) === "en" ? STRATEGY_EXPLANATIONS : STRATEGY_EXPLANATIONS_FR });
});
