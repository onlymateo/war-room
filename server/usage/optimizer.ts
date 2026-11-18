import { db, schema } from "../db/client";
import { usableProviderIds } from "../providers/registry";
import type { CostStrategy } from "../../shared/types";

type ModelRow = typeof schema.models.$inferSelect;
type Tier = "economy" | "balanced" | "premium";

const ORDER: Tier[] = ["economy", "balanced", "premium"];

/** Shift the requested tier according to the room's cost strategy. */
export function adjustTier(tier: Tier, strategy: CostStrategy): Tier {
  const i = ORDER.indexOf(tier);
  if (strategy === "quality") return ORDER[Math.min(2, i + 1)];
  if (strategy === "economy") return ORDER[Math.max(0, i - 1)];
  if (strategy === "strict") return "economy";
  return tier;
}

/**
 * Pick a model for an agent: same provider as the orchestrator when possible,
 * matching tier, cheapest known price within the tier. Returns null when nothing
 * suitable is connected (the caller then falls back to the orchestrator's model).
 */
export function pickModelFromList(models: ModelRow[], usable: string[], tier: Tier, preferredProvider: string | null): ModelRow | null {
  const candidates = models.filter((m) => m.enabled && usable.includes(m.providerId));
  if (!candidates.length) return null;
  const score = (m: ModelRow) =>
    (m.providerId === preferredProvider ? 0 : 10) + (m.tier === tier ? 0 : m.tier ? Math.abs(ORDER.indexOf(m.tier) - ORDER.indexOf(tier)) * 3 : 5);
  return [...candidates].sort((a, b) => score(a) - score(b) || (a.inputPrice ?? 99) - (b.inputPrice ?? 99))[0];
}

export async function pickModel(tier: Tier, strategy: CostStrategy, preferredProvider: string | null) {
  const usable = await usableProviderIds();
  const models = await db.select().from(schema.models);
  return pickModelFromList(models, usable, adjustTier(tier, strategy), preferredProvider);
}

export const STRATEGY_EXPLANATIONS: Record<CostStrategy, { label: string; tradeoff: string }> = {
  quality: { label: "Maximum quality", tradeoff: "Premium models and more agents per question. Best answers, highest cost and latency." },
  balanced: { label: "Balanced", tradeoff: "Premium models only for hard reasoning, mid-tier elsewhere; only relevant agents are called." },
  economy: { label: "Economy", tradeoff: "Cheaper models, the orchestrator answers directly when it can. Lower cost, slightly lower depth." },
  strict: { label: "Strict budget", tradeoff: "Cheapest models, at most one agent per question. Lowest cost; complex topics get shallower answers." },
};
