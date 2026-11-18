import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Shield, Sparkles } from "lucide-react";
import type { MessageDTO } from "@shared/types";
import { api } from "@/lib/api";
import { qk, useModels } from "@/lib/queries";
import type { Conversation, UsageEvent } from "@/lib/types";
import { fmtPct, fmtTokens } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, Progress, Skeleton } from "@/components/ui/primitives";
import { AgentAvatar, CostTag, modelLabel } from "@/components/domain";
import { Composer } from "../chat/Composer";
import { MessageItem, useStickToBottom } from "../chat/MessageList";
import { useRunStream } from "../chat/useRunStream";
import { AgentEditor } from "./AgentEditor";
import { useRoom } from "./shared";

export default function AgentChatPage() {
  const { id = "", agentId = "" } = useParams();
  const room = useRoom(id);
  const models = useModels();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const conv = useQuery({
    queryKey: qk.agentConversation(agentId),
    queryFn: () => api.get<{ conversation: Conversation; messages: MessageDTO[] }>(`/agents/${agentId}/conversation`),
  });
  const usage = useQuery({
    queryKey: ["agent-conv-usage", conv.data?.conversation.id],
    queryFn: () => api.get<UsageEvent[]>(`/usage/events?conversationId=${conv.data!.conversation.id}&limit=50`),
    enabled: !!conv.data,
  });
  const stream = useRunStream();
  useEffect(() => {
    if (conv.data) stream.setMessages(conv.data.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.data?.conversation.id]);
  const scrollRef = useStickToBottom(stream.messages);

  const agent = room.data?.agents.find((a) => a.id === agentId);
  const orch = room.data?.agents.find((a) => a.role === "orchestrator");
  if (room.isLoading || conv.isLoading) return <div className="p-8"><Skeleton className="h-8 w-64" /></div>;
  if (!agent || !room.data) return <div className="p-8 text-sm text-danger">Agent introuvable.</div>;

  const providerId = agent.providerId ?? orch?.providerId ?? null;
  const modelId = agent.modelId ?? orch?.modelId ?? null;
  const last = usage.data?.find((e) => e.status === "ok");
  const model = models.data?.find((m) => m.providerId === providerId && m.modelId === modelId);
  const ratio = last?.contextTokens != null && model?.contextWindow ? last.contextTokens / model.contextWindow : null;
  const totals = (usage.data ?? []).reduce(
    (acc, e) => ({ input: acc.input + (e.inputTokens ?? 0), output: acc.output + (e.outputTokens ?? 0), billed: acc.billed + (e.costKind === "api_billed" ? (e.costUsd ?? 0) : 0) }),
    { input: 0, output: 0, billed: 0 },
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
          <Link to={`/warrooms/${id}?tab=agents`} className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Retour">
            <ArrowLeft className="size-4" />
          </Link>
          <AgentAvatar icon={agent.icon} color={agent.color} size="sm" />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium">{agent.name}</div>
            <div className="truncate text-[11px] text-fg-subtle">
              {room.data.room.name} · {modelLabel(models.data ?? [], providerId, modelId)}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
            <Pencil /> Configurer
          </Button>
        </header>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-5 py-4">
            {stream.messages.length === 0 ? (
              <div className="py-16 text-center text-sm text-fg-subtle">
                Conversation directe avec {agent.name}, sans passer par l'orchestrateur.
                {agent.permissions.readWarRoomContext ? " Il a accès au contexte de la War Room." : " Il n'a pas accès au contexte de la War Room."}
              </div>
            ) : (
              stream.messages.map((m) => <MessageItem key={m.id} message={m} speaker={{ name: agent.name, icon: agent.icon, color: agent.color }} modelName={modelLabel(models.data ?? [], m.providerId, m.modelId)} />)
            )}
          </div>
        </div>
        <div className="shrink-0 px-5 pb-5">
          <div className="mx-auto max-w-3xl">
            <Composer
              running={stream.running}
              onStop={stream.stop}
              scope={{ warRoomId: id, conversationId: conv.data?.conversation.id }}
              placeholder={`Message à ${agent.name}…`}
              onSend={(content, attachments) =>
                stream.run(`/agents/${agentId}/messages`, { content, attachmentIds: attachments.map((a) => a.id) }, () => {
                  void qc.invalidateQueries({ queryKey: ["agent-conv-usage"] });
                })
              }
            />
          </div>
        </div>
      </div>
      <aside className="hidden w-72 shrink-0 space-y-4 overflow-y-auto border-l border-border bg-surface/40 p-4 lg:block">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Rôle</h3>
          <p className="mt-1 text-[13px]">{agent.function || "—"}</p>
          <p className="mt-1 text-xs text-fg-muted">{agent.description}</p>
        </div>
        <Card className="space-y-2 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">Contexte</div>
          <Progress value={ratio} tone={ratio !== null && ratio > 0.8 ? "danger" : "accent"} />
          <div className="text-xs tabular-nums text-fg-muted">
            {last ? `${fmtTokens(last.contextTokens)} / ${model?.contextWindow ? fmtTokens(model.contextWindow) : "inconnu"} tokens · ${fmtPct(ratio)}` : "Pas encore d'appel"}
          </div>
          <div className="border-t border-border pt-2 text-xs text-fg-muted">
            Cette conversation : {fmtTokens(totals.input, { compact: true })} ↑ · {fmtTokens(totals.output, { compact: true })} ↓
            {last ? (
              <div className="mt-1">
                Dernier appel : <CostTag costUsd={last.costUsd} costKind={last.costKind} />
              </div>
            ) : null}
          </div>
        </Card>
        <div>
          <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            <Sparkles className="size-3" /> Skills
          </h3>
          <div className="flex flex-wrap gap-1">{agent.skills.length ? agent.skills.map((s) => <Badge key={s} tone="outline">{s}</Badge>) : <span className="text-xs text-fg-subtle">Aucun</span>}</div>
        </div>
        <div>
          <h3 className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            <Shield className="size-3" /> Permissions
          </h3>
          <ul className="space-y-0.5 text-xs text-fg-muted">
            <li>{agent.permissions.readWarRoomContext ? "✓" : "✗"} Contexte de la War Room</li>
            <li>{agent.permissions.readFiles ? "✓" : "✗"} Pièces jointes</li>
            <li>{agent.permissions.useMcp ? "✓" : "✗"} Outils MCP</li>
          </ul>
        </div>
      </aside>
      <AgentEditor warRoomId={id} agent={agent} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
