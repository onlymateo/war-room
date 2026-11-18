import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "../db/client";
import { log } from "../lib/logger";
import { estimateTokens } from "../usage/cost";
import type { ChatTurn } from "../providers/types";

type MessageRow = typeof schema.messages.$inferSelect;

export interface ContextOptions {
  /** Soft cap for history sent with each call (estimated tokens). Older turns are dropped / summarized. */
  maxHistoryTokens: number;
  /** Label assistant messages with the agent name (collective threads). */
  agentNames?: Map<string, string>;
}

export const DEFAULT_MAX_HISTORY_TOKENS = 24_000;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, key) });
  return (row?.value as T) ?? fallback;
}

/**
 * Turn stored messages into model turns, newest kept first within the token budget.
 * Only the message being answered carries its real attachments; earlier attachments
 * are referenced by name so documents are not re-sent on every call.
 */
export function messagesToTurns(rows: MessageRow[], opts: ContextOptions, fileNames: Map<string, string>): { turns: ChatTurn[]; dropped: number } {
  const usable = rows.filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim() && m.status !== "pending");
  const kept: ChatTurn[] = [];
  let budget = opts.maxHistoryTokens;
  let dropped = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    let text = m.content;
    if (m.role === "assistant" && m.agentId && opts.agentNames?.has(m.agentId)) {
      text = `[${opts.agentNames.get(m.agentId)}]\n${text}`;
    }
    if (m.attachmentIds.length) {
      const names = m.attachmentIds.map((id) => fileNames.get(id) ?? id).join(", ");
      text = `${text}\n[attachments previously shared: ${names}]`;
    }
    const cost = estimateTokens(text);
    if (cost > budget && kept.length > 0) {
      dropped = i + 1;
      break;
    }
    budget -= cost;
    kept.unshift({ role: m.role as "user" | "assistant", content: [{ type: "text", text }] });
  }
  return { turns: normalizeTurns(kept), dropped };
}

/** Merge consecutive same-role turns and make sure the first turn is from the user. */
export function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = [];
  for (const t of turns) {
    const prev = out[out.length - 1];
    if (prev && prev.role === t.role) prev.content.push(...t.content);
    else out.push({ role: t.role, content: [...t.content] });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

export async function loadHistory(conversationId: string, excludeIds: string[] = []) {
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, conversationId) });
  const where = conv?.summaryUpTo
    ? and(eq(schema.messages.conversationId, conversationId), gt(schema.messages.createdAt, conv.summaryUpTo))
    : eq(schema.messages.conversationId, conversationId);
  const rows = await db.select().from(schema.messages).where(where).orderBy(asc(schema.messages.createdAt));
  return { conv, rows: rows.filter((r) => !excludeIds.includes(r.id)) };
}

export async function fileNameMap(rows: MessageRow[]) {
  const ids = [...new Set(rows.flatMap((r) => r.attachmentIds))];
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const files = await db.select({ id: schema.files.id, name: schema.files.name }).from(schema.files);
  for (const f of files) if (ids.includes(f.id)) map.set(f.id, f.name);
  return map;
}

/**
 * Context compression: when the stored history exceeds the threshold, older messages
 * are summarized once (with the configured summary model) and replaced by that summary
 * in future calls. The full history stays in the database and in the UI.
 */
export async function maybeCompress(
  conversationId: string,
  summarize: (text: string) => Promise<string | null>,
): Promise<boolean> {
  const threshold = await getSetting<number>("context.compressThresholdTokens", 32_000);
  const { conv, rows } = await loadHistory(conversationId);
  if (!conv) return false;
  const usable = rows.filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim());
  const total = usable.reduce((n, m) => n + estimateTokens(m.content), 0);
  if (total < threshold || usable.length < 8) return false;

  // Keep the most recent ~40% verbatim, summarize the rest.
  const keepFrom = Math.floor(usable.length * 0.6);
  const toSummarize = usable.slice(0, keepFrom);
  const cutoff = toSummarize[toSummarize.length - 1].createdAt;
  const transcript = [
    conv.summary ? `Previous summary:\n${conv.summary}\n` : "",
    ...toSummarize.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
  ].join("\n\n");
  try {
    const summary = await summarize(transcript);
    if (!summary) return false;
    await db
      .update(schema.conversations)
      .set({ summary, summaryUpTo: cutoff })
      .where(eq(schema.conversations.id, conversationId));
    return true;
  } catch (err) {
    log.warn("Context compression failed", err);
    return false;
  }
}

export const SUMMARY_SYSTEM_PROMPT =
  "You compress conversation history for later reuse by AI agents. Write a dense, factual summary: decisions made, constraints, open questions, key facts, names, numbers and file names. No preamble. Use short bullet points. Never invent anything.";
