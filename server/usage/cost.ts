import type { CostKind } from "../../shared/types";
import type { ProviderUsage } from "../providers/types";

export interface ModelPrice {
  inputPrice: number | null;
  outputPrice: number | null;
  cacheReadPrice: number | null;
  cacheWritePrice: number | null;
}

export interface CostResult {
  costUsd: number | null;
  costKind: CostKind;
  /** Total prompt size seen by the model for this call (exact, from provider counts). */
  contextTokens: number | null;
}

/**
 * Turn provider-reported usage into a cost figure, without inventing anything:
 * - subscription: costUsd is the API-equivalent value the tool reported (or null); no money is spent.
 * - local: no per-token cost.
 * - api_billed: provider-reported cost if given, else tokens x known price; if any needed
 *   number is missing the cost is null and costKind is "unknown".
 *
 * `inputIncludesCached` — OpenAI-style APIs count cached tokens inside prompt_tokens;
 * Anthropic reports uncached input separately from cache reads/writes.
 */
export function computeCost(
  providerCostKind: "api_billed" | "subscription" | "local",
  usage: ProviderUsage | null,
  price: ModelPrice | null,
  inputIncludesCached: boolean,
): CostResult {
  const input = usage?.inputTokens ?? null;
  const cacheRead = usage?.cacheReadTokens ?? 0;
  const cacheWrite = usage?.cacheWriteTokens ?? 0;
  const contextTokens = input === null ? null : inputIncludesCached ? input : input + cacheRead + cacheWrite;

  if (providerCostKind === "subscription") {
    return { costUsd: usage?.reportedCostUsd ?? null, costKind: "subscription", contextTokens };
  }
  if (providerCostKind === "local") return { costUsd: 0, costKind: "local", contextTokens };

  if (typeof usage?.reportedCostUsd === "number") {
    return { costUsd: usage.reportedCostUsd, costKind: "api_billed", contextTokens };
  }
  const output = usage?.outputTokens ?? null;
  if (input === null || output === null || !price || price.inputPrice === null || price.outputPrice === null) {
    return { costUsd: null, costKind: "unknown", contextTokens };
  }
  const uncachedInput = inputIncludesCached ? Math.max(0, input - cacheRead) : input;
  const readPrice = cacheRead > 0 ? price.cacheReadPrice : 0;
  const writePrice = cacheWrite > 0 ? price.cacheWritePrice : 0;
  if (readPrice === null || writePrice === null) {
    return { costUsd: null, costKind: "unknown", contextTokens };
  }
  const cost =
    (uncachedInput * price.inputPrice + output * price.outputPrice + cacheRead * readPrice + cacheWrite * writePrice) /
    1_000_000;
  return { costUsd: Math.round(cost * 1e8) / 1e8, costKind: "api_billed", contextTokens };
}

/** Rough token estimate for text we have not sent yet (≈4 chars/token). Always labelled as an estimate in the UI. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
