import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Wand2, Users, ListTodo, Plug, AlertTriangle, HelpCircle, CheckCircle2, Download, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Analysis } from "@/lib/types";
import { fmtDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { AgentAvatar } from "@/components/domain";
import type { RoomDetail } from "./shared";

const TIER_LABEL = { economy: "économique", balanced: "équilibré", premium: "premium" } as const;

export function AnalysisTab({ detail }: { detail: RoomDetail }) {
  const { room, agents } = detail;
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const analysis = room.analysis as Analysis | null;
  const existingNames = new Set(agents.map((a) => a.name.toLowerCase()));
  const [picked, setPicked] = useState<string[]>([]);
  const [withTasks, setWithTasks] = useState(true);
  const started = useRef(false);

  useEffect(() => {
    if (analysis) setPicked(analysis.agents.filter((a) => !existingNames.has(a.name.toLowerCase())).map((a) => a.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.generatedAt]);

  const run = useMutation({
    mutationFn: () => api.post<Analysis>(`/warrooms/${room.id}/analyze`),
    onSuccess: () => {
      toast.success("Analyse terminée");
      void qc.invalidateQueries({ queryKey: qk.warroom(room.id) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  useEffect(() => {
    if (params.get("analyze") === "1" && !started.current) {
      started.current = true;
      params.delete("analyze");
      setParams(params, { replace: true });
      run.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = useMutation({
    mutationFn: () => api.post<{ created: { name: string; model: string }[]; taskCount: number }>(`/warrooms/${room.id}/apply-analysis`, { agentNames: picked, createTasks: withTasks }),
    onSuccess: (r) => {
      toast.success(`${r.created.length} agent(s) et ${r.taskCount} tâche(s) créés`);
      void qc.invalidateQueries({ queryKey: qk.warroom(room.id) });
      void qc.invalidateQueries({ queryKey: qk.tasks({ warRoomId: room.id }) });
      void qc.invalidateQueries({ queryKey: qk.agents });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-5">
        <Card>
          <CardHeader
            title="Brief du projet"
            description={analysis ? `Dernière analyse : ${fmtDateTime(analysis.generatedAt)} · ${analysis.model}` : "L'orchestrateur lit le brief et les fichiers de référence, puis propose une organisation."}
            actions={
              <Button variant={analysis ? "secondary" : "primary"} size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={!room.brief.trim() && !room.objective.trim()}>
                <Wand2 /> {analysis ? "Relancer l'analyse" : "Analyser le brief"}
              </Button>
            }
          />
          <div className="max-h-48 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-[13px] text-fg-muted">{room.brief || room.objective || "Aucun brief. Ajoutez-le dans l'onglet Paramètres."}</div>
        </Card>

        {run.isPending ? (
          <Card className="flex items-center gap-3 p-5 text-[13px] text-fg-muted">
            <CircleDashed className="size-4 animate-spin text-accent" />
            L'orchestrateur analyse le projet (cela peut prendre une à deux minutes avec un modèle de raisonnement)…
          </Card>
        ) : null}

        {!analysis && !run.isPending ? (
          <EmptyState icon={<Sparkles />} title="Pas encore d'analyse" description="Lancez l'analyse : vous obtiendrez une proposition d'équipe, de tâches, de Skills et de serveurs MCP, que vous validerez avant toute création." />
        ) : null}

        {analysis ? (
          <>
            <Card className="p-4">
              <h3 className="text-[13px] font-semibold">Compréhension du projet</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">{analysis.summary}</p>
              {analysis.domains.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {analysis.domains.map((d) => (
                    <Badge key={d} tone="outline">{d}</Badge>
                  ))}
                </div>
              ) : null}
            </Card>

            <Card>
              <CardHeader
                title={<span className="flex items-center gap-1.5"><Users className="size-3.5" /> Équipe proposée</span>}
                description="Le modèle de chaque agent est choisi selon la gamme proposée, la stratégie de coût et les fournisseurs connectés. Modifiable ensuite."
                actions={
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <input type="checkbox" checked={withTasks} onChange={(e) => setWithTasks(e.target.checked)} className="accent-[var(--accent)]" />
                      Créer aussi les tâches
                    </label>
                    <Button size="sm" variant="primary" onClick={() => apply.mutate()} loading={apply.isPending} disabled={!picked.length && !withTasks}>
                      Créer la sélection
                    </Button>
                  </>
                }
              />
              <div className="grid gap-2 p-3 md:grid-cols-2">
                {analysis.agents.map((a) => {
                  const exists = existingNames.has(a.name.toLowerCase());
                  return (
                    <label key={a.name} className="flex cursor-pointer gap-3 rounded-md border border-border p-3 hover:bg-surface-2/50">
                      <input
                        type="checkbox"
                        disabled={exists}
                        checked={exists || picked.includes(a.name)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, a.name] : p.filter((x) => x !== a.name)))}
                        className="mt-1 accent-[var(--accent)]"
                      />
                      <AgentAvatar icon={a.icon} color="blue" size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium">{a.name}</span>
                          <Badge tone={a.tier === "premium" ? "accent" : "neutral"}>{TIER_LABEL[a.tier]}</Badge>
                          {exists ? <Badge tone="success">déjà créé</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-fg-muted">{a.function}</p>
                        <p className="mt-1 line-clamp-3 text-xs text-fg-subtle">{a.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </Card>

            <Card>
              <CardHeader title={<span className="flex items-center gap-1.5"><ListTodo className="size-3.5" /> Premières tâches</span>} />
              <ol className="divide-y divide-border">
                {analysis.tasks.map((t, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                    <Badge tone={t.priority === 1 ? "danger" : t.priority === 2 ? "warning" : "neutral"}>P{t.priority}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px]">{t.title}</div>
                      <div className="text-xs text-fg-subtle">{t.description}</div>
                      {t.dependsOn.length ? <div className="mt-0.5 text-[11px] text-fg-subtle">Dépend de : {t.dependsOn.join(", ")}</div> : null}
                    </div>
                    <span className="shrink-0 text-xs text-fg-muted">{t.assignee}</span>
                  </li>
                ))}
              </ol>
            </Card>

            <Card>
              <CardHeader
                title={<span className="flex items-center gap-1.5"><Sparkles className="size-3.5" /> Skills recommandés</span>}
                description="Le statut est vérifié dans votre inventaire réel (Claude Code, marketplace, WAR ROOM). Rien n'est installé sans votre accord."
                actions={
                  <Link to="/skills">
                    <Button size="sm" variant="ghost">Catalogue</Button>
                  </Link>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-border text-left text-[11px] text-fg-subtle">
                      <th className="px-4 py-2 font-medium">Skill</th>
                      <th className="px-2 py-2 font-medium">Statut</th>
                      <th className="px-2 py-2 font-medium">Priorité</th>
                      <th className="px-2 py-2 font-medium">Pour</th>
                      <th className="px-2 py-2 font-medium">Pourquoi</th>
                      <th className="px-4 py-2 font-medium">Coût contexte / risques</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.skills.map((s, i) => (
                      <tr key={i} className="border-b border-border/60 align-top last:border-0">
                        <td className="px-4 py-2 font-medium">{s.name}</td>
                        <td className="px-2 py-2">
                          {s.status === "installed" ? (
                            <Badge tone="success"><CheckCircle2 /> disponible</Badge>
                          ) : s.status === "available" ? (
                            <Badge tone="accent" title={s.matchSource ?? ""}><Download /> installable</Badge>
                          ) : (
                            <Badge tone="warning">manquant</Badge>
                          )}
                        </td>
                        <td className="px-2 py-2 text-fg-muted">{s.priority === "required" ? "requis" : s.priority === "recommended" ? "recommandé" : "optionnel"}</td>
                        <td className="px-2 py-2 text-fg-muted">{s.agent}</td>
                        <td className="px-2 py-2 text-fg-muted">{s.why}</td>
                        <td className="px-4 py-2 text-fg-subtle">
                          {s.contextCost}
                          {s.risks ? ` · ${s.risks}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-border px-4 py-2 text-[11px] text-fg-subtle">
                « Manquant » : aucun Skill correspondant n'a été trouvé dans les sources configurées. Vous pouvez en créer un sur la page Skills.
              </p>
            </Card>

            {analysis.mcp.length ? (
              <Card>
                <CardHeader title={<span className="flex items-center gap-1.5"><Plug className="size-3.5" /> Serveurs MCP suggérés</span>} actions={<Link to="/mcp"><Button size="sm" variant="ghost">Configurer</Button></Link>} />
                <ul className="divide-y divide-border">
                  {analysis.mcp.map((m, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-[13px]">
                      <span className="font-medium">{m.name}</span>
                      <span className="flex-1 text-fg-muted">{m.why}</span>
                      <span className="text-xs text-fg-subtle">{m.agent}</span>
                      {m.sensitive ? <Badge tone="warning">sensible</Badge> : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            <div className="grid gap-5 md:grid-cols-2">
              <Card className="p-4">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><AlertTriangle className="size-3.5 text-warning" /> Risques</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
                  {analysis.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Card>
              <Card className="p-4">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><HelpCircle className="size-3.5 text-accent" /> Questions de l'orchestrateur</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-fg-muted">
                  {analysis.questions.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-fg-subtle">Répondez-y dans la conversation collective ou complétez le brief, puis relancez l'analyse.</p>
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
