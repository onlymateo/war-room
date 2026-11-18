import { Hono } from "hono";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { body, notFound } from "../lib/http";
import { now } from "../lib/ids";
import { getProviderDef } from "./catalog";
import {
  deleteConnection,
  getProvider,
  listProviders,
  refreshModels,
  saveConnection,
  testConnection,
  toModelDTO,
} from "./registry";

export const providerRoutes = new Hono();

providerRoutes.get("/providers", async (c) => c.json(await listProviders()));

providerRoutes.put("/providers/:id", async (c) => {
  const id = c.req.param("id");
  try {
    getProviderDef(id);
  } catch {
    notFound("Provider");
  }
  const input = await body(
    c,
    z.object({
      secret: z.string().max(500).nullable().optional(),
      baseUrl: z.string().url().max(500).nullable().optional().or(z.literal("")),
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }),
  );
  await saveConnection(id, input);
  return c.json(await getProvider(id));
});

providerRoutes.delete("/providers/:id", async (c) => {
  await deleteConnection(c.req.param("id"));
  return c.json({ ok: true });
});

providerRoutes.post("/providers/:id/test", async (c) => c.json(await testConnection(c.req.param("id"))));

providerRoutes.post("/providers/:id/refresh-models", async (c) => {
  try {
    return c.json(await refreshModels(c.req.param("id")));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

providerRoutes.get("/models", async (c) => {
  const providerId = c.req.query("provider");
  const rows = providerId
    ? await db.select().from(schema.models).where(eq(schema.models.providerId, providerId)).orderBy(asc(schema.models.displayName))
    : await db.select().from(schema.models).orderBy(asc(schema.models.providerId), asc(schema.models.displayName));
  return c.json(rows.map(toModelDTO));
});

/** User edits: prices (marked as user-provided), context window, capabilities, enabled. */
providerRoutes.patch("/models/:id", async (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const existing = await db.query.models.findFirst({ where: eq(schema.models.id, id) });
  if (!existing) notFound("Model");
  const input = await body(
    c,
    z.object({
      enabled: z.boolean().optional(),
      contextWindow: z.number().int().positive().nullable().optional(),
      inputPrice: z.number().min(0).nullable().optional(),
      outputPrice: z.number().min(0).nullable().optional(),
      cacheReadPrice: z.number().min(0).nullable().optional(),
      cacheWritePrice: z.number().min(0).nullable().optional(),
      tier: z.enum(["economy", "balanced", "premium"]).nullable().optional(),
      capabilities: z
        .object({ vision: z.boolean().optional(), pdf: z.boolean().optional(), temperature: z.boolean().optional(), effort: z.boolean().optional() })
        .optional(),
    }),
  );
  const priceTouched = ["inputPrice", "outputPrice", "cacheReadPrice", "cacheWritePrice"].some((k) => k in input);
  await db
    .update(schema.models)
    .set({
      ...input,
      capabilities: input.capabilities ? { ...existing!.capabilities, ...input.capabilities } : existing!.capabilities,
      ...(priceTouched ? { priceSource: "user" } : {}),
      updatedAt: now(),
    })
    .where(eq(schema.models.id, id));
  return c.json(toModelDTO((await db.query.models.findFirst({ where: eq(schema.models.id, id) }))!));
});

providerRoutes.post("/models", async (c) => {
  const input = await body(
    c,
    z.object({ providerId: z.string(), modelId: z.string().min(1).max(200), displayName: z.string().max(200).optional(), contextWindow: z.number().int().positive().nullable().optional() }),
  );
  getProviderDef(input.providerId);
  const id = `${input.providerId}:${input.modelId}`;
  await db
    .insert(schema.models)
    .values({
      id,
      providerId: input.providerId,
      modelId: input.modelId,
      displayName: input.displayName || input.modelId,
      contextWindow: input.contextWindow ?? null,
      capabilities: { streaming: true },
      source: "manual",
      enabled: true,
      updatedAt: now(),
    })
    .onConflictDoNothing();
  return c.json(toModelDTO((await db.query.models.findFirst({ where: eq(schema.models.id, id) }))!));
});
