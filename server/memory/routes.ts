import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, like, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client";
import { body, notFound } from "../lib/http";
import { newId, now } from "../lib/ids";

export const memoryRoutes = new Hono();

const scope = z.enum(["global", "project", "warroom", "agent", "conversation"]);
const kind = z.enum(["fact", "decision", "constraint", "summary", "note"]);

memoryRoutes.get("/memories", async (c) => {
  const conds: SQL[] = [];
  const s = c.req.query("scope");
  const scopeId = c.req.query("scopeId");
  const q = c.req.query("q");
  if (s) conds.push(eq(schema.memories.scope, s as z.infer<typeof scope>));
  if (scopeId) conds.push(eq(schema.memories.scopeId, scopeId));
  if (q) conds.push(like(schema.memories.content, `%${q}%`));
  const rows = await db
    .select()
    .from(schema.memories)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.memories.updatedAt))
    .limit(500);
  return c.json(rows);
});

memoryRoutes.post("/memories", async (c) => {
  const input = await body(c, z.object({ scope, scopeId: z.string().nullable().optional(), kind, content: z.string().min(1).max(20_000), source: z.string().max(100).optional() }));
  const ts = now();
  const id = newId("mem");
  await db.insert(schema.memories).values({ id, scope: input.scope, scopeId: input.scopeId ?? null, kind: input.kind, content: input.content, source: input.source ?? "user", createdAt: ts, updatedAt: ts });
  return c.json(await db.query.memories.findFirst({ where: eq(schema.memories.id, id) }));
});

memoryRoutes.patch("/memories/:id", async (c) => {
  const input = await body(c, z.object({ kind: kind.optional(), content: z.string().min(1).max(20_000).optional() }));
  await db.update(schema.memories).set({ ...input, updatedAt: now() }).where(eq(schema.memories.id, c.req.param("id")));
  const row = await db.query.memories.findFirst({ where: eq(schema.memories.id, c.req.param("id")) });
  if (!row) notFound("Memory");
  return c.json(row);
});

memoryRoutes.delete("/memories/:id", async (c) => {
  await db.delete(schema.memories).where(eq(schema.memories.id, c.req.param("id")));
  return c.json({ ok: true });
});
