import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Network, Activity as ActivityIcon, ArrowRight, MessagesSquare, GitBranch, Crown } from "lucide-react";
import type { MessageDTO } from "@shared/types";
import { api } from "@/lib/api";
import { qk, useModels } from "@/lib/queries";
import type { Agent, Conversation, Task } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState } from "@/components/ui/primitives";
import { AgentAvatar, modelLabel } from "@/components/domain";
import { TASK_STATUS_LABEL, type RoomDetail } from "./shared";
import { t } from "@/i18n";

function AgentNode({ agent, tasks, modelName, active, onClick, highlight }: { agent: Agent; tasks: Task[]; modelName: string; active: boolean; onClick: () => void; highlight?: boolean }) {
  const open = tasks.filter((t) => t.status !== "done");
  const running = tasks.filter((t) => t.status === "in_progress");
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-56 rounded-lg border bg-surface p-3 text-left transition-colors",
        active ? "border-accent/70 ring-1 ring-accent/30" : "border-border hover:border-border-strong",
        highlight && "border-amber-500/40",
      )}
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar icon={agent.icon} color={agent.color} />
        <div className="min-w-0">
          <div className="flex items-center gap-1 truncate text-[13px] font-medium">
            {agent.name}
            {agent.role === "orchestrator" ? <Crown className="size-3 text-amber-500" /> : null}
          </div>
          <div className="truncate text-[11px] text-fg-subtle">{agent.function || (agent.role === "orchestrator" ? t("Orchestrateur") : "Agent")}</div>
        </div>
      </div>
      <div className="mt-2.5 truncate text-[11px] text-fg-muted">{modelName}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {running.length ? <Badge tone="accent">{t("{count} en cours", { count: running.length })}</Badge> : null}
        {open.length ? <Badge>{t("{count} ouvertes", { count: open.length })}</Badge> : <Badge tone="outline">{t("aucune tâche")}</Badge>}
        {agent.skills.length ? <Badge tone="outline">{agent.skills.length} skills</Badge> : null}
      </div>
    </button>
  );
}

export function OrgTab({ detail }: { detail: RoomDetail }) {
  const { room, agents, collectiveConversationId } = detail;
  const models = useModels();
  const [view, setView] = useState<"org" | "live">("org");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tasks = useQuery({ queryKey: qk.tasks({ warRoomId: room.id }), queryFn: () => api.get<Task[]>(`/tasks?warRoomId=${room.id}`), refetchInterval: view === "live" ? 4000 : false });
  const conv = useQuery({
    queryKey: qk.conversation(collectiveConversationId ?? ""),
    queryFn: () => api.get<{ conversation: Conversation; messages: MessageDTO[] }>(`/conversations/${collectiveConversationId}`),
    enabled: !!collectiveConversationId,
    refetchInterval: view === "live" ? 4000 : false,
  });

  const orch = agents.find((a) => a.role === "orchestrator")!;
  const team = agents.filter((a) => a.role === "agent");
  const allTasks = tasks.data ?? [];
  const tasksOf = (id: string) => allTasks.filter((t) => t.assigneeAgentId === id);
  const mName = (a: Agent) => modelLabel(models.data ?? [], a.providerId ?? orch.providerId, a.modelId ?? orch.modelId) + (a.providerId ? "" : t(" (hérité)"));
  const selected = agents.find((a) => a.id === selectedId) ?? null;

  const exchanges = useMemo(() => {
    const msgs = conv.data?.messages ?? [];
    return msgs
      .filter((m) => m.role === "assistant" && m.agentId && (m.meta.instruction || m.meta.kind === "synthesis" || m.meta.kind === "debate_round"))
      .slice(-30)
      .reverse();
  }, [conv.data]);

  const deps = allTasks.filter((t) => t.dependsOn.length);
  const taskById = new Map(allTasks.map((t) => [t.id, t]));
  const byId = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex rounded-md border border-border p-0.5">
            <button onClick={() => setView("org")} className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-xs", view === "org" ? "bg-surface-3 text-fg" : "text-fg-muted")}>
              <Network className="size-3.5" /> {t("Vue organisationnelle")}
            </button>
            <button onClick={() => setView("live")} className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-xs", view === "live" ? "bg-surface-3 text-fg" : "text-fg-muted")}>
              <ActivityIcon className="size-3.5" /> {t("Activité en temps réel")}
            </button>
          </div>
          {view === "live" ? <span className="text-[11px] text-fg-subtle">{t("Actualisation toutes les 4 s")}</span> : null}
        </div>

        {view === "org" ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="flex flex-col items-center">
              <AgentNode agent={orch} tasks={tasksOf(orch.id)} modelName={mName(orch)} active={selectedId === orch.id} onClick={() => setSelectedId(orch.id)} highlight />
              {team.length ? (
                <>
                  <div className="h-6 w-px bg-border-strong" />
                  <div className="relative w-full">
                    <div className="absolute left-[10%] right-[10%] top-0 h-px bg-border-strong" />
                  </div>
                  <div className="flex w-full flex-wrap justify-center gap-4 pt-6">
                    {team.map((a) => (
                      <div key={a.id} className="relative">
                        <div className="absolute -top-6 left-1/2 h-6 w-px bg-border-strong" />
                        <AgentNode agent={a} tasks={tasksOf(a.id)} modelName={mName(a)} active={selectedId === a.id} onClick={() => setSelectedId(a.id)} />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState className="mt-8 w-full" title={t("Pas encore d'agents")} description={t("Lancez l'analyse du brief pour obtenir une proposition d'équipe, ou ajoutez des agents dans l'onglet Agents.")} />
              )}
            </div>
            <Card className="h-fit p-4">
              {selected ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <AgentAvatar icon={selected.icon} color={selected.color} />
                    <div>
                      <div className="text-[13px] font-semibold">{selected.name}</div>
                      <div className="text-[11px] text-fg-subtle">{mName(selected)}</div>
                    </div>
                  </div>
                  <p className="text-xs text-fg-muted">{selected.description || selected.function || t("Pas de description.")}</p>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-subtle">{t("Tâches")}</div>
                    {tasksOf(selected.id).length ? (
                      <ul className="space-y-1">
                        {tasksOf(selected.id).slice(0, 8).map((task) => (
                          <li key={task.id} className="flex items-start justify-between gap-2 text-xs">
                            <span className="line-clamp-2">{task.title}</span>
                            <Badge tone={task.status === "done" ? "success" : task.status === "in_progress" ? "accent" : task.status === "blocked" ? "danger" : "neutral"}>{t(TASK_STATUS_LABEL[task.status])}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-fg-subtle">{t("Aucune tâche assignée.")}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selected.skills.map((s) => (
                      <Badge key={s} tone="outline">{s}</Badge>
                    ))}
                  </div>
                  <Link to={`/warrooms/${room.id}/agents/${selected.id}`}>
                    <Button size="sm" className="w-full">
                      <MessagesSquare /> {t("Discuter avec {name}", { name: selected.name })}
                    </Button>
                  </Link>
                </div>
              ) : (
                <p className="text-xs text-fg-subtle">{t("Sélectionnez un membre de l'équipe pour voir son rôle, son modèle et ses tâches.")}</p>
              )}
            </Card>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="mb-3 text-[13px] font-semibold">{t("Statut des agents")}</h3>
              <div className="space-y-2">
                {agents.map((a) => {
                  const running = tasksOf(a.id).filter((t) => t.status === "in_progress");
                  const last = (conv.data?.messages ?? []).filter((m) => m.agentId === a.id).at(-1);
                  return (
                    <div key={a.id} className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2">
                      <AgentAvatar icon={a.icon} color={a.color} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-medium">{a.name}</span>
                          <span className="text-[11px] text-fg-subtle">{last ? t("actif {time}", { time: fmtRelative(last.createdAt) }) : t("jamais sollicité")}</span>
                        </div>
                        {running.length ? (
                          running.map((t) => (
                            <div key={t.id} className="mt-0.5 flex items-center gap-1.5 text-xs text-accent">
                              <span className="size-1.5 animate-pulse-dot rounded-full bg-accent" /> <span className="truncate">{t.title}</span>
                            </div>
                          ))
                        ) : (
                          <div className="mt-0.5 text-xs text-fg-subtle">{last?.status === "streaming" ? t("rédige une réponse…") : t("en attente")}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <div className="space-y-5">
              <Card className="p-4">
                <h3 className="mb-3 text-[13px] font-semibold">{t("Échanges récents")}</h3>
                {exchanges.length ? (
                  <ul className="space-y-2">
                    {exchanges.map((m) => {
                      const a = byId.get(m.agentId!);
                      return (
                        <li key={m.id} className="text-xs">
                          <div className="flex items-center gap-1.5 text-fg-muted">
                            {m.meta.instruction ? (
                              <>
                                <span className="font-medium text-fg">{orch.name}</span> <ArrowRight className="size-3" /> <span className="font-medium text-fg">{a?.name}</span>
                              </>
                            ) : (
                              <span className="font-medium text-fg">{a?.name}</span>
                            )}
                            <Badge tone="neutral">{m.meta.kind === "synthesis" ? t("synthèse") : m.meta.kind === "debate_round" ? t("débat tour {round}", { round: m.meta.round }) : t("mission")}</Badge>
                            <span className="ml-auto text-fg-subtle">{fmtRelative(m.createdAt)}</span>
                          </div>
                          {m.meta.instruction ? <p className="mt-0.5 line-clamp-2 text-fg-muted">{m.meta.instruction}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-fg-subtle">{t("Aucun échange entre agents pour l'instant.")}</p>
                )}
              </Card>
              <Card className="p-4">
                <h3 className="mb-3 flex items-center gap-1.5 text-[13px] font-semibold">
                  <GitBranch className="size-3.5" /> {t("Dépendances entre tâches")}
                </h3>
                {deps.length ? (
                  <ul className="space-y-1.5 text-xs">
                    {deps.map((task) => (
                      <li key={task.id} className="flex flex-wrap items-center gap-1.5">
                        {task.dependsOn.map((d) => (
                          <Badge key={d} tone={taskById.get(d)?.status === "done" ? "success" : "neutral"}>
                            {taskById.get(d)?.title.slice(0, 40) ?? t("tâche supprimée")}
                          </Badge>
                        ))}
                        <ArrowRight className="size-3 text-fg-subtle" />
                        <span>{task.title}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-fg-subtle">{t("Aucune dépendance déclarée.")}</p>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
