import { and, eq, gte, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db/client";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/** Money actually billed via APIs (subscription-equivalent values are excluded on purpose). */
async function billedSince(filter: SQL | undefined, since = 0): Promise<number> {
  const conditions = [eq(schema.usageEvents.costKind, "api_billed"), gte(schema.usageEvents.createdAt, since)];
  if (filter) conditions.push(filter);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.usageEvents.costUsd}), 0)` })
    .from(schema.usageEvents)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

export const warRoomSpend = (id: string) => billedSince(eq(schema.usageEvents.warRoomId, id));
export const agentSpend = (id: string) => billedSince(eq(schema.usageEvents.agentId, id));
export const projectSpend = (id: string) => billedSince(eq(schema.usageEvents.projectId, id));

export function startOfMonth(): number {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const monthSpend = () => billedSince(undefined, startOfMonth());

/** Throws when a hard budget is already exhausted. Called before every model call. */
export async function assertWithinBudget(ctx: { warRoomId?: string | null; agentId?: string | null; projectId?: string | null }) {
  if (ctx.warRoomId) {
    const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, ctx.warRoomId) });
    if (room?.budgetUsd != null) {
      const spent = await warRoomSpend(ctx.warRoomId);
      if (spent >= room.budgetUsd)
        throw new BudgetExceededError(
          `War Room budget reached ($${spent.toFixed(2)} / $${room.budgetUsd.toFixed(2)}). Raise it in the room settings to continue.`,
        );
    }
  }
  if (ctx.agentId) {
    const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, ctx.agentId) });
    if (agent?.budgetUsd != null) {
      const spent = await agentSpend(ctx.agentId);
      if (spent >= agent.budgetUsd)
        throw new BudgetExceededError(`Budget of agent ${agent.name} reached ($${spent.toFixed(2)} / $${agent.budgetUsd.toFixed(2)}).`);
    }
  }
  if (ctx.projectId) {
    const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, ctx.projectId) });
    if (project?.budgetUsd != null) {
      const spent = await projectSpend(ctx.projectId);
      if (spent >= project.budgetUsd)
        throw new BudgetExceededError(`Project budget reached ($${spent.toFixed(2)} / $${project.budgetUsd.toFixed(2)}).`);
    }
  }
  const monthly = await db.query.settings.findFirst({ where: eq(schema.settings.key, "budget.monthlyUsd") });
  if (typeof monthly?.value === "number") {
    const spent = await monthSpend();
    if (spent >= monthly.value)
      throw new BudgetExceededError(`Global monthly API budget reached ($${spent.toFixed(2)} / $${monthly.value.toFixed(2)}).`);
  }
}
