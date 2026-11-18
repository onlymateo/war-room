import fs from "node:fs";
import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, like, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, body, notFound } from "../lib/http";
import { FileRejectedError, absolutePath, deleteFile, storeUpload, toFileDTO } from "./service";

export const fileRoutes = new Hono();

fileRoutes.get("/files", async (c) => {
  const conds: SQL[] = [];
  const projectId = c.req.query("projectId");
  const warRoomId = c.req.query("warRoomId");
  const q = c.req.query("q");
  if (projectId) conds.push(eq(schema.files.projectId, projectId));
  if (warRoomId) conds.push(eq(schema.files.warRoomId, warRoomId));
  if (q) conds.push(like(schema.files.name, `%${q}%`));
  const rows = await db
    .select()
    .from(schema.files)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.files.createdAt))
    .limit(500);
  return c.json(rows.map(toFileDTO));
});

fileRoutes.post("/files", async (c) => {
  const form = await c.req.parseBody({ all: true });
  const raw = form["file"];
  const list = (Array.isArray(raw) ? raw : [raw]).filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!list.length) badRequest("No file in the upload (field name: file)");
  const scope = {
    projectId: typeof form.projectId === "string" ? form.projectId : null,
    warRoomId: typeof form.warRoomId === "string" ? form.warRoomId : null,
    conversationId: typeof form.conversationId === "string" ? form.conversationId : null,
  };
  try {
    const out = [];
    for (const f of list) out.push(await storeUpload(f, scope));
    return c.json(out);
  } catch (err) {
    if (err instanceof FileRejectedError) badRequest(err.message);
    throw err;
  }
});

fileRoutes.get("/files/:id", async (c) => {
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, c.req.param("id")) });
  if (!row) notFound("File");
  return c.json({ ...toFileDTO(row!), textPreview: row!.textContent?.slice(0, 20_000) ?? null });
});

/** Raw content. `?download=1` forces a download; otherwise inline (for previews). */
fileRoutes.get("/files/:id/content", async (c) => {
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, c.req.param("id")) });
  if (!row) notFound("File");
  const p = absolutePath(row!);
  if (!fs.existsSync(p)) notFound("File content");
  const download = c.req.query("download") === "1";
  // Never render user-uploaded HTML/SVG inline on our origin.
  const unsafeInline = /html|svg|xml|javascript/i.test(row!.mime);
  const disposition = download || unsafeInline ? "attachment" : "inline";
  return new Response(fs.readFileSync(p), {
    headers: {
      "Content-Type": unsafeInline ? "application/octet-stream" : row!.mime,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(row!.name)}`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});

fileRoutes.patch("/files/:id", async (c) => {
  const input = await body(
    c,
    z.object({ tags: z.array(z.string().max(40)).max(30).optional(), projectId: z.string().nullable().optional(), warRoomId: z.string().nullable().optional() }),
  );
  await db.update(schema.files).set(input).where(eq(schema.files.id, c.req.param("id")));
  const row = await db.query.files.findFirst({ where: eq(schema.files.id, c.req.param("id")) });
  if (!row) notFound("File");
  return c.json(toFileDTO(row!));
});

fileRoutes.delete("/files/:id", async (c) => {
  await deleteFile(c.req.param("id"));
  return c.json({ ok: true });
});
