import {
  Bot, Brain, Code2, Search, Palette, Shield, CheckCircle2, BarChart3, BookOpen, Server, Users, Megaphone, Scale, Crown,
  Sparkles, Wrench, FileText, type LucideIcon,
} from "lucide-react";
import type { ModelDTO, UsageSummary } from "@shared/types";
import { cn, COST_KIND_LABEL, fmtPct, fmtTokens, fmtUsd, fmtMs } from "@/lib/utils";
import { Badge, Tooltip } from "./ui/primitives";
import { Select } from "./ui/form";
import { useUsableModels } from "@/lib/queries";

export const AGENT_ICONS: Record<string, LucideIcon> = {
  bot: Bot, brain: Brain, code: Code2, search: Search, palette: Palette, shield: Shield, check: CheckCircle2, chart: BarChart3,
  book: BookOpen, server: Server, users: Users, megaphone: Megaphone, scale: Scale, crown: Crown, sparkles: Sparkles, wrench: Wrench, file: FileText,
};

export const AGENT_COLORS: Record<string, string> = {
  slate: "bg-slate-500/15 text-slate-300 dark:text-slate-300 text-slate-600",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  cyan: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-300",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
};

export function AgentAvatar({ icon, color, size = "md", className }: { icon: string; color: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const Icon = AGENT_ICONS[icon] ?? Bot;
  const dims = { sm: "size-6 [&_svg]:size-3.5 rounded-md", md: "size-8 [&_svg]:size-4 rounded-lg", lg: "size-11 [&_svg]:size-5 rounded-xl" }[size];
  return (
    <div className={cn("flex shrink-0 items-center justify-center", dims, AGENT_COLORS[color] ?? AGENT_COLORS.slate, className)}>
      <Icon />
    </div>
  );
}

export function modelLabel(models: ModelDTO[], providerId: string | null, modelId: string | null) {
  if (!providerId || !modelId) return "aucun modèle";
  return models.find((m) => m.providerId === providerId && m.modelId === modelId)?.displayName ?? modelId;
}

/**
 * Model selector limited to connected providers. Value is "providerId::modelId".
 */
export function ModelPicker({
  providerId,
  modelId,
  onChange,
  allowNone,
  noneLabel = "Hériter de l'orchestrateur",
  className,
}: {
  providerId: string | null;
  modelId: string | null;
  onChange: (providerId: string | null, modelId: string | null) => void;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}) {
  const { models, providers, isLoading } = useUsableModels();
  const value = providerId && modelId ? `${providerId}::${modelId}` : "";
  const groups = providers.filter((p) => models.some((m) => m.providerId === p.id));
  const currentMissing = value && !models.some((m) => `${m.providerId}::${m.modelId}` === value);
  return (
    <Select
      className={className}
      value={value}
      disabled={isLoading}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return onChange(null, null);
        const [p, ...rest] = v.split("::");
        onChange(p, rest.join("::"));
      }}
    >
      {allowNone || !value ? <option value="">{isLoading ? "Chargement…" : allowNone ? noneLabel : groups.length ? "Choisir un modèle" : "Aucun fournisseur connecté"}</option> : null}
      {currentMissing ? <option value={value}>{modelId} (fournisseur indisponible)</option> : null}
      {groups.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {models
            .filter((m) => m.providerId === p.id)
            .map((m) => (
              <option key={m.id} value={`${m.providerId}::${m.modelId}`}>
                {m.displayName}
                {m.tier ? ` · ${m.tier}` : ""}
              </option>
            ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** Compact usage line under a message: exact provider numbers, unknown shown as unknown. */
export function UsageLine({ usage, className }: { usage: UsageSummary; className?: string }) {
  const ctxRatio = usage.contextTokens !== null && usage.contextWindow ? usage.contextTokens / usage.contextWindow : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle tabular-nums", className)}>
      <Tooltip content="Tokens d'entrée (non mis en cache) rapportés par le fournisseur">
        <span>↑ {fmtTokens(usage.inputTokens, { compact: true })}</span>
      </Tooltip>
      <Tooltip content="Tokens de sortie rapportés par le fournisseur">
        <span>↓ {fmtTokens(usage.outputTokens, { compact: true })}</span>
      </Tooltip>
      {usage.cacheReadTokens ? (
        <Tooltip content="Tokens lus depuis le cache (facturés à tarif réduit)">
          <span>cache {fmtTokens(usage.cacheReadTokens, { compact: true })}</span>
        </Tooltip>
      ) : null}
      {ctxRatio !== null ? (
        <Tooltip content={`Contexte envoyé : ${fmtTokens(usage.contextTokens)} / ${fmtTokens(usage.contextWindow)} tokens`}>
          <span>ctx {fmtPct(ctxRatio)}</span>
        </Tooltip>
      ) : null}
      <CostTag costUsd={usage.costUsd} costKind={usage.costKind} />
      <span>{fmtMs(usage.latencyMs)}</span>
    </div>
  );
}

export function CostTag({ costUsd, costKind }: { costUsd: number | null; costKind: string }) {
  if (costKind === "subscription") {
    return (
      <Tooltip content="Inclus dans votre abonnement : aucun coût facturé. Valeur équivalente API rapportée par Claude Code, à titre indicatif.">
        <span>abonnement{costUsd !== null ? ` (≈${fmtUsd(costUsd)} éq. API)` : ""}</span>
      </Tooltip>
    );
  }
  if (costKind === "local") return <span>local</span>;
  if (costKind === "unknown") {
    return (
      <Tooltip content="Prix du modèle ou tokens non disponibles. Renseignez le prix dans Models & Providers.">
        <span>coût inconnu</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Coût calculé à partir des tokens rapportés par le fournisseur et du prix du modèle">
      <span>{fmtUsd(costUsd)}</span>
    </Tooltip>
  );
}

export function CostKindBadge({ kind }: { kind: string }) {
  const tone = kind === "api_billed" ? "accent" : kind === "subscription" ? "success" : kind === "local" ? "neutral" : "warning";
  return <Badge tone={tone}>{COST_KIND_LABEL[kind] ?? kind}</Badge>;
}

export const AUTONOMY_LABEL = { assisted: "Assisté", semi: "Semi-autonome", autonomous: "Autonome" } as const;
export const AUTONOMY_HINT = {
  assisted: "Chaque plan de l'orchestrateur attend votre accord avant d'être exécuté.",
  semi: "L'orchestrateur répartit seul le travail, mais demande votre accord dès qu'il mobilise 3 agents ou plus.",
  autonomous: "L'orchestrateur distribue et exécute sans validation (dans les limites de budget et d'appels).",
} as const;
export const STRATEGY_LABEL = { quality: "Qualité maximale", balanced: "Équilibré", economy: "Économique", strict: "Budget strict" } as const;
export const STRATEGY_HINT = {
  quality: "Modèles premium et plus d'agents par question. Meilleures réponses, coût et latence les plus élevés.",
  balanced: "Modèles premium seulement pour le raisonnement difficile ; seuls les agents pertinents sont sollicités.",
  economy: "Modèles moins chers ; l'orchestrateur répond lui-même quand il le peut. Coût réduit, un peu moins de profondeur.",
  strict: "Modèles les moins chers, un agent au maximum par question. Coût minimal ; réponses moins approfondies sur les sujets complexes.",
} as const;
