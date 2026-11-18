import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, MessagesSquare, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Trash2, Cpu } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useModels, useUsableModels } from "@/lib/queries";
import type { Conversation, MessageDTO } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Dialog, EmptyState, Menu, Skeleton } from "@/components/ui/primitives";
import { ModelPicker, modelLabel } from "@/components/domain";
import { Composer } from "../chat/Composer";
import { MessageItem, useStickToBottom } from "../chat/MessageList";
import { useRunStream } from "../chat/useRunStream";

const LAST_MODEL_KEY = "wr-last-chat-model";

function lastModel(): { providerId: string; modelId: string } | null {
  try {
    return JSON.parse(localStorage.getItem(LAST_MODEL_KEY) ?? "null");
  } catch {
    return null;
  }
}

export default function ChatsPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const { models, isLoading: modelsLoading } = useUsableModels();

  const chats = useQuery({
    queryKey: qk.chats(q, archived),
    queryFn: () => api.get<Conversation[]>(`/chats?q=${encodeURIComponent(q)}${archived ? "&archived=1" : ""}`),
  });

  const create = useMutation({
    mutationFn: async () => {
      const remembered = lastModel();
      const pick = (remembered && models.find((m) => m.providerId === remembered.providerId && m.modelId === remembered.modelId)) || models[0];
      if (!pick) throw new Error("Aucun modèle disponible : connectez un fournisseur dans Models & Providers.");
      return api.post<Conversation>("/chats", { providerId: pick.providerId, modelId: pick.modelId });
    },
    onSuccess: (conv) => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      navigate(`/chats/${conv.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  useEffect(() => {
    if (params.get("new") === "1" && !modelsLoading) {
      setParams({}, { replace: true });
      create.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, modelsLoading]);

  return (
    <div className="flex h-full">
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-surface/50">
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h1 className="text-[15px] font-semibold">Chats</h1>
          <Button size="sm" variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={modelsLoading}>
            <Plus /> Nouveau
          </Button>
        </div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className="pl-8" />
          </div>
        </div>
        <div className="flex gap-1 px-3 pb-2 text-xs">
          <button onClick={() => setArchived(false)} className={cn("rounded px-2 py-1", !archived ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg")}>
            Actifs
          </button>
          <button onClick={() => setArchived(true)} className={cn("rounded px-2 py-1", archived ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg")}>
            Archivés
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {chats.isLoading ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : chats.data?.length ? (
            chats.data.map((c) => (
              <Link
                key={c.id}
                to={`/chats/${c.id}`}
                className={cn("block rounded-md px-2.5 py-2 transition-colors", c.id === id ? "bg-surface-3" : "hover:bg-surface-2")}
              >
                <div className="truncate text-[13px]">{c.title}</div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle">
                  <span className="truncate">{c.modelId ?? "—"}</span>
                  <span className="ml-auto shrink-0">{fmtRelative(c.updatedAt)}</span>
                </div>
              </Link>
            ))
          ) : (
            <p className="px-2.5 py-6 text-center text-xs text-fg-subtle">{q ? "Aucun résultat" : archived ? "Aucun chat archivé" : "Aucune conversation"}</p>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {id ? (
          <ChatView key={id} id={id} />
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            {!modelsLoading && models.length === 0 ? (
              <EmptyState
                icon={<Cpu />}
                title="Aucun modèle connecté"
                description="Connectez un fournisseur (abonnement Claude via Claude Code, clé API, ou Ollama en local) pour commencer à discuter."
                action={
                  <Link to="/providers">
                    <Button variant="primary">Models & Providers</Button>
                  </Link>
                }
              />
            ) : (
              <EmptyState
                icon={<MessagesSquare />}
                title="Chats indépendants"
                description="Discutez avec n'importe quel modèle connecté, hors War Room. Changez de modèle en cours de conversation."
                action={
                  <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
                    <Plus /> Nouvelle conversation
                  </Button>
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatView({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const models = useModels();
  const { data, isLoading, error } = useQuery({
    queryKey: qk.conversation(id),
    queryFn: () => api.get<{ conversation: Conversation; messages: MessageDTO[] }>(`/conversations/${id}`),
  });
  const stream = useRunStream();
  const [renaming, setRenaming] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (data) stream.setMessages(data.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.conversation.id]);

  const scrollRef = useStickToBottom(stream.messages);
  const conv = data?.conversation;

  const patch = useMutation({
    mutationFn: (body: Partial<Conversation>) => api.patch<Conversation>(`/conversations/${id}`, body),
    onSuccess: (c) => {
      qc.setQueryData(qk.conversation(id), (old: { conversation: Conversation; messages: MessageDTO[] } | undefined) =>
        old ? { ...old, conversation: c } : old,
      );
      void qc.invalidateQueries({ queryKey: ["chats"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/conversations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chats"] });
      navigate("/chats");
    },
  });

  const modelName = useMemo(() => modelLabel(models.data ?? [], conv?.providerId ?? null, conv?.modelId ?? null), [models.data, conv]);

  if (isLoading) return <div className="p-8"><Skeleton className="h-8 w-64" /></div>;
  if (error || !conv) return <div className="p-8 text-sm text-danger">Conversation introuvable.</div>;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        {renaming ? (
          <Input
            autoFocus
            defaultValue={conv.title}
            className="h-8 max-w-md"
            onBlur={(e) => {
              setRenaming(false);
              if (e.target.value.trim() && e.target.value !== conv.title) patch.mutate({ title: e.target.value.trim() });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h2 className="min-w-0 truncate text-[14px] font-medium">{conv.title}</h2>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="w-64">
            <ModelPicker
              providerId={conv.providerId}
              modelId={conv.modelId}
              onChange={(providerId, modelId) => {
                if (!providerId || !modelId) return;
                try {
                  localStorage.setItem(LAST_MODEL_KEY, JSON.stringify({ providerId, modelId }));
                } catch {
                  /* ignore */
                }
                patch.mutate({ providerId, modelId });
                toast(`Modèle changé : la suite de la conversation utilisera ${modelId}.`);
              }}
            />
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Paramètres du modèle">
            <SlidersHorizontal />
          </Button>
          <Menu
            trigger={
              <Button variant="ghost" size="icon" aria-label="Plus">
                <MoreHorizontal />
              </Button>
            }
            items={[
              { label: "Renommer", icon: <Pencil />, onSelect: () => setRenaming(true) },
              conv.archived
                ? { label: "Désarchiver", icon: <ArchiveRestore />, onSelect: () => patch.mutate({ archived: false }) }
                : { label: "Archiver", icon: <Archive />, onSelect: () => patch.mutate({ archived: true }) },
              "separator",
              { label: "Supprimer", icon: <Trash2 />, danger: true, onSelect: () => confirm("Supprimer définitivement cette conversation ?") && remove.mutate() },
            ]}
          />
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-5 py-4">
          {stream.messages.length === 0 ? (
            <div className="py-16 text-center text-sm text-fg-subtle">
              Nouvelle conversation avec <span className="text-fg">{modelName}</span>.
              {conv.summary ? null : null}
            </div>
          ) : (
            <>
              {conv.summary ? (
                <div className="mb-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-fg-muted">
                  Les messages les plus anciens ont été résumés pour réduire le contexte envoyé au modèle (l'historique complet reste affiché).
                </div>
              ) : null}
              {stream.messages.map((m) => (
                <MessageItem
                  key={m.id}
                  message={m}
                  speaker={{ name: modelLabel(models.data ?? [], m.providerId, m.modelId), icon: "sparkles", color: "blue" }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 px-5 pb-5">
        <div className="mx-auto max-w-3xl">
          <Composer
            running={stream.running}
            onStop={stream.stop}
            scope={{ conversationId: id }}
            improve={{ conversationId: id }}
            disabled={!conv.providerId || !conv.modelId}
            disabledReason="Choisissez un modèle pour cette conversation."
            onSend={(content, attachments) =>
              stream.run(`/chats/${id}/messages`, { content, attachmentIds: attachments.map((a) => a.id) }, () => {
                void qc.invalidateQueries({ queryKey: ["chats"] });
                void qc.invalidateQueries({ queryKey: qk.conversation(id) });
              })
            }
          />
          <p className="mt-1.5 text-center text-[11px] text-fg-subtle">Entrée pour envoyer · Maj+Entrée pour un saut de ligne</p>
        </div>
      </div>

      <ChatSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} conv={conv} onSave={(body) => patch.mutate(body)} />
    </div>
  );
}

function ChatSettingsDialog({
  open,
  onOpenChange,
  conv,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conv: Conversation;
  onSave: (body: Partial<Conversation>) => void;
}) {
  const models = useModels();
  const model = models.data?.find((m) => m.providerId === conv.providerId && m.modelId === conv.modelId);
  const [system, setSystem] = useState(conv.systemPrompt);
  const [effort, setEffort] = useState(conv.params.effort ?? "");
  const [temperature, setTemperature] = useState(conv.params.temperature?.toString() ?? "");
  const [maxTokens, setMaxTokens] = useState(conv.params.maxTokens?.toString() ?? "");
  useEffect(() => {
    if (open) {
      setSystem(conv.systemPrompt);
      setEffort(conv.params.effort ?? "");
      setTemperature(conv.params.temperature?.toString() ?? "");
      setMaxTokens(conv.params.maxTokens?.toString() ?? "");
    }
  }, [open, conv]);
  const caps = model?.capabilities ?? {};
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paramètres de la conversation"
      description={model ? `${model.displayName} · contexte ${model.contextWindow ? model.contextWindow.toLocaleString("fr-FR") + " tokens" : "inconnu"}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave({
                systemPrompt: system,
                params: {
                  ...(effort ? { effort: effort as "low" } : {}),
                  ...(temperature ? { temperature: Number(temperature) } : {}),
                  ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
                },
              });
              onOpenChange(false);
            }}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Prompt système" hint="Instructions permanentes envoyées avec chaque message.">
          <Textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={5} placeholder="Ex. : Tu es un expert en architecture logicielle…" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Effort de raisonnement" hint={caps.effort ? "Modèles Claude" : "Non supporté par ce modèle"}>
            <Select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={!caps.effort}>
              <option value="">Par défaut</option>
              <option value="low">Faible</option>
              <option value="medium">Moyen</option>
              <option value="high">Élevé</option>
              <option value="xhigh">Très élevé</option>
              <option value="max">Maximum</option>
            </Select>
          </Field>
          <Field label="Température" hint={caps.temperature === false ? "Non supportée par ce modèle" : "0 à 2"}>
            <Input type="number" step="0.1" min={0} max={2} value={temperature} onChange={(e) => setTemperature(e.target.value)} disabled={caps.temperature === false} placeholder="Défaut" />
          </Field>
          <Field label="Tokens max en sortie">
            <Input type="number" min={1} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="Défaut" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
