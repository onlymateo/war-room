import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Pencil, Trash2, ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Agent } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Badge, Dialog, EmptyState } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface SecretDTO {
  id: string;
  name: string;
  description: string;
  hint: string;
  agentIds: string[];
  serverIds: string[];
  requireApproval: boolean;
  lastUsedAt: number | null;
  useCount: number;
}

interface McpLite {
  id: string;
  name: string;
}

function Chips<T extends { id: string; name: string }>({ items, selected, onChange, allLabel }: { items: T[]; selected: string[]; onChange: (v: string[]) => void; allLabel: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange([])}
        className={cn("h-6 rounded-full border px-2 text-xs", selected.length === 0 ? "border-accent/60 bg-accent-soft text-fg" : "border-border text-fg-muted hover:text-fg")}
      >
        {allLabel}
      </button>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => onChange(selected.includes(it.id) ? selected.filter((x) => x !== it.id) : [...selected, it.id])}
          className={cn("h-6 rounded-full border px-2 text-xs", selected.includes(it.id) ? "border-accent/60 bg-accent-soft text-fg" : "border-border text-fg-muted hover:text-fg")}
        >
          {it.name}
        </button>
      ))}
    </div>
  );
}

function SecretForm({ warRoomId, agents, secret, onDone }: { warRoomId: string; agents: Agent[]; secret: SecretDTO | null; onDone: () => void }) {
  const qc = useQueryClient();
  const mcp = useQuery({ queryKey: qk.mcp, queryFn: () => api.get<McpLite[]>("/mcp") });
  const [name, setName] = useState(secret?.name ?? "");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState(secret?.description ?? "");
  const [agentIds, setAgentIds] = useState<string[]>(secret?.agentIds ?? []);
  const [serverIds, setServerIds] = useState<string[]>(secret?.serverIds ?? []);
  const [requireApproval, setRequireApproval] = useState(secret?.requireApproval ?? false);
  useEffect(() => setValue(""), [secret?.id]);

  const save = useMutation({
    mutationFn: () =>
      secret
        ? api.patch(`/secrets/${secret.id}`, { ...(value ? { value } : {}), description, agentIds, serverIds, requireApproval })
        : api.post(`/warrooms/${warRoomId}/secrets`, { name, value, description, agentIds, serverIds, requireApproval }),
    onSuccess: () => {
      setValue("");
      toast.success(secret ? "Clé mise à jour" : "Clé enregistrée");
      void qc.invalidateQueries({ queryKey: ["secrets", warRoomId] });
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom" hint="Majuscules, chiffres et _ ; c'est ce que voient les agents.">
          <Input
            value={name}
            disabled={!!secret}
            onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
            placeholder="ROBLOX_API_KEY"
            className="font-mono"
          />
        </Field>
        <Field label={secret ? "Nouvelle valeur (optionnel)" : "Valeur"} hint={secret ? `Valeur actuelle : ${secret.hint}. Laissez vide pour la garder.` : "Chiffrée sur cette machine. Elle ne sera plus jamais affichée."}>
          <Input type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder="••••••••" />
        </Field>
      </div>
      <Field label="Description pour les agents" hint="Dites à quoi sert la clé et où l'utiliser (ex. « en-tête x-api-key de l'API Open Cloud »). Ne mettez jamais la valeur ici.">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="min-h-0" />
      </Field>
      <Field label="Agents autorisés">
        <Chips items={agents.map((a) => ({ id: a.id, name: a.name }))} selected={agentIds} onChange={setAgentIds} allLabel="Tous les agents de la room" />
      </Field>
      <Field label="Serveurs MCP vers lesquels elle peut être envoyée">
        <Chips items={mcp.data ?? []} selected={serverIds} onChange={setServerIds} allLabel="Tous" />
      </Field>
      <label className="flex items-center gap-2 text-[13px] text-fg-muted">
        <input type="checkbox" checked={requireApproval} onChange={(e) => setRequireApproval(e.target.checked)} className="accent-[var(--accent)]" />
        Me demander mon accord avant chaque utilisation
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Annuler
        </Button>
        <Button variant="primary" size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!secret && (!name || !value)}>
          {secret ? "Enregistrer" : "Ajouter la clé"}
        </Button>
      </div>
    </div>
  );
}

export function SecretsDialog({ warRoomId, agents, open, onOpenChange }: { warRoomId: string; agents: Agent[]; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const secrets = useQuery({ queryKey: ["secrets", warRoomId], queryFn: () => api.get<SecretDTO[]>(`/warrooms/${warRoomId}/secrets`), enabled: open });
  const mcp = useQuery({ queryKey: qk.mcp, queryFn: () => api.get<McpLite[]>("/mcp"), enabled: open });
  const [editing, setEditing] = useState<SecretDTO | "new" | null>(null);
  const [toDelete, setToDelete] = useState<SecretDTO | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/secrets/${id}`),
    onSuccess: () => {
      setToDelete(null);
      void qc.invalidateQueries({ queryKey: ["secrets", warRoomId] });
    },
  });
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "agent supprimé";
  const serverName = (id: string) => mcp.data?.find((s) => s.id === id)?.name ?? "serveur supprimé";

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Clés secrètes de la War Room" description="Utilisables par les agents dans leurs appels d'outils, jamais lisibles par eux.">
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-muted">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="space-y-1">
            <p>
              Les agents ne voient que le nom et la description. Pour utiliser une clé, ils écrivent <code className="font-mono text-fg">{"{{secret:NOM}}"}</code> dans les
              arguments d'un outil MCP ; WAR ROOM remplace cette référence par la vraie valeur au moment de l'appel, sur cette machine.
            </p>
            <p>Si un outil renvoie la valeur (en clair, encodée URL, base64…), elle est masquée avant d'être transmise à l'IA, affichée ou journalisée.</p>
            <p>
              Limite : une clé envoyée à un outil part là où cet outil l'envoie. Limitez les serveurs autorisés et, pour les clés sensibles, activez l'accord avant
              chaque utilisation.
            </p>
          </div>
        </div>

        {editing === "new" ? <SecretForm warRoomId={warRoomId} agents={agents} secret={null} onDone={() => setEditing(null)} /> : null}

        {secrets.data?.length ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {secrets.data.map((s) =>
              editing !== "new" && editing?.id === s.id ? (
                <li key={s.id} className="p-2">
                  <SecretForm warRoomId={warRoomId} agents={agents} secret={s} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={s.id} className="flex items-start gap-3 px-3 py-2.5">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-medium">{s.name}</span>
                      <span className="font-mono text-[11px] text-fg-subtle">{s.hint}</span>
                      {s.requireApproval ? <Badge tone="warning">accord requis</Badge> : null}
                    </div>
                    {s.description ? <p className="mt-0.5 text-xs text-fg-muted">{s.description}</p> : null}
                    <p className="mt-0.5 text-[11px] text-fg-subtle">
                      {s.agentIds.length ? s.agentIds.map(agentName).join(", ") : "Tous les agents"} · {s.serverIds.length ? s.serverIds.map(serverName).join(", ") : "tous les serveurs"} ·{" "}
                      {s.useCount ? `utilisée ${s.useCount} fois, dernière ${fmtRelative(s.lastUsedAt)}` : "jamais utilisée"}
                    </p>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Copier la référence"
                    title="Copier la référence à utiliser"
                    onClick={() => navigator.clipboard.writeText(`{{secret:${s.name}}}`).then(() => toast.success("Référence copiée"))}
                  >
                    <Copy />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Modifier" onClick={() => setEditing(s)}>
                    <Pencil />
                  </Button>
                  <Button size="icon-sm" variant="danger-ghost" aria-label="Supprimer" onClick={() => setToDelete(s)}>
                    <Trash2 />
                  </Button>
                </li>
              ),
            )}
          </ul>
        ) : editing !== "new" && !secrets.isLoading ? (
          <EmptyState icon={<KeyRound />} title="Aucune clé secrète" description="Ajoutez une clé d'API ou un jeton : vos agents pourront s'en servir dans leurs outils sans jamais la voir." />
        ) : null}

        {editing !== "new" ? (
          <Button variant="primary" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Ajouter une clé
          </Button>
        ) : null}
        <p className="text-[11px] text-fg-subtle">
          Les agents utilisent les clés via leurs outils MCP : un agent sans permission « Utiliser MCP » ou sans serveur attribué ne peut pas s'en servir.
        </p>
      </div>
      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        title={`Supprimer la clé ${toDelete?.name ?? ""} ?`}
        details={["La valeur chiffrée est effacée définitivement.", "Les agents qui l'utilisent ne pourront plus appeler les outils qui en ont besoin."]}
        loading={remove.isPending}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </Dialog>
  );
}
