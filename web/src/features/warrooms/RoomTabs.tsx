import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, MessagesSquare, Crown, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useModels } from "@/lib/queries";
import type { Activity, Agent, Project, Task, UsageEvent } from "@/lib/types";
import { cn, fmtPct, fmtRelative, fmtTokens, fmtUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, CardHeader, Dialog, EmptyState, Progress, Stat } from "@/components/ui/primitives";
import { AgentAvatar, AUTONOMY_HINT, AUTONOMY_LABEL, CostTag, STRATEGY_HINT, STRATEGY_LABEL, modelLabel } from "@/components/domain";
import { AgentEditor } from "./AgentEditor";
import { TASK_STATUSES, TASK_STATUS_LABEL, type RoomDetail } from "./shared";

// ------------------------------------------------------------------ Agents

export function AgentsTab({ detail }: { detail: RoomDetail }) {
  const { room, agents, agentSpentUsd } = detail;
  const qc = useQueryClient();
  const models = useModels();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [open, setOpen] = useState(false);
  const orch = agents.find((a) => a.role === "orchestrator");
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/agents/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warroom(room.id) });
      void qc.invalidateQueries({ queryKey: qk.agents });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-fg-muted">Chaque agent appelle réellement son modèle. Sans modèle propre, il utilise celui de l'orchestrateur.</p>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus /> Ajouter un agent
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Card key={a.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <AgentAvatar icon={a.icon} color={a.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13.5px] font-semibold">{a.name}</span>
                    {a.role === "orchestrator" ? <Crown className="size-3.5 text-amber-500" /> : null}
                  </div>
                  <div className="truncate text-xs text-fg-muted">{a.function || (a.role === "orchestrator" ? "Orchestrateur" : "—")}</div>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-xs text-fg-subtle">{a.description || "Pas de description."}</p>
              <div className="mt-3 flex flex-wrap gap-1">
                <Badge tone="outline">
                  {modelLabel(models.data ?? [], a.providerId ?? orch?.providerId ?? null, a.modelId ?? orch?.modelId ?? null)}
                  {a.providerId ? "" : " · hérité"}
                </Badge>
                {a.skills.length ? <Badge>{a.skills.length} skills</Badge> : null}
                {a.mcpServers.length ? <Badge>{a.mcpServers.length} MCP</Badge> : null}
                {a.budgetUsd !== null ? (
                  <Badge tone={(agentSpentUsd[a.id] ?? 0) >= a.budgetUsd ? "danger" : "neutral"}>
                    {fmtUsd(agentSpentUsd[a.id] ?? 0)} / {fmtUsd(a.budgetUsd)}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-auto flex gap-1.5 pt-4">
                <Link to={`/warrooms/${room.id}/agents/${a.id}`} className="flex-1">
                  <Button size="sm" className="w-full">
                    <MessagesSquare /> Discuter
                  </Button>
                </Link>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(a);
                    setOpen(true);
                  }}
                >
                  <Pencil /> Configurer
                </Button>
                {a.role !== "orchestrator" ? (
                  <Button size="icon-sm" variant="danger-ghost" onClick={() => confirm(`Supprimer ${a.name} et sa conversation individuelle ?`) && remove.mutate(a.id)} aria-label="Supprimer">
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </div>
      <AgentEditor warRoomId={room.id} agent={editing} open={open} onOpenChange={setOpen} />
    </div>
  );
}

// ------------------------------------------------------------------ Tasks

export function TasksTab({ detail }: { detail: RoomDetail }) {
  const { room, agents } = detail;
  const qc = useQueryClient();
  const tasks = useQuery({ queryKey: qk.tasks({ warRoomId: room.id }), queryFn: () => api.get<Task[]>(`/tasks?warRoomId=${room.id}`) });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Task | null>(null);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const invalidate = () => void qc.invalidateQueries({ queryKey: qk.tasks({ warRoomId: room.id }) });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<Task> }) => api.patch(`/tasks/${id}`, body), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.del(`/tasks/${id}`), onSuccess: invalidate });
  const move = (t: Task, dir: -1 | 1) => {
    const i = TASK_STATUSES.indexOf(t.status) + dir;
    if (i >= 0 && i < TASK_STATUSES.length) patch.mutate({ id: t.id, body: { status: TASK_STATUSES[i] } });
  };
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="px-6 py-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs text-fg-muted">Tâches créées par l'analyse, par l'orchestrateur lors des missions, ou manuellement.</p>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            <Plus /> Nouvelle tâche
          </Button>
        </div>
        <div className="grid min-w-[1000px] grid-cols-5 gap-3">
          {TASK_STATUSES.map((s) => {
            const col = (tasks.data ?? []).filter((t) => t.status === s);
            return (
              <div key={s} className="rounded-lg bg-surface/50 p-2">
                <div className="mb-2 flex items-center justify-between px-1.5 text-xs font-medium text-fg-muted">
                  {TASK_STATUS_LABEL[s]} <span className="tabular-nums text-fg-subtle">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((t) => {
                    const a = t.assigneeAgentId ? byId.get(t.assigneeAgentId) : undefined;
                    return (
                      <div key={t.id} className="group rounded-md border border-border bg-surface p-2.5">
                        <button className="text-left text-[13px] leading-snug hover:text-accent" onClick={() => setSelected(t)}>
                          {t.title}
                        </button>
                        <div className="mt-2 flex items-center gap-1.5">
                          {a ? <AgentAvatar icon={a.icon} color={a.color} size="sm" className="!size-5" /> : null}
                          <span className="truncate text-[11px] text-fg-subtle">{a?.name ?? "Non assignée"}</span>
                          <Badge tone={t.priority === 1 ? "danger" : t.priority === 2 ? "warning" : "neutral"} className="ml-auto">
                            P{t.priority}
                          </Badge>
                        </div>
                        <div className="mt-1.5 flex justify-between opacity-0 transition-opacity group-hover:opacity-100">
                          <button onClick={() => move(t, -1)} className="rounded p-0.5 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Reculer">
                            <ChevronLeft className="size-3.5" />
                          </button>
                          <button onClick={() => move(t, 1)} className="rounded p-0.5 text-fg-subtle hover:bg-surface-2 hover:text-fg" aria-label="Avancer">
                            <ChevronRight className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <TaskDialog
        open={creating || !!selected}
        task={selected}
        agents={agents}
        allTasks={tasks.data ?? []}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setSelected(null);
          }
        }}
        onSave={async (body) => {
          if (selected) await api.patch(`/tasks/${selected.id}`, body);
          else await api.post("/tasks", { ...body, warRoomId: room.id });
          invalidate();
        }}
        onDelete={selected ? () => remove.mutate(selected.id) : undefined}
      />
    </div>
  );
}

function TaskDialog({
  open,
  task,
  agents,
  allTasks,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  task: Task | null;
  agents: Agent[];
  allTasks: Task[];
  onOpenChange: (v: boolean) => void;
  onSave: (body: Partial<Task>) => Promise<void>;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Task["status"]>("todo");
  const [priority, setPriority] = useState(2);
  const [assignee, setAssignee] = useState("");
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setTitle(task?.title ?? "");
      setDescription(task?.description ?? "");
      setStatus(task?.status ?? "todo");
      setPriority(task?.priority ?? 2);
      setAssignee(task?.assigneeAgentId ?? "");
      setDependsOn(task?.dependsOn ?? []);
    }
  }, [open, task]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={task ? "Tâche" : "Nouvelle tâche"}
      size="lg"
      footer={
        <>
          {onDelete ? (
            <Button
              variant="danger-ghost"
              className="mr-auto"
              onClick={() => {
                if (confirm("Supprimer cette tâche ?")) {
                  onDelete();
                  onOpenChange(false);
                }
              }}
            >
              Supprimer
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            disabled={!title.trim()}
            onClick={() =>
              onSave({ title: title.trim(), description, status, priority, assigneeAgentId: assignee || null, dependsOn })
                .then(() => onOpenChange(false))
                .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
            }
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Titre">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Statut">
            <Select value={status} onChange={(e) => setStatus(e.target.value as Task["status"])}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TASK_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priorité">
            <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              <option value={1}>P1 — haute</option>
              <option value={2}>P2 — normale</option>
              <option value={3}>P3 — basse</option>
            </Select>
          </Field>
          <Field label="Assignée à">
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Personne</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Dépend de">
          <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-md border border-border p-1.5">
            {allTasks.filter((t) => t.id !== task?.id).map((t) => (
              <label key={t.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-2">
                <input type="checkbox" checked={dependsOn.includes(t.id)} onChange={(e) => setDependsOn((d) => (e.target.checked ? [...d, t.id] : d.filter((x) => x !== t.id)))} className="accent-[var(--accent)]" />
                <span className="truncate">{t.title}</span>
              </label>
            ))}
            {allTasks.length <= 1 ? <p className="px-1.5 py-1 text-xs text-fg-subtle">Aucune autre tâche.</p> : null}
          </div>
        </Field>
        {task?.result ? (
          <Field label="Résultat (extrait)">
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-2.5 text-xs text-fg-muted">{task.result}</div>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ Activity

const ACTIVITY_LABEL: Record<string, string> = {
  room_created: "Création",
  user_message: "Message",
  routing: "Routage",
  task_started: "Mission",
  task_done: "Terminé",
  task_failed: "Échec",
  analysis: "Analyse",
  team_applied: "Équipe",
  agent_added: "Agent",
  agent_removed: "Agent",
  plan_approved: "Validation",
  plan_rejected: "Refus",
  debate: "Débat",
};

export function ActivityTab({ detail }: { detail: RoomDetail }) {
  const { room, agents } = detail;
  const activity = useQuery({ queryKey: qk.activity(room.id), queryFn: () => api.get<Activity[]>(`/activity?warRoomId=${room.id}&limit=200`), refetchInterval: 8000 });
  const byId = new Map(agents.map((a) => [a.id, a]));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-5">
        {activity.data?.length ? (
          <ol className="relative space-y-3 border-l border-border pl-5">
            {activity.data.map((e) => {
              const a = e.agentId ? byId.get(e.agentId) : undefined;
              return (
                <li key={e.id} className="relative">
                  <span className={cn("absolute -left-[25px] top-1.5 size-2 rounded-full", e.type === "task_failed" ? "bg-danger" : e.type.startsWith("plan") ? "bg-warning" : "bg-accent")} />
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge>{ACTIVITY_LABEL[e.type] ?? e.type}</Badge>
                    {a ? <span className="font-medium">{a.name}</span> : null}
                    <span className="text-fg-subtle">{fmtRelative(e.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] text-fg-muted">{e.summary}</p>
                  {typeof e.data?.reasoning === "string" && e.data.reasoning ? <p className="mt-0.5 text-xs italic text-fg-subtle">{e.data.reasoning}</p> : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <EmptyState title="Aucune activité" description="Le journal enregistre les décisions de l'orchestrateur, les missions et les validations." />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Usage

interface ContextRow {
  conversationId: string | null;
  agentId: string | null;
  providerId: string;
  modelId: string;
  contextTokens: number | null;
  contextWindow: number | null;
  agentName: string | null;
  title: string | null;
  createdAt: number;
}
interface SummaryRow {
  agentId?: string | null;
  name?: string | null;
  calls: number;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  billedUsd: number;
  subscriptionEquivUsd: number;
  unknownCostCalls: number;
}

export function RoomUsageTab({ detail }: { detail: RoomDetail }) {
  const { room, spentUsd } = detail;
  const summary = useQuery({
    queryKey: qk.usage(90, room.id),
    queryFn: () => api.get<{ totals: SummaryRow; byAgent: SummaryRow[]; byPurpose: (SummaryRow & { purpose: string })[] }>(`/usage/summary?days=90&warRoomId=${room.id}`),
  });
  const contexts = useQuery({ queryKey: qk.contexts(room.id), queryFn: () => api.get<ContextRow[]>(`/usage/contexts?warRoomId=${room.id}`) });
  const events = useQuery({ queryKey: ["room-events", room.id], queryFn: () => api.get<UsageEvent[]>(`/usage/events?limit=500`) });
  const roomEvents = (events.data ?? []).filter((e) => e.warRoomId === room.id).slice(0, 30);
  const t = summary.data?.totals;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Appels (90 j)" value={t ? t.calls : "—"} />
          <Stat label="Tokens entrée / sortie" value={t ? `${fmtTokens(t.inputTokens, { compact: true })} / ${fmtTokens(t.outputTokens, { compact: true })}` : "—"} hint={t?.cacheReadTokens ? `${fmtTokens(t.cacheReadTokens, { compact: true })} lus en cache` : undefined} />
          <Stat
            label="Dépense API facturée"
            value={fmtUsd(spentUsd)}
            hint={room.budgetUsd !== null ? `Budget ${fmtUsd(room.budgetUsd)} (${fmtPct(spentUsd / (room.budgetUsd || 1))})` : "Pas de budget"}
          />
          <Stat label="Équivalent abonnement" value={t ? fmtUsd(t.subscriptionEquivUsd) : "—"} hint="Non dépensé : inclus dans l'abonnement" />
        </div>
        {room.budgetUsd ? <Progress value={spentUsd / room.budgetUsd} tone={spentUsd / room.budgetUsd >= 0.8 ? "danger" : spentUsd / room.budgetUsd >= 0.5 ? "warning" : "accent"} /> : null}

        <Card>
          <CardHeader title="Contexte par agent et conversation" description="Taille exacte du dernier prompt envoyé (rapportée par le fournisseur) rapportée à la fenêtre de contexte connue du modèle." />
          <div className="divide-y divide-border">
            {(contexts.data ?? []).length ? (
              contexts.data!.map((c, i) => {
                const ratio = c.contextTokens !== null && c.contextWindow ? c.contextTokens / c.contextWindow : null;
                return (
                  <div key={i} className="flex items-center gap-4 px-4 py-2.5 text-[13px]">
                    <div className="w-48 min-w-0">
                      <div className="truncate font-medium">{c.agentName ?? "—"}</div>
                      <div className="truncate text-[11px] text-fg-subtle">{c.title}</div>
                    </div>
                    <div className="w-40 truncate text-xs text-fg-muted">{c.modelId}</div>
                    <div className="flex-1">
                      <Progress value={ratio} tone={ratio !== null && ratio > 0.8 ? "danger" : ratio !== null && ratio > 0.5 ? "warning" : "accent"} />
                    </div>
                    <div className="w-44 text-right text-xs tabular-nums text-fg-muted">
                      {fmtTokens(c.contextTokens, { compact: true })} / {c.contextWindow ? fmtTokens(c.contextWindow, { compact: true }) : "inconnu"} · {fmtPct(ratio)}
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucun appel pour l'instant.</p>
            )}
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Par agent" />
            <table className="w-full text-[12.5px]">
              <tbody>
                {(summary.data?.byAgent ?? []).map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">{r.name ?? "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{r.calls} appels</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmtTokens(r.inputTokens, { compact: true })} ↑ {fmtTokens(r.outputTokens, { compact: true })} ↓</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.billedUsd ? fmtUsd(r.billedUsd) : r.subscriptionEquivUsd ? "abonnement" : r.unknownCostCalls ? "inconnu" : "$0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            <CardHeader title="Par usage" description="Routage et synthèse = coût de coordination de l'orchestrateur." />
            <table className="w-full text-[12.5px]">
              <tbody>
                {(summary.data?.byPurpose ?? []).map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2">{r.purpose}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{r.calls} appels</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtTokens(r.inputTokens, { compact: true })} ↑ {fmtTokens(r.outputTokens, { compact: true })} ↓</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <Card>
          <CardHeader title="Derniers appels" />
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-fg-subtle">
                  <th className="px-4 py-2 font-medium">Quand</th>
                  <th className="px-2 py-2 font-medium">Usage</th>
                  <th className="px-2 py-2 font-medium">Modèle</th>
                  <th className="px-2 py-2 text-right font-medium">Entrée</th>
                  <th className="px-2 py-2 text-right font-medium">Sortie</th>
                  <th className="px-2 py-2 text-right font-medium">Cache</th>
                  <th className="px-4 py-2 font-medium">Coût</th>
                </tr>
              </thead>
              <tbody>
                {roomEvents.map((e) => (
                  <tr key={e.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-1.5 text-fg-subtle">{fmtRelative(e.createdAt)}</td>
                    <td className="px-2 py-1.5">{e.purpose}{e.status !== "ok" ? <Badge tone="danger" className="ml-1">{e.status}</Badge> : null}</td>
                    <td className="px-2 py-1.5 text-fg-muted">{e.modelId}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtTokens(e.inputTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtTokens(e.outputTokens)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-fg-muted">{fmtTokens(e.cacheReadTokens)}</td>
                    <td className="px-4 py-1.5">
                      <CostTag costUsd={e.costUsd} costKind={e.costKind} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Settings

export function RoomSettingsTab({ detail }: { detail: RoomDetail }) {
  const { room } = detail;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const projects = useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>("/projects") });
  const [form, setForm] = useState(() => ({ ...room, budget: room.budgetUsd?.toString() ?? "" }));
  useEffect(() => setForm({ ...room, budget: room.budgetUsd?.toString() ?? "" }), [room]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/warrooms/${room.id}`, {
        name: form.name,
        description: form.description,
        objective: form.objective,
        brief: form.brief,
        projectId: form.projectId || null,
        autonomy: form.autonomy,
        costStrategy: form.costStrategy,
        budgetUsd: form.budget ? Number(form.budget) : null,
        maxAgentsPerTurn: Number(form.maxAgentsPerTurn) || 3,
        communication: form.communication,
        sharedMemory: form.sharedMemory,
        status: form.status,
      }),
    onSuccess: () => {
      toast.success("Paramètres enregistrés");
      void qc.invalidateQueries({ queryKey: qk.warroom(room.id) });
      void qc.invalidateQueries({ queryKey: qk.warrooms });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/warrooms/${room.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warrooms });
      navigate("/warrooms");
    },
  });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-5">
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Projet">
              <Select value={form.projectId ?? ""} onChange={(e) => set("projectId", e.target.value || null)}>
                <option value="">Aucun</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field label="Objectif">
            <Input value={form.objective} onChange={(e) => set("objective", e.target.value)} />
          </Field>
          <Field label="Brief">
            <Textarea value={form.brief} onChange={(e) => set("brief", e.target.value)} rows={6} />
          </Field>
          <Field label="Mémoire commune" hint="Décisions, contraintes et faits partagés : injectés dans le contexte de tous les agents autorisés.">
            <Textarea value={form.sharedMemory} onChange={(e) => set("sharedMemory", e.target.value)} rows={5} placeholder="- Stack retenue : Next.js + PostgreSQL&#10;- Budget serveur : 50 €/mois" />
          </Field>
          <Field label="Préférences de communication">
            <Input value={form.communication} onChange={(e) => set("communication", e.target.value)} />
          </Field>
        </Card>
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Autonomie" hint={AUTONOMY_HINT[form.autonomy]}>
              <Select value={form.autonomy} onChange={(e) => set("autonomy", e.target.value as typeof form.autonomy)}>
                {Object.entries(AUTONOMY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Stratégie de coût" hint={STRATEGY_HINT[form.costStrategy]}>
              <Select value={form.costStrategy} onChange={(e) => set("costStrategy", e.target.value as typeof form.costStrategy)}>
                {Object.entries(STRATEGY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Budget API ($)" hint="Les appels sont bloqués une fois le budget atteint.">
              <Input type="number" min={0} step={0.5} value={form.budget} onChange={(e) => set("budget", e.target.value)} placeholder="Illimité" />
            </Field>
            <Field label="Agents max par message">
              <Input type="number" min={1} max={10} value={form.maxAgentsPerTurn} onChange={(e) => set("maxAgentsPerTurn", Number(e.target.value))} />
            </Field>
            <Field label="Statut">
              <Select value={form.status} onChange={(e) => set("status", e.target.value as typeof form.status)}>
                <option value="active">Active</option>
                <option value="paused">En pause</option>
                <option value="archived">Archivée</option>
              </Select>
            </Field>
          </div>
        </Card>
        <div className="flex justify-between">
          <Button variant="danger-ghost" onClick={() => confirm(`Supprimer définitivement « ${room.name} », ses agents, conversations et tâches ? L'historique de consommation est conservé.`) && remove.mutate()}>
            <Trash2 /> Supprimer la War Room
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending}>
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
