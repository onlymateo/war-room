import { Hono } from "hono";
import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, body } from "../lib/http";
import { callModel } from "../runtime/llm";
import { getSetting } from "../memory/context";
import { pickModel } from "../usage/optimizer";
import { getModel } from "../providers/registry";

/**
 * Prompt improvement: a cheap model rewrites the user's draft before it is sent
 * to the (usually more expensive) target model. One short call; nothing is sent
 * to the target until the user accepts the rewrite.
 */
export const promptRoutes = new Hono();

const IMPROVER_SYSTEM = `You improve prompts that a user is about to send to an AI assistant (or a team of AI agents).
Rewrite the draft so the assistant can answer well on the first try:
- keep the user's intent, language (reply in the draft's language), tone and every constraint;
- make the request explicit: goal, relevant context, expected output format or length when implied;
- remove filler and ambiguity; use short structure (lines or bullets) only if it helps;
- do NOT add new requirements, assumptions or facts the user did not imply; if something essential is missing, add at most one short bracketed placeholder like [préciser X];
- do NOT answer the prompt;
- if the draft is already clear and specific, return it almost unchanged;
- keep it concise: the rewrite should rarely be more than twice as long as the draft.
Output only the rewritten prompt, nothing else.`;

const MAX_CONTEXT_CHARS = 2_000;

promptRoutes.post("/prompt/improve", async (c) => {
  const input = await body(
    c,
    z.object({
      text: z.string().min(1).max(20_000),
      conversationId: z.string().optional(),
      warRoomId: z.string().optional(),
      agentId: z.string().optional(),
    }),
  );

  // Short context so the rewrite fits the conversation, kept small on purpose (cost).
  const contextParts: string[] = [];
  let preferredProvider: string | null = null;
  if (input.warRoomId) {
    const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, input.warRoomId) });
    const agents = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, input.warRoomId)).orderBy(asc(schema.agents.position));
    if (room) {
      contextParts.push(`Target: War Room "${room.name}"${room.objective ? ` — objective: ${room.objective}` : ""}.`);
      contextParts.push(`Agents: ${agents.map((a) => `${a.name}${a.function ? ` (${a.function})` : ""}`).join(", ")}. The user may address agents with @Name.`);
    }
    preferredProvider = agents.find((a) => a.role === "orchestrator")?.providerId ?? null;
  }
  if (input.agentId) {
    const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, input.agentId) });
    if (agent) {
      contextParts.push(`Target: agent "${agent.name}" — ${agent.function || agent.description}.`);
      preferredProvider = agent.providerId ?? preferredProvider;
    }
  }
  if (input.conversationId) {
    const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, input.conversationId) });
    preferredProvider = conv?.providerId ?? preferredProvider;
    const recent = await db
      .select({ role: schema.messages.role, content: schema.messages.content })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, input.conversationId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(4);
    let budget = MAX_CONTEXT_CHARS;
    const lines: string[] = [];
    for (const m of recent) {
      if (budget <= 0 || !m.content.trim()) continue;
      const excerpt = m.content.slice(0, Math.min(600, budget));
      budget -= excerpt.length;
      lines.unshift(`${m.role}: ${excerpt}${m.content.length > excerpt.length ? "…" : ""}`);
    }
    if (lines.length) contextParts.push(`Recent conversation (excerpt):\n${lines.join("\n")}`);
  }

  const configured = await getSetting<{ providerId: string; modelId: string } | null>("optimizer.promptModel", null);
  const target = configured && (await getModel(configured.providerId, configured.modelId)) ? configured : await pickModel("economy", "strict", preferredProvider);
  if (!target) badRequest("Aucun modèle disponible pour améliorer le prompt.");

  const userContent = [contextParts.length ? `<context>\n${contextParts.join("\n")}\n</context>` : "", `<draft>\n${input.text}\n</draft>`]
    .filter(Boolean)
    .join("\n\n");
  const result = await callModel({
    providerId: target!.providerId,
    modelId: target!.modelId,
    system: IMPROVER_SYSTEM,
    messages: [{ role: "user", content: [{ type: "text", text: userContent }] }],
    params: { effort: "low", maxTokens: 4_000 },
    context: { conversationId: input.conversationId ?? null, warRoomId: input.warRoomId ?? null, agentId: null, purpose: "prompt" },
  });
  const improved = result.text.trim().replace(/^<draft>\s*|\s*<\/draft>$/g, "");
  return c.json({ improved, providerId: target!.providerId, modelId: target!.modelId, usage: result.usage });
});
