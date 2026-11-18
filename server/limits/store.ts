import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { log } from "../lib/logger";
import { logActivity } from "../activity/log";
import type { PausedWorkDTO } from "../../shared/types";

type Row = typeof schema.pausedWork.$inferSelect;

export async function createPausedWork(input: {
  kind: "chat" | "collective";
  warRoomId: string | null;
  conversationId: string;
  agentId?: string | null;
  title: string;
  payload: Record<string, unknown>;
  reason: string;
  resetsAt: number | null;
}): Promise<Row> {
  const ts = now();
  const row: Row = {
    id: newId("pause"),
    kind: input.kind,
    warRoomId: input.warRoomId,
    conversationId: input.conversationId,
    agentId: input.agentId ?? null,
    title: input.title.slice(0, 200),
    payload: input.payload,
    reason: input.reason,
    resetsAt: input.resetsAt,
    // Already past the reset (e.g. unknown reset time): ready immediately.
    status: input.resetsAt !== null && input.resetsAt <= ts ? "ready" : "paused",
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(schema.pausedWork).values(row);
  await logActivity({ type: "limit_paused", summary: `Mis en pause (limite Claude) : ${row.title}`, warRoomId: row.warRoomId, agentId: row.agentId, data: { reason: row.reason, resetsAt: row.resetsAt } });
  return row;
}

export async function toPausedDTO(rows: Row[]): Promise<PausedWorkDTO[]> {
  const roomIds = [...new Set(rows.map((r) => r.warRoomId).filter((x): x is string => !!x))];
  const rooms = roomIds.length ? await db.select({ id: schema.warRooms.id, name: schema.warRooms.name }).from(schema.warRooms).where(inArray(schema.warRooms.id, roomIds)) : [];
  const convIds = rows.map((r) => r.conversationId);
  const convs = convIds.length ? await db.select({ id: schema.conversations.id, kind: schema.conversations.kind }).from(schema.conversations).where(inArray(schema.conversations.id, convIds)) : [];
  return rows.map((r) => {
    const conv = convs.find((c) => c.id === r.conversationId);
    const href =
      conv?.kind === "chat"
        ? `/chats/${r.conversationId}?resume=${r.id}`
        : conv?.kind === "agent" && r.warRoomId && r.agentId
          ? `/warrooms/${r.warRoomId}/agents/${r.agentId}?resume=${r.id}`
          : r.warRoomId
            ? `/warrooms/${r.warRoomId}?tab=collective&resume=${r.id}`
            : "/";
    return {
      id: r.id,
      kind: r.kind,
      warRoomId: r.warRoomId,
      warRoomName: rooms.find((x) => x.id === r.warRoomId)?.name ?? null,
      conversationId: r.conversationId,
      agentId: r.agentId,
      title: r.title,
      reason: r.reason,
      resetsAt: r.resetsAt,
      status: r.status,
      href,
      createdAt: r.createdAt,
    };
  });
}

export async function listPausedWork(statuses: Row["status"][] = ["paused", "ready"]) {
  return db.select().from(schema.pausedWork).where(inArray(schema.pausedWork.status, statuses)).orderBy(desc(schema.pausedWork.createdAt));
}

export async function setPausedStatus(id: string, status: Row["status"]) {
  await db.update(schema.pausedWork).set({ status, updatedAt: now() }).where(eq(schema.pausedWork.id, id));
}

/** Runs every minute: paused work whose quota window has reset becomes "ready" (the UI then asks the user). */
export async function tickPausedWork() {
  try {
    const due = await db
      .select()
      .from(schema.pausedWork)
      .where(and(eq(schema.pausedWork.status, "paused"), lte(schema.pausedWork.resetsAt, now())));
    if (!due.length) return;
    await db.update(schema.pausedWork).set({ status: "ready", updatedAt: now() }).where(inArray(schema.pausedWork.id, due.map((d) => d.id)));
    const rooms = [...new Set(due.map((d) => d.warRoomId))];
    for (const room of rooms) {
      const n = due.filter((d) => d.warRoomId === room).length;
      await logActivity({ type: "limit_reset", summary: `Limites Claude réinitialisées : ${n} travail(aux) en pause peuvent reprendre`, warRoomId: room });
    }
  } catch (err) {
    log.warn("tickPausedWork failed", err);
  }
}
