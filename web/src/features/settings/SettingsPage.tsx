import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Settings, ShieldCheck, Keyboard, Sun, Moon, Save, Database } from "lucide-react";
import { api } from "@/lib/api";
import { qk, useSettings, useSystemStatus } from "@/lib/queries";
import { Card, CardHeader, Kbd, Page, PageHeader, Skeleton } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/form";
import { ModelPicker } from "@/components/domain";
import { useTheme } from "@/components/layout/AppShell";

type ModelRef = { providerId: string; modelId: string } | null;

const DEFAULTS = {
  "context.maxHistoryTokens": 24_000,
  "context.compressThresholdTokens": 32_000,
  "orchestration.maxCallsPerRun": 12,
  "orchestration.maxToolRounds": 8,
};

function useSaveSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api.put(`/settings/${encodeURIComponent(key)}`, { value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      toast.success("Paramètre enregistré");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
}

function Row({ title, description, children }: { title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_minmax(0,340px)] md:items-center">
      <div>
        <div className="text-[13px] font-medium">{title}</div>
        {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Text/number input with explicit save (no save on every keystroke). */
function SettingInput({
  settingKey,
  value,
  type = "text",
  placeholder,
  nullable,
  min,
  suffix,
}: {
  settingKey: string;
  value: unknown;
  type?: "text" | "number";
  placeholder?: string;
  nullable?: boolean;
  min?: number;
  suffix?: string;
}) {
  const save = useSaveSetting();
  const initial = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const dirty = draft !== initial;
  const submit = () => {
    if (type === "number") {
      if (draft.trim() === "") {
        if (!nullable) return toast.error("Valeur requise");
        return save.mutate({ key: settingKey, value: null });
      }
      const num = Number(draft);
      if (!Number.isFinite(num)) return toast.error("Nombre invalide");
      return save.mutate({ key: settingKey, value: settingKey === "budget.monthlyUsd" ? num : Math.round(num) });
    }
    save.mutate({ key: settingKey, value: draft.trim() });
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="relative flex-1">
        <Input type={type} value={draft} min={min} step={settingKey === "budget.monthlyUsd" ? "0.01" : "1"} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
        {suffix ? <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">{suffix}</span> : null}
      </div>
      <Button type="submit" size="sm" variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={save.isPending}>
        <Save /> Enregistrer
      </Button>
    </form>
  );
}

function BoolSetting({ settingKey, value, label }: { settingKey: string; value: boolean; label: string }) {
  const save = useSaveSetting();
  return <Switch checked={value} onChange={(v) => save.mutate({ key: settingKey, value: v })} label={label} />;
}

/** Stored as a 0..1 fraction, edited as a percentage. */
function PercentSetting({ settingKey, value }: { settingKey: string; value: number }) {
  const save = useSaveSetting();
  const initial = String(Math.round(value * 100));
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(draft);
        if (!Number.isFinite(n) || n < 1 || n > 100) return toast.error("Entre 1 et 100");
        save.mutate({ key: settingKey, value: n / 100 });
      }}
    >
      <div className="relative flex-1">
        <Input type="number" min={1} max={100} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">%</span>
      </div>
      <Button type="submit" size="sm" variant={draft !== initial ? "primary" : "secondary"} disabled={draft === initial} loading={save.isPending}>
        <Save /> Enregistrer
      </Button>
    </form>
  );
}

function ModelSetting({ settingKey, value }: { settingKey: string; value: ModelRef }) {
  const save = useSaveSetting();
  return (
    <ModelPicker
      providerId={value?.providerId ?? null}
      modelId={value?.modelId ?? null}
      allowNone
      noneLabel="Modèle de l'orchestrateur / de la conversation"
      onChange={(providerId, modelId) => save.mutate({ key: settingKey, value: providerId && modelId ? { providerId, modelId } : null })}
    />
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const status = useSystemStatus();
  const theme = useTheme();
  const s = settings.data ?? {};

  return (
    <Page>
      <PageHeader title="Settings" description="Préférences, optimisation des coûts et sécurité. Tout est stocké localement." icon={<Settings />} />

      {settings.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Profil & apparence" />
            <div className="divide-y divide-border">
              <Row title="Nom affiché" description="Affiché en bas de la barre latérale.">
                <SettingInput settingKey="user.displayName" value={s["user.displayName"] ?? ""} placeholder="Vous" />
              </Row>
              <Row title="Thème" description="Le thème sombre est le thème principal.">
                <Button variant="secondary" onClick={theme.toggle}>
                  {theme.dark ? <Sun /> : <Moon />} Passer en thème {theme.dark ? "clair" : "sombre"}
                </Button>
              </Row>
            </div>
          </Card>

          <Card>
            <CardHeader title="Budget" description="Seules les dépenses API réelles sont comptées ; l'usage couvert par un abonnement est exclu." />
            <div className="divide-y divide-border">
              <Row
                title="Budget mensuel global"
                description="Au-delà, tout appel facturé est bloqué jusqu'au mois suivant. Laisser vide pour aucune limite. Les budgets par War Room, agent et projet se règlent dans leurs paramètres."
              >
                <SettingInput settingKey="budget.monthlyUsd" value={s["budget.monthlyUsd"]} type="number" nullable min={0} placeholder="Aucune limite" suffix="USD" />
              </Row>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Limites de l'abonnement Claude"
              description="Le gardien surveille les fenêtres 5 h et hebdomadaire rapportées par Claude Code, et met le travail en pause proprement avant la coupure."
            />
            <div className="divide-y divide-border">
              <Row title="Gardien des limites" description="Désactivé, les appels continuent jusqu'au refus de Claude (le travail est alors quand même mis en pause).">
                <BoolSetting settingKey="limits.guardEnabled" value={(s["limits.guardEnabled"] as boolean | undefined) ?? true} label="Activé" />
              </Row>
              <Row title="Seuil d'alerte" description="Bandeau d'avertissement au-delà de ce niveau, ou quand le rythme actuel mène au seuil de pause dans l'heure.">
                <PercentSetting settingKey="limits.warnAt" value={(s["limits.warnAt"] as number | undefined) ?? 0.8} />
              </Row>
              <Row title="Seuil de pause" description="Au-delà, les nouveaux appels Claude sont retenus et le travail en cours est mis en pause jusqu'à la réinitialisation.">
                <PercentSetting settingKey="limits.pauseAt" value={(s["limits.pauseAt"] as number | undefined) ?? 0.95} />
              </Row>
            </div>
          </Card>

          <Card>
            <CardHeader title="Rapports d'avancement" description="Un rapport par War Room active, chaque jour, construit à partir des données (aucun appel à une IA)." />
            <div className="divide-y divide-border">
              <Row title="Rapport quotidien">
                <BoolSetting settingKey="reports.dailyEnabled" value={(s["reports.dailyEnabled"] as boolean | undefined) ?? true} label="Activé" />
              </Row>
              <Row title="Heure du rapport" description="Si WAR ROOM était éteint à cette heure, le rapport est créé au prochain démarrage.">
                <SettingInput settingKey="reports.dailyHour" value={s["reports.dailyHour"] ?? 8} type="number" min={0} suffix="h" />
              </Row>
            </div>
          </Card>

          <Card>
            <CardHeader title="Contexte & optimisation des coûts" description="Réduit les tokens envoyés à chaque appel sans perdre l'historique (conservé en base)." />
            <div className="divide-y divide-border">
              <Row
                title="Historique envoyé par appel"
                description={`Plafond estimé (≈ 4 caractères par token) de l'historique transmis à un modèle. Les messages plus anciens sont omis ou résumés. Défaut : ${DEFAULTS["context.maxHistoryTokens"].toLocaleString("fr-FR")}.`}
              >
                <SettingInput
                  settingKey="context.maxHistoryTokens"
                  value={s["context.maxHistoryTokens"] ?? DEFAULTS["context.maxHistoryTokens"]}
                  type="number"
                  min={2000}
                  suffix="tokens"
                />
              </Row>
              <Row
                title="Seuil de compression"
                description={`Au-delà de cette taille estimée, les anciens messages d'une conversation sont résumés une fois par le modèle de résumé. Défaut : ${DEFAULTS["context.compressThresholdTokens"].toLocaleString("fr-FR")}.`}
              >
                <SettingInput
                  settingKey="context.compressThresholdTokens"
                  value={s["context.compressThresholdTokens"] ?? DEFAULTS["context.compressThresholdTokens"]}
                  type="number"
                  min={4000}
                  suffix="tokens"
                />
              </Row>
              <Row
                title="Modèle de routage"
                description="Modèle utilisé par l'orchestrateur pour choisir les agents (appel court). Un modèle économique suffit en général."
              >
                <ModelSetting settingKey="optimizer.routingModel" value={(s["optimizer.routingModel"] as ModelRef) ?? null} />
              </Row>
              <Row title="Modèle de résumé" description="Modèle utilisé pour compresser les historiques longs. Un modèle économique suffit en général.">
                <ModelSetting settingKey="optimizer.summaryModel" value={(s["optimizer.summaryModel"] as ModelRef) ?? null} />
              </Row>
              <Row
                title="Appels maximum par message"
                description={`Garde-fou contre les boucles d'orchestration : au-delà, l'exécution s'arrête. Défaut : ${DEFAULTS["orchestration.maxCallsPerRun"]}.`}
              >
                <SettingInput
                  settingKey="orchestration.maxCallsPerRun"
                  value={s["orchestration.maxCallsPerRun"] ?? DEFAULTS["orchestration.maxCallsPerRun"]}
                  type="number"
                  min={1}
                  suffix="appels"
                />
              </Row>
              <Row
                title="Tours d'outils MCP maximum par réponse"
                description={`Nombre maximum d'allers-retours modèle ↔ outils pour une même réponse d'agent (API). Défaut : ${DEFAULTS["orchestration.maxToolRounds"]}.`}
              >
                <SettingInput
                  settingKey="orchestration.maxToolRounds"
                  value={s["orchestration.maxToolRounds"] ?? DEFAULTS["orchestration.maxToolRounds"]}
                  type="number"
                  min={1}
                  suffix="tours"
                />
              </Row>
              <Row title="Modèle d'amélioration des prompts" description="Utilisé par le bouton « Améliorer » des conversations. Par défaut : le modèle économique le moins cher disponible.">
                <ModelSetting settingKey="optimizer.promptModel" value={(s["optimizer.promptModel"] as ModelRef) ?? null} />
              </Row>
            </div>
          </Card>

          <Card>
            <CardHeader title="Raccourcis clavier" />
            <div className="divide-y divide-border text-[13px]">
              {[
                [["Ctrl", "K"], "Recherche globale et navigation"],
                [["Ctrl", "B"], "Replier / déplier la barre latérale"],
                [["Ctrl", "Shift", "O"], "Nouveau chat"],
                [["Entrée"], "Envoyer le message"],
                [["Shift", "Entrée"], "Nouvelle ligne dans le message"],
              ].map(([keys, label]) => (
                <div key={label as string} className="flex items-center justify-between px-4 py-2.5">
                  <span className="flex items-center gap-2 text-fg-muted">
                    <Keyboard className="size-3.5" /> {label as string}
                  </span>
                  <span className="flex items-center gap-1">
                    {(keys as string[]).map((k) => (
                      <Kbd key={k}>{k}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Sécurité & données" />
            <div className="space-y-3 px-4 py-4 text-[13px] text-fg-muted">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <span>
                  L'API de WAR ROOM écoute uniquement sur <code className="rounded bg-surface-3 px-1 font-mono text-xs text-fg">127.0.0.1</code> : elle n'est pas joignable depuis le
                  réseau, et les requêtes venant d'autres sites ouverts dans votre navigateur sont refusées.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <span>
                  Les clés API et les secrets des serveurs MCP sont chiffrés (AES-256-GCM) avec une clé maître stockée dans{" "}
                  <code className="rounded bg-surface-3 px-1 font-mono text-xs text-fg">data/master.key</code>. Ils ne sont jamais envoyés au navigateur ni écrits dans les journaux.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <span>
                  Les documents importés et les réponses des autres agents sont transmis aux modèles comme des données, jamais comme des instructions. Les outils MCP sensibles
                  exigent votre confirmation.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <Database className="mt-0.5 size-4 shrink-0" />
                <span>
                  Dossier de données :{" "}
                  <code className="break-all rounded bg-surface-3 px-1 font-mono text-xs text-fg">{status.data?.dataDir ?? "inconnu"}</code> (base SQLite, fichiers, Skills WAR
                  ROOM). Sauvegardez ce dossier pour conserver vos données.
                </span>
              </p>
              {status.data ? <p className="text-xs text-fg-subtle">Version {status.data.version}</p> : null}
            </div>
          </Card>
        </div>
      )}
    </Page>
  );
}
