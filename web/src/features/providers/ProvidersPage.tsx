import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cpu, ExternalLink, KeyRound, RefreshCw, Plug, Info, Plus, Terminal, Server, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import type { ModelDTO, ProviderDTO } from "@shared/types";
import { api } from "@/lib/api";
import { qk, useModels, useProviders } from "@/lib/queries";
import { cn, fmtRelative } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/form";
import { Badge, Card, Dialog, Page, PageHeader, Skeleton, StatusDot, Tooltip } from "@/components/ui/primitives";
import { locale, t } from "@/i18n";

const AUTH_LABEL: Record<string, { label: string; icon: React.ReactNode }> = {
  api_key: { label: "Clé API", icon: <KeyRound /> },
  none: { label: "Local, sans clé", icon: <Server /> },
  cli_subscription: { label: "Abonnement via CLI officielle", icon: <Terminal /> },
};

export default function ProvidersPage() {
  const providers = useProviders();
  const models = useModels();
  const [editing, setEditing] = useState<ProviderDTO | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const connected = (providers.data ?? []).filter((p) => p.configured);
  const others = (providers.data ?? []).filter((p) => !p.configured);
  const current = providers.data?.find((p) => p.id === selected) ?? connected[0] ?? null;

  return (
    <Page wide>
      <PageHeader
        icon={<Cpu />}
        title="Models & Providers"
        description={t("Connectez vos fournisseurs d'IA. Les clés sont chiffrées sur votre machine et ne sont jamais envoyées au navigateur.")}
      />
      {providers.isLoading ? (
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold">{t("Connectés")}</h2>
            {connected.length ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {connected.map((p) => (
                  <ProviderCard key={p.id} p={p} active={current?.id === p.id} onSelect={() => setSelected(p.id)} onConfigure={() => setEditing(p)} />
                ))}
              </div>
            ) : (
              <Card className="flex items-start gap-3 p-4 text-[13px] text-fg-muted">
                <Info className="mt-0.5 size-4 shrink-0 text-accent" />
                <div>
                  {t("Aucun fournisseur connecté. Pour utiliser votre")} <b className="text-fg">{t("abonnement Claude Pro/Max")}</b>
                  {t(", connectez « Claude Code » (il faut que la commande")} <code className="font-mono text-xs">claude</code>
                  {t(" soit installée et connectée). Pour un usage gratuit et local, installez Ollama.")}
                </div>
              </Card>
            )}
          </section>

          {current ? <ModelsTable provider={current} models={(models.data ?? []).filter((m) => m.providerId === current.id)} /> : null}

          <section className="space-y-3">
            <h2 className="text-[13px] font-semibold">{t("Disponibles")}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {others.map((p) => (
                <ProviderCard key={p.id} p={p} onConfigure={() => setEditing(p)} />
              ))}
            </div>
          </section>
        </div>
      )}
      {editing ? <ConfigureDialog provider={editing} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}

function ProviderCard({ p, active, onSelect, onConfigure }: { p: ProviderDTO; active?: boolean; onSelect?: () => void; onConfigure: () => void }) {
  const auth = AUTH_LABEL[p.authMode];
  const status: "ok" | "error" | "unknown" = p.status;
  return (
    <Card
      onClick={onSelect}
      className={cn("flex flex-col p-4 transition-colors", onSelect && "cursor-pointer hover:border-border-strong", active && "border-accent/60 ring-1 ring-accent/30")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {p.configured ? <StatusDot status={!p.enabled ? "unknown" : status} /> : null}
            <h3 className="truncate text-[13.5px] font-semibold">{p.name}</h3>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-fg-muted">{p.description}</p>
        </div>
        <Button
          size="sm"
          variant={p.configured ? "ghost" : "primary"}
          onClick={(e) => {
            e.stopPropagation();
            onConfigure();
          }}
        >
          {p.configured ? t("Configurer") : t("Connecter")}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone="outline">
          {auth.icon} {t(auth.label)}
        </Badge>
        {p.configured ? <Badge>{t("{n} modèles", { n: p.modelCount })}</Badge> : null}
        {p.configured && !p.enabled ? <Badge tone="warning">{t("Désactivé")}</Badge> : null}
        {p.secretHint ? <Badge tone="neutral">{p.secretHint}</Badge> : null}
      </div>
      {p.lastError ? <p className="mt-2 line-clamp-3 text-xs text-danger">{p.lastError}</p> : null}
      {p.lastCheckedAt && !p.lastError ? <p className="mt-2 text-[11px] text-fg-subtle">{t("Vérifié {when}", { when: fmtRelative(p.lastCheckedAt) })}</p> : null}
    </Card>
  );
}

function ConfigureDialog({ provider, onClose }: { provider: ProviderDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [secret, setSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [enabled, setEnabled] = useState(provider.configured ? provider.enabled : true);
  const [binaryPath, setBinaryPath] = useState((provider.config.binaryPath as string) ?? "");
  const [useSubscription, setUseSubscription] = useState(provider.config.useSubscription !== false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const isCli = provider.kind === "claude_cli";

  useEffect(() => setTestResult(null), [provider.id]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.providers });
    void qc.invalidateQueries({ queryKey: qk.models });
    void qc.invalidateQueries({ queryKey: qk.status });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { enabled };
      if (secret.trim()) body.secret = secret.trim();
      if (!isCli) body.baseUrl = baseUrl.trim() || null;
      if (isCli) body.config = { binaryPath: binaryPath.trim() || null, useSubscription };
      return api.put<ProviderDTO>(`/providers/${provider.id}`, body);
    },
    onSuccess: invalidate,
  });

  const test = useMutation({
    mutationFn: async () => {
      await save.mutateAsync();
      const result = await api.post<{ ok: boolean; message: string }>(`/providers/${provider.id}/test`);
      if (result.ok && !isCli) {
        const refresh = await api.post<{ added: number; total: number | null; error?: string }>(`/providers/${provider.id}/refresh-models`).catch(() => null);
        if (refresh?.added) result.message += ` ${t("{n} modèle(s) ajouté(s).", { n: refresh.added })}`;
      }
      return result;
    },
    onSuccess: (r) => {
      setTestResult(r);
      setSecret("");
      invalidate();
    },
    onError: (err) => setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) }),
  });

  const remove = useMutation({
    mutationFn: () => api.del(`/providers/${provider.id}`),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={provider.name}
      description={provider.description}
      size="lg"
      footer={
        <>
          {provider.configured ? (
            <Button variant="danger-ghost" className="mr-auto" onClick={() => confirm(t("Retirer cette connexion et sa clé ?")) && remove.mutate()}>
              {t("Déconnecter")}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => test.mutate()} loading={test.isPending}>
            <Plug /> {isCli ? t("Enregistrer et tester (1 court message)") : t("Enregistrer et tester")}
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={provider.requiresSecret && !provider.secretHint && !secret.trim()}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  toast.success(t("Connexion enregistrée"));
                  onClose();
                },
                onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
              })
            }
          >
            {t("Enregistrer")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-fg-muted">
          <p>
            <b className="text-fg">{t("Accès : ")}</b>
            {provider.accessNotes}
          </p>
          <p>
            <b className="text-fg">{t("Abonnements : ")}</b>
            {provider.subscriptionNotes}
          </p>
          <a href={provider.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            {t("Documentation")} <ExternalLink className="size-3" />
          </a>
        </div>

        {provider.requiresSecret || provider.id === "custom-openai" ? (
          <Field
            label={t("Clé API")}
            hint={
              provider.secretHint
                ? t("Clé enregistrée ({hint}). Laissez vide pour la conserver.", { hint: provider.secretHint })
                : t("Stockée chiffrée (AES-256-GCM) dans data/, jamais renvoyée au navigateur.")
            }
          >
            <Input type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={provider.secretHint ? "••••••••" : t("Collez votre clé")} />
          </Field>
        ) : null}

        {!isCli ? (
          <Field label={t("URL de base")} hint={provider.defaultBaseUrl ? t("Par défaut : {url}", { url: provider.defaultBaseUrl }) : t("URL par défaut du SDK")}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={provider.defaultBaseUrl ?? ""} />
          </Field>
        ) : (
          <>
            <Field label={t("Chemin de la commande claude")} hint={t("Laissez vide pour utiliser « claude » du PATH.")}>
              <Input value={binaryPath} onChange={(e) => setBinaryPath(e.target.value)} placeholder="claude" />
            </Field>
            <Switch
              checked={useSubscription}
              onChange={setUseSubscription}
              label={t("Forcer l'abonnement (retire ANTHROPIC_API_KEY de l'environnement de la CLI)")}
            />
          </>
        )}
        <Switch checked={enabled} onChange={setEnabled} label={t("Activé")} />

        {testResult ? (
          <div className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-xs", testResult.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger")}>
            {testResult.ok ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <XCircle className="mt-0.5 size-3.5 shrink-0" />}
            <span className="whitespace-pre-wrap">{testResult.message}</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function PriceInput({ value, onCommit, disabled }: { value: number | null; onCommit: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText(value === null ? "" : String(value)), [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = text.trim() === "" ? null : Number(text.replace(",", "."));
        if (next !== null && (!Number.isFinite(next) || next < 0)) {
          setText(value === null ? "" : String(value));
          return;
        }
        if (next !== value) onCommit(next);
      }}
      placeholder={t("inconnu")}
      className="h-7 w-20 rounded border border-transparent bg-transparent px-1.5 text-right text-xs tabular-nums hover:border-border focus:border-accent/60 focus:outline-none disabled:opacity-60"
    />
  );
}

function ModelsTable({ provider, models }: { provider: ProviderDTO; models: ModelDTO[] }) {
  const qc = useQueryClient();
  const [newModel, setNewModel] = useState("");
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch<ModelDTO>(`/models/${encodeURIComponent(id)}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.models }),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const refresh = useMutation({
    mutationFn: () => api.post<{ added: number; total: number | null; error?: string }>(`/providers/${provider.id}/refresh-models`),
    onSuccess: (r) => {
      if (r.error) toast.error(r.error);
      else if (r.total === null) toast(t("Ce fournisseur ne publie pas de liste de modèles : le catalogue intégré est utilisé."));
      else toast.success(t("{total} modèles trouvés, {added} ajoutés.", { total: r.total, added: r.added }));
      void qc.invalidateQueries({ queryKey: qk.models });
      void qc.invalidateQueries({ queryKey: qk.providers });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const add = useMutation({
    mutationFn: () => api.post<ModelDTO>("/models", { providerId: provider.id, modelId: newModel.trim() }),
    onSuccess: () => {
      setNewModel("");
      void qc.invalidateQueries({ queryKey: qk.models });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const isSubscription = provider.kind === "claude_cli";
  const isLocal = provider.id === "ollama";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-[13px] font-semibold">{t("Modèles — {name}", { name: provider.name })}</h3>
          <p className="text-xs text-fg-muted">
            {isSubscription
              ? t("Usage couvert par l'abonnement : aucun prix n'est appliqué. Le coût affiché ailleurs est l'équivalent API rapporté par Claude Code.")
              : isLocal
                ? t("Modèles locaux : pas de coût par token.")
                : t("Prix en $ par million de tokens. Les prix vides sont « inconnus » : le coût des appels restera inconnu tant qu'ils ne sont pas renseignés.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={newModel} onChange={(e) => setNewModel(e.target.value)} placeholder={t("Ajouter un ID de modèle")} className="h-7 w-52 text-xs" />
          <Button size="sm" onClick={() => add.mutate()} disabled={!newModel.trim()} loading={add.isPending}>
            <Plus /> {t("Ajouter")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} loading={refresh.isPending}>
            <RefreshCw /> {t("Actualiser")}
          </Button>
        </div>
      </div>
      {models.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-fg-subtle">{t("Aucun modèle. Cliquez sur « Actualiser » pour interroger le fournisseur.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-fg-subtle">
                <th className="px-4 py-2 font-medium">{t("Modèle")}</th>
                <th className="px-2 py-2 font-medium">{t("Contexte")}</th>
                <th className="px-2 py-2 font-medium">{t("Capacités")}</th>
                <th className="px-2 py-2 font-medium">{t("Gamme")}</th>
                {!isSubscription && !isLocal ? (
                  <>
                    <th className="px-2 py-2 text-right font-medium">{t("Entrée")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("Sortie")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("Cache lu")}</th>
                    <th className="px-2 py-2 text-right font-medium">{t("Cache écrit")}</th>
                    <th className="px-2 py-2 font-medium">{t("Source du prix")}</th>
                  </>
                ) : null}
                <th className="px-4 py-2 font-medium">{t("Actif")}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-1.5">
                    <div className="font-medium">{m.displayName}</div>
                    <div className="font-mono text-[11px] text-fg-subtle">{m.modelId}</div>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums text-fg-muted">{m.contextWindow ? `${(m.contextWindow / 1000).toLocaleString(locale())}K` : t("inconnu")}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-1">
                      {m.capabilities.vision ? <Badge>{t("images")}</Badge> : null}
                      {m.capabilities.pdf ? <Badge>PDF</Badge> : null}
                      {m.capabilities.effort ? <Badge>effort</Badge> : null}
                      {!m.capabilities.vision && !m.capabilities.pdf ? (
                        <Tooltip content={t("Capacités non déclarées par le fournisseur : seul le texte est envoyé. Activez « images » si le modèle les supporte.")}>
                          <button className="text-[11px] text-fg-subtle underline decoration-dotted" onClick={() => update.mutate({ id: m.id, body: { capabilities: { vision: true } } })}>
                            {t("texte · activer images")}
                          </button>
                        </Tooltip>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      value={m.tier ?? ""}
                      onChange={(e) => update.mutate({ id: m.id, body: { tier: e.target.value || null } })}
                      className="h-7 rounded border border-transparent bg-transparent text-xs text-fg-muted hover:border-border"
                    >
                      <option value="">—</option>
                      <option value="economy">{t("économique")}</option>
                      <option value="balanced">{t("équilibré")}</option>
                      <option value="premium">premium</option>
                    </select>
                  </td>
                  {!isSubscription && !isLocal ? (
                    <>
                      {(["inputPrice", "outputPrice", "cacheReadPrice", "cacheWritePrice"] as const).map((k) => (
                        <td key={k} className="px-2 py-1.5 text-right">
                          <PriceInput value={m[k]} onCommit={(v) => update.mutate({ id: m.id, body: { [k]: v } })} />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-[11px] text-fg-subtle">{m.priceSource ?? "—"}</td>
                    </>
                  ) : null}
                  <td className="px-4 py-1.5">
                    <Switch checked={m.enabled} onChange={(v) => update.mutate({ id: m.id, body: { enabled: v } })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
