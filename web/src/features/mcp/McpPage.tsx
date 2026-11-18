import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Plus, Power, PowerOff, Pencil, Trash2, Info, Play, RefreshCw, ShieldAlert, Terminal, Globe } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { cn, fmtDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Badge, Card, Dialog, EmptyState, Page, PageHeader, Skeleton, StatusDot, Tabs, Tooltip } from "@/components/ui/primitives";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface McpServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  hasEnv: boolean;
  hasHeaders: boolean;
  enabled: boolean;
  sensitiveTools: string[];
  createdAt: number;
  status: "connecting" | "connected" | "error" | "disconnected";
  error: string | null;
  tools: McpTool[];
  resources: { uri: string; name?: string; description?: string; mimeType?: string }[];
  prompts: { name: string; description?: string }[];
  serverInfo: { name?: string; version?: string } | null;
  agents: { id: string; name: string; allowed: boolean }[];
}

const STATUS_LABEL: Record<McpServer["status"], string> = {
  connecting: "Connexion…",
  connected: "Connecté",
  error: "Erreur",
  disconnected: "Déconnecté",
};

function statusDot(s: McpServer["status"]) {
  return s === "connected" ? "ok" : s === "error" ? "error" : s === "connecting" ? "working" : "unknown";
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export default function McpPage() {
  const qc = useQueryClient();
  const servers = useQuery({ queryKey: qk.mcp, queryFn: () => api.get<McpServer[]>("/mcp") });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);

  useEffect(() => {
    const list = servers.data ?? [];
    if (!list.length) setSelectedId(null);
    else if (!selectedId || !list.some((s) => s.id === selectedId)) setSelectedId(list[0].id);
  }, [servers.data, selectedId]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.mcp });
    void qc.invalidateQueries({ queryKey: qk.status });
  };

  const selected = servers.data?.find((s) => s.id === selectedId) ?? null;

  return (
    <Page wide>
      <PageHeader
        icon={<Plug />}
        title="MCP Servers"
        description="Serveurs Model Context Protocol (STDIO local ou HTTP distant), connectés via le SDK officiel."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus /> Ajouter un serveur
          </Button>
        }
      />

      <Card className="mb-5 flex items-start gap-2.5 px-4 py-3 text-xs text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          Les agents ne déclenchent pas encore d'appels d'outils MCP automatiquement pendant les conversations ; les outils peuvent être testés manuellement ici.
          Les permissions et confirmations sont déjà appliquées côté serveur.
        </p>
      </Card>

      {servers.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : servers.isError ? (
        <EmptyState title="Impossible de charger les serveurs MCP" description={errMsg(servers.error)} />
      ) : !servers.data?.length ? (
        <EmptyState
          icon={<Plug />}
          title="Aucun serveur MCP"
          description="Ajoutez un serveur local (STDIO), par exemple : npx -y @modelcontextprotocol/server-filesystem <dossier>, ou un serveur distant HTTP."
          action={
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus /> Ajouter un serveur
            </Button>
          }
        />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-1.5">
            {servers.data.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  s.id === selectedId ? "border-accent/50 bg-surface-2" : "border-border bg-surface hover:bg-surface-2",
                )}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-muted [&_svg]:size-4">
                  {s.transport === "stdio" ? <Terminal /> : <Globe />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">{s.name}</span>
                    {!s.enabled ? <Badge>désactivé</Badge> : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                    <StatusDot status={statusDot(s.status)} className="size-1.5" />
                    {STATUS_LABEL[s.status]}
                    {s.status === "connected" ? ` · ${s.tools.length} outils` : ""}
                  </div>
                </div>
              </button>
            ))}
          </div>
          {selected ? <ServerDetail server={selected} onEdit={() => setEditing(selected)} onChanged={invalidate} /> : null}
        </div>
      )}

      <ServerDialog target={editing} onClose={() => setEditing(null)} onSaved={(id) => { invalidate(); if (id) setSelectedId(id); }} />
    </Page>
  );
}

function ServerDetail({ server, onEdit, onChanged }: { server: McpServer; onEdit: () => void; onChanged: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState("tools");
  const [testTool, setTestTool] = useState<McpTool | null>(null);

  const connect = useMutation({
    mutationFn: () => api.post<McpServer>(`/mcp/${server.id}/connect`),
    onSuccess: (s) => {
      if (s.status === "error") toast.error(`${server.name} : ${s.error ?? "échec de connexion"}`);
      else toast.success(`${server.name} connecté`);
      onChanged();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const disconnect = useMutation({
    mutationFn: () => api.post(`/mcp/${server.id}/disconnect`),
    onSuccess: () => {
      toast.success(`${server.name} déconnecté`);
      onChanged();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/mcp/${server.id}`),
    onSuccess: () => {
      toast.success("Serveur supprimé");
      onChanged();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const setSensitive = useMutation({
    mutationFn: (sensitiveTools: string[]) => api.patch(`/mcp/${server.id}`, { sensitiveTools }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.mcp }),
    onError: (e) => toast.error(errMsg(e)),
  });
  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/mcp/${server.id}`, { enabled }),
    onSuccess: onChanged,
    onError: (e) => toast.error(errMsg(e)),
  });

  const connected = server.status === "connected";

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">{server.name}</h2>
            <Badge tone="outline">{server.transport === "stdio" ? "STDIO" : "HTTP"}</Badge>
            <Badge tone={connected ? "success" : server.status === "error" ? "danger" : "neutral"}>{STATUS_LABEL[server.status]}</Badge>
            {server.serverInfo?.name ? (
              <span className="text-[11px] text-fg-subtle">
                {server.serverInfo.name}
                {server.serverInfo.version ? ` v${server.serverInfo.version}` : ""}
              </span>
            ) : null}
          </div>
          <p className="mt-1 break-all font-mono text-[11px] text-fg-subtle">
            {server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url}
          </p>
          <div className="mt-1 flex gap-3 text-[11px] text-fg-subtle">
            {server.hasEnv ? <span>Variables d'environnement chiffrées</span> : null}
            {server.hasHeaders ? <span>En-têtes chiffrés</span> : null}
          </div>
          {server.error ? <p className="mt-2 rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{server.error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Switch checked={server.enabled} onChange={(v) => toggleEnabled.mutate(v)} label="Activé" />
          {connected ? (
            <Button size="sm" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
              <PowerOff /> Déconnecter
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={!server.enabled} loading={connect.isPending} onClick={() => connect.mutate()}>
              <Power /> Connecter
            </Button>
          )}
          <Tooltip content="Modifier">
            <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label="Modifier">
              <Pencil />
            </Button>
          </Tooltip>
          <Tooltip content="Supprimer">
            <Button
              size="icon-sm"
              variant="danger-ghost"
              loading={remove.isPending}
              onClick={() => confirm(`Supprimer le serveur « ${server.name} » ?`) && remove.mutate()}
              aria-label="Supprimer"
            >
              <Trash2 />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="px-4">
        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "tools", label: "Outils", count: server.tools.length },
            { value: "resources", label: "Ressources", count: server.resources.length },
            { value: "prompts", label: "Prompts", count: server.prompts.length },
            { value: "logs", label: "Logs" },
            { value: "agents", label: "Agents", count: server.agents.length },
          ]}
        />
      </div>

      <div className="p-4">
        {tab === "tools" ? (
          !connected ? (
            <p className="text-xs text-fg-subtle">Connectez le serveur pour lister ses outils.</p>
          ) : server.tools.length === 0 ? (
            <p className="text-xs text-fg-subtle">Ce serveur n'expose aucun outil.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {server.tools.map((t) => {
                const sensitive = server.sensitiveTools.includes(t.name);
                return (
                  <div key={t.name} className="flex items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[12px] font-medium">{t.name}</span>
                        {sensitive ? (
                          <Badge tone="warning">
                            <ShieldAlert /> Sensible
                          </Badge>
                        ) : null}
                      </div>
                      {t.description ? <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{t.description}</p> : null}
                    </div>
                    <Tooltip content="Un outil sensible exige une confirmation humaine avant chaque exécution par un agent">
                      <span>
                        <Switch
                          checked={sensitive}
                          onChange={(v) =>
                            setSensitive.mutate(v ? [...server.sensitiveTools, t.name] : server.sensitiveTools.filter((x) => x !== t.name))
                          }
                          label="Sensible"
                        />
                      </span>
                    </Tooltip>
                    <Button size="sm" variant="ghost" onClick={() => setTestTool(t)}>
                      <Play /> Tester
                    </Button>
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "resources" ? (
          server.resources.length === 0 ? (
            <p className="text-xs text-fg-subtle">{connected ? "Aucune ressource exposée." : "Connectez le serveur pour lister ses ressources."}</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {server.resources.map((r) => (
                <div key={r.uri} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{r.name ?? r.uri}</span>
                    {r.mimeType ? <Badge tone="outline">{r.mimeType}</Badge> : null}
                  </div>
                  <p className="break-all font-mono text-[11px] text-fg-subtle">{r.uri}</p>
                  {r.description ? <p className="mt-0.5 text-xs text-fg-muted">{r.description}</p> : null}
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === "prompts" ? (
          server.prompts.length === 0 ? (
            <p className="text-xs text-fg-subtle">{connected ? "Aucun prompt exposé." : "Connectez le serveur pour lister ses prompts."}</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {server.prompts.map((p) => (
                <div key={p.name} className="px-3 py-2.5">
                  <span className="font-mono text-[12px] font-medium">{p.name}</span>
                  {p.description ? <p className="mt-0.5 text-xs text-fg-muted">{p.description}</p> : null}
                </div>
              ))}
            </div>
          )
        ) : null}

        {tab === "logs" ? <LogsPanel serverId={server.id} /> : null}

        {tab === "agents" ? (
          <div className="space-y-3">
            <p className="text-xs text-fg-muted">
              L'attribution d'un serveur MCP se fait dans les paramètres de l'agent (dans sa War Room). L'agent doit aussi disposer de la permission « Utiliser
              MCP » : sans elle, le serveur refuse tout appel d'outil.
            </p>
            {server.agents.length === 0 ? (
              <p className="text-xs text-fg-subtle">Aucun agent n'a accès à ce serveur.</p>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border">
                {server.agents.map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-3 py-2">
                    <span className="text-[13px]">{a.name}</span>
                    {a.allowed ? <Badge tone="success">Permission MCP accordée</Badge> : <Badge tone="warning">Permission « Utiliser MCP » désactivée</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <ToolTestDialog serverId={server.id} tool={testTool} onClose={() => setTestTool(null)} />
    </Card>
  );
}

function LogsPanel({ serverId }: { serverId: string }) {
  const logs = useQuery({
    queryKey: ["mcp-logs", serverId],
    queryFn: () => api.get<{ at: number; level: "info" | "error"; text: string }[]>(`/mcp/${serverId}/logs`),
  });
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" loading={logs.isFetching} onClick={() => void logs.refetch()}>
          <RefreshCw /> Actualiser
        </Button>
      </div>
      {logs.data?.length ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-bg p-2 font-mono text-[11px]">
          {[...logs.data].reverse().map((l, i) => (
            <div key={i} className={cn("whitespace-pre-wrap py-0.5", l.level === "error" ? "text-danger" : "text-fg-muted")}>
              <span className="text-fg-subtle">{fmtDateTime(l.at)} </span>
              {l.text}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-fg-subtle">{logs.isLoading ? "Chargement…" : "Aucun log depuis le démarrage de WAR ROOM."}</p>
      )}
    </div>
  );
}

function ToolTestDialog({ serverId, tool, onClose }: { serverId: string; tool: McpTool | null; onClose: () => void }) {
  const [argsText, setArgsText] = useState("{}");
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    setArgsText("{}");
    setResult(null);
  }, [tool?.name]);
  const run = useMutation({
    mutationFn: async () => {
      let args: unknown;
      try {
        args = JSON.parse(argsText || "{}");
      } catch {
        throw new Error("Arguments : JSON invalide");
      }
      if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error("Les arguments doivent être un objet JSON");
      return api.post<unknown>(`/mcp/${serverId}/tools/${encodeURIComponent(tool!.name)}`, { args });
    },
    onSuccess: (r) => setResult(JSON.stringify(r, null, 2)),
    onError: (e) => toast.error(errMsg(e)),
  });
  return (
    <Dialog
      open={!!tool}
      onOpenChange={(v) => !v && onClose()}
      title={`Tester « ${tool?.name ?? ""} »`}
      description="Exécution manuelle par vous : l'outil s'exécute réellement sur le serveur MCP."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
          <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()}>
            <Play /> Exécuter
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {tool?.description ? <p className="text-xs text-fg-muted">{tool.description}</p> : null}
        {tool?.inputSchema ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-fg-muted">Schéma des arguments</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px]">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
          </details>
        ) : null}
        <Field label="Arguments (JSON)">
          <Textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={6} className="font-mono text-xs" />
        </Field>
        {result !== null ? (
          <Field label="Résultat">
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[11px]">{result}</pre>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

function parseLines(text: string, sep: "=" | ":"): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(sep);
    if (i <= 0) return `Ligne invalide : « ${line} » (format attendu KEY${sep === "=" ? "=" : ": "}VALUE)`;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function ServerDialog({ target, onClose, onSaved }: { target: McpServer | "new" | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const editing = target && target !== "new" ? target : null;
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [clearSecrets, setClearSecrets] = useState(false);

  useEffect(() => {
    if (!target) return;
    setName(editing?.name ?? "");
    setTransport(editing?.transport ?? "stdio");
    setCommand(editing?.command ?? "");
    setArgsText((editing?.args ?? []).join("\n"));
    setUrl(editing?.url ?? "");
    setEnvText("");
    setHeadersText("");
    setClearSecrets(false);
  }, [target, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { name: name.trim(), transport };
      if (transport === "stdio") {
        payload.command = command.trim();
        payload.args = argsText.split(/\r?\n/).map((a) => a.trim()).filter(Boolean);
        if (envText.trim()) {
          const env = parseLines(envText, "=");
          if (typeof env === "string") throw new Error(env);
          payload.env = env;
        } else if (clearSecrets) payload.env = {};
      } else {
        payload.url = url.trim();
        if (headersText.trim()) {
          const headers = parseLines(headersText, ":");
          if (typeof headers === "string") throw new Error(headers);
          payload.headers = headers;
        } else if (clearSecrets) payload.headers = {};
      }
      return editing ? api.patch<McpServer>(`/mcp/${editing.id}`, payload) : api.post<McpServer>("/mcp", payload);
    },
    onSuccess: (s) => {
      toast.success(editing ? "Serveur mis à jour" : "Serveur ajouté — cliquez sur « Connecter »");
      onSaved(s.id);
      onClose();
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const valid = name.trim() && (transport === "stdio" ? command.trim() : /^https?:\/\//.test(url.trim()));
  const hasStoredSecret = transport === "stdio" ? editing?.hasEnv : editing?.hasHeaders;

  return (
    <Dialog
      open={!!target}
      onOpenChange={(v) => !v && onClose()}
      title={editing ? `Modifier « ${editing.name} »` : "Ajouter un serveur MCP"}
      description="Les variables d'environnement et en-têtes sont chiffrés au repos et ne sont jamais renvoyés au navigateur."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {editing ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <Field label="Nom">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="filesystem" />
          </Field>
          <Field label="Transport">
            <Select value={transport} onChange={(e) => setTransport(e.target.value as "stdio" | "http")} disabled={!!editing}>
              <option value="stdio">STDIO (local)</option>
              <option value="http">HTTP (distant)</option>
            </Select>
          </Field>
        </div>
        {transport === "stdio" ? (
          <>
            <Field label="Commande" hint="Exemple : npx">
              <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" className="font-mono text-xs" />
            </Field>
            <Field label="Arguments (un par ligne)" hint="Exemple : -y, @modelcontextprotocol/server-filesystem, C:\chemin\vers\dossier">
              <Textarea value={argsText} onChange={(e) => setArgsText(e.target.value)} rows={4} className="font-mono text-xs" placeholder={"-y\n@modelcontextprotocol/server-filesystem\nC:\\Users\\moi\\Documents"} />
            </Field>
            <Field
              label="Variables d'environnement (KEY=VALUE, une par ligne)"
              hint={hasStoredSecret ? "Valeurs enregistrées chiffrées. Laissez vide pour les conserver ; saisissez de nouvelles valeurs pour les remplacer." : "Optionnel. Écriture seule."}
            >
              <Textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={3} className="font-mono text-xs" placeholder="API_TOKEN=…" />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL" hint="Endpoint Streamable HTTP du serveur MCP">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" className="font-mono text-xs" />
            </Field>
            <Field
              label="En-têtes (KEY: VALUE, un par ligne)"
              hint={hasStoredSecret ? "Valeurs enregistrées chiffrées. Laissez vide pour les conserver ; saisissez de nouvelles valeurs pour les remplacer." : "Optionnel. Écriture seule."}
            >
              <Textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} rows={3} className="font-mono text-xs" placeholder="Authorization: Bearer …" />
            </Field>
          </>
        )}
        {hasStoredSecret ? (
          <Switch checked={clearSecrets} onChange={setClearSecrets} label="Effacer les valeurs chiffrées enregistrées (si aucune nouvelle valeur n'est saisie)" />
        ) : null}
        <p className="text-[11px] text-fg-subtle">
          Un serveur STDIO est un programme lancé sur votre machine avec vos droits : n'ajoutez que des serveurs de confiance.
        </p>
      </div>
    </Dialog>
  );
}
