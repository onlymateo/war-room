import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, body, notFound } from "../lib/http";
import { logActivity } from "../activity/log";
import { createSecret, deleteSecret, listSecrets, updateSecret } from "./service";
import { serverLang, tx } from "../lib/i18n";

/** War Room secrets API. Values are write-only: no route ever returns them. */
export const secretRoutes = new Hono();

const ids = z.array(z.string().max(64)).max(100);

secretRoutes.get("/warrooms/:id/secrets", async (c) => c.json(await listSecrets(c.req.param("id"))));

secretRoutes.post("/warrooms/:id/secrets", async (c) => {
  const roomId = c.req.param("id");
  if (!(await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, roomId) }))) notFound("War Room");
  const input = await body(
    c,
    z.object({
      name: z.string().min(2).max(64),
      value: z.string().min(1).max(20_000),
      description: z.string().max(500).optional(),
      agentIds: ids.optional(),
      serverIds: ids.optional(),
      requireApproval: z.boolean().optional(),
    }),
  );
  try {
    const s = await createSecret(roomId, input);
    await logActivity({ type: "secret_added", summary: tx(await serverLang(), `Clé secrète ${s.name} ajoutée`, `Secret key ${s.name} added`), warRoomId: roomId });
    return c.json(s);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : String(err));
  }
});

secretRoutes.patch("/secrets/:id", async (c) => {
  const input = await body(
    c,
    z.object({
      value: z.string().min(1).max(20_000).optional(),
      description: z.string().max(500).optional(),
      agentIds: ids.optional(),
      serverIds: ids.optional(),
      requireApproval: z.boolean().optional(),
    }),
  );
  const s = await updateSecret(c.req.param("id"), input);
  if (!s) notFound(tx(await serverLang(), "Clé", "Key"));
  if (input.value) await logActivity({ type: "secret_updated", summary: tx(await serverLang(), `Valeur de la clé ${s!.name} remplacée`, `Value of key ${s!.name} replaced`), warRoomId: s!.warRoomId });
  return c.json(s);
});

secretRoutes.delete("/secrets/:id", async (c) => {
  const row = await db.query.roomSecrets.findFirst({ where: eq(schema.roomSecrets.id, c.req.param("id")) });
  if (!row) notFound(tx(await serverLang(), "Clé", "Key"));
  await deleteSecret(row!.id);
  await logActivity({ type: "secret_removed", summary: tx(await serverLang(), `Clé secrète ${row!.name} supprimée`, `Secret key ${row!.name} deleted`), warRoomId: row!.warRoomId });
  return c.json({ ok: true });
});
