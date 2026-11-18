import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn, fmtDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { Markdown } from "../chat/Markdown";
import type { RoomDetail } from "./shared";

interface ReportItem {
  id: string;
  kind: "daily" | "manual";
  day: string;
  periodStart: number;
  periodEnd: number;
  stats: Record<string, number>;
  createdAt: number;
}

export function ReportsTab({ detail }: { detail: RoomDetail }) {
  const { room } = detail;
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["reports", room.id], queryFn: () => api.get<ReportItem[]>(`/warrooms/${room.id}/reports`) });
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (!selected && list.data?.length) setSelected(list.data[0].id);
  }, [list.data, selected]);
  const report = useQuery({
    queryKey: ["report", selected],
    queryFn: () => api.get<ReportItem & { markdown: string }>(`/warrooms/${room.id}/reports/${selected}`),
    enabled: !!selected,
  });
  const generate = useMutation({
    mutationFn: () => api.post<ReportItem>(`/warrooms/${room.id}/reports`, { hours: 24 }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["reports", room.id] });
      setSelected(r.id);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-5 px-6 py-5 lg:grid-cols-[260px_1fr]">
        <div className="space-y-3">
          <Button variant="primary" size="sm" className="w-full" onClick={() => generate.mutate()} loading={generate.isPending}>
            <FilePlus2 /> Rapport des dernières 24 h
          </Button>
          <p className="flex items-start gap-1.5 text-[11px] text-fg-subtle">
            <CalendarClock className="mt-0.5 size-3 shrink-0" />
            Un rapport est créé automatiquement chaque jour (heure réglable dans Settings). Il est construit à partir des données, sans appel à une IA.
          </p>
          <div className="space-y-1">
            {(list.data ?? []).map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={cn("block w-full rounded-md px-2.5 py-2 text-left transition-colors", selected === r.id ? "bg-surface-3" : "hover:bg-surface-2")}
              >
                <div className="flex items-center justify-between text-[13px]">
                  <span>{new Date(r.periodEnd).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span>
                  <Badge tone={r.kind === "daily" ? "neutral" : "outline"}>{r.kind === "daily" ? "quotidien" : "manuel"}</Badge>
                </div>
                <div className="mt-0.5 text-[11px] text-fg-subtle">
                  {r.stats.tasksDone}/{r.stats.tasksTotal} tâches · +{r.stats.doneInPeriod} terminée(s)
                </div>
              </button>
            ))}
          </div>
        </div>
        <div>
          {!list.data?.length && !list.isLoading ? (
            <EmptyState
              icon={<CalendarClock />}
              title="Pas encore de rapport"
              description="Le premier rapport quotidien sera créé à l'heure prévue. Vous pouvez en générer un maintenant."
            />
          ) : report.data ? (
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-fg-subtle">
                <span>
                  Du {fmtDateTime(report.data.periodStart)} au {fmtDateTime(report.data.periodEnd)}
                </span>
                <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(report.data!.markdown).then(() => toast.success("Copié"))}>
                  <Copy /> Copier
                </Button>
              </div>
              <Markdown text={report.data.markdown} />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
