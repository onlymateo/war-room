import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { log } from "../lib/logger";
import { logActivity } from "../activity/log";
import { getSetting } from "../memory/context";
import { getLimitState } from "../limits/guard";
import { warRoomSpend } from "../usage/budget";
import { dateLocale, serverLang, tx } from "../lib/i18n";

/**
 * Progress report of a War Room over a period (by default the last 24 h),
 * compiled from WAR ROOM's records only: no model call, so it costs nothing and
 * is produced even when the Claude quota is exhausted.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
/** Markdown removed and whitespace collapsed, so excerpts render as plain text inside a list. */
const plain = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+|^\s*\d+\.\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
export const localDay = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export async function buildProgressReport(warRoomId: string, periodStart: number, periodEnd: number) {
  const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, warRoomId) });
  const lang = await serverLang();
  const t = (fr: string, en: string) => tx(lang, fr, en);
  const time = (ts: number) => new Date(ts).toLocaleString(dateLocale(lang), { dateStyle: "short", timeStyle: "short" });
  if (!room) throw new Error(t("War Room introuvable", "War Room not found"));
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, warRoomId));
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? t("non assignée", "unassigned");
  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.warRoomId, warRoomId));
  const inPeriod = (ts: number) => ts >= periodStart && ts < periodEnd;
  const done = tasks.filter((t) => t.status === "done");
  const doneInPeriod = done.filter((t) => inPeriod(t.updatedAt));
  const createdInPeriod = tasks.filter((t) => inPeriod(t.createdAt));
  const inProgress = tasks.filter((t) => t.status === "in_progress" || t.status === "review");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const todo = tasks.filter((t) => t.status === "todo").sort((a, b) => a.priority - b.priority);
  const progress = tasks.length ? done.length / tasks.length : null;

  // Collective conversation and individual chats with the room's agents.
  const convIds = (await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.warRoomId, warRoomId))).map((c) => c.id);
  const msgs = convIds.length
    ? await db
        .select({ role: schema.messages.role, agentId: schema.messages.agentId, meta: schema.messages.meta, content: schema.messages.content, createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(inArray(schema.messages.conversationId, convIds), gte(schema.messages.createdAt, periodStart), lt(schema.messages.createdAt, periodEnd)))
        .orderBy(schema.messages.createdAt)
    : [];
  const userMsgs = msgs.filter((m) => m.role === "user");
  const agentMsgs = msgs.filter((m) => m.role === "assistant" && m.meta.kind !== "plan");
  const syntheses = agentMsgs.filter((m) => m.meta.kind === "synthesis");

  const activity = await db
    .select()
    .from(schema.activity)
    .where(and(eq(schema.activity.warRoomId, warRoomId), gte(schema.activity.createdAt, periodStart), lt(schema.activity.createdAt, periodEnd)))
    .orderBy(desc(schema.activity.createdAt));
  const decisions = await db
    .select()
    .from(schema.memories)
    .where(and(inArray(schema.memories.scopeId, [warRoomId, ...(room.projectId ? [room.projectId] : [])]), eq(schema.memories.kind, "decision"), gte(schema.memories.createdAt, periodStart)));
  const paused = await db.select().from(schema.pausedWork).where(and(eq(schema.pausedWork.warRoomId, warRoomId), inArray(schema.pausedWork.status, ["paused", "ready"])));

  const u = schema.usageEvents;
  const [usage] = await db
    .select({
      calls: sql<number>`count(*)`,
      output: sql<number | null>`sum(${u.outputTokens})`,
      input: sql<number | null>`sum(${u.inputTokens})`,
      billed: sql<number>`coalesce(sum(case when ${u.costKind} = 'api_billed' then ${u.costUsd} end), 0)`,
      equiv: sql<number>`coalesce(sum(case when ${u.costKind} = 'subscription' then ${u.costUsd} end), 0)`,
      errors: sql<number>`sum(case when ${u.status} = 'error' then 1 else 0 end)`,
    })
    .from(u)
    .where(and(eq(u.warRoomId, warRoomId), gte(u.createdAt, periodStart), lt(u.createdAt, periodEnd)));
  const spent = await warRoomSpend(warRoomId);

  const previous = await db
    .select()
    .from(schema.roomReports)
    .where(and(eq(schema.roomReports.warRoomId, warRoomId), lt(schema.roomReports.periodEnd, periodEnd)))
    .orderBy(desc(schema.roomReports.periodEnd))
    .limit(1);
  const prevDone = previous[0]?.stats.tasksDone;

  const out: string[] = [];
  out.push(t(`# État d'avancement — ${room.name}`, `# Progress report — ${room.name}`));
  out.push(
    t(
      `_Période : du ${time(periodStart)} au ${time(periodEnd)}. Établi à partir des données WAR ROOM, sans appel à une IA._`,
      `_Period: ${time(periodStart)} to ${time(periodEnd)}. Compiled from WAR ROOM data, without any AI call._`,
    ),
  );

  out.push(t("## En bref", "## At a glance"));
  const quiet = !userMsgs.length && !agentMsgs.length && !doneInPeriod.length && !createdInPeriod.length;
  out.push(
    [
      progress !== null
        ? (() => {
            const delta = prevDone !== undefined ? `${done.length - prevDone >= 0 ? "+" : ""}${done.length - prevDone}` : null;
            return t(
              `- **Progression :** ${done.length}/${tasks.length} tâches terminées (${Math.round(progress * 100)} %)${delta !== null ? `, ${delta} depuis le rapport précédent` : ""}.`,
              `- **Progress:** ${done.length}/${tasks.length} tasks done (${Math.round(progress * 100)}%)${delta !== null ? `, ${delta} since the previous report` : ""}.`,
            );
          })()
        : t("- **Progression :** aucune tâche définie pour l'instant.", "- **Progress:** no tasks defined yet."),
      t(
        `- **Sur la période :** ${doneInPeriod.length} tâche(s) terminée(s), ${createdInPeriod.length} créée(s), ${userMsgs.length} message(s) de votre part, ${agentMsgs.length} réponse(s) d'agents${syntheses.length ? ` dont ${syntheses.length} synthèse(s)` : ""}.`,
        `- **During the period:** ${doneInPeriod.length} task(s) completed, ${createdInPeriod.length} created, ${userMsgs.length} message(s) from you, ${agentMsgs.length} agent response(s)${syntheses.length ? ` including ${syntheses.length} synthesis(es)` : ""}.`,
      ),
      t(
        `- **En cours :** ${inProgress.length} · **bloquées ou en pause :** ${blocked.length} · **à faire :** ${todo.length}.`,
        `- **In progress:** ${inProgress.length} · **blocked or paused:** ${blocked.length} · **to do:** ${todo.length}.`,
      ),
      quiet ? t("- Aucune activité sur la période.", "- No activity during the period.") : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (doneInPeriod.length) {
    out.push(t("## Terminé", "## Completed"));
    for (const k of doneInPeriod.slice(0, 15)) out.push(`- **${plain(k.title)}** — ${name(k.assigneeAgentId)}${k.result ? `\n  ${clip(plain(k.result), 300)}` : ""}`);
  }
  if (inProgress.length) {
    out.push(t("## En cours", "## In progress"));
    for (const k of inProgress.slice(0, 15)) out.push(`- ${plain(k.title)} — ${name(k.assigneeAgentId)}`);
  }
  if (blocked.length || paused.length) {
    out.push(t("## Bloqué ou en pause", "## Blocked or paused"));
    for (const k of blocked.slice(0, 15)) out.push(`- ${plain(k.title)} — ${name(k.assigneeAgentId)}${k.result ? ` (${clip(plain(k.result), 160)})` : ""}`);
    for (const p of paused)
      out.push(
        `- ${p.title} — ${
          p.status === "ready"
            ? t("prêt à reprendre", "ready to resume")
            : t(`en pause (limite Claude${p.resetsAt ? `, reprise après ${time(p.resetsAt)}` : ""})`, `paused (Claude limit${p.resetsAt ? `, resumes after ${time(p.resetsAt)}` : ""})`)
        }`,
      );
  }
  if (decisions.length || activity.some((a) => a.type === "plan_approved" || a.type === "plan_rejected")) {
    out.push(t("## Décisions", "## Decisions"));
    for (const d of decisions) out.push(`- ${clip(d.content, 300)}`);
    const approvals = activity.filter((a) => a.type === "plan_approved" || a.type === "plan_rejected");
    if (approvals.length) {
      const ok = approvals.filter((a) => a.type === "plan_approved").length;
      const ko = approvals.filter((a) => a.type === "plan_rejected").length;
      out.push(t(`- ${ok} plan(s) de l'orchestrateur approuvé(s), ${ko} refusé(s).`, `- ${ok} orchestrator plan(s) approved, ${ko} rejected.`));
    }
  }
  if (syntheses.length) {
    out.push(t("## Dernière synthèse de l'orchestrateur", "## Latest orchestrator synthesis"));
    out.push(clip(syntheses[syntheses.length - 1].content, 1500));
  }
  if (todo.length) {
    out.push(t("## Prochaines étapes", "## Next steps"));
    for (const k of todo.slice(0, 8)) out.push(`- (P${k.priority}) ${k.title} — ${name(k.assigneeAgentId)}`);
  }

  out.push(t("## Consommation sur la période", "## Usage during the period"));
  out.push(
    t(
      `${usage?.calls ?? 0} appel(s) IA · ${usage?.output ?? 0} tokens générés · facturé API ${Number(usage?.billed ?? 0).toFixed(4)} $ · équivalent abonnement ${Number(usage?.equiv ?? 0).toFixed(4)} $ (non dépensé)${usage?.errors ? ` · ${usage.errors} erreur(s)` : ""}.`,
      `${usage?.calls ?? 0} AI call(s) · ${usage?.output ?? 0} tokens generated · API billed $${Number(usage?.billed ?? 0).toFixed(4)} · subscription equivalent $${Number(usage?.equiv ?? 0).toFixed(4)} (not spent)${usage?.errors ? ` · ${usage.errors} error(s)` : ""}.`,
    ),
  );

  const attention: string[] = [];
  if (room.budgetUsd !== null && spent >= room.budgetUsd * 0.8) attention.push(
      t(
        `Budget API à ${Math.round((spent / room.budgetUsd) * 100)} % (${spent.toFixed(2)} $ / ${room.budgetUsd.toFixed(2)} $).`,
        `API budget at ${Math.round((spent / room.budgetUsd) * 100)}% ($${spent.toFixed(2)} / $${room.budgetUsd.toFixed(2)}).`,
      ),
    );
  const limits = await getLimitState();
  for (const w of limits.windows)
    if (w.level === "warning" || w.level === "critical" || w.level === "exhausted")
      attention.push(
        t(
          `Abonnement Claude, ${w.label.toLowerCase()} : ${w.utilization !== null ? `${Math.round(w.utilization * 100)} %` : "épuisée"}.`,
          `Claude subscription, ${w.label.toLowerCase()}: ${w.utilization !== null ? `${Math.round(w.utilization * 100)}%` : "exhausted"}.`,
        ),
      );
  if (blocked.length) attention.push(t(`${blocked.length} tâche(s) bloquée(s) à examiner.`, `${blocked.length} blocked task(s) to review.`));
  if (attention.length) {
    out.push(t("## Points d'attention", "## Needs attention"));
    for (const a of attention) out.push(`- ${a}`);
  }

  const stats = {
    tasksTotal: tasks.length,
    tasksDone: done.length,
    doneInPeriod: doneInPeriod.length,
    createdInPeriod: createdInPeriod.length,
    inProgress: inProgress.length,
    blocked: blocked.length,
    userMessages: userMsgs.length,
    agentMessages: agentMsgs.length,
    calls: Number(usage?.calls ?? 0),
  };
  return { markdown: out.join("\n\n"), stats };
}

export async function createReport(warRoomId: string, kind: "daily" | "manual", periodStart: number, periodEnd: number) {
  const { markdown, stats } = await buildProgressReport(warRoomId, periodStart, periodEnd);
  const row = { id: newId("rep"), warRoomId, kind, day: localDay(periodEnd), periodStart, periodEnd, markdown, stats, createdAt: now() };
  await db.insert(schema.roomReports).values(row);
  const lang = await serverLang();
  const summary = tx(
    lang,
    `Rapport d'avancement ${kind === "daily" ? "quotidien" : "à la demande"} : ${stats.tasksDone}/${stats.tasksTotal} tâches terminées`,
    `${kind === "daily" ? "Daily" : "On-demand"} progress report: ${stats.tasksDone}/${stats.tasksTotal} tasks done`,
  );
  await logActivity({ type: "progress_report", summary, warRoomId });
  return row;
}

/**
 * Daily scheduler (checked every minute): after the configured hour, each active
 * War Room gets one daily report covering the time since its previous report
 * (at most 7 days, at least the last 24 h). Catches up if the app was off.
 */
export async function maybeGenerateDailyReports() {
  try {
    if (!(await getSetting<boolean>("reports.dailyEnabled", true))) return;
    const hour = await getSetting<number>("reports.dailyHour", 8);
    const at = now();
    if (new Date(at).getHours() < hour) return;
    const today = localDay(at);
    const rooms = await db.select({ id: schema.warRooms.id }).from(schema.warRooms).where(eq(schema.warRooms.status, "active"));
    for (const r of rooms) {
      const existing = await db.query.roomReports.findFirst({ where: and(eq(schema.roomReports.warRoomId, r.id), eq(schema.roomReports.kind, "daily"), eq(schema.roomReports.day, today)) });
      if (existing) continue;
      const last = await db.query.roomReports.findFirst({
        where: and(eq(schema.roomReports.warRoomId, r.id), eq(schema.roomReports.kind, "daily")),
        orderBy: desc(schema.roomReports.periodEnd),
      });
      const start = Math.max(Math.min(last?.periodEnd ?? at - 86_400_000, at - 86_400_000), at - 7 * 86_400_000);
      await createReport(r.id, "daily", start, at);
    }
  } catch (err) {
    log.warn("daily reports failed", err);
  }
}
