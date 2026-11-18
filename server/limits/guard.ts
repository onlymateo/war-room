import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { getProviderDef } from "../providers/catalog";
import type { LimitLevel, LimitState, LimitWindowState } from "../../shared/types";
import { serverLang, tx } from "../lib/i18n";

/**
 * Limit guard for the Claude Pro/Max subscription (Claude Code bridge).
 *
 * Claude Code reports the real quota usage of the 5-hour and weekly windows with
 * every call (`rate_limit_event`). There is no way to read it without making a
 * call, so the guard works from the snapshots recorded after each call:
 * - current utilization and reset time per window;
 * - consumption rate over recent observations -> predicted time of exhaustion;
 * - before each Claude Code call, `assertClaudeAvailable` refuses the call when a
 *   window is at/above the pause threshold (or was rejected) and has not reset.
 * Callers turn that refusal into a clean pause that can be resumed after the reset.
 */

export const GUARDED_PROVIDER = "claude-code";
const WINDOWS = [
  { key: "five_hour" as const, label: { fr: "Fenêtre 5 h", en: "5-hour window" }, lookbackMs: 90 * 60_000 },
  { key: "seven_day" as const, label: { fr: "Semaine", en: "Weekly" }, lookbackMs: 24 * 3_600_000 },
];
const RETENTION_MS = 8 * 86_400_000;

export class LimitPausedError extends Error {
  constructor(
    message: string,
    public readonly resumeAt: number | null,
    public readonly partialText = "",
  ) {
    super(message);
    this.name = "LimitPausedError";
  }
}

export interface Snapshot {
  utilization: number | null;
  resetsAt: number | null;
  status: string | null;
  observedAt: number;
}

async function getNum(key: string, fallback: number) {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return typeof row?.value === "number" ? row.value : fallback;
}
async function getBool(key: string, fallback: boolean) {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return typeof row?.value === "boolean" ? row.value : fallback;
}

/** Normalize Claude Code's resetsAt (unix seconds) to ms. */
function toMs(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v;
}

/** Extract per-window snapshots from a `rate_limit_info` object. Exported for tests. */
export function parseRateLimitInfo(info: Record<string, unknown>, observedAt: number): { window: "five_hour" | "seven_day"; snap: Snapshot }[] {
  const out: { window: "five_hour" | "seven_day"; snap: Snapshot }[] = [];
  const unified = info.unifiedWindows as Record<string, { utilization?: number; resetsAt?: number; status?: string }> | undefined;
  for (const w of ["five_hour", "seven_day"] as const) {
    const u = unified?.[w];
    if (u) {
      out.push({
        window: w,
        snap: { utilization: typeof u.utilization === "number" ? u.utilization : null, resetsAt: toMs(u.resetsAt), status: u.status ?? null, observedAt },
      });
    }
  }
  // Older/simpler shape: a single window described at the top level.
  if (!out.length && typeof info.rateLimitType === "string" && (info.rateLimitType === "five_hour" || info.rateLimitType === "seven_day")) {
    out.push({
      window: info.rateLimitType,
      snap: {
        utilization: typeof info.utilization === "number" ? info.utilization : null,
        resetsAt: toMs(info.resetsAt),
        status: typeof info.status === "string" ? info.status : null,
        observedAt,
      },
    });
  }
  return out;
}

export async function recordRateLimit(providerId: string, info: Record<string, unknown>) {
  const ts = now();
  for (const { window, snap } of parseRateLimitInfo(info, ts)) {
    await db.insert(schema.limitSnapshots).values({ id: newId("lim"), providerId, window, ...snap });
  }
  await db.delete(schema.limitSnapshots).where(lt(schema.limitSnapshots.observedAt, ts - RETENTION_MS));
}

/** A call was refused for quota reasons: record the window as exhausted until its reset. */
export async function recordHardLimit(providerId: string, message: string) {
  const ts = now();
  const fromMessage = /\|(\d{10,13})/.exec(message);
  const latest = await db
    .select()
    .from(schema.limitSnapshots)
    .where(eq(schema.limitSnapshots.providerId, providerId))
    .orderBy(desc(schema.limitSnapshots.observedAt))
    .limit(10);
  // Which window refused? The one closest to full in the latest observations, default 5 h.
  const candidates = WINDOWS.map((w) => latest.find((s) => s.window === w.key)).filter(Boolean) as typeof latest;
  const blocking = candidates.sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0))[0];
  const window = blocking?.window ?? "five_hour";
  const resetsAt = fromMessage ? toMs(Number(fromMessage[1])) : (blocking?.resetsAt ?? null);
  await db.insert(schema.limitSnapshots).values({ id: newId("lim"), providerId, window, utilization: 1, resetsAt, status: "rejected", observedAt: ts });
}

/** Pure computation of one window's state from its snapshots (oldest first). Exported for tests. */
export function computeWindow(
  key: "five_hour" | "seven_day",
  label: string,
  snaps: Snapshot[],
  at: number,
  warnAt: number,
  pauseAt: number,
  lookbackMs: number,
): LimitWindowState {
  const last = snaps[snaps.length - 1];
  const empty: LimitWindowState = {
    key, label, utilization: null, resetsAt: null, status: null, observedAt: null, isReset: false,
    ratePerHour: null, etaPauseAt: null, etaExhaustAt: null, willHitBeforeReset: false, level: "unknown",
  };
  if (!last) return empty;
  const isReset = last.resetsAt !== null && last.resetsAt <= at;
  if (isReset) {
    return { ...empty, resetsAt: last.resetsAt, observedAt: last.observedAt, isReset: true, utilization: null, level: "ok", status: last.status };
  }
  // Rate over the current window only (same reset time), within the lookback.
  const current = snaps.filter((s) => s.resetsAt === last.resetsAt && s.utilization !== null && s.observedAt >= last.observedAt - lookbackMs);
  let ratePerHour: number | null = null;
  if (current.length >= 2) {
    const first = current[0];
    const dt = last.observedAt - first.observedAt;
    if (dt >= 2 * 60_000) ratePerHour = (((last.utilization ?? 0) - (first.utilization ?? 0)) / dt) * 3_600_000;
  }
  const u = last.utilization;
  const eta = (target: number) =>
    u !== null && ratePerHour !== null && ratePerHour > 0 && u < target ? Math.round(last.observedAt + ((target - u) / ratePerHour) * 3_600_000) : u !== null && u >= target ? last.observedAt : null;
  const etaPauseAt = eta(pauseAt);
  const etaExhaustAt = eta(1);
  const willHitBeforeReset = etaPauseAt !== null && last.resetsAt !== null && etaPauseAt < last.resetsAt;
  let level: LimitLevel = "ok";
  if (last.status === "rejected" || (u !== null && u >= 1)) level = "exhausted";
  else if (u !== null && u >= pauseAt) level = "critical";
  else if ((u !== null && u >= warnAt) || last.status === "allowed_warning" || (willHitBeforeReset && etaPauseAt! - at < 60 * 60_000)) level = "warning";
  if (u === null && level === "ok") level = "unknown";
  return { key, label, utilization: u, resetsAt: last.resetsAt, status: last.status, observedAt: last.observedAt, isReset: false, ratePerHour, etaPauseAt, etaExhaustAt, willHitBeforeReset, level };
}

const ORDER: LimitLevel[] = ["unknown", "ok", "warning", "critical", "exhausted"];

export async function getLimitState(providerId = GUARDED_PROVIDER): Promise<LimitState> {
  const at = now();
  const lang = await serverLang();
  const enabled = await getBool("limits.guardEnabled", true);
  const warnAt = await getNum("limits.warnAt", 0.8);
  const pauseAt = await getNum("limits.pauseAt", 0.95);
  const rows = await db
    .select()
    .from(schema.limitSnapshots)
    .where(and(eq(schema.limitSnapshots.providerId, providerId), gte(schema.limitSnapshots.observedAt, at - RETENTION_MS)))
    .orderBy(schema.limitSnapshots.observedAt);
  const windows = WINDOWS.map((w) =>
    computeWindow(
      w.key,
      w.label[lang],
      rows.filter((r) => r.window === w.key).map((r) => ({ utilization: r.utilization, resetsAt: r.resetsAt, status: r.status, observedAt: r.observedAt })),
      at,
      warnAt,
      pauseAt,
      w.lookbackMs,
    ),
  );
  const level = windows.reduce<LimitLevel>((acc, w) => (ORDER.indexOf(w.level) > ORDER.indexOf(acc) ? w.level : acc), "unknown");
  const blocking = windows.filter((w) => w.level === "critical" || w.level === "exhausted");
  const shouldPause = enabled && blocking.length > 0;
  const resumeAt = blocking.length ? Math.max(...blocking.map((w) => w.resetsAt ?? 0)) || null : null;
  const counts = await db
    .select({ status: schema.pausedWork.status, n: sql<number>`count(*)` })
    .from(schema.pausedWork)
    .groupBy(schema.pausedWork.status);
  return {
    providerId,
    enabled,
    warnAt,
    pauseAt,
    windows,
    level,
    shouldPause,
    pauseReason: shouldPause
      ? blocking
          .map((w) =>
            w.level === "exhausted"
              ? tx(lang, `${w.label} épuisée`, `${w.label} exhausted`)
              : tx(lang, `${w.label} à ${Math.round((w.utilization ?? 0) * 100)} %`, `${w.label} at ${Math.round((w.utilization ?? 0) * 100)}%`),
          )
          .join(", ")
      : null,
    resumeAt,
    pausedCount: Number(counts.find((c) => c.status === "paused")?.n ?? 0),
    readyCount: Number(counts.find((c) => c.status === "ready")?.n ?? 0),
  };
}

/** Called before every model call. Only the subscription bridge is guarded. */
export async function assertClaudeAvailable(providerId: string) {
  let kind: string;
  try {
    kind = getProviderDef(providerId).kind;
  } catch {
    return;
  }
  if (kind !== "claude_cli") return;
  const state = await getLimitState(providerId);
  if (state.shouldPause) {
    const lang = await serverLang();
    throw new LimitPausedError(
      tx(
        lang,
        `Limite Claude proche ou atteinte (${state.pauseReason}). Travail mis en pause jusqu'à la réinitialisation.`,
        `Claude limit nearly or fully reached (${state.pauseReason}). Work paused until the reset.`,
      ),
      state.resumeAt,
    );
  }
}
