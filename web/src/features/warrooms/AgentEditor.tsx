import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useModels } from "@/lib/queries";
import type { Agent } from "@/lib/types";
import type { AgentPermissions } from "@shared/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Badge, Dialog, Tabs } from "@/components/ui/primitives";
import { ChevronRight } from "lucide-react";
import { AGENT_COLORS, AGENT_ICONS, AgentAvatar, ModelPicker } from "@/components/domain";

interface SkillLite {
  id: string;
  name: string;
  status: "installed" | "available";
  contextTokens: number;
  sourceLabel: string;
}
interface McpLite {
  id: string;
  name: string;
  status: string;
  tools: { name: string; description?: string; inputSchema?: unknown }[];
  sensitiveTools: string[];
}

/** Rough size of one tool definition in the model's prompt (~4 characters per token). */
function toolTokens(t: McpLite["tools"][number]) {
  return Math.ceil(JSON.stringify({ name: t.name, description: t.description ?? "", input_schema: t.inputSchema ?? {} }).length / 4);
}

function McpToolPicker({ server, allowed, onChange }: { server: McpLite; allowed: string[] | undefined; onChange: (next: string[] | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const all = server.tools.map((t) => t.name);
  const selected = allowed ?? all;
  const totalTokens = server.tools.filter((t) => selected.includes(t.name)).reduce((n, t) => n + toolTokens(t), 0);
  const maxTokens = server.tools.reduce((n, t) => n + toolTokens(t), 0);
  if (!server.tools.length) {
    return <p className="pl-7 text-[11px] text-fg-subtle">Connectez le serveur pour choisir ses outils (tous seront exposés en attendant).</p>;
  }
  const readOnly = all.filter((n) => !server.sensitiveTools.includes(n));
  return (
    <div className="ml-7 rounded-md border border-border bg-surface-2/40">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
        <ChevronRight className={cn("size-3 text-fg-subtle transition-transform", open && "rotate-90")} />
        <span>
          {selected.length}/{all.length} outils
        </span>
        <span className="ml-auto tabular-nums text-fg-subtle">
          ~{totalTokens.toLocaleString("fr-FR")} tokens / appel{selected.length < all.length ? ` (au lieu de ~${maxTokens.toLocaleString("fr-FR")})` : ""}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border p-2">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => onChange(all)}>Tous</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(readOnly)}>Non sensibles uniquement</Button>
            <Button size="sm" variant="ghost" onClick={() => onChange([])}>Aucun</Button>
          </div>
          <div className="max-h-60 space-y-0.5 overflow-y-auto">
            {server.tools.map((t) => (
              <label key={t.name} className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={selected.includes(t.name)}
                  onChange={(e) => onChange(e.target.checked ? [...selected, t.name] : selected.filter((x) => x !== t.name))}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-mono">{t.name}</span>
                  {server.sensitiveTools.includes(t.name) ? <Badge tone="warning" className="ml-1.5">sensible</Badge> : null}
                  {t.description ? <span className="block truncate text-[11px] text-fg-subtle">{t.description}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-[11px] text-fg-subtle">~{toolTokens(t)}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const DEFAULT_PERMS: AgentPermissions = { readWarRoomContext: true, readFiles: true, useMcp: false, dispatchWithoutApproval: false };

export function AgentEditor({ warRoomId, agent, open, onOpenChange }: { warRoomId: string; agent: Agent | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const models = useModels();
  const skills = useQuery({ queryKey: qk.skills, queryFn: () => api.get<SkillLite[]>("/skills"), enabled: open });
  const mcp = useQuery({ queryKey: qk.mcp, queryFn: () => api.get<McpLite[]>("/mcp"), enabled: open });
  const isOrch = agent?.role === "orchestrator";
  const [tab, setTab] = useState("identity");
  const [form, setForm] = useState(() => toForm(agent));

  useEffect(() => {
    if (open) {
      setForm(toForm(agent));
      setTab("identity");
    }
  }, [open, agent]);

  const set = <K extends keyof ReturnType<typeof toForm>>(k: K, v: ReturnType<typeof toForm>[K]) => setForm((f) => ({ ...f, [k]: v }));
  const model = models.data?.find((m) => m.providerId === form.providerId && m.modelId === form.modelId);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        icon: form.icon,
        color: form.color,
        function: form.function,
        description: form.description,
        personality: form.personality,
        providerId: form.providerId,
        modelId: form.modelId,
        systemPrompt: form.systemPrompt,
        params: {
          ...(form.effort ? { effort: form.effort } : {}),
          ...(form.temperature !== "" ? { temperature: Number(form.temperature) } : {}),
          ...(form.maxTokens !== "" ? { maxTokens: Number(form.maxTokens) } : {}),
        },
        skills: form.skills,
        mcpServers: form.mcpServers,
        mcpTools: Object.fromEntries(Object.entries(form.mcpTools).filter(([id]) => form.mcpServers.includes(id))),
        memory: form.memory,
        tokenLimit: form.tokenLimit !== "" ? Number(form.tokenLimit) : null,
        budgetUsd: form.budgetUsd !== "" ? Number(form.budgetUsd) : null,
        priority: Number(form.priority) || 0,
        permissions: form.permissions,
      };
      return agent ? api.patch<Agent>(`/agents/${agent.id}`, body) : api.post<Agent>(`/warrooms/${warRoomId}/agents`, body);
    },
    onSuccess: () => {
      toast.success(agent ? "Agent mis à jour" : "Agent créé");
      void qc.invalidateQueries({ queryKey: qk.warroom(warRoomId) });
      void qc.invalidateQueries({ queryKey: qk.agents });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const installed = (skills.data ?? []).filter((s) => s.status === "installed");
  const skillTokens = installed.filter((s) => form.skills.includes(s.name)).reduce((n, s) => n + s.contextTokens, 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={agent ? `Configurer ${agent.name}` : "Nouvel agent"}
      description={isOrch ? "Orchestrateur de la War Room" : "Agent spécialisé : il appelle réellement le modèle choisi."}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!form.name.trim() || (isOrch && !form.modelId)}>
            {agent ? "Enregistrer" : "Créer l'agent"}
          </Button>
        </>
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="-mx-5 -mt-4 mb-4 px-5"
        items={[
          { value: "identity", label: "Identité" },
          { value: "model", label: "Modèle & prompt" },
          { value: "tools", label: "Skills & MCP" },
          { value: "limits", label: "Mémoire, limites, permissions" },
        ]}
      />
      {tab === "identity" ? (
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <AgentAvatar icon={form.icon} color={form.color} size="lg" />
            <Field label="Nom" className="flex-1">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Architect" />
            </Field>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-fg-muted">Icône et couleur</div>
            <div className="flex flex-wrap gap-1">
              {Object.keys(AGENT_ICONS).map((k) => {
                const Icon = AGENT_ICONS[k];
                return (
                  <button key={k} onClick={() => set("icon", k)} className={cn("flex size-8 items-center justify-center rounded-md border", form.icon === k ? "border-accent bg-accent-soft" : "border-border hover:bg-surface-2")} aria-label={k}>
                    <Icon className="size-4" />
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-1.5">
              {Object.keys(AGENT_COLORS).map((c) => (
                <button key={c} onClick={() => set("color", c)} className={cn("size-6 rounded-full", AGENT_COLORS[c], form.color === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")} aria-label={c} />
              ))}
            </div>
          </div>
          <Field label="Fonction" hint="Une ligne : ce pour quoi l'orchestrateur le sollicite.">
            <Input value={form.function} onChange={(e) => set("function", e.target.value)} placeholder="Architecture logicielle et choix techniques" />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={3} />
          </Field>
          <Field label="Personnalité">
            <Input value={form.personality} onChange={(e) => set("personality", e.target.value)} placeholder="Rigoureux, pragmatique, challenge les hypothèses" />
          </Field>
        </div>
      ) : null}

      {tab === "model" ? (
        <div className="space-y-4">
          <Field label="Modèle" hint={isOrch ? "Obligatoire pour l'orchestrateur." : "Sans modèle, l'agent utilise celui de l'orchestrateur."}>
            <ModelPicker providerId={form.providerId} modelId={form.modelId} allowNone={!isOrch} onChange={(p, m) => setForm((f) => ({ ...f, providerId: p, modelId: m }))} />
          </Field>
          <Field label="Prompt système" hint="Les règles de collaboration, le contexte de la War Room (selon permissions) et les Skills sont ajoutés automatiquement.">
            <Textarea value={form.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} rows={8} className="font-mono text-xs" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Effort" hint={model?.capabilities.effort ? undefined : "Non supporté"}>
              <Select value={form.effort} onChange={(e) => set("effort", e.target.value)} disabled={model ? !model.capabilities.effort : false}>
                <option value="">Par défaut</option>
                <option value="low">Faible</option>
                <option value="medium">Moyen</option>
                <option value="high">Élevé</option>
                <option value="xhigh">Très élevé</option>
                <option value="max">Maximum</option>
              </Select>
            </Field>
            <Field label="Température" hint={model?.capabilities.temperature === false ? "Non supportée" : undefined}>
              <Input type="number" min={0} max={2} step={0.1} value={form.temperature} onChange={(e) => set("temperature", e.target.value)} disabled={model?.capabilities.temperature === false} placeholder="Défaut" />
            </Field>
            <Field label="Tokens max / réponse">
              <Input type="number" min={1} value={form.maxTokens} onChange={(e) => set("maxTokens", e.target.value)} placeholder="Défaut" />
            </Field>
          </div>
        </div>
      ) : null}

      {tab === "tools" ? (
        <div className="space-y-5">
          <Field label={`Skills (${form.skills.length})`} hint={`Contenu injecté dans le prompt système : environ ${skillTokens.toLocaleString("fr-FR")} tokens (estimation) ajoutés à chaque appel.`}>
            {installed.length ? (
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {installed.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={form.skills.includes(s.name)}
                      onChange={(e) => set("skills", e.target.checked ? [...form.skills, s.name] : form.skills.filter((x) => x !== s.name))}
                      className="accent-[var(--accent)]"
                    />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[11px] text-fg-subtle">~{s.contextTokens.toLocaleString("fr-FR")} tok · {s.sourceLabel}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">Aucun Skill installé. Voir la page Skills.</p>
            )}
          </Field>
          <Field label="Serveurs MCP autorisés" hint="L'agent doit aussi avoir la permission « Utiliser MCP ». Les outils sensibles demandent toujours votre confirmation.">
            {(mcp.data ?? []).length ? (
              <div className="space-y-1.5 rounded-md border border-border p-2">
                {(mcp.data ?? []).map((s) => {
                  const checked = form.mcpServers.includes(s.id);
                  return (
                    <div key={s.id} className="space-y-1">
                      <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setForm((f) => {
                              const mcpTools = { ...f.mcpTools };
                              // New assignment: start from the non-sensitive tools only (smaller prompt, safer); adjust below.
                              if (on && s.tools.length) mcpTools[s.id] = s.tools.map((t) => t.name).filter((n) => !s.sensitiveTools.includes(n));
                              if (!on) delete mcpTools[s.id];
                              return { ...f, mcpServers: on ? [...f.mcpServers, s.id] : f.mcpServers.filter((x) => x !== s.id), mcpTools };
                            });
                          }}
                          className="accent-[var(--accent)]"
                        />
                        <span className="flex-1">{s.name}</span>
                        <span className="text-[11px] text-fg-subtle">{s.status}</span>
                      </label>
                      {checked ? (
                        <McpToolPicker
                          server={s}
                          allowed={form.mcpTools[s.id]}
                          onChange={(next) => setForm((f) => ({ ...f, mcpTools: { ...f.mcpTools, [s.id]: next ?? [] } }))}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-fg-subtle">Aucun serveur MCP configuré.</p>
            )}
          </Field>
        </div>
      ) : null}

      {tab === "limits" ? (
        <div className="space-y-4">
          <Field label="Mémoire individuelle" hint="Notes persistantes propres à cet agent, ajoutées à son prompt.">
            <Textarea value={form.memory} onChange={(e) => set("memory", e.target.value)} rows={4} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Limite de tokens / réponse">
              <Input type="number" min={1} value={form.tokenLimit} onChange={(e) => set("tokenLimit", e.target.value)} placeholder="Aucune" />
            </Field>
            <Field label="Budget API ($)">
              <Input type="number" min={0} step={0.5} value={form.budgetUsd} onChange={(e) => set("budgetUsd", e.target.value)} placeholder="Illimité" />
            </Field>
            <Field label="Priorité (0-10)">
              <Input type="number" min={0} max={10} value={form.priority} onChange={(e) => set("priority", e.target.value)} />
            </Field>
          </div>
          <div className="space-y-2.5 rounded-md border border-border p-3">
            <div className="text-xs font-medium text-fg-muted">Permissions</div>
            <Switch checked={form.permissions.readWarRoomContext} onChange={(v) => set("permissions", { ...form.permissions, readWarRoomContext: v })} label="Lire le contexte de la War Room (brief, mémoire commune, équipe)" />
            <Switch checked={form.permissions.readFiles} onChange={(v) => set("permissions", { ...form.permissions, readFiles: v })} label="Recevoir les pièces jointes des messages" />
            <Switch checked={form.permissions.useMcp} onChange={(v) => set("permissions", { ...form.permissions, useMcp: v })} label="Utiliser les outils MCP autorisés" />
            {isOrch ? (
              <Switch
                checked={form.permissions.dispatchWithoutApproval}
                onChange={(v) => set("permissions", { ...form.permissions, dispatchWithoutApproval: v })}
                label="Distribuer le travail sans validation (outrepasse le niveau d'autonomie)"
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function toForm(agent: Agent | null) {
  return {
    name: agent?.name ?? "",
    icon: agent?.icon ?? "bot",
    color: agent?.color ?? "blue",
    function: agent?.function ?? "",
    description: agent?.description ?? "",
    personality: agent?.personality ?? "",
    providerId: agent?.providerId ?? null,
    modelId: agent?.modelId ?? null,
    systemPrompt: agent?.systemPrompt ?? "",
    effort: agent?.params.effort ?? "",
    temperature: agent?.params.temperature?.toString() ?? "",
    maxTokens: agent?.params.maxTokens?.toString() ?? "",
    skills: agent?.skills ?? [],
    mcpServers: agent?.mcpServers ?? [],
    mcpTools: (agent?.mcpTools ?? {}) as Record<string, string[]>,
    memory: agent?.memory ?? "",
    tokenLimit: agent?.tokenLimit?.toString() ?? "",
    budgetUsd: agent?.budgetUsd?.toString() ?? "",
    priority: agent?.priority?.toString() ?? "0",
    permissions: agent?.permissions ?? DEFAULT_PERMS,
  };
}
