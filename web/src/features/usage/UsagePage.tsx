import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Info, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useModels } from "@/lib/queries";
import { cn, fmtDateTime, fmtMs, fmtPct, fmtTokens, fmtUsd } from "@/lib/utils";
import type { UsageEvent } from "@/lib/types";
import { Badge, Card, CardHeader, EmptyState, Page, PageHeader, Progress, Section, Skeleton, Stat, Tabs, Tooltip } from "@/components/ui/primitives";
import { CostKindBadge, modelLabel } from "@/components/domain";
import { SubscriptionQuota, type BudgetsData } from "../dashboard/shared";

interface Agg {
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  billedUsd: number;
  subscriptionEquivUsd: number;
  unknownCostCalls: number | null;
  errors: number | null;
  avgLatencyMs: number | null;
}

interface Summary {
  days: number;
  totals: Agg;
  byModel: (Agg & { providerId: string; modelId: string })[];
  byAgent: (Agg & { agentId: string; name: string | null })[];
  byRoom: (Agg & { warRoomId: string; name: string | null })[];
  byPurpose: (Agg & { purpose: string })[];
  byDay: (Agg & { day: string })[];
}

interface ContextRow {
  conversationId: string | null;
  agentId: string | null;
  providerId: string;
  modelId: string;
  contextTokens: number | null;
  createdAt: number;
  contextWindow: number | null;
  agentName: string | null;
  title: string | null;
}

const PURPOSE_LABEL: Record<string, string> = {
  chat: "Réponses",
  routing: "Routage orchestrateur",
  synthesis: "Synthèses",
  analysis: "Analyse de brief",
  summary: "Résumés (compression)",
  debate: "Débats",
};

const n = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v));

type Metric = "calls" | "tokens" | "billed";

/** Daily columns, single series (no legend: the title names it). Hover/focus shows the exact value. */
function DailyChart({ days, rows, metric }: { days: number; rows: Summary["byDay"]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const out: { day: string; value: number | null; row: Agg | null }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const r = byDay.get(key) ?? null;
      const value = !r
        ? 0
        : metric === "calls"
          ? Number(r.calls)
          : metric === "billed"
            ? Number(r.billedUsd)
            : r.inputTokens === null && r.outputTokens === null
              ? null
              : (n(r.inputTokens) ?? 0) + (n(r.outputTokens) ?? 0);
      out.push({ day: key, value, row: r });
    }
    return out;
  }, [rows, days, metric]);

  const max = Math.max(0, ...series.map((s) => s.value ?? 0));
  const niceMax = max === 0 ? 1 : niceCeil(max);
  const fmt = (v: number) => (metric === "billed" ? fmtUsd(v, 2) : metric === "tokens" ? fmtTokens(v, { compact: true }) : String(v));
  const H = 160;
  const ticks = [0, niceMax / 2, niceMax];
  const active = hover !== null ? series[hover] : null;

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex w-12 shrink-0 flex-col justify-between text-right text-[10px] tabular-nums text-fg-subtle" style={{ height: H }}>
          {[...ticks].reverse().map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-border" style={{ bottom: `${(t / niceMax) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {series.map((s, i) => {
              const h = s.value === null ? 0 : (s.value / niceMax) * H;
              return (
                <button
                  key={s.day}
                  type="button"
                  aria-label={`${s.day} : ${s.value === null ? "inconnu" : fmt(s.value)}`}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="group flex h-full min-w-0 flex-1 items-end justify-center outline-none"
                >
                  <span
                    className={cn("w-full max-w-6 rounded-t-[4px] transition-colors", s.value === null ? "bg-transparent" : hover === i ? "bg-accent" : "bg-accent/70")}
                    style={{ height: s.value ? Math.max(2, h) : 0 }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-14 text-[10px] text-fg-subtle">
        <span>{series[0]?.day.slice(5)}</span>
        <span>{series[Math.floor(series.length / 2)]?.day.slice(5)}</span>
        <span>{series[series.length - 1]?.day.slice(5)}</span>
      </div>
      {active ? (
        <div className="pointer-events-none absolute right-0 top-0 rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-xs shadow-lg">
          <div className="font-semibold tabular-nums">{active.value === null ? "inconnu" : fmt(active.value)}</div>
          <div className="text-fg-subtle">{new Date(active.day).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</div>
          {active.row ? (
            <div className="mt-1 space-y-0.5 text-[11px] text-fg-muted tabular-nums">
              <div>{active.row.calls} appels</div>
              <div>
                ↑ {fmtTokens(n(active.row.inputTokens), { compact: true })} · ↓ {fmtTokens(n(active.row.outputTokens), { compact: true })}
              </div>
              <div>Facturé {fmtUsd(Number(active.row.billedUsd))}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function niceCeil(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function AggTable({ rows, label, empty }: { rows: (Agg & { key: string; label: ReactNode })[]; label: string; empty: string }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-xs text-fg-subtle">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] text-fg-subtle">
            <th className="px-4 py-2 font-medium">{label}</th>
            <th className="px-3 py-2 text-right font-medium">Appels</th>
            <th className="px-3 py-2 text-right font-medium">Entrée</th>
            <th className="px-3 py-2 text-right font-medium">Sortie</th>
            <th className="px-3 py-2 text-right font-medium">Cache lu</th>
            <th className="px-3 py-2 text-right font-medium">Facturé API</th>
            <th className="px-3 py-2 text-right font-medium">Éq. abonnement</th>
            <th className="px-4 py-2 text-right font-medium">Latence moy.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border tabular-nums">
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-surface-2">
              <td className="max-w-64 truncate px-4 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right">
                {r.calls}
                {r.errors ? <span className="ml-1 text-danger">({r.errors} err.)</span> : null}
              </td>
              <td className="px-3 py-2 text-right">{fmtTokens(n(r.inputTokens), { compact: true })}</td>
              <td className="px-3 py-2 text-right">{fmtTokens(n(r.outputTokens), { compact: true })}</td>
              <td className="px-3 py-2 text-right">{fmtTokens(n(r.cacheReadTokens), { compact: true })}</td>
              <td className="px-3 py-2 text-right">
                {fmtUsd(Number(r.billedUsd))}
                {r.unknownCostCalls ? (
                  <Tooltip content={`${r.unknownCostCalls} appel(s) au coût inconnu (prix du modèle non renseigné) non inclus`}>
                    <span className="ml-1 text-warning">+?</span>
                  </Tooltip>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">{Number(r.subscriptionEquivUsd) ? `≈${fmtUsd(Number(r.subscriptionEquivUsd))}` : "—"}</td>
              <td className="px-4 py-2 text-right text-fg-muted">{fmtMs(r.avgLatencyMs === null ? null : Math.round(Number(r.avgLatencyMs)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SCOPE_LABEL: Record<string, string> = { global: "Global (mois)", project: "Projet", warroom: "War Room", agent: "Agent" };

export default function UsagePage() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>("calls");
  const [breakdown, setBreakdown] = useState("model");
  const models = useModels();

  const summary = useQuery({ queryKey: qk.usage(days), queryFn: () => api.get<Summary>(`/usage/summary?days=${days}`), refetchInterval: 30_000 });
  const contexts = useQuery({ queryKey: qk.contexts(), queryFn: () => api.get<ContextRow[]>("/usage/contexts"), refetchInterval: 30_000 });
  const events = useQuery({ queryKey: ["usage-events"], queryFn: () => api.get<UsageEvent[]>("/usage/events?limit=100"), refetchInterval: 30_000 });
  const budgets = useQuery({ queryKey: qk.budgets, queryFn: () => api.get<BudgetsData>("/usage/budgets"), refetchInterval: 30_000 });

  const t = summary.data?.totals;
  const md = models.data ?? [];

  const breakdownRows = useMemo(() => {
    const s = summary.data;
    if (!s) return [];
    switch (breakdown) {
      case "agent":
        return s.byAgent.map((r) => ({ ...r, key: r.agentId, label: r.name ?? "agent supprimé" }));
      case "room":
        return s.byRoom.map((r) => ({
          ...r,
          key: r.warRoomId,
          label: r.name ? (
            <Link className="hover:underline" to={`/warrooms/${r.warRoomId}`}>
              {r.name}
            </Link>
          ) : (
            "War Room supprimée"
          ),
        }));
      case "purpose":
        return s.byPurpose.map((r) => ({ ...r, key: r.purpose, label: PURPOSE_LABEL[r.purpose] ?? r.purpose }));
      default:
        return s.byModel.map((r) => ({ ...r, key: `${r.providerId}:${r.modelId}`, label: `${modelLabel(md, r.providerId, r.modelId)} · ${r.providerId}` }));
    }
  }, [summary.data, breakdown, md]);

  return (
    <Page wide>
      <PageHeader
        title="Usage & Costs"
        description="Consommation réelle des IA. Les tokens viennent des fournisseurs ; les coûts sont calculés à partir de ces tokens et du prix connu du modèle."
        icon={<BarChart3 />}
        actions={
          <div className="flex rounded-md border border-border bg-surface p-0.5">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={cn("h-7 rounded px-2.5 text-xs", days === d ? "bg-surface-3 font-medium text-fg" : "text-fg-muted hover:text-fg")}
              >
                {d} j
              </button>
            ))}
          </div>
        }
      />

      {summary.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : summary.isError ? (
        <EmptyState icon={<AlertTriangle />} title="Impossible de charger l'usage" description={(summary.error as Error).message} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Stat label="Appels" value={t?.calls ?? 0} hint={t?.errors ? `${t.errors} en erreur` : `sur ${days} jours`} />
            <Stat label="Tokens entrée" value={fmtTokens(n(t?.inputTokens), { compact: true })} hint="hors cache, rapportés" />
            <Stat label="Tokens sortie" value={fmtTokens(n(t?.outputTokens), { compact: true })} hint="rapportés par les fournisseurs" />
            <Stat
              label="Tokens cache"
              value={fmtTokens(n(t?.cacheReadTokens), { compact: true })}
              hint={`lus · ${fmtTokens(n(t?.cacheWriteTokens), { compact: true })} écrits`}
            />
            <Stat
              label="Facturé API"
              value={fmtUsd(Number(t?.billedUsd ?? 0))}
              hint={t?.unknownCostCalls ? `+ ${t.unknownCostCalls} appel(s) au coût inconnu` : "argent réellement dépensé"}
            />
            <Stat
              label="Équivalent abonnement"
              value={Number(t?.subscriptionEquivUsd ?? 0) ? `≈${fmtUsd(Number(t?.subscriptionEquivUsd))}` : "—"}
              hint="valeur API indicative, non dépensée"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <strong className="text-fg">Exact</strong> : tokens et durée de chaque appel, tels que renvoyés par le fournisseur. <strong className="text-fg">Calculé</strong> : coût
              API = tokens × prix du modèle (source affichée dans Models & Providers). <strong className="text-fg">Indicatif</strong> : la valeur « équivalent API » de Claude
              Code n'est pas une dépense, l'usage est couvert par l'abonnement. Quand le prix ou les tokens manquent, le coût est « inconnu » et n'est pas additionné.
            </span>
          </div>

          <Card>
            <CardHeader
              title={metric === "calls" ? "Appels par jour" : metric === "tokens" ? "Tokens (entrée + sortie) par jour" : "Coût API facturé par jour"}
              description={`${days} derniers jours`}
              actions={
                <div className="flex rounded-md border border-border p-0.5">
                  {(
                    [
                      ["calls", "Appels"],
                      ["tokens", "Tokens"],
                      ["billed", "Facturé"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setMetric(k)}
                      className={cn("h-6 rounded px-2 text-[11px]", metric === k ? "bg-surface-3 font-medium text-fg" : "text-fg-muted hover:text-fg")}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="px-4 py-4">
              {summary.data?.byDay.length ? (
                <DailyChart days={days} rows={summary.data.byDay} metric={metric} />
              ) : (
                <p className="py-10 text-center text-xs text-fg-subtle">Aucun appel enregistré sur la période.</p>
              )}
            </div>
          </Card>

          <Card>
            <div className="px-4 pt-2">
              <Tabs
                value={breakdown}
                onValueChange={setBreakdown}
                items={[
                  { value: "model", label: "Par modèle", count: summary.data?.byModel.length },
                  { value: "agent", label: "Par agent", count: summary.data?.byAgent.length },
                  { value: "room", label: "Par War Room", count: summary.data?.byRoom.length },
                  { value: "purpose", label: "Par usage", count: summary.data?.byPurpose.length },
                ]}
              />
            </div>
            <AggTable
              rows={breakdownRows}
              label={{ model: "Modèle", agent: "Agent", room: "War Room", purpose: "Usage" }[breakdown] ?? ""}
              empty="Aucune donnée sur la période."
            />
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Section title="Contextes" description="Taille du dernier contexte envoyé (exacte, rapportée par le fournisseur) par rapport à la fenêtre maximale connue du modèle.">
              <Card>
                {contexts.data?.length ? (
                  <div className="divide-y divide-border">
                    {contexts.data.slice(0, 30).map((c) => {
                      const ratio = c.contextTokens !== null && c.contextWindow ? c.contextTokens / c.contextWindow : null;
                      return (
                        <div key={`${c.conversationId}-${c.agentId}`} className="space-y-1.5 px-4 py-2.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-fg">{c.agentName ?? c.title ?? "Conversation"}</div>
                              <div className="truncate text-[11px] text-fg-subtle">
                                {c.agentName && c.title ? `${c.title} · ` : ""}
                                {modelLabel(md, c.providerId, c.modelId)}
                              </div>
                            </div>
                            <div className="shrink-0 text-right tabular-nums">
                              <div>{ratio === null ? "inconnu" : fmtPct(ratio)}</div>
                              <div className="text-[11px] text-fg-subtle">
                                {fmtTokens(c.contextTokens, { compact: true })} / {c.contextWindow ? fmtTokens(c.contextWindow, { compact: true }) : "fenêtre inconnue"}
                              </div>
                            </div>
                          </div>
                          <Progress value={ratio} tone={ratio === null ? "accent" : ratio >= 0.85 ? "danger" : ratio >= 0.6 ? "warning" : "accent"} />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucun contexte mesuré pour l'instant.</p>
                )}
              </Card>
            </Section>

            <Section title="Budgets & alertes" description="Seuils d'alerte à 50 %, 80 % et 100 %. Seules les dépenses API réelles comptent.">
              <div className="space-y-4">
                {budgets.data?.claudeCodeRateLimit ? <SubscriptionQuota raw={budgets.data.claudeCodeRateLimit} /> : null}
                <Card>
                  {budgets.data?.items.length ? (
                    <div className="divide-y divide-border">
                      {budgets.data.items.map((b) => (
                        <div key={`${b.scope}-${b.id}`} className="space-y-1.5 px-4 py-2.5">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="min-w-0 truncate">
                              <span className="text-fg-subtle">{SCOPE_LABEL[b.scope]} · </span>
                              {b.name}
                            </span>
                            <span className="flex shrink-0 items-center gap-2 tabular-nums">
                              {b.level !== null && b.level >= 0.5 ? (
                                <Badge tone={b.level >= 1 ? "danger" : b.level >= 0.8 ? "warning" : "neutral"}>
                                  <AlertTriangle /> {Math.round(b.level * 100)} %
                                </Badge>
                              ) : null}
                              {fmtUsd(b.spentUsd)} {b.limitUsd !== null ? <span className="text-fg-subtle">/ {fmtUsd(b.limitUsd)}</span> : <span className="text-fg-subtle">· sans limite</span>}
                            </span>
                          </div>
                          {b.limitUsd ? (
                            <div className="relative">
                              <Progress value={b.spentUsd / b.limitUsd} tone={(b.level ?? 0) >= 1 ? "danger" : (b.level ?? 0) >= 0.8 ? "warning" : "accent"} />
                              {[0.5, 0.8].map((th) => (
                                <span key={th} className="absolute top-0 h-1.5 w-px bg-fg-subtle/60" style={{ left: `${th * 100}%` }} />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucun budget défini ni dépense enregistrée.</p>
                  )}
                  <p className="border-t border-border px-4 py-2 text-[11px] text-fg-subtle">
                    Budget mensuel global dans <Link to="/settings" className="text-accent hover:underline">Settings</Link> ; budgets par War Room, agent et projet dans leurs
                    paramètres.
                  </p>
                </Card>
                {budgets.data?.strategies ? (
                  <Card>
                    <CardHeader title="Stratégies de coût" description="Choisies par War Room ; elles guident l'orchestrateur et le choix des modèles." />
                    <div className="divide-y divide-border">
                      {Object.entries(budgets.data.strategies).map(([k, s]) => (
                        <div key={k} className="px-4 py-2.5 text-xs">
                          <div className="font-medium text-fg">{s.label}</div>
                          <div className="mt-0.5 text-fg-muted">{s.tradeoff}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : null}
              </div>
            </Section>
          </div>

          <Section title="Derniers appels" description="Chaque ligne est un appel réel à un modèle.">
            <Card>
              {events.data?.length ? (
                <div className="max-h-[480px] overflow-auto">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="border-b border-border text-left text-[11px] text-fg-subtle">
                        <th className="px-4 py-2 font-medium">Date</th>
                        <th className="px-3 py-2 font-medium">Modèle</th>
                        <th className="px-3 py-2 font-medium">Usage</th>
                        <th className="px-3 py-2 text-right font-medium">Entrée</th>
                        <th className="px-3 py-2 text-right font-medium">Sortie</th>
                        <th className="px-3 py-2 text-right font-medium">Cache lu</th>
                        <th className="px-3 py-2 text-right font-medium">Coût</th>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-4 py-2 text-right font-medium">Durée</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border tabular-nums">
                      {events.data.map((e) => (
                        <tr key={e.id} className="hover:bg-surface-2">
                          <td className="whitespace-nowrap px-4 py-1.5 text-fg-muted">{fmtDateTime(e.createdAt)}</td>
                          <td className="max-w-56 truncate px-3 py-1.5">{modelLabel(md, e.providerId, e.modelId)}</td>
                          <td className="px-3 py-1.5 text-fg-muted">
                            {PURPOSE_LABEL[e.purpose] ?? e.purpose}
                            {e.status !== "ok" ? <Badge tone={e.status === "error" ? "danger" : "neutral"} className="ml-1.5">{e.status === "error" ? "erreur" : "interrompu"}</Badge> : null}
                          </td>
                          <td className="px-3 py-1.5 text-right">{fmtTokens(e.inputTokens, { compact: true })}</td>
                          <td className="px-3 py-1.5 text-right">{fmtTokens(e.outputTokens, { compact: true })}</td>
                          <td className="px-3 py-1.5 text-right">{fmtTokens(e.cacheReadTokens, { compact: true })}</td>
                          <td className="px-3 py-1.5 text-right">
                            {e.costKind === "subscription" ? (e.costUsd !== null ? `≈${fmtUsd(e.costUsd)}` : "—") : e.costKind === "local" ? "—" : fmtUsd(e.costUsd)}
                          </td>
                          <td className="px-3 py-1.5">
                            <CostKindBadge kind={e.costKind} />
                          </td>
                          <td className="px-4 py-1.5 text-right text-fg-muted">{fmtMs(e.latencyMs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucun appel enregistré.</p>
              )}
            </Card>
          </Section>
        </div>
      )}
    </Page>
  );
}
