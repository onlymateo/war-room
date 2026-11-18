import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Calendar, CheckCircle2, Columns3, FolderKanban, LayoutList, Link2, MoreHorizontal, Pencil, Plus, Swords, Trash2, Unlink,
  ListTree, ChevronUp, ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useAgents, useWarRooms } from "@/lib/queries";
import type { Activity, Agent, Memory, Project, Task, TaskStatus, WarRoom } from "@/lib/types";
import { cn, fmtDateTime, fmtRelative, fmtUsd } from "@/lib/utils";
import { locale, t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  Badge, Card, CardHeader, Dialog, EmptyState, Menu, Page, PageHeader, Progress, Section, Skeleton, Stat, Tabs,
} from "@/components/ui/primitives";
import { AgentAvatar } from "@/components/domain";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "./ProjectsPage";

interface ProjectDetail {
  project: Project;
  rooms: WarRoom[];
  decisions: Memory[];
  activity: Activity[];
  spentUsd: number;
}

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done", "blocked"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  review: "En revue",
  done: "Terminé",
  blocked: "Bloqué",
};
export const TASK_STATUS_TONE: Record<TaskStatus, "neutral" | "accent" | "warning" | "success" | "danger"> = {
  todo: "neutral",
  in_progress: "accent",
  review: "warning",
  done: "success",
  blocked: "danger",
};
const PRIORITY_LABEL: Record<number, string> = { 1: "Haute", 2: "Moyenne", 3: "Basse" };

type View = "summary" | "kanban" | "list" | "timeline";

export default function ProjectPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("summary");
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detail = useQuery({ queryKey: qk.project(id), queryFn: () => api.get<ProjectDetail>(`/projects/${id}`), enabled: !!id });
  const tasks = useQuery({ queryKey: qk.tasks({ projectId: id }), queryFn: () => api.get<Task[]>(`/tasks?projectId=${encodeURIComponent(id)}`), enabled: !!id });
  const agents = useAgents();

  const roomIds = useMemo(() => new Set((detail.data?.rooms ?? []).map((r) => r.id)), [detail.data]);
  const projectAgents = useMemo(() => (agents.data ?? []).filter((a) => a.warRoomId && roomIds.has(a.warRoomId)), [agents.data, roomIds]);
  const agentById = useMemo(() => new Map((agents.data ?? []).map((a) => [a.id, a])), [agents.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.project(id) });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: qk.projects });
  };

  const updateTask = useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => api.patch<Task>(`/tasks/${taskId}`, patch),
    onSuccess: invalidate,
    onError: (err) => toast.error((err as Error).message),
  });
  const deleteTask = useMutation({
    mutationFn: (taskId: string) => api.del(`/tasks/${taskId}`),
    onSuccess: () => {
      toast.success(t("Tâche supprimée"));
      invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const deleteProject = useMutation({
    mutationFn: () => api.del(`/projects/${id}`),
    onSuccess: () => {
      toast.success(t("Projet supprimé"));
      void qc.invalidateQueries({ queryKey: qk.projects });
      void qc.invalidateQueries({ queryKey: qk.warrooms });
      navigate("/projects");
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const unlinkRoom = useMutation({
    mutationFn: (roomId: string) => api.patch(`/warrooms/${roomId}`, { projectId: null }),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: qk.warrooms });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  if (detail.isLoading) {
    return (
      <Page>
        <Skeleton className="h-7 w-60" />
        <Skeleton className="mt-6 h-48 w-full" />
      </Page>
    );
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <EmptyState title={t("Projet introuvable")} description={(detail.error as Error | null)?.message} action={<Link to="/projects"><Button>{t("Retour aux projets")}</Button></Link>} />
      </Page>
    );
  }

  const { project, rooms, decisions, activity, spentUsd } = detail.data;
  const taskList = tasks.data ?? [];
  const done = taskList.filter((t) => t.status === "done").length;
  const inProgress = taskList.filter((t) => t.status === "in_progress").length;
  const blocked = taskList.filter((t) => t.status === "blocked").length;
  const roomName = (rid: string | null) => rooms.find((r) => r.id === rid)?.name ?? null;

  const taskActions = {
    onStatus: (t: Task, status: TaskStatus) => updateTask.mutate({ taskId: t.id, patch: { status } }),
    onDelete: (t: Task) => deleteTask.mutate(t.id),
  };

  return (
    <Page wide>
      <Link to="/projects" className="mb-3 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg">
        <ArrowLeft className="size-3.5" /> Projects
      </Link>
      <PageHeader
        icon={<FolderKanban />}
        title={
          <span className="flex items-center gap-2">
            {project.name}
            <Badge tone={PROJECT_STATUS_TONE[project.status]}>{t(PROJECT_STATUS_LABEL[project.status])}</Badge>
          </span>
        }
        description={project.description || t("Pas de description.")}
        actions={
          <>
            <Button variant="primary" onClick={() => setTaskOpen(true)}>
              <Plus /> {t("Tâche")}
            </Button>
            <Button onClick={() => setEditOpen(true)}>
              <Pencil /> {t("Modifier")}
            </Button>
            <Menu
              trigger={
                <Button variant="ghost" size="icon" aria-label={t("Plus d'actions")}>
                  <MoreHorizontal />
                </Button>
              }
              items={[
                { label: t("Rattacher une War Room"), icon: <Link2 />, onSelect: () => setLinkOpen(true) },
                { label: t("Nouvelle War Room"), icon: <Swords />, onSelect: () => navigate("/warrooms/new") },
                "separator",
                { label: t("Supprimer le projet"), icon: <Trash2 />, danger: true, onSelect: () => setDeleteOpen(true) },
              ]}
            />
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("Tâches")} value={taskList.length} hint={done > 1 ? t("{count} terminées", { count: done }) : t("{count} terminée", { count: done })} />
        <Stat label={t("En cours")} value={inProgress} />
        <Stat label={t("Bloquées")} value={blocked} />
        <Stat label="War Rooms" value={rooms.length} />
        <Stat
          label={t("Coût API facturé")}
          value={fmtUsd(spentUsd)}
          hint={project.budgetUsd != null ? t("Budget {amount}", { amount: fmtUsd(project.budgetUsd) }) : t("Pas de budget défini")}
        />
      </div>

      <Tabs
        value={view}
        onValueChange={(v) => setView(v as View)}
        className="mb-5"
        items={[
          { value: "summary", label: t("Synthèse##project"), icon: <ListTree /> },
          { value: "kanban", label: "Kanban", icon: <Columns3 />, count: taskList.length },
          { value: "list", label: t("Liste"), icon: <LayoutList /> },
          { value: "timeline", label: "Timeline", icon: <Calendar /> },
        ]}
      />

      {view === "summary" ? (
        <SummaryView
          project={project}
          rooms={rooms}
          decisions={decisions}
          activity={activity}
          taskTotal={taskList.length}
          taskDone={done}
          spentUsd={spentUsd}
          onLink={() => setLinkOpen(true)}
          onUnlink={(rid) => unlinkRoom.mutate(rid)}
          onInvalidate={invalidate}
          agentById={agentById}
        />
      ) : tasks.isLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : !taskList.length ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={t("Aucune tâche")}
          description={t("Créez des tâches ici, ou laissez l'orchestrateur d'une War Room rattachée les générer à partir du brief.")}
          action={
            <Button variant="primary" onClick={() => setTaskOpen(true)}>
              <Plus /> {t("Nouvelle tâche")}
            </Button>
          }
        />
      ) : view === "kanban" ? (
        <KanbanView tasks={taskList} agentById={agentById} roomName={roomName} {...taskActions} />
      ) : view === "list" ? (
        <ListView tasks={taskList} agentById={agentById} roomName={roomName} {...taskActions} />
      ) : (
        <TimelineView tasks={taskList} agentById={agentById} roomName={roomName} />
      )}

      <EditProjectDialog open={editOpen} onOpenChange={setEditOpen} project={project} onSaved={invalidate} />
      <CreateTaskDialog open={taskOpen} onOpenChange={setTaskOpen} projectId={id} rooms={rooms} agents={projectAgents} onCreated={invalidate} />
      <LinkRoomDialog open={linkOpen} onOpenChange={setLinkOpen} projectId={id} onLinked={invalidate} />
      <Dialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        size="sm"
        title={t("Supprimer le projet ?")}
        description={t("Les War Rooms et tâches sont conservées mais détachées du projet. L'historique d'usage est conservé.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {t("Annuler")}
            </Button>
            <Button variant="danger" loading={deleteProject.isPending} onClick={() => deleteProject.mutate()}>
              {t("Supprimer")}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-muted">
          {t("Le projet")} <span className="font-medium text-fg">{project.name}</span> {t("sera supprimé définitivement.")}
        </p>
      </Dialog>
    </Page>
  );
}

// ---------------------------------------------------------------- Summary

function SummaryView({
  project, rooms, decisions, activity, taskTotal, taskDone, spentUsd, onLink, onUnlink, onInvalidate, agentById,
}: {
  project: Project;
  rooms: WarRoom[];
  decisions: Memory[];
  activity: Activity[];
  taskTotal: number;
  taskDone: number;
  spentUsd: number;
  onLink: () => void;
  onUnlink: (roomId: string) => void;
  onInvalidate: () => void;
  agentById: Map<string, Agent>;
}) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState("");
  const addDecision = useMutation({
    mutationFn: () => api.post<Memory>("/memories", { scope: "project", scopeId: project.id, kind: "decision", content: decision.trim() }),
    onSuccess: () => {
      setDecision("");
      onInvalidate();
      void qc.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const removeDecision = useMutation({
    mutationFn: (memId: string) => api.del(`/memories/${memId}`),
    onSuccess: () => {
      onInvalidate();
      void qc.invalidateQueries({ queryKey: ["memories"] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const ratio = taskTotal ? taskDone / taskTotal : 0;
  const budgetRatio = project.budgetUsd ? spentUsd / project.budgetUsd : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title={t("Objectifs")} />
          <div className="px-4 py-3">
            {project.objectives.trim() ? (
              <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{project.objectives}</div>
            ) : (
              <p className="text-xs text-fg-subtle">{t("Aucun objectif défini. Utilisez « Modifier » pour en ajouter.")}</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("Indicateurs")} />
          <div className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-fg-muted">
                <span>{t("Tâches terminées")}</span>
                <span className="tabular-nums">
                  {taskDone}/{taskTotal}
                </span>
              </div>
              <Progress value={ratio} tone={ratio >= 1 && taskTotal ? "success" : "accent"} />
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-fg-muted">
                <span>{t("Budget API")}</span>
                <span className="tabular-nums">
                  {fmtUsd(spentUsd)}
                  {project.budgetUsd != null ? ` / ${fmtUsd(project.budgetUsd)}` : ` ${t("(aucune limite)")}`}
                </span>
              </div>
              {budgetRatio !== null ? <Progress value={budgetRatio} tone={budgetRatio >= 1 ? "danger" : budgetRatio >= 0.8 ? "warning" : "accent"} /> : null}
              <p className="text-[11px] text-fg-subtle">{t("Seuls les coûts réellement facturés par API sont comptés (pas les abonnements).")}</p>
            </div>
          </div>
        </Card>

        <Section
          title="War Rooms"
          description={t("Environnements de travail rattachés à ce projet.")}
          actions={
            <Button size="sm" onClick={onLink}>
              <Link2 /> {t("Rattacher")}
            </Button>
          }
        >
          {rooms.length ? (
            <div className="grid gap-2 md:grid-cols-2">
              {rooms.map((r) => (
                <Card key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Swords className="size-4 shrink-0 text-fg-subtle" />
                  <Link to={`/warrooms/${r.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium hover:underline">{r.name}</div>
                    <div className="truncate text-[11px] text-fg-subtle">{r.objective || r.description || "—"}</div>
                  </Link>
                  <Button variant="ghost" size="icon-sm" title={t("Détacher du projet")} aria-label={t("Détacher")} onClick={() => onUnlink(r.id)}>
                    <Unlink />
                  </Button>
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState title={t("Aucune War Room rattachée")} description={t("Rattachez une War Room existante ou créez-en une nouvelle.")} />
          )}
        </Section>

        <Section title={t("Décisions")} description={t("Décisions importantes du projet (mémoire de projet).")}>
          <Card>
            <div className="divide-y divide-border">
              {decisions.length ? (
                decisions.map((d) => (
                  <div key={d.id} className="group flex items-start gap-3 px-4 py-2.5">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                    <div className="min-w-0 flex-1">
                      <div className="whitespace-pre-wrap text-[13px]">{d.content}</div>
                      <div className="text-[11px] text-fg-subtle">
                        {fmtDateTime(d.createdAt)} · {d.source}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100"
                      aria-label={t("Supprimer la décision")}
                      onClick={() => removeDecision.mutate(d.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))
              ) : (
                <p className="px-4 py-3 text-xs text-fg-subtle">{t("Aucune décision enregistrée.")}</p>
              )}
            </div>
            <div className="flex gap-2 border-t border-border p-3">
              <Input
                value={decision}
                onChange={(e) => setDecision(e.target.value)}
                placeholder={t("Nouvelle décision…")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && decision.trim()) addDecision.mutate();
                }}
              />
              <Button onClick={() => addDecision.mutate()} disabled={!decision.trim()} loading={addDecision.isPending}>
                {t("Ajouter")}
              </Button>
            </div>
          </Card>
        </Section>
      </div>

      <Card className="h-fit">
        <CardHeader title={t("Activité récente")} />
        {activity.length ? (
          <ol className="max-h-[640px] divide-y divide-border overflow-y-auto">
            {activity.map((a) => {
              const agent = a.agentId ? agentById.get(a.agentId) : null;
              return (
                <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
                  {agent ? <AgentAvatar icon={agent.icon} color={agent.color} size="sm" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-fg-subtle" />}
                  <div className="min-w-0">
                    <div className="text-[13px]">{a.summary}</div>
                    <div className="text-[11px] text-fg-subtle">{fmtRelative(a.createdAt)}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="px-4 py-3 text-xs text-fg-subtle">{t("Aucune activité pour l'instant.")}</p>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Task views

interface TaskViewProps {
  tasks: Task[];
  agentById: Map<string, Agent>;
  roomName: (id: string | null) => string | null;
}

function Assignee({ agent }: { agent: Agent | undefined | null }) {
  if (!agent) return <span className="text-[11px] text-fg-subtle">{t("Non assignée")}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-fg-muted">
      <AgentAvatar icon={agent.icon} color={agent.color} size="sm" className="!size-5" />
      <span className="truncate">{agent.name}</span>
    </span>
  );
}

function TaskMenu({ task, onStatus, onDelete }: { task: Task; onStatus: (t: Task, s: TaskStatus) => void; onDelete: (t: Task) => void }) {
  return (
    <Menu
      trigger={
        <button className="rounded p-0.5 text-fg-subtle hover:bg-surface-3 hover:text-fg" aria-label={t("Actions de la tâche")}>
          <MoreHorizontal className="size-3.5" />
        </button>
      }
      items={[
        ...TASK_STATUSES.filter((s) => s !== task.status).map((s) => ({ label: `→ ${t(TASK_STATUS_LABEL[s])}`, onSelect: () => onStatus(task, s) })),
        "separator" as const,
        { label: t("Supprimer"), icon: <Trash2 />, danger: true, onSelect: () => onDelete(task) },
      ]}
    />
  );
}

function KanbanView({ tasks, agentById, roomName, onStatus, onDelete }: TaskViewProps & { onStatus: (t: Task, s: TaskStatus) => void; onDelete: (t: Task) => void }) {
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(5,minmax(220px,1fr))]">
      {TASK_STATUSES.map((status) => {
        const col = tasks.filter((t) => t.status === status).sort((a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt);
        return (
          <div key={status} className="flex min-h-40 flex-col rounded-lg border border-border bg-surface/60">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <Badge tone={TASK_STATUS_TONE[status]}>{t(TASK_STATUS_LABEL[status])}</Badge>
              <span className="text-[11px] tabular-nums text-fg-subtle">{col.length}</span>
            </div>
            <div className="flex-1 space-y-2 p-2">
              {col.map((task) => {
                const idx = TASK_STATUSES.indexOf(task.status);
                return (
                  <Card key={task.id} className="space-y-2 bg-surface-2 p-2.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1 text-[13px] font-medium leading-snug">{task.title}</div>
                      <TaskMenu task={task} onStatus={onStatus} onDelete={onDelete} />
                    </div>
                    {task.description && task.description !== task.title ? <p className="line-clamp-3 text-xs text-fg-muted">{task.description}</p> : null}
                    <div className="flex items-center justify-between gap-2">
                      <Assignee agent={task.assigneeAgentId ? agentById.get(task.assigneeAgentId) : null} />
                      <Badge tone="outline">{PRIORITY_LABEL[task.priority] ? t(PRIORITY_LABEL[task.priority]) : `P${task.priority}`}</Badge>
                    </div>
                    {roomName(task.warRoomId) ? <div className="truncate text-[11px] text-fg-subtle">{roomName(task.warRoomId)}</div> : null}
                    <div className="flex justify-between">
                      <button
                        disabled={idx <= 0}
                        onClick={() => onStatus(task, TASK_STATUSES[idx - 1])}
                        className="rounded px-1 text-[11px] text-fg-subtle hover:text-fg disabled:opacity-0"
                      >
                        ← {idx > 0 ? t(TASK_STATUS_LABEL[TASK_STATUSES[idx - 1]]) : ""}
                      </button>
                      <button
                        disabled={idx >= TASK_STATUSES.length - 1}
                        onClick={() => onStatus(task, TASK_STATUSES[idx + 1])}
                        className="rounded px-1 text-[11px] text-fg-subtle hover:text-fg disabled:opacity-0"
                      >
                        {idx < TASK_STATUSES.length - 1 ? t(TASK_STATUS_LABEL[TASK_STATUSES[idx + 1]]) : ""} →
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type SortKey = "title" | "status" | "priority" | "assignee" | "updatedAt";

function ListView({ tasks, agentById, roomName, onStatus, onDelete }: TaskViewProps & { onStatus: (t: Task, s: TaskStatus) => void; onDelete: (t: Task) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "priority", dir: 1 });
  const sorted = useMemo(() => {
    const val = (t: Task): string | number => {
      switch (sort.key) {
        case "title":
          return t.title.toLowerCase();
        case "status":
          return TASK_STATUSES.indexOf(t.status);
        case "priority":
          return t.priority;
        case "assignee":
          return (t.assigneeAgentId ? agentById.get(t.assigneeAgentId)?.name : "~")?.toLowerCase() ?? "~";
        case "updatedAt":
          return t.updatedAt;
      }
    };
    return [...tasks].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [tasks, sort, agentById]);

  const Th = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={cn("px-3 py-2 text-left font-medium", className)}>
      <button
        className="inline-flex items-center gap-1 hover:text-fg"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((-s.dir) as 1 | -1) : 1 }))}
      >
        {children}
        {sort.key === k ? sort.dir === 1 ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" /> : null}
      </button>
    </th>
  );

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="border-b border-border text-xs text-fg-muted">
          <tr>
            <Th k="title">{t("Tâche")}</Th>
            <Th k="status">{t("Statut")}</Th>
            <Th k="priority">{t("Priorité")}</Th>
            <Th k="assignee">{t("Assigné à")}</Th>
            <th className="px-3 py-2 text-left font-medium">War Room</th>
            <Th k="updatedAt">{t("Mise à jour")}</Th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((task) => (
            <tr key={task.id} className="hover:bg-surface-2/50">
              <td className="max-w-md px-3 py-2">
                <div className="truncate font-medium">{task.title}</div>
                {task.dependsOn.length ? <div className="text-[11px] text-fg-subtle">{t("Dépend de {count} tâche(s)", { count: task.dependsOn.length })}</div> : null}
              </td>
              <td className="px-3 py-2">
                <Select value={task.status} onChange={(e) => onStatus(task, e.target.value as TaskStatus)} className="h-7 w-32 text-xs">
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(TASK_STATUS_LABEL[s])}
                    </option>
                  ))}
                </Select>
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">{PRIORITY_LABEL[task.priority] ? t(PRIORITY_LABEL[task.priority]) : task.priority}</td>
              <td className="px-3 py-2">
                <Assignee agent={task.assigneeAgentId ? agentById.get(task.assigneeAgentId) : null} />
              </td>
              <td className="px-3 py-2 text-xs text-fg-muted">{roomName(task.warRoomId) ?? "—"}</td>
              <td className="px-3 py-2 text-xs text-fg-subtle">{fmtRelative(task.updatedAt)}</td>
              <td className="px-2 py-2">
                <TaskMenu task={task} onStatus={onStatus} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function TimelineView({ tasks, agentById, roomName }: TaskViewProps) {
  const items = [...tasks].sort((a, b) => (a.dueAt ?? a.createdAt) - (b.dueAt ?? b.createdAt));
  const groups = new Map<string, Task[]>();
  for (const task of items) {
    const key = new Date(task.dueAt ?? task.createdAt).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "long", year: "numeric" });
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return (
    <div className="space-y-6">
      <p className="text-xs text-fg-subtle">{t("Tâches ordonnées par échéance (ou date de création si aucune échéance n'est définie).")}</p>
      {[...groups.entries()].map(([day, list]) => (
        <div key={day} className="relative pl-6">
          <div className="absolute bottom-0 left-[7px] top-6 w-px bg-border" />
          <div className="mb-2 flex items-center gap-2">
            <span className="absolute left-0 size-[15px] rounded-full border-2 border-accent bg-bg" />
            <h3 className="text-xs font-semibold capitalize text-fg-muted">{day}</h3>
          </div>
          <div className="space-y-2">
            {list.map((task) => (
              <Card key={task.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <Badge tone={TASK_STATUS_TONE[task.status]}>{t(TASK_STATUS_LABEL[task.status])}</Badge>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{task.title}</span>
                {task.dueAt ? <Badge tone="outline">{t("échéance")}</Badge> : <span className="text-[11px] text-fg-subtle">{t("créée")}</span>}
                <Assignee agent={task.assigneeAgentId ? agentById.get(task.assigneeAgentId) : null} />
                {roomName(task.warRoomId) ? <span className="text-[11px] text-fg-subtle">{roomName(task.warRoomId)}</span> : null}
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Dialogs

function EditProjectDialog({ open, onOpenChange, project, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; project: Project; onSaved: () => void }) {
  const [form, setForm] = useState(() => ({
    name: project.name,
    description: project.description,
    objectives: project.objectives,
    status: project.status,
    budget: project.budgetUsd != null ? String(project.budgetUsd) : "",
  }));
  const [lastId, setLastId] = useState(project.id + project.updatedAt);
  if (lastId !== project.id + project.updatedAt && !open) {
    setLastId(project.id + project.updatedAt);
    setForm({
      name: project.name,
      description: project.description,
      objectives: project.objectives,
      status: project.status,
      budget: project.budgetUsd != null ? String(project.budgetUsd) : "",
    });
  }
  const budgetInvalid = form.budget.trim() !== "" && (!Number.isFinite(Number(form.budget)) || Number(form.budget) < 0);
  const save = useMutation({
    mutationFn: () =>
      api.patch<Project>(`/projects/${project.id}`, {
        name: form.name.trim(),
        description: form.description,
        objectives: form.objectives,
        status: form.status,
        budgetUsd: form.budget.trim() ? Number(form.budget) : null,
      }),
    onSuccess: () => {
      toast.success(t("Projet mis à jour"));
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => toast.error((err as Error).message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Modifier le projet")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" loading={save.isPending} disabled={!form.name.trim() || budgetInvalid} onClick={() => save.mutate()}>
            {t("Enregistrer")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Nom")}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
        </Field>
        <Field label={t("Description")}>
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
        </Field>
        <Field label={t("Objectifs")}>
          <Textarea value={form.objectives} onChange={(e) => setForm({ ...form, objectives: e.target.value })} rows={4} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Statut")}>
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Project["status"] })}>
              {(Object.keys(PROJECT_STATUS_LABEL) as Project["status"][]).map((s) => (
                <option key={s} value={s}>
                  {t(PROJECT_STATUS_LABEL[s])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Budget API (USD)")} hint={t("Vide = pas de limite")}>
            <Input value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} inputMode="decimal" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function CreateTaskDialog({
  open, onOpenChange, projectId, rooms, agents, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  rooms: WarRoom[];
  agents: Agent[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(2);
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [warRoomId, setWarRoomId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");

  const roomAgents = warRoomId ? agents.filter((a) => a.warRoomId === warRoomId) : agents;

  const create = useMutation({
    mutationFn: () =>
      api.post<Task>("/tasks", {
        title: title.trim(),
        description,
        priority,
        status,
        projectId,
        warRoomId: warRoomId || null,
        assigneeAgentId: assignee || null,
        dueAt: due ? new Date(due).getTime() : null,
      }),
    onSuccess: () => {
      toast.success(t("Tâche créée"));
      onCreated();
      onOpenChange(false);
      setTitle("");
      setDescription("");
      setAssignee("");
      setDue("");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Nouvelle tâche")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!title.trim()} onClick={() => create.mutate()}>
            {t("Créer")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Titre")}>
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} />
        </Field>
        <Field label={t("Description")}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder={t("À quoi ressemble « terminé » ?")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Statut")}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(TASK_STATUS_LABEL[s])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Priorité")}>
            <Select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              <option value={1}>{t("Haute")}</option>
              <option value={2}>{t("Moyenne")}</option>
              <option value={3}>{t("Basse")}</option>
            </Select>
          </Field>
          <Field label="War Room">
            <Select
              value={warRoomId}
              onChange={(e) => {
                setWarRoomId(e.target.value);
                setAssignee("");
              }}
            >
              <option value="">{t("Aucune")}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Assigner à")} hint={!agents.length ? t("Aucun agent : rattachez une War Room.") : undefined}>
            <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!roomAgents.length}>
              <option value="">{t("Personne")}</option>
              {roomAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.role === "orchestrator" ? ` ${t("(orchestrateur)")}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("Échéance")}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <p className="text-[11px] text-fg-subtle">
          {t("Assigner une tâche à un agent l'enregistre dans le suivi ; l'exécution se fait en demandant le travail à l'agent depuis sa War Room.")}
        </p>
      </div>
    </Dialog>
  );
}

function LinkRoomDialog({ open, onOpenChange, projectId, onLinked }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string; onLinked: () => void }) {
  const qc = useQueryClient();
  const rooms = useWarRooms();
  const [selected, setSelected] = useState("");
  const candidates = (rooms.data ?? []).filter((r) => r.projectId !== projectId);
  const link = useMutation({
    mutationFn: () => api.patch(`/warrooms/${selected}`, { projectId }),
    onSuccess: () => {
      toast.success(t("War Room rattachée"));
      void qc.invalidateQueries({ queryKey: qk.warrooms });
      onLinked();
      onOpenChange(false);
      setSelected("");
    },
    onError: (err) => toast.error((err as Error).message),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={t("Rattacher une War Room")}
      description={t("Les nouvelles dépenses et tâches de la War Room seront comptées dans ce projet.")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" disabled={!selected} loading={link.isPending} onClick={() => link.mutate()}>
            {t("Rattacher")}
          </Button>
        </>
      }
    >
      {rooms.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : candidates.length ? (
        <Field label="War Room">
          <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">{t("Choisir…")}</option>
            {candidates.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.projectId ? ` ${t("(déjà dans un autre projet)")}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-[13px] text-fg-muted">
          {t("Aucune War Room disponible.")}{" "}
          <Link to="/warrooms/new" className="text-accent underline">
            {t("Créer une War Room")}
          </Link>
        </p>
      )}
    </Dialog>
  );
}
