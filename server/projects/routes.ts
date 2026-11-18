import { Hono } from "hono";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { body, notFound } from "../lib/http";
import { newId, now } from "../lib/ids";
import { logActivity } from "../activity/log";
import { projectSpend } from "../usage/budget";

export const projectRoutes = new Hono();

const projectInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  objectives: z.string().max(10_000).optional(),
  status: z.enum(["active", "paused", "done", "archived"]).optional(),
  budgetUsd: z.number().min(0).nullable().optional(),
});

projectRoutes.get("/projects", async (c) => {
  const rows = await db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt));
  const taskStats = await db
    .select({ projectId: schema.tasks.projectId, status: schema.tasks.status, n: sql<number>`count(*)` })
    .from(schema.tasks)
    .groupBy(schema.tasks.projectId, schema.tasks.status);
  const roomCounts = await db
    .select({ projectId: schema.warRooms.projectId, n: sql<number>`count(*)` })
    .from(schema.warRooms)
    .groupBy(schema.warRooms.projectId);
  return c.json(
    await Promise.all(
      rows.map(async (p) => {
        const stats = taskStats.filter((t) => t.projectId === p.id);
        const total = stats.reduce((n, s) => n + Number(s.n), 0);
        const done = Number(stats.find((s) => s.status === "done")?.n ?? 0);
        return {
          ...p,
          taskTotal: total,
          taskDone: done,
          warRoomCount: Number(roomCounts.find((r) => r.projectId === p.id)?.n ?? 0),
          spentUsd: await projectSpend(p.id),
        };
      }),
    ),
  );
});

projectRoutes.post("/projects", async (c) => {
  const input = await body(c, projectInput);
  const ts = now();
  const id = newId("proj");
  await db.insert(schema.projects).values({
    id,
    name: input.name,
    description: input.description ?? "",
    objectives: input.objectives ?? "",
    status: input.status ?? "active",
    budgetUsd: input.budgetUsd ?? null,
    createdAt: ts,
    updatedAt: ts,
  });
  await logActivity({ type: "project_created", summary: `Project "${input.name}" created`, projectId: id });
  return c.json(await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }));
});

projectRoutes.get("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const project = await db.query.projects.findFirst({ where: eq(schema.projects.id, id) });
  if (!project) notFound("Project");
  const rooms = await db.select().from(schema.warRooms).where(eq(schema.warRooms.projectId, id));
  const decisions = await db
    .select()
    .from(schema.memories)
    .where(sql`${schema.memories.scope} = 'project' and ${schema.memories.scopeId} = ${id} and ${schema.memories.kind} = 'decision'`);
  const activity = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.projectId, id))
    .orderBy(desc(schema.activity.createdAt))
    .limit(50);
  return c.json({ project, rooms, decisions, activity, spentUsd: await projectSpend(id) });
});

projectRoutes.patch("/projects/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, projectInput.partial());
  await db.update(schema.projects).set({ ...input, updatedAt: now() }).where(eq(schema.projects.id, id));
  return c.json(await db.query.projects.findFirst({ where: eq(schema.projects.id, id) }));
});

projectRoutes.delete("/projects/:id", async (c) => {
  const id = c.req.param("id");
  // War Rooms and tasks are kept, just detached from the project.
  await db.update(schema.warRooms).set({ projectId: null }).where(eq(schema.warRooms.projectId, id));
  await db.update(schema.tasks).set({ projectId: null }).where(eq(schema.tasks.projectId, id));
  await db.delete(schema.projects).where(eq(schema.projects.id, id));
  return c.json({ ok: true });
});
