import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, X, FileText, Clock, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import type { LimitState, LimitWindowState, PausedWorkDTO } from "@shared/types";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { cn, fmtDateTime, fmtRelative, fmtTokens, fmtUsd } from "@/lib/utils";
import { Button } from "../ui/button";
import { Badge, Card, Dialog, Progress } from "../ui/primitives";
import { locale, t } from "@/i18n";

export const LEVEL_TONE = { unknown: "neutral", ok: "success", warning: "warning", critical: "danger", exhausted: "danger" } as const;
export const LEVEL_LABEL = { unknown: "inconnu", ok: "ok", warning: "attention", critical: "pause", exhausted: "épuisée" } as const;

function fmtTime(ts: number | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : fmtDateTime(ts);
}

/** One line describing a window: usage, reset, prediction. */
export function windowSentence(w: LimitWindowState, pauseAt: number) {
  const label = t(w.label);
  if (w.isReset) return t("{label} : réinitialisée depuis {time} (nouvelle mesure au prochain appel).", { label, time: fmtTime(w.resetsAt) });
  if (w.utilization === null) return t("{label} : pas encore mesurée (aucun appel Claude Code récent).", { label });
  const pct = Math.round(w.utilization * 100);
  const parts = [t("{label} : {pct} %", { label, pct }), t("réinitialisation {time}", { time: fmtTime(w.resetsAt) })];
  if (w.ratePerHour !== null && w.ratePerHour > 0) {
    parts.push(t("rythme ≈ {rate} pts/h", { rate: (w.ratePerHour * 100).toFixed(1) }));
    if (w.willHitBeforeReset && w.etaPauseAt) parts.push(t("pause prévue vers {time} (seuil {pct} %)", { time: fmtTime(w.etaPauseAt), pct: Math.round(pauseAt * 100) }));
    else parts.push(t("pas de pause prévue avant la réinitialisation"));
  }
  return parts.join(" · ");
}

export function WindowMeter({ w, pauseAt, compact }: { w: LimitWindowState; pauseAt: number; compact?: boolean }) {
  const value = w.isReset ? 0 : w.utilization;
  const tone = w.level === "exhausted" || w.level === "critical" ? "danger" : w.level === "warning" ? "warning" : "accent";
  return (
    <div className={cn("space-y-1", compact && "space-y-0.5")}>
      <div className="flex items-center justify-between text-xs">
        <span className={compact ? "text-fg-subtle" : "font-medium"}>{t(w.label)}</span>
        <span className="tabular-nums text-fg-muted">{w.isReset ? t("réinitialisée") : w.utilization === null ? "—" : t("{pct} %", { pct: Math.round(w.utilization * 100) })}</span>
      </div>
      <div className="relative">
        <Progress value={value} tone={tone} className={compact ? "h-1" : undefined} />
        {!compact ? <div className="absolute top-[-2px] h-2.5 w-px bg-danger/70" style={{ left: `${pauseAt * 100}%` }} title={t("Seuil de pause")} /> : null}
      </div>
    </div>
  );
}

interface Report {
  generatedAt: number;
  state: LimitState;
  paused: PausedWorkDTO[];
  windowsUsage: {
    key: string;
    label: string;
    since: number;
    totals: { calls: number; input: number | null; output: number | null; cacheRead: number | null; equivUsd: number | null };
    byRoom: { name: string | null; calls: number; output: number | null; equivUsd: number | null }[];
    byAgent: { name: string | null; calls: number; output: number | null; equivUsd: number | null }[];
  }[];
  recentActivity: { id: string; type: string; summary: string; createdAt: number }[];
}

export function PausedList({ items, onNavigate }: { items: PausedWorkDTO[]; onNavigate?: () => void }) {
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/limits/paused/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.paused });
      void qc.invalidateQueries({ queryKey: qk.limits });
    },
  });
  if (!items.length) return <p className="text-xs text-fg-subtle">{t("Aucun travail en pause.")}</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
          <div className="min-w-0 flex-1">
            <div className="truncate">{p.title}</div>
            <div className="text-[11px] text-fg-subtle">
              {p.warRoomName ? `${p.warRoomName} · ` : ""}
              {p.kind === "collective" ? t("conversation collective") : t("conversation")} · {t("en pause {when}", { when: fmtRelative(p.createdAt) })}
              {p.resetsAt ? ` · ${p.status === "ready" ? t("reprise possible maintenant") : t("reprise possible à {time}", { time: fmtTime(p.resetsAt) })}` : ""}
            </div>
          </div>
          <Badge tone={p.status === "ready" ? "success" : "warning"}>{p.status === "ready" ? t("prêt à reprendre") : t("en pause")}</Badge>
          <Link to={p.href} onClick={onNavigate}>
            <Button size="sm" variant={p.status === "ready" ? "primary" : "ghost"}>
              <Play /> {p.status === "ready" ? t("Reprendre ici") : t("Reprendre quand même")}
            </Button>
          </Link>
          {p.warRoomId ? (
            <Link to={`/warrooms/${p.warRoomId}?recap=1`} onClick={onNavigate}>
              <Button size="sm" variant="ghost">
                <FileText /> {t("Récap")}
              </Button>
            </Link>
          ) : null}
          <Button size="icon-sm" variant="ghost" aria-label={t("Abandonner")} title={t("Abandonner ce travail")} onClick={() => cancel.mutate(p.id)}>
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function LimitReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const report = useQuery({ queryKey: ["limits-report"], queryFn: () => api.get<Report>("/limits/report"), enabled: open });
  const resumeAll = useMutation({
    mutationFn: () => api.post<{ started: boolean; count?: number; reason?: string }>("/limits/paused/resume-all"),
    onSuccess: (r) => {
      if (r.started) toast.success(t("Reprise de {count} travail(aux) en arrière-plan. Les conversations se mettront à jour.", { count: r.count }));
      else toast(r.reason ?? t("Rien à reprendre"));
      setTimeout(() => void qc.invalidateQueries(), 4000);
    },
  });
  const r = report.data;
  const ready = r?.paused.filter((p) => p.status === "ready") ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="xl" title={t("Rapport des limites Claude")} description={r ? t("Établi {when} à partir des mesures renvoyées par Claude Code.", { when: fmtRelative(r.generatedAt) }) : undefined}>
      {!r ? (
        <p className="text-sm text-fg-muted">{t("Chargement…")}</p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            {r.state.windows.map((w) => (
              <Card key={w.key} className="space-y-2 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold">{t(w.label)}</span>
                  <Badge tone={LEVEL_TONE[w.level]}>{t(LEVEL_LABEL[w.level])}</Badge>
                </div>
                <WindowMeter w={w} pauseAt={r.state.pauseAt} />
                <div className="space-y-0.5 text-xs text-fg-muted">
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-3" /> {t("Réinitialisation : {time}", { time: fmtTime(w.resetsAt) })}
                  </div>
                  {w.ratePerHour !== null && w.ratePerHour > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="size-3" /> {t("Rythme ≈ {rate} points/h", { rate: (w.ratePerHour * 100).toFixed(1) })}
                      {w.etaPauseAt ? ` · ${t("seuil de pause vers {time}", { time: fmtTime(w.etaPauseAt) })}` : ""}
                      {w.etaExhaustAt ? ` · ${t("100 % vers {time}", { time: fmtTime(w.etaExhaustAt) })}` : ""}
                    </div>
                  ) : (
                    <div>{t("Pas assez de mesures récentes pour estimer le rythme.")}</div>
                  )}
                  {w.observedAt ? <div>{t("Dernière mesure {when}", { when: fmtRelative(w.observedAt) })}</div> : null}
                </div>
              </Card>
            ))}
          </div>
          <p className="text-[11px] text-fg-subtle">
            {t(
              "Les pourcentages sont ceux de votre compte Claude (ils incluent l'usage hors WAR ROOM). Ils ne sont mis à jour qu'à chaque appel fait par WAR ROOM. La prédiction suppose que le rythme récent continue. Seuils : alerte à {warn} %, pause à {pause} % (réglables dans Settings).",
              { warn: Math.round(r.state.warnAt * 100), pause: Math.round(r.state.pauseAt * 100) },
            )}
          </p>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">{t("Travail en pause ({count})", { count: r.paused.length })}</h3>
              {ready.length ? (
                <Button size="sm" variant="primary" onClick={() => resumeAll.mutate()} loading={resumeAll.isPending}>
                  <Play /> {t("Tout reprendre en arrière-plan ({count})", { count: ready.length })}
                </Button>
              ) : null}
            </div>
            <PausedList items={r.paused} onNavigate={() => onOpenChange(false)} />
          </section>

          {r.windowsUsage.map((wu) => (
            <section key={wu.key} className="space-y-2">
              <h3 className="text-[13px] font-semibold">
                {t("Consommation WAR ROOM dans la {window}", { window: t(wu.label).toLowerCase() })} <span className="font-normal text-fg-subtle">{t("(depuis {date})", { date: fmtDateTime(wu.since) })}</span>
              </h3>
              <p className="text-xs text-fg-muted">
                {t("{calls} appel(s) · {output} tokens générés · {cache} lus en cache · équivalent API {usd} (inclus dans l'abonnement)", {
                  calls: wu.totals.calls,
                  output: fmtTokens(wu.totals.output, { compact: true }),
                  cache: fmtTokens(wu.totals.cacheRead, { compact: true }),
                  usd: fmtUsd(wu.totals.equivUsd),
                })}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  [t("Par War Room"), wu.byRoom],
                  [t("Par agent"), wu.byAgent],
                ].map(([label, rows]) => (
                  <Card key={label as string} className="p-3">
                    <div className="mb-1.5 text-xs font-medium text-fg-muted">{label as string}</div>
                    <table className="w-full text-xs">
                      <tbody>
                        {(rows as Report["windowsUsage"][number]["byRoom"]).map((x, i) => (
                          <tr key={i}>
                            <td className="py-0.5">{x.name ?? t("Hors War Room")}</td>
                            <td className="py-0.5 text-right tabular-nums text-fg-muted">{t("{calls} appels", { calls: x.calls })}</td>
                            <td className="py-0.5 text-right tabular-nums text-fg-muted">{fmtUsd(x.equivUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                ))}
              </div>
            </section>
          ))}

          {r.recentActivity.length ? (
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{t("Derniers événements")}</h3>
              <ul className="space-y-0.5 text-xs text-fg-muted">
                {r.recentActivity.map((a) => (
                  <li key={a.id}>
                    <span className="text-fg-subtle">{fmtDateTime(a.createdAt)}</span> — {a.summary}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
