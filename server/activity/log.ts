import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { log } from "../lib/logger";

export async function logActivity(entry: {
  type: string;
  summary: string;
  warRoomId?: string | null;
  projectId?: string | null;
  agentId?: string | null;
  data?: Record<string, unknown>;
}) {
  try {
    await db.insert(schema.activity).values({
      id: newId("act"),
      type: entry.type,
      summary: entry.summary.slice(0, 500),
      warRoomId: entry.warRoomId ?? null,
      projectId: entry.projectId ?? null,
      agentId: entry.agentId ?? null,
      data: entry.data ?? null,
      createdAt: now(),
    });
  } catch (err) {
    log.warn("activity log failed", err);
  }
}
