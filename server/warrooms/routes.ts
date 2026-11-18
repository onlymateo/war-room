import { Hono } from "hono";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { badRequest, body, notFound, sseRun } from "../lib/http";
import { newId, now } from "../lib/ids";
import { logActivity } from "../activity/log";
import { getModel } from "../providers/registry";
import { sendChatMessage, toMessageDTO } from "../chat/service";
import { decidePlan, loadRoom, runCollective, setupFor } from "../orchestration/engine";
import { agentSystemPrompt } from "../orchestration/prompts";
import { analyzeBrief, applyAnalysis } from "./analysis";
import { warRoomSpend, agentSpend } from "../usage/budget";
import { DEFAULT_PERMISSIONS } from "../../shared/types";

export const warRoomRoutes = new Hono();

const paramsSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().max(200_000).optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  })
  .partial();

const permissionsSchema = z.object({
  readWarRoomContext: z.boolean(),
  readFiles: z.boolean(),
  useMcp: z.boolean(),
  dispatchWithoutApproval: z.boolean(),
});

const agentInput = z.object({
  name: z.string().min(1).max(80),
  icon: z.string().max(40).optional(),
  color: z.string().max(20).optional(),
  description: z.string().max(4000).optional(),
  function: z.string().max(300).optional(),
  personality: z.string().max(2000).optional(),
  providerId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  systemPrompt: z.string().max(50_000).optional(),
  params: paramsSchema.optional(),
  skills: z.array(z.string().max(120)).max(50).optional(),
  mcpServers: z.array(z.string()).max(50).optional(),
  memory: z.string().max(50_000).optional(),
  tokenLimit: z.number().int().positive().nullable().optional(),
  budgetUsd: z.number().min(0).nullable().optional(),
  priority: z.number().int().min(0).max(10).optional(),
  permissions: permissionsSchema.optional(),
});

async function assertModel(providerId?: string | null, modelId?: string | null) {
  if (providerId && modelId && !(await getModel(providerId, modelId))) badRequest(`Unknown model ${providerId}/${modelId}`);
}

// ------------------------------------------------------------------ rooms

warRoomRoutes.get("/warrooms", async (c) => {
  const rooms = await db.select().from(schema.warRooms).orderBy(desc(schema.warRooms.updatedAt));
  const agentCounts = await db
    .select({ warRoomId: schema.agents.warRoomId, n: sql<number>`count(*)` })
    .from(schema.agents)
    .groupBy(schema.agents.warRoomId);
  const taskCounts = await db
    .select({ warRoomId: schema.tasks.warRoomId, status: schema.tasks.status, n: sql<number>`count(*)` })
    .from(schema.tasks)
    .groupBy(schema.tasks.warRoomId, schema.tasks.status);
  const orchestrators = await db.select().from(schema.agents).where(eq(schema.agents.role, "orchestrator"));
  return c.json(
    await Promise.all(
      rooms.map(async (r) => ({
        ...r,
        agentCount: agentCounts.find((a) => a.warRoomId === r.id)?.n ?? 0,
        openTasks: taskCounts.filter((t) => t.warRoomId === r.id && t.status !== "done").reduce((n, t) => n + t.n, 0),
        orchestrator: orchestrators.find((o) => o.warRoomId === r.id) ?? null,
        spentUsd: await warRoomSpend(r.id),
      })),
    ),
  );
});

warRoomRoutes.post("/warrooms", async (c) => {
  const input = await body(
    c,
    z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(4000).default(""),
      objective: z.string().max(4000).default(""),
      brief: z.string().max(100_000).default(""),
      projectId: z.string().nullable().optional(),
      autonomy: z.enum(["assisted", "semi", "autonomous"]).default("semi"),
      costStrategy: z.enum(["quality", "balanced", "economy", "strict"]).default("balanced"),
      budgetUsd: z.number().min(0).nullable().optional(),
      maxAgentsPerTurn: z.number().int().min(1).max(10).default(3),
      communication: z.string().max(2000).default(""),
      fileIds: z.array(z.string()).max(50).default([]),
      orchestrator: agentInput.extend({ name: z.string().min(1).max(80) }),
    }),
  );
  await assertModel(input.orchestrator.providerId, input.orchestrator.modelId);
  if (!input.orchestrator.providerId || !input.orchestrator.modelId) badRequest("Choose a model for the orchestrator.");
  const ts = now();
  const roomId = newId("room");
  await db.insert(schema.warRooms).values({
    id: roomId,
    projectId: input.projectId ?? null,
    name: input.name,
    description: input.description,
    objective: input.objective,
    brief: input.brief,
    autonomy: input.autonomy,
    costStrategy: input.costStrategy,
    budgetUsd: input.budgetUsd ?? null,
    maxAgentsPerTurn: input.maxAgentsPerTurn,
    communication: input.communication,
    sharedMemory: "",
    analysis: null,
    status: "active",
    createdAt: ts,
    updatedAt: ts,
  });
  const o = input.orchestrator;
  await db.insert(schema.agents).values({
    id: newId("agent"),
    warRoomId: roomId,
    role: "orchestrator",
    name: o.name,
    icon: o.icon ?? "crown",
    color: o.color ?? "amber",
    description: o.description ?? "",
    function: o.function ?? "Orchestrator",
    personality: o.personality ?? "",
    providerId: o.providerId ?? null,
    modelId: o.modelId ?? null,
    systemPrompt: o.systemPrompt ?? "",
    params: o.params ?? {},
    skills: o.skills ?? [],
    mcpServers: o.mcpServers ?? [],
    memory: "",
    tokenLimit: o.tokenLimit ?? null,
    budgetUsd: o.budgetUsd ?? null,
    priority: 10,
    permissions: o.permissions ?? { ...DEFAULT_PERMISSIONS, dispatchWithoutApproval: false },
    position: 0,
    createdAt: ts,
    updatedAt: ts,
  });
  await db.insert(schema.conversations).values({
    id: newId("conv"),
    kind: "warroom",
    warRoomId: roomId,
    agentId: null,
    title: `${input.name} — collective`,
    params: {},
    systemPrompt: "",
    archived: false,
    createdAt: ts,
    updatedAt: ts,
  });
  if (input.fileIds.length) {
    await db.update(schema.files).set({ warRoomId: roomId }).where(inArray(schema.files.id, input.fileIds));
  }
  await logActivity({ type: "room_created", summary: `War Room "${input.name}" created with orchestrator ${o.name}`, warRoomId: roomId, projectId: input.projectId });
  return c.json({ id: roomId });
});

warRoomRoutes.get("/warrooms/:id", async (c) => {
  const id = c.req.param("id");
  const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, id) });
  if (!room) notFound("War Room");
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, id)).orderBy(asc(schema.agents.position));
  const conv = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.warRoomId, id), eq(schema.conversations.kind, "warroom")) });
  const spend = await warRoomSpend(id);
  const agentSpends = Object.fromEntries(await Promise.all(agents.map(async (a) => [a.id, await agentSpend(a.id)] as const)));
  return c.json({ room, agents, collectiveConversationId: conv?.id ?? null, spentUsd: spend, agentSpentUsd: agentSpends });
});

warRoomRoutes.patch("/warrooms/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(
    c,
    z.object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(4000).optional(),
      objective: z.string().max(4000).optional(),
      brief: z.string().max(100_000).optional(),
      projectId: z.string().nullable().optional(),
      autonomy: z.enum(["assisted", "semi", "autonomous"]).optional(),
      costStrategy: z.enum(["quality", "balanced", "economy", "strict"]).optional(),
      budgetUsd: z.number().min(0).nullable().optional(),
      maxAgentsPerTurn: z.number().int().min(1).max(10).optional(),
      communication: z.string().max(2000).optional(),
      sharedMemory: z.string().max(100_000).optional(),
      status: z.enum(["active", "paused", "archived"]).optional(),
    }),
  );
  await db.update(schema.warRooms).set({ ...input, updatedAt: now() }).where(eq(schema.warRooms.id, id));
  if (input.projectId !== undefined) {
    // Keep the room's tasks attached to the same project as the room.
    await db.update(schema.tasks).set({ projectId: input.projectId }).where(eq(schema.tasks.warRoomId, id));
  }
  return c.json(await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, id) }));
});

warRoomRoutes.delete("/warrooms/:id", async (c) => {
  const id = c.req.param("id");
  const convs = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.warRoomId, id));
  const convIds = convs.map((x) => x.id);
  if (convIds.length) await db.delete(schema.messages).where(inArray(schema.messages.conversationId, convIds));
  await db.delete(schema.conversations).where(eq(schema.conversations.warRoomId, id));
  await db.delete(schema.agents).where(eq(schema.agents.warRoomId, id));
  await db.delete(schema.tasks).where(eq(schema.tasks.warRoomId, id));
  await db.delete(schema.activity).where(eq(schema.activity.warRoomId, id));
  await db.update(schema.files).set({ warRoomId: null }).where(eq(schema.files.warRoomId, id));
  // Usage events are kept (spend history stays truthful) but detached.
  await db.update(schema.usageEvents).set({ warRoomId: null }).where(eq(schema.usageEvents.warRoomId, id));
  await db.delete(schema.warRooms).where(eq(schema.warRooms.id, id));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ analysis

warRoomRoutes.post("/warrooms/:id/analyze", async (c) => {
  const id = c.req.param("id");
  return c.json(await analyzeBrief(id));
});

warRoomRoutes.post("/warrooms/:id/apply-analysis", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, z.object({ agentNames: z.array(z.string()), createTasks: z.boolean().default(true) }));
  return c.json(await applyAnalysis(id, input.agentNames, input.createTasks));
});

// ------------------------------------------------------------------ agents

warRoomRoutes.get("/agents", async (c) => {
  const rows = await db.select().from(schema.agents).orderBy(asc(schema.agents.warRoomId), asc(schema.agents.position));
  const rooms = await db.select({ id: schema.warRooms.id, name: schema.warRooms.name }).from(schema.warRooms);
  return c.json(rows.map((a) => ({ ...a, warRoomName: rooms.find((r) => r.id === a.warRoomId)?.name ?? null })));
});

warRoomRoutes.post("/warrooms/:id/agents", async (c) => {
  const roomId = c.req.param("id");
  if (!(await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, roomId) }))) notFound("War Room");
  const input = await body(c, agentInput);
  await assertModel(input.providerId, input.modelId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(schema.agents).where(eq(schema.agents.warRoomId, roomId));
  const ts = now();
  const id = newId("agent");
  await db.insert(schema.agents).values({
    id,
    warRoomId: roomId,
    role: "agent",
    name: input.name,
    icon: input.icon ?? "bot",
    color: input.color ?? "slate",
    description: input.description ?? "",
    function: input.function ?? "",
    personality: input.personality ?? "",
    providerId: input.providerId ?? null,
    modelId: input.modelId ?? null,
    systemPrompt: input.systemPrompt ?? "",
    params: input.params ?? {},
    skills: input.skills ?? [],
    mcpServers: input.mcpServers ?? [],
    memory: input.memory ?? "",
    tokenLimit: input.tokenLimit ?? null,
    budgetUsd: input.budgetUsd ?? null,
    priority: input.priority ?? 0,
    permissions: input.permissions ?? DEFAULT_PERMISSIONS,
    position: Number(n),
    createdAt: ts,
    updatedAt: ts,
  });
  await logActivity({ type: "agent_added", summary: `Agent ${input.name} added`, warRoomId: roomId, agentId: id });
  return c.json(await db.query.agents.findFirst({ where: eq(schema.agents.id, id) }));
});

warRoomRoutes.patch("/agents/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, agentInput.partial());
  await assertModel(input.providerId, input.modelId);
  await db.update(schema.agents).set({ ...input, updatedAt: now() }).where(eq(schema.agents.id, id));
  const row = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!row) notFound("Agent");
  return c.json(row);
});

warRoomRoutes.delete("/agents/:id", async (c) => {
  const id = c.req.param("id");
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) notFound("Agent");
  if (agent!.role === "orchestrator") badRequest("The orchestrator cannot be deleted; edit it instead.");
  const convs = await db.select({ id: schema.conversations.id }).from(schema.conversations).where(eq(schema.conversations.agentId, id));
  if (convs.length) await db.delete(schema.messages).where(inArray(schema.messages.conversationId, convs.map((x) => x.id)));
  await db.delete(schema.conversations).where(eq(schema.conversations.agentId, id));
  await db.update(schema.tasks).set({ assigneeAgentId: null }).where(eq(schema.tasks.assigneeAgentId, id));
  await db.delete(schema.agents).where(eq(schema.agents.id, id));
  await logActivity({ type: "agent_removed", summary: `Agent ${agent!.name} removed`, warRoomId: agent!.warRoomId });
  return c.json({ ok: true });
});

/** Individual conversation with one agent (created on first access). */
warRoomRoutes.get("/agents/:id/conversation", async (c) => {
  const id = c.req.param("id");
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) notFound("Agent");
  let conv = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.agentId, id), eq(schema.conversations.kind, "agent")) });
  if (!conv) {
    const ts = now();
    conv = {
      id: newId("conv"),
      kind: "agent",
      warRoomId: agent!.warRoomId,
      agentId: id,
      title: `Chat with ${agent!.name}`,
      providerId: null,
      modelId: null,
      params: {},
      systemPrompt: "",
      archived: false,
      summary: null,
      summaryUpTo: null,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.insert(schema.conversations).values(conv);
  }
  const msgs = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(asc(schema.messages.createdAt));
  return c.json({ conversation: conv, messages: msgs.map(toMessageDTO) });
});

warRoomRoutes.post("/agents/:id/messages", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, z.object({ content: z.string().max(400_000), attachmentIds: z.array(z.string()).max(20).default([]) }));
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, id) });
  if (!agent) notFound("Agent");
  const conv = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.agentId, id), eq(schema.conversations.kind, "agent")) });
  if (!conv) badRequest("Open the agent conversation first");
  let room = null;
  let team: (typeof schema.agents.$inferSelect)[] = [];
  let orch = agent!;
  if (agent!.warRoomId) {
    const loaded = await loadRoom(agent!.warRoomId);
    room = loaded.room;
    team = loaded.agents;
    orch = loaded.orch;
  }
  const system =
    agent!.role === "orchestrator" && room
      ? agentSystemPrompt(agent!, room, team, null)
      : agentSystemPrompt(agent!, room, team, room ? orch.name : null);
  const setup = room ? setupFor(agent!, { room, agents: team, orch }, system) : null;
  if (!setup && (!agent!.providerId || !agent!.modelId)) badRequest("This agent has no model.");
  return sseRun(c, (emit, signal) =>
    sendChatMessage({
      conversationId: conv!.id,
      content: input.content,
      attachmentIds: input.attachmentIds,
      setup: setup ?? { providerId: agent!.providerId!, modelId: agent!.modelId!, system, params: agent!.params, agentId: agent!.id },
      emit,
      signal,
    }),
  );
});

// ------------------------------------------------------------------ collective chat

warRoomRoutes.post("/warrooms/:id/messages", async (c) => {
  const id = c.req.param("id");
  const input = await body(
    c,
    z.object({
      content: z.string().max(400_000),
      attachmentIds: z.array(z.string()).max(20).default([]),
      mode: z.enum(["auto", "all", "direct", "debate", "synthesis"]).default("auto"),
      agentIds: z.array(z.string()).max(20).default([]),
      synthesize: z.boolean().default(false),
    }),
  );
  if (!input.content.trim() && input.mode !== "synthesis" && input.attachmentIds.length === 0) badRequest("Empty message");
  return sseRun(c, (emit, signal) => runCollective({ warRoomId: id, ...input }, emit, signal));
});

warRoomRoutes.post("/warrooms/:id/plans/:messageId/decision", async (c) => {
  const input = await body(c, z.object({ approve: z.boolean() }));
  return sseRun(c, (emit, signal) => decidePlan(c.req.param("id"), c.req.param("messageId"), input.approve, emit, signal));
});

// ------------------------------------------------------------------ tasks & activity

const taskInput = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).optional(),
  status: z.enum(["todo", "in_progress", "review", "done", "blocked"]).optional(),
  priority: z.number().int().min(1).max(3).optional(),
  assigneeAgentId: z.string().nullable().optional(),
  dependsOn: z.array(z.string()).max(50).optional(),
  dueAt: z.number().int().nullable().optional(),
  warRoomId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

warRoomRoutes.get("/tasks", async (c) => {
  const warRoomId = c.req.query("warRoomId");
  const projectId = c.req.query("projectId");
  const conds = [];
  if (warRoomId) conds.push(eq(schema.tasks.warRoomId, warRoomId));
  if (projectId) conds.push(eq(schema.tasks.projectId, projectId));
  const rows = await db
    .select()
    .from(schema.tasks)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.tasks.priority), desc(schema.tasks.updatedAt));
  return c.json(rows);
});

warRoomRoutes.post("/tasks", async (c) => {
  const input = await body(c, taskInput);
  let projectId = input.projectId ?? null;
  if (!projectId && input.warRoomId) {
    projectId = (await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, input.warRoomId) }))?.projectId ?? null;
  }
  const ts = now();
  const id = newId("task");
  await db.insert(schema.tasks).values({
    id,
    title: input.title,
    description: input.description ?? "",
    status: input.status ?? "todo",
    priority: input.priority ?? 2,
    assigneeAgentId: input.assigneeAgentId ?? null,
    dependsOn: input.dependsOn ?? [],
    dueAt: input.dueAt ?? null,
    warRoomId: input.warRoomId ?? null,
    projectId,
    createdAt: ts,
    updatedAt: ts,
  });
  return c.json(await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) }));
});

warRoomRoutes.patch("/tasks/:id", async (c) => {
  const id = c.req.param("id");
  const input = await body(c, taskInput.partial());
  await db.update(schema.tasks).set({ ...input, updatedAt: now() }).where(eq(schema.tasks.id, id));
  const row = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, id) });
  if (!row) notFound("Task");
  return c.json(row);
});

warRoomRoutes.delete("/tasks/:id", async (c) => {
  await db.delete(schema.tasks).where(eq(schema.tasks.id, c.req.param("id")));
  return c.json({ ok: true });
});

warRoomRoutes.get("/activity", async (c) => {
  const warRoomId = c.req.query("warRoomId");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const rows = await db
    .select()
    .from(schema.activity)
    .where(warRoomId ? eq(schema.activity.warRoomId, warRoomId) : undefined)
    .orderBy(desc(schema.activity.createdAt))
    .limit(limit);
  return c.json(rows);
});
