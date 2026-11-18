import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, body, notFound, sseRun } from "../lib/http";
import { log } from "../lib/logger";
import { now } from "../lib/ids";
import { getLimitState, GUARDED_PROVIDER } from "./guard";
import { listPausedWork, setPausedStatus, toPausedDTO } from "./store";
import { resumeChatReply } from "../chat/service";
import { agentChatSetup, resumeCollective } from "../orchestration/engine";
import { buildRecap } from "../warrooms/recap";
import { createReport } from "../warrooms/reports";
import { callModel } from "../runtime/llm";
import { getModel } from "../providers/registry";
import type { RunEvent } from "../../shared/types";

export const limitRoutes = new Hono();

limitRoutes.get("/limits/status", async (c) => c.json(await getLimitState()));

limitRoutes.get("/limits/paused", async (c) => c.json(await toPausedDTO(await listPausedWork())));

async function resumeOne(id: string, emit: (e: RunEvent) => void, signal: AbortSignal) {
  const pw = await db.query.pausedWork.findFirst({ where: eq(schema.pausedWork.id, id) });
  if (!pw) throw new Error("Travail en pause introuvable");
  if (pw.status !== "paused" && pw.status !== "ready") throw new Error("Ce travail a déjà été repris ou annulé.");
  // Mark first so a second click cannot run it twice; a new pause creates a new entry.
  await setPausedStatus(pw.id, "resumed");
  if (pw.kind === "collective") {
    await resumeCollective(pw, emit, signal);
    return;
  }
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, pw.conversationId) });
  if (!conv) throw new Error("Conversation introuvable");
  const setup =
    conv.kind === "agent" && conv.agentId
      ? await agentChatSetup(conv.agentId)
      : { providerId: conv.providerId!, modelId: conv.modelId!, system: conv.systemPrompt, params: conv.params };
  await resumeChatReply(pw, setup, emit, signal);
}

/** Resume one paused item, streaming its events (used from the page where it happens). */
limitRoutes.post("/limits/paused/:id/resume", async (c) => {
  const id = c.req.param("id");
  if (!(await db.query.pausedWork.findFirst({ where: eq(schema.pausedWork.id, id) }))) notFound("Travail en pause");
  return sseRun(c, (emit, signal) => resumeOne(id, emit, signal));
});

/** Resume everything that is ready, one after the other, in the background. */
let resumingAll = false;
limitRoutes.post("/limits/paused/resume-all", async (c) => {
  if (resumingAll) return c.json({ started: false, reason: "Une reprise est déjà en cours." });
  const ready = (await listPausedWork(["ready"])).sort((a, b) => a.createdAt - b.createdAt);
  if (!ready.length) return c.json({ started: false, reason: "Rien à reprendre." });
  resumingAll = true;
  const ac = new AbortController();
  void (async () => {
    try {
      for (const pw of ready) {
        const state = await getLimitState();
        if (state.shouldPause) break; // quota tripped again: the rest stays ready / re-paused
        await resumeOne(pw.id, () => undefined, ac.signal).catch((err) => log.warn(`resume ${pw.id} failed`, err));
      }
    } finally {
      resumingAll = false;
    }
  })();
  return c.json({ started: true, count: ready.length });
});

limitRoutes.post("/limits/paused/:id/cancel", async (c) => {
  const pw = await db.query.pausedWork.findFirst({ where: eq(schema.pausedWork.id, c.req.param("id")) });
  if (!pw) notFound("Travail en pause");
  await setPausedStatus(pw!.id, "cancelled");
  return c.json({ ok: true });
});

/**
 * Report: quota state, what is paused, and what consumed the quota in the current
 * windows (from WAR ROOM's own recorded calls; usage made outside WAR ROOM is
 * included in the utilization figures but cannot be broken down here).
 */
limitRoutes.get("/limits/report", async (c) => {
  const state = await getLimitState();
  const paused = await toPausedDTO(await listPausedWork(["paused", "ready"]));
  const windowsUsage = [];
  for (const w of state.windows) {
    const span = w.key === "five_hour" ? 5 * 3_600_000 : 7 * 86_400_000;
    const start = w.resetsAt && !w.isReset ? w.resetsAt - span : now() - span;
    const u = schema.usageEvents;
    const where = and(eq(u.providerId, GUARDED_PROVIDER), gte(u.createdAt, start));
    const [totals] = await db
      .select({ calls: sql<number>`count(*)`, input: sql<number | null>`sum(${u.inputTokens})`, output: sql<number | null>`sum(${u.outputTokens})`, cacheRead: sql<number | null>`sum(${u.cacheReadTokens})`, equivUsd: sql<number | null>`sum(${u.costUsd})` })
      .from(u)
      .where(where);
    const byRoom = await db
      .select({ name: schema.warRooms.name, calls: sql<number>`count(*)`, output: sql<number | null>`sum(${u.outputTokens})`, equivUsd: sql<number | null>`sum(${u.costUsd})` })
      .from(u)
      .leftJoin(schema.warRooms, eq(schema.warRooms.id, u.warRoomId))
      .where(where)
      .groupBy(schema.warRooms.name)
      .orderBy(desc(sql`sum(${u.costUsd})`));
    const byAgent = await db
      .select({ name: schema.agents.name, calls: sql<number>`count(*)`, output: sql<number | null>`sum(${u.outputTokens})`, equivUsd: sql<number | null>`sum(${u.costUsd})` })
      .from(u)
      .leftJoin(schema.agents, eq(schema.agents.id, u.agentId))
      .where(where)
      .groupBy(schema.agents.name)
      .orderBy(desc(sql`sum(${u.costUsd})`))
      .limit(10);
    windowsUsage.push({ key: w.key, label: w.label, since: start, totals, byRoom, byAgent });
  }
  const recentActivity = await db
    .select()
    .from(schema.activity)
    .where(sql`${schema.activity.type} in ('limit_paused','limit_reset','limit_resumed','task_done','task_failed')`)
    .orderBy(desc(schema.activity.createdAt))
    .limit(20);
  return c.json({ generatedAt: now(), state, paused, windowsUsage, recentActivity });
});

// ------------------------------------------------------------------ War Room progress reports

limitRoutes.get("/warrooms/:id/reports", async (c) => {
  const rows = await db
    .select({ id: schema.roomReports.id, kind: schema.roomReports.kind, day: schema.roomReports.day, periodStart: schema.roomReports.periodStart, periodEnd: schema.roomReports.periodEnd, stats: schema.roomReports.stats, createdAt: schema.roomReports.createdAt })
    .from(schema.roomReports)
    .where(eq(schema.roomReports.warRoomId, c.req.param("id")))
    .orderBy(desc(schema.roomReports.periodEnd))
    .limit(120);
  return c.json(rows);
});

limitRoutes.get("/warrooms/:id/reports/:reportId", async (c) => {
  const row = await db.query.roomReports.findFirst({ where: eq(schema.roomReports.id, c.req.param("reportId")) });
  if (!row || row.warRoomId !== c.req.param("id")) notFound("Rapport");
  return c.json(row);
});

/** Generate a report now (last 24 h by default, or since a given time). */
limitRoutes.post("/warrooms/:id/reports", async (c) => {
  const input = await body(c, z.object({ hours: z.number().min(1).max(24 * 31).default(24) }));
  const end = now();
  try {
    return c.json(await createReport(c.req.param("id"), "manual", end - input.hours * 3_600_000, end));
  } catch (err) {
    notFound(err instanceof Error ? err.message : "War Room");
  }
});

// ------------------------------------------------------------------ War Room context recap

limitRoutes.get("/warrooms/:id/recap", async (c) => {
  try {
    return c.json(await buildRecap(c.req.param("id")));
  } catch (err) {
    notFound(err instanceof Error ? err.message : "War Room");
  }
});

/** Optional AI-written handoff, using a model the user chooses (e.g. another provider when Claude is limited). */
limitRoutes.post("/warrooms/:id/recap/ai", async (c) => {
  const input = await body(c, z.object({ providerId: z.string(), modelId: z.string(), audience: z.string().max(200).optional() }));
  if (!(await getModel(input.providerId, input.modelId))) badRequest("Modèle inconnu");
  const recap = await buildRecap(c.req.param("id"), { recentMessages: 30 });
  const result = await callModel({
    providerId: input.providerId,
    modelId: input.modelId,
    system:
      "You write handoff briefs so another AI assistant can continue a project without any other context. Write in French. Be factual: use only the information given, never invent. Structure: 1) Le projet en bref, 2) Où on en est (fait / en cours / en pause), 3) Décisions et contraintes à respecter, 4) Prochaines étapes concrètes, 5) Questions ouvertes, 6) Un prompt prêt à coller pour démarrer. Keep it under 900 words.",
    messages: [{ role: "user", content: [{ type: "text", text: `${input.audience ? `Destinataire : ${input.audience}\n\n` : ""}<project_data>\n${recap.markdown}\n</project_data>` }] }],
    params: { effort: "low", maxTokens: 6000 },
    context: { warRoomId: c.req.param("id"), purpose: "summary" },
  });
  return c.json({ title: recap.title, markdown: result.text.trim(), usage: result.usage, model: `${input.providerId}/${input.modelId}` });
});
