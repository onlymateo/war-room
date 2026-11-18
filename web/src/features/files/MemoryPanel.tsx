import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useAgents, useWarRooms } from "@/lib/queries";
import type { Memory, Project } from "@/lib/types";
import { fmtRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, Dialog, EmptyState, Skeleton } from "@/components/ui/primitives";

type Scope = Memory["scope"];
type Kind = Memory["kind"];

const SCOPE_LABEL: Record<Scope, string> = {
  global: "Globale",
  project: "Projet",
  warroom: "War Room",
  agent: "Agent",
  conversation: "Conversation",
};
const KIND_LABEL: Record<Kind, string> = {
  fact: "Fait",
  decision: "Décision",
  constraint: "Contrainte",
  summary: "Résumé",
  note: "Note",
};
const KIND_TONE: Record<Kind, "neutral" | "accent" | "warning" | "success"> = {
  fact: "neutral",
  decision: "success",
  constraint: "warning",
  summary: "accent",
  note: "neutral",
};

export function MemoryPanel() {
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope | "">("");
  const [scopeId, setScopeId] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const projects = useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>("/projects") });
  const rooms = useWarRooms();
  const agents = useAgents();

  const memories = useQuery({
    queryKey: [...qk.memories(scope || undefined, scopeId || undefined), debounced],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (scope) sp.set("scope", scope);
      if (scopeId) sp.set("scopeId", scopeId);
      if (debounced) sp.set("q", debounced);
      return api.get<Memory[]>(`/memories${sp.size ? `?${sp}` : ""}`);
    },
  });

  const scopeOptions = (s: Scope | ""): { id: string; name: string }[] => {
    if (s === "project") return (projects.data ?? []).map((p) => ({ id: p.id, name: p.name }));
    if (s === "warroom") return (rooms.data ?? []).map((r) => ({ id: r.id, name: r.name }));
    if (s === "agent") return (agents.data ?? []).map((a) => ({ id: a.id, name: `${a.name}${a.warRoomName ? ` · ${a.warRoomName}` : ""}` }));
    return [];
  };
  const scopeTargetName = (m: Memory) => {
    if (!m.scopeId) return null;
    return scopeOptions(m.scope).find((o) => o.id === m.scopeId)?.name ?? m.scopeId;
  };

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["memories"] });
    void qc.invalidateQueries({ queryKey: ["project"] });
  };

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<Memory, "content" | "kind">> }) => api.patch<Memory>(`/memories/${id}`, patch),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/memories/${id}`),
    onSuccess: () => {
      toast.success("Entrée supprimée");
      invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const list = (memories.data ?? []).filter((m) => !kind || m.kind === kind);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-fg-muted">
        <Info className="mt-0.5 size-3.5 shrink-0 text-accent" />
        <p>
          Cette mémoire structurée sert à consulter, corriger et supprimer ce qui est retenu. Elle n'est pas encore injectée automatiquement dans les prompts des agents.
          Ce qui est réellement transmis aujourd'hui : le champ « mémoire partagée » de chaque War Room, la mémoire individuelle de chaque agent (dans sa configuration) et
          les résumés automatiques des conversations longues.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-60">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher dans la mémoire…" className="pl-8" />
        </div>
        <Select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as Scope | "");
            setScopeId("");
          }}
          className="w-40"
        >
          <option value="">Toutes portées</option>
          {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABEL[s]}
            </option>
          ))}
        </Select>
        {scope && scope !== "global" && scope !== "conversation" ? (
          <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)} className="w-52">
            <option value="">Tous</option>
            {scopeOptions(scope).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} className="w-36">
          <option value="">Tous types</option>
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Button variant="primary" className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus /> Ajouter
        </Button>
      </div>

      {memories.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : memories.isError ? (
        <EmptyState title="Impossible de charger la mémoire" description={(memories.error as Error).message} />
      ) : !list.length ? (
        <EmptyState
          icon={<Brain />}
          title="Aucune entrée"
          description="Ajoutez des faits, décisions et contraintes à retenir pour vos projets, War Rooms et agents."
        />
      ) : (
        <Card className="divide-y divide-border">
          {list.map((m) => (
            <div key={m.id} className="group flex gap-3 px-4 py-3">
              <div className="flex w-36 shrink-0 flex-col items-start gap-1">
                <Badge tone={KIND_TONE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                <span className="text-[11px] text-fg-subtle">
                  {SCOPE_LABEL[m.scope]}
                  {scopeTargetName(m) ? ` · ${scopeTargetName(m)}` : ""}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                {editing === m.id ? (
                  <div className="space-y-2">
                    <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} autoFocus />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" disabled={!editText.trim()} loading={update.isPending} onClick={() => update.mutate({ id: m.id, patch: { content: editText.trim() } })}>
                        Enregistrer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.content}</div>
                )}
                <div className="mt-1 text-[11px] text-fg-subtle">
                  {m.source} · modifié {fmtRelative(m.updatedAt)}
                </div>
              </div>
              {editing !== m.id ? (
                <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <Select
                    value={m.kind}
                    onChange={(e) => update.mutate({ id: m.id, patch: { kind: e.target.value as Kind } })}
                    className="h-7 w-28 text-xs"
                    aria-label="Type"
                  >
                    {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Modifier"
                    onClick={() => {
                      setEditing(m.id);
                      setEditText(m.content);
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Supprimer" onClick={() => remove.mutate(m.id)}>
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </Card>
      )}

      <CreateMemoryDialog open={createOpen} onOpenChange={setCreateOpen} scopeOptions={scopeOptions} onCreated={invalidate} defaultScope={scope || "global"} defaultScopeId={scopeId} />
    </div>
  );
}

function CreateMemoryDialog({
  open, onOpenChange, scopeOptions, onCreated, defaultScope, defaultScopeId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scopeOptions: (s: Scope | "") => { id: string; name: string }[];
  onCreated: () => void;
  defaultScope: Scope;
  defaultScopeId: string;
}) {
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [scopeId, setScopeId] = useState(defaultScopeId);
  const [kind, setKind] = useState<Kind>("fact");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (open) {
      setScope(defaultScope === "conversation" ? "global" : defaultScope);
      setScopeId(defaultScopeId);
    }
  }, [open, defaultScope, defaultScopeId]);

  const needsTarget = scope === "project" || scope === "warroom" || scope === "agent";
  const create = useMutation({
    mutationFn: () => api.post<Memory>("/memories", { scope, scopeId: needsTarget ? scopeId : null, kind, content: content.trim() }),
    onSuccess: () => {
      toast.success("Entrée ajoutée");
      onCreated();
      onOpenChange(false);
      setContent("");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nouvelle entrée de mémoire"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!content.trim() || (needsTarget && !scopeId)} loading={create.isPending} onClick={() => create.mutate()}>
            Ajouter
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Portée">
            <Select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as Scope);
                setScopeId("");
              }}
            >
              {(["global", "project", "warroom", "agent"] as Scope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {needsTarget ? (
          <Field label={SCOPE_LABEL[scope]}>
            <Select value={scopeId} onChange={(e) => setScopeId(e.target.value)}>
              <option value="">Choisir…</option>
              {scopeOptions(scope).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Contenu">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} autoFocus placeholder="Ex. : la base de données cible est PostgreSQL 16." />
        </Field>
      </div>
    </Dialog>
  );
}
