import { Hono } from "hono";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, body, notFound, sseRun } from "../lib/http";
import { now } from "../lib/ids";
import { getModel } from "../providers/registry";
import { createChat, deleteConversation, listChats, sendChatMessage, toMessageDTO } from "./service";

export const chatRoutes = new Hono();

const paramsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().max(200_000).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  })
  .partial();

chatRoutes.get("/chats", async (c) => {
  const rows = await listChats({ archived: c.req.query("archived") === "1", q: c.req.query("q") });
  return c.json(rows);
});

chatRoutes.post("/chats", async (c) => {
  const input = await body(
    c,
    z.object({
      title: z.string().max(200).optional(),
      providerId: z.string(),
      modelId: z.string(),
      systemPrompt: z.string().max(50_000).optional(),
      params: paramsSchema.optional(),
    }),
  );
  if (!(await getModel(input.providerId, input.modelId))) badRequest("Unknown model");
  return c.json(await createChat(input));
});

chatRoutes.get("/conversations/:id", async (c) => {
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, c.req.param("id")) });
  if (!conv) notFound("Conversation");
  const msgs = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conv!.id))
    .orderBy(asc(schema.messages.createdAt));
  return c.json({ conversation: conv, messages: msgs.map(toMessageDTO) });
});

chatRoutes.patch("/conversations/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(
    c,
    z.object({
      title: z.string().min(1).max(200).optional(),
      archived: z.boolean().optional(),
      providerId: z.string().optional(),
      modelId: z.string().optional(),
      systemPrompt: z.string().max(50_000).optional(),
      params: paramsSchema.optional(),
    }),
  );
  if (input.providerId && input.modelId && !(await getModel(input.providerId, input.modelId))) badRequest("Unknown model");
  await db.update(schema.conversations).set({ ...input, updatedAt: now() }).where(eq(schema.conversations.id, id));
  return c.json(await db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) }));
});

chatRoutes.delete("/conversations/:id", async (c) => {
  await deleteConversation(c.req.param("id"));
  return c.json({ ok: true });
});

/** Send a message in a classic chat; the reply streams back as SSE. */
chatRoutes.post("/chats/:id/messages", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, z.object({ content: z.string().max(400_000), attachmentIds: z.array(z.string()).max(20).default([]) }));
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, id) });
  if (!conv || conv.kind !== "chat") notFound("Chat");
  if (!conv!.providerId || !conv!.modelId) badRequest("Choose a model for this conversation first.");
  if (!input.content.trim() && input.attachmentIds.length === 0) badRequest("Empty message");
  return sseRun(c, (emit, signal) =>
    sendChatMessage({
      conversationId: id,
      content: input.content,
      attachmentIds: input.attachmentIds,
      setup: {
        providerId: conv!.providerId!,
        modelId: conv!.modelId!,
        system: conv!.systemPrompt,
        params: conv!.params,
      },
      emit,
      signal,
    }),
  );
});
