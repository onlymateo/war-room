import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/crypto";
import { now } from "../lib/ids";
import type { ModelDTO, ProviderDTO } from "../../shared/types";
import { PROVIDERS, getProviderDef } from "./catalog";
import { anthropicAdapter } from "./anthropic";
import { claudeCliAdapter } from "./claude-cli";
import { createOpenAICompatibleAdapter } from "./openai-compatible";
import type { ProviderAdapter, ProviderDefinition, ResolvedCredentials } from "./types";
import { ProviderError } from "./types";

const adapters = new Map<string, ProviderAdapter>();

export function getAdapter(providerId: string): ProviderAdapter {
  const cached = adapters.get(providerId);
  if (cached) return cached;
  const def = getProviderDef(providerId);
  const adapter =
    def.kind === "anthropic" ? anthropicAdapter : def.kind === "claude_cli" ? claudeCliAdapter : createOpenAICompatibleAdapter(def);
  adapters.set(providerId, adapter);
  return adapter;
}

export async function resolveCredentials(providerId: string): Promise<ResolvedCredentials> {
  const row = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.id, providerId) });
  const def = getProviderDef(providerId);
  if (!row && def.requiresSecret) throw new ProviderError(`${def.name} is not configured. Add it under Models & Providers.`, "auth");
  if (row && !row.enabled) throw new ProviderError(`${def.name} is disabled.`, "auth");
  return {
    secret: row?.encryptedSecret ? decryptSecret(row.encryptedSecret) : null,
    baseUrl: row?.baseUrl ?? null,
    config: row?.config ?? {},
  };
}

/** Upsert catalog models at startup. User-edited prices (priceSource = "user") are preserved. */
export async function seedCatalog() {
  const ts = now();
  for (const def of PROVIDERS) {
    for (const m of def.catalog) {
      const id = `${def.id}:${m.modelId}`;
      const existing = await db.query.models.findFirst({ where: eq(schema.models.id, id) });
      const priceFields =
        existing?.priceSource === "user"
          ? {}
          : {
              inputPrice: m.price?.input ?? null,
              outputPrice: m.price?.output ?? null,
              cacheReadPrice: m.price?.cacheRead ?? null,
              cacheWritePrice: m.price?.cacheWrite ?? null,
              priceSource: m.price?.source ?? null,
            };
      if (existing) {
        await db
          .update(schema.models)
          .set({
            displayName: m.displayName,
            contextWindow: m.contextWindow,
            maxOutputTokens: m.maxOutputTokens,
            capabilities: m.capabilities,
            tier: m.tier,
            ...priceFields,
            updatedAt: ts,
          })
          .where(eq(schema.models.id, id));
      } else {
        await db.insert(schema.models).values({
          id,
          providerId: def.id,
          modelId: m.modelId,
          displayName: m.displayName,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          capabilities: m.capabilities,
          tier: m.tier,
          source: "catalog",
          enabled: true,
          inputPrice: m.price?.input ?? null,
          outputPrice: m.price?.output ?? null,
          cacheReadPrice: m.price?.cacheRead ?? null,
          cacheWritePrice: m.price?.cacheWrite ?? null,
          priceSource: m.price?.source ?? null,
          updatedAt: ts,
        });
      }
    }
  }
}

function toProviderDTO(def: ProviderDefinition, row: typeof schema.providerConnections.$inferSelect | undefined, modelCount: number): ProviderDTO {
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    authMode: def.authMode,
    description: def.description,
    accessNotes: def.accessNotes,
    subscriptionNotes: def.subscriptionNotes,
    docsUrl: def.docsUrl,
    defaultBaseUrl: def.defaultBaseUrl,
    requiresSecret: def.requiresSecret,
    configured: !!row,
    enabled: row?.enabled ?? false,
    secretHint: row?.secretHint ?? null,
    baseUrl: row?.baseUrl ?? null,
    config: row?.config ?? {},
    status: row?.status ?? "unknown",
    lastError: row?.lastError ?? null,
    lastCheckedAt: row?.lastCheckedAt ?? null,
    modelCount,
  };
}

export async function listProviders(): Promise<ProviderDTO[]> {
  const rows = await db.select().from(schema.providerConnections);
  const counts = await db
    .select({ providerId: schema.models.providerId, n: sql<number>`count(*)` })
    .from(schema.models)
    .groupBy(schema.models.providerId);
  return PROVIDERS.map((def) =>
    toProviderDTO(
      def,
      rows.find((r) => r.id === def.id),
      counts.find((c) => c.providerId === def.id)?.n ?? 0,
    ),
  );
}

export async function getProvider(id: string): Promise<ProviderDTO> {
  return (await listProviders()).find((p) => p.id === id)!;
}

export async function saveConnection(
  id: string,
  input: { secret?: string | null; baseUrl?: string | null; enabled?: boolean; config?: Record<string, unknown> },
) {
  const def = getProviderDef(id);
  const ts = now();
  const existing = await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.id, id) });
  const secretFields =
    input.secret === undefined
      ? {}
      : input.secret === null || input.secret === ""
        ? { encryptedSecret: null, secretHint: null }
        : { encryptedSecret: encryptSecret(input.secret.trim()), secretHint: maskSecret(input.secret.trim()) };
  const values = {
    ...secretFields,
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl || null } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.config !== undefined ? { config: { ...(existing?.config ?? {}), ...input.config } } : {}),
    status: "unknown" as const,
    lastError: null,
    updatedAt: ts,
  };
  if (existing) {
    await db.update(schema.providerConnections).set(values).where(eq(schema.providerConnections.id, id));
  } else {
    await db.insert(schema.providerConnections).values({ id, enabled: true, config: {}, createdAt: ts, ...values });
  }
  return toProviderDTO(def, await db.query.providerConnections.findFirst({ where: eq(schema.providerConnections.id, id) }), 0);
}

export async function deleteConnection(id: string) {
  await db.delete(schema.providerConnections).where(eq(schema.providerConnections.id, id));
  await db.delete(schema.models).where(and(eq(schema.models.providerId, id), eq(schema.models.source, "discovered")));
}

async function setStatus(id: string, status: "ok" | "error", lastError: string | null) {
  await db
    .update(schema.providerConnections)
    .set({ status, lastError, lastCheckedAt: now() })
    .where(eq(schema.providerConnections.id, id));
}

export async function testConnection(id: string): Promise<{ ok: boolean; message: string }> {
  try {
    const creds = await resolveCredentials(id);
    const message = await getAdapter(id).test(creds);
    await setStatus(id, "ok", null);
    return { ok: true, message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(id, "error", message);
    return { ok: false, message };
  }
}

/** Fetch the provider's model list and store new models (no prices invented: they start unknown). */
export async function refreshModels(id: string): Promise<{ added: number; total: number | null }> {
  const creds = await resolveCredentials(id);
  const found = await getAdapter(id).listModels(creds);
  if (!found) return { added: 0, total: null };
  const ts = now();
  let added = 0;
  for (const m of found) {
    const rowId = `${id}:${m.modelId}`;
    const existing = await db.query.models.findFirst({ where: eq(schema.models.id, rowId) });
    if (existing) {
      if (existing.source === "discovered" && m.contextWindow && !existing.contextWindow) {
        await db.update(schema.models).set({ contextWindow: m.contextWindow, updatedAt: ts }).where(eq(schema.models.id, rowId));
      }
      continue;
    }
    added++;
    await db.insert(schema.models).values({
      id: rowId,
      providerId: id,
      modelId: m.modelId,
      displayName: m.displayName,
      contextWindow: m.contextWindow ?? null,
      maxOutputTokens: m.maxOutputTokens ?? null,
      capabilities: { streaming: true },
      source: "discovered",
      enabled: true,
      updatedAt: ts,
    });
  }
  await setStatus(id, "ok", null);
  return { added, total: found.length };
}

export function toModelDTO(row: typeof schema.models.$inferSelect): ModelDTO {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    displayName: row.displayName,
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    capabilities: row.capabilities,
    inputPrice: row.inputPrice,
    outputPrice: row.outputPrice,
    cacheReadPrice: row.cacheReadPrice,
    cacheWritePrice: row.cacheWritePrice,
    priceSource: row.priceSource,
    tier: row.tier ?? null,
    source: row.source,
    enabled: row.enabled,
  };
}

export async function getModel(providerId: string, modelId: string) {
  return db.query.models.findFirst({ where: eq(schema.models.id, `${providerId}:${modelId}`) });
}

/** Providers the user can actually call right now (configured + enabled, or keyless local/CLI ones). */
export async function usableProviderIds(): Promise<string[]> {
  const rows = await db.select().from(schema.providerConnections);
  return rows.filter((r) => r.enabled).map((r) => r.id);
}
