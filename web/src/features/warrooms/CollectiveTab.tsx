import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Route, MessageSquare, Crown, Wand2, Users, Swords as Debate, Sigma, AtSign } from "lucide-react";
import type { CollectiveMode, MessageDTO } from "@shared/types";
import { api } from "@/lib/api";
import { qk, useModels } from "@/lib/queries";
import type { Agent, Conversation, Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot, Tooltip } from "@/components/ui/primitives";
import { AgentAvatar, modelLabel } from "@/components/domain";
import { Composer } from "../chat/Composer";
import { MessageItem, useStickToBottom } from "../chat/MessageList";
import { useRunStream } from "../chat/useRunStream";
import { STATUS_LABEL, type RoomDetail } from "./shared";

const MODES: { value: CollectiveMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { value: "auto", label: "Auto", icon: <Wand2 />, hint: "L'orchestrateur choisit les agents pertinents (ou répond seul)." },
  { value: "direct", label: "Ciblé", icon: <AtSign />, hint: "Seuls les agents sélectionnés répondent (ou mentionnez @Nom)." },
  { value: "all", label: "Tous", icon: <Users />, hint: "Force une réponse de tous les agents (coûteux)." },
  { value: "debate", label: "Débat", icon: <Debate />, hint: "Deux tours : positions puis confrontation, et synthèse finale." },
  { value: "synthesis", label: "Synthèse", icon: <Sigma />, hint: "L'orchestrateur synthétise la discussion." },
];

const KIND_LABEL: Record<string, string> = {
  agent_reply: "mission",
  synthesis: "synthèse",
  debate_round: "débat",
  direct_answer: "réponse",
};

function PlanCard({ message, agents, onDecide, busy }: { message: MessageDTO; agents: Agent[]; onDecide: (approve: boolean) => void; busy: boolean }) {
  const plan = message.meta.plan!;
  const status = message.meta.planStatus;
  const orch = agents.find((a) => a.role === "orchestrator");
  return (
    <div className="my-2 ml-11 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Route className="size-3.5 text-accent" />
        <span className="font-medium">Plan de {orch?.name ?? "l'orchestrateur"}</span>
        {status === "pending_approval" ? <Badge tone="warning">En attente de votre accord</Badge> : null}
        {status === "approved" ? <Badge tone="accent">Approuvé</Badge> : null}
        {status === "executed" ? <Badge tone="success">Exécuté</Badge> : null}
        {status === "rejected" ? <Badge tone="danger">Refusé</Badge> : null}
      </div>
      {plan.reasoning ? <p className="mt-1.5 text-[13px] text-fg-muted">{plan.reasoning}</p> : null}
      <ol className="mt-2 space-y-1.5">
        {plan.steps.map((s, i) => {
          const a = agents.find((x) => x.id === s.agentId);
          return (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              {a ? <AgentAvatar icon={a.icon} color={a.color} size="sm" /> : null}
              <div className="min-w-0">
                <span className="font-medium">{s.agentName}</span>
                <span className="text-fg-muted"> — {s.instruction}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {plan.synthesize ? <p className="mt-2 text-[11px] text-fg-subtle">Puis synthèse par l'orchestrateur.</p> : null}
      {status === "pending_approval" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="primary" onClick={() => onDecide(true)} disabled={busy}>
            <Check /> Approuver et lancer
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDecide(false)} disabled={busy}>
            <X /> Refuser
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CollectiveTab({ detail }: { detail: RoomDetail }) {
  const { room, agents, collectiveConversationId } = detail;
  const qc = useQueryClient();
  const models = useModels();
  const convId = collectiveConversationId!;
  const conv = useQuery({
    queryKey: qk.conversation(convId),
    queryFn: () => api.get<{ conversation: Conversation; messages: MessageDTO[] }>(`/conversations/${convId}`),
    enabled: !!convId,
  });
  const tasks = useQuery({ queryKey: qk.tasks({ warRoomId: room.id }), queryFn: () => api.get<Task[]>(`/tasks?warRoomId=${room.id}`), refetchInterval: 5000 });
  const stream = useRunStream();
  const [mode, setMode] = useState<CollectiveMode>("auto");
  const [selected, setSelected] = useState<string[]>([]);
  const [synthesize, setSynthesize] = useState(true);

  useEffect(() => {
    if (conv.data) stream.setMessages(conv.data.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.data?.conversation.id]);

  const scrollRef = useStickToBottom(stream.messages);
  const team = agents.filter((a) => a.role === "agent");
  const orch = agents.find((a) => a.role === "orchestrator");
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.tasks({ warRoomId: room.id }) });
    void qc.invalidateQueries({ queryKey: qk.activity(room.id) });
    void qc.invalidateQueries({ queryKey: qk.warroom(room.id) });
    void qc.invalidateQueries({ queryKey: qk.conversation(convId) });
  };

  const send = (content: string, attachmentIds: string[]) => {
    let agentIds = selected;
    let m = mode;
    // "@Name" mentions switch to targeted mode for those agents.
    const mentioned = team.filter((a) => new RegExp(`@${a.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content)).map((a) => a.id);
    if (mentioned.length && (m === "auto" || m === "direct")) {
      m = "direct";
      agentIds = mentioned;
    }
    void stream.run(`/warrooms/${room.id}/messages`, { content, attachmentIds, mode: m, agentIds, synthesize }, refresh);
  };

  const decide = (planId: string, approve: boolean) => {
    void stream.run(`/warrooms/${room.id}/plans/${planId}/decision`, { approve }, refresh);
  };

  const needsSelection = (mode === "direct" || mode === "debate") && selected.length === 0 && mode === "direct";
  const inProgress = (tasks.data ?? []).filter((t) => t.status === "in_progress");

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-4">
            {stream.messages.length === 0 && !conv.isLoading ? (
              <div className="py-14 text-center">
                <MessageSquare className="mx-auto size-6 text-fg-subtle" />
                <p className="mt-3 text-sm">Conversation collective</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-fg-muted">
                  Écrivez à toute la room. En mode Auto, {orch?.name ?? "l'orchestrateur"} décide qui doit intervenir pour éviter des appels inutiles.
                  {team.length === 0 ? " Aucun agent pour l'instant : lancez l'analyse du brief ou ajoutez des agents." : ""}
                </p>
              </div>
            ) : null}
            {stream.messages.map((m) => {
              if (m.meta.kind === "plan" && m.meta.plan) {
                return <PlanCard key={m.id} message={m} agents={agents} busy={stream.running} onDecide={(approve) => decide(m.id, approve)} />;
              }
              const a = m.agentId ? byId.get(m.agentId) : undefined;
              return (
                <MessageItem
                  key={m.id}
                  message={m}
                  speaker={a ? { name: a.name, icon: a.icon, color: a.color, subtitle: a.role === "orchestrator" ? "orchestrateur" : a.function } : undefined}
                  modelName={modelLabel(models.data ?? [], m.providerId, m.modelId)}
                  extra={
                    <>
                      {m.meta.kind && KIND_LABEL[m.meta.kind] ? <Badge tone={m.meta.kind === "synthesis" ? "accent" : "neutral"}>{KIND_LABEL[m.meta.kind]}{m.meta.round ? ` · tour ${m.meta.round}` : ""}</Badge> : null}
                      {m.role === "user" && m.meta.mode && m.meta.mode !== "auto" ? <Badge tone="outline">{MODES.find((x) => x.value === m.meta.mode)?.label}</Badge> : null}
                    </>
                  }
                />
              );
            })}
          </div>
        </div>
        <div className="shrink-0 px-5 pb-5">
          <div className="mx-auto max-w-3xl">
            {mode === "direct" || mode === "debate" ? (
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-fg-muted">{mode === "debate" ? "Participants (tous si aucun) :" : "Destinataires :"}</span>
                {team.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelected((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))}
                    className={cn(
                      "flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs transition-colors",
                      selected.includes(a.id) ? "border-accent/60 bg-accent-soft text-fg" : "border-border text-fg-muted hover:text-fg",
                    )}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            ) : null}
            <Composer
              running={stream.running}
              onStop={stream.stop}
              scope={{ warRoomId: room.id }}
              allowEmpty={mode === "synthesis"}
              disabled={needsSelection}
              disabledReason="Sélectionnez au moins un agent destinataire."
              placeholder={mode === "auto" ? `Message à la room — ${orch?.name ?? "l'orchestrateur"} répartira le travail (mentionnez @Agent pour cibler)` : "Message…"}
              onSend={(content, attachments) => send(content, attachments.map((a) => a.id))}
              toolbar={
                <>
                  <div className="flex rounded-md border border-border p-0.5">
                    {MODES.map((m) => (
                      <Tooltip key={m.value} content={m.hint}>
                        <button
                          onClick={() => setMode(m.value)}
                          className={cn(
                            "flex h-6 items-center gap-1 rounded px-2 text-xs transition-colors [&_svg]:size-3",
                            mode === m.value ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
                          )}
                        >
                          {m.icon}
                          {m.label}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                  {mode === "all" || mode === "direct" ? (
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
                      <input type="checkbox" checked={synthesize} onChange={(e) => setSynthesize(e.target.checked)} className="accent-[var(--accent)]" />
                      Synthèse finale
                    </label>
                  ) : null}
                </>
              }
            />
          </div>
        </div>
      </div>

      <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border bg-surface/40 p-4 xl:block">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Équipe</h3>
        <div className="space-y-1">
          {agents.map((a) => {
            const st = stream.agentStatus[a.id];
            const busy = st && st !== "idle";
            return (
              <Link key={a.id} to={`/warrooms/${room.id}/agents/${a.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-2">
                <AgentAvatar icon={a.icon} color={a.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px]">{a.name}</span>
                    {a.role === "orchestrator" ? <Crown className="size-3 shrink-0 text-amber-500" /> : null}
                  </div>
                  <div className="truncate text-[11px] text-fg-subtle">
                    {busy ? <span className="text-accent">{STATUS_LABEL[st] ?? st}…</span> : modelLabel(models.data ?? [], a.providerId ?? orch?.providerId ?? null, a.modelId ?? orch?.modelId ?? null)}
                  </div>
                </div>
                <StatusDot status={st === "error" ? "error" : busy ? "working" : "idle"} />
              </Link>
            );
          })}
        </div>
        <h3 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Tâches en cours</h3>
        {inProgress.length ? (
          <div className="space-y-1.5">
            {inProgress.map((t) => (
              <div key={t.id} className="rounded-md border border-border bg-surface px-2.5 py-2 text-xs">
                <div className="line-clamp-2">{t.title}</div>
                <div className="mt-1 text-[11px] text-fg-subtle">{byId.get(t.assigneeAgentId ?? "")?.name ?? "Non assignée"}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-fg-subtle">Aucune tâche en cours.</p>
        )}
      </aside>
    </div>
  );
}
