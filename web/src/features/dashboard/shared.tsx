import { fmtPct, fmtRelative } from "@/lib/utils";
import { Card, CardHeader, Progress } from "@/components/ui/primitives";

export interface BudgetItem {
  scope: "global" | "project" | "warroom" | "agent";
  id: string | null;
  name: string;
  spentUsd: number;
  limitUsd: number | null;
  level: number | null;
}

export interface BudgetsData {
  items: BudgetItem[];
  claudeCodeRateLimit: unknown;
  strategies: Record<string, { label: string; tradeoff: string }>;
}



/** Defensive reader for the Claude Code rate_limit_event payload (shape may evolve). */
export function readQuota(raw: unknown): { label: string; utilization: number | null; resetsAt: number | null; status: string | null }[] {
  if (!raw || typeof raw !== "object") return [];
  const windows = (raw as { unifiedWindows?: unknown }).unifiedWindows;
  if (!windows || typeof windows !== "object") return [];
  const labels: Record<string, string> = { five_hour: "Fenêtre 5 h", seven_day: "Fenêtre 7 jours" };
  return Object.entries(windows as Record<string, unknown>).map(([key, w]) => {
    const win = (w && typeof w === "object" ? w : {}) as { utilization?: unknown; resetsAt?: unknown; status?: unknown };
    return {
      label: labels[key] ?? key.replace(/_/g, " "),
      utilization: typeof win.utilization === "number" ? win.utilization : null,
      resetsAt: typeof win.resetsAt === "number" ? win.resetsAt * 1000 : null,
      status: typeof win.status === "string" ? win.status : null,
    };
  });
}

export function quotaObservedAt(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as { observedAt?: unknown }).observedAt;
  return typeof v === "number" ? v : null;
}

export function SubscriptionQuota({ raw }: { raw: unknown }) {
  const windows = readQuota(raw);
  if (!windows.length) return null;
  const observed = quotaObservedAt(raw);
  return (
    <Card>
      <CardHeader
        title="Quota abonnement Claude (Claude Code)"
        description={`Taux d'utilisation rapporté par Claude Code lors du dernier appel${observed ? ` (${fmtRelative(observed)})` : ""}. Aucun coût facturé.`}
      />
      <div className="space-y-3 px-4 py-3">
        {windows.map((w) => {
          const tone = w.utilization === null ? "accent" : w.utilization >= 0.9 ? "danger" : w.utilization >= 0.7 ? "warning" : "accent";
          return (
            <div key={w.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-fg-muted">{w.label}</span>
                <span className="tabular-nums">
                  {w.utilization === null ? "inconnu" : fmtPct(w.utilization)}
                  {w.resetsAt ? <span className="ml-2 text-fg-subtle">réinit. {fmtRelative(w.resetsAt)}</span> : null}
                </span>
              </div>
              <Progress value={w.utilization} tone={tone} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

