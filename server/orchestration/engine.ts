import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { logActivity } from "../activity/log";
import { insertMessage, streamReply, toMessageDTO, updateMessage, makeSummarizer, type ModelSetup } from "../chat/service";
import { DEFAULT_MAX_HISTORY_TOKENS, fileNameMap, getSetting, maybeCompress, messagesToTurns } from "../memory/context";
import { callModel, extractJson } from "../runtime/llm";
import type { ChatTurn } from "../providers/types";
import type { CollectiveMode, RoutingPlan, RunEvent } from "../../shared/types";
import {
  agentSystemPrompt,
  agentTaskInstruction,
  debateInstruction,
  orchestratorSystemPrompt,
  routingInstruction,
  synthesisInstruction,
} from "./prompts";

type Agent = typeof schema.agents.$inferSelect;
type Room = typeof schema.warRooms.$inferSelect;

export class OrchestrationError extends Error {}

/** Hard cap on model calls per user message: protects against runaway loops. */
const DEFAULT_MAX_CALLS_PER_RUN = 12;

interface Run {
  room: Room;
  agents: Agent[];
  orch: Agent;
  conversationId: string;
  emit: (e: RunEvent) => void;
  signal: AbortSignal;
  calls: number;
  maxCalls: number;
  agentNames: Map<string, string>;
}

export async function loadRoom(warRoomId: string) {
  const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, warRoomId) });
  if (!room) throw new OrchestrationError("War Room not found");
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, warRoomId)).orderBy(asc(schema.agents.position));
  const orch = agents.find((a) => a.role === "orchestrator");
  if (!orch) throw new OrchestrationError("This War Room has no orchestrator.");
  const conv = await db.query.conversations.findFirst({
    where: and(eq(schema.conversations.warRoomId, warRoomId), eq(schema.conversations.kind, "warroom")),
  });
  if (!conv) throw new OrchestrationError("Collective conversation missing");
  return { room, agents, orch, conv };
}

export function setupFor(agent: Agent, run: Pick<Run, "room" | "agents" | "orch">, system: string): ModelSetup {
  const providerId = agent.providerId ?? run.orch.providerId;
  const modelId = agent.modelId ?? run.orch.modelId;
  if (!providerId || !modelId) throw new OrchestrationError(`${agent.name} has no model. Assign one in the agent settings.`);
  return {
    providerId,
    modelId,
    system,
    params: { ...agent.params, ...(agent.tokenLimit ? { maxTokens: agent.tokenLimit } : {}) },
    agentId: agent.id,
    warRoomId: run.room.id,
    projectId: run.room.projectId,
  };
}

function countCall(run: Run) {
  run.calls++;
  if (run.calls > run.maxCalls) {
    throw new OrchestrationError(`Safety stop: more than ${run.maxCalls} model calls for one message. Adjust "orchestration.maxCallsPerRun" in Settings if this is intended.`);
  }
}

async function threadTurns(run: Run, excludeIds: string[]): Promise<ChatTurn[]> {
  const rows = (
    await db.select().from(schema.messages).where(eq(schema.messages.conversationId, run.conversationId)).orderBy(asc(schema.messages.createdAt))
  ).filter((r) => !excludeIds.includes(r.id) && r.meta.kind !== "plan");
  const conv = await db.query.conversations.findFirst({ where: eq(schema.conversations.id, run.conversationId) });
  const recent = conv?.summaryUpTo ? rows.filter((r) => r.createdAt > conv.summaryUpTo!) : rows;
  const maxHistory = await getSetting<number>("context.maxHistoryTokens", DEFAULT_MAX_HISTORY_TOKENS);
  return messagesToTurns(recent, { maxHistoryTokens: maxHistory, agentNames: run.agentNames }, await fileNameMap(recent)).turns;
}

async function parallel<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** One agent answers, streaming into a new message of the collective thread. */
async function agentTurn(
  run: Run,
  agent: Agent,
  instructionText: string,
  opts: { attachmentIds?: string[]; excludeIds: string[]; kind: "agent_reply" | "debate_round" | "direct_answer"; instruction?: string; round?: number; taskId?: string },
): Promise<{ agent: Agent; text: string; ok: boolean }> {
  countCall(run);
  const system = agentSystemPrompt(agent, run.room, run.agents, run.orch.name);
  const setup = setupFor(agent, run, system);
  const history = await threadTurns(run, opts.excludeIds);
  const turns: ChatTurn[] = [...history, { role: "user", content: [{ type: "text", text: instructionText }] }];
  const msg = await insertMessage({
    conversationId: run.conversationId,
    role: "assistant",
    agentId: agent.id,
    status: "streaming",
    providerId: setup.providerId,
    modelId: setup.modelId,
    meta: { kind: opts.kind, instruction: opts.instruction, round: opts.round, taskId: opts.taskId },
  });
  run.emit({ type: "message_created", message: toMessageDTO(msg) });
  run.emit({ type: "status", agentId: agent.id, messageId: msg.id, status: "working" });
  try {
    const row = await streamReply({
      conversationId: run.conversationId,
      assistantMessageId: msg.id,
      setup,
      turns,
      attachmentSourceIds: agent.permissions.readFiles ? opts.attachmentIds : [],
      emit: run.emit,
      signal: run.signal,
      purpose: opts.kind === "debate_round" ? "debate" : "chat",
      extraMeta: { kind: opts.kind, instruction: opts.instruction, round: opts.round, taskId: opts.taskId },
    });
    run.emit({ type: "status", agentId: agent.id, messageId: msg.id, status: "idle" });
    return { agent, text: row.content, ok: row.status === "complete" };
  } catch (err) {
    run.emit({ type: "status", agentId: agent.id, messageId: msg.id, status: "error" });
    run.emit({ type: "notice", level: "error", text: `${agent.name}: ${err instanceof Error ? err.message : String(err)}` });
    return { agent, text: "", ok: false };
  }
}

async function orchestratorStream(run: Run, instructionText: string, excludeIds: string[], kind: "synthesis" | "direct_answer", attachmentIds?: string[]) {
  countCall(run);
  const setup = setupFor(run.orch, run, orchestratorSystemPrompt(run.orch, run.room, run.agents));
  const history = await threadTurns(run, excludeIds);
  const turns: ChatTurn[] = [...history, { role: "user", content: [{ type: "text", text: instructionText }] }];
  const msg = await insertMessage({
    conversationId: run.conversationId,
    role: "assistant",
    agentId: run.orch.id,
    status: "streaming",
    providerId: setup.providerId,
    modelId: setup.modelId,
    meta: { kind },
  });
  run.emit({ type: "message_created", message: toMessageDTO(msg) });
  run.emit({ type: "status", agentId: run.orch.id, status: kind === "synthesis" ? "synthesizing" : "answering" });
  try {
    const row = await streamReply({
      conversationId: run.conversationId,
      assistantMessageId: msg.id,
      setup,
      turns,
      attachmentSourceIds: attachmentIds,
      emit: run.emit,
      signal: run.signal,
      purpose: kind === "synthesis" ? "synthesis" : "chat",
      extraMeta: { kind },
    });
    return row.content;
  } finally {
    run.emit({ type: "status", agentId: run.orch.id, status: "idle" });
  }
}

/** Ask the orchestrator which agents should handle the message (cheap, non-streamed call). */
async function route(run: Run, userText: string): Promise<RoutingPlan> {
  countCall(run);
  run.emit({ type: "status", agentId: run.orch.id, status: "routing" });
  const routingModel = await getSetting<{ providerId: string; modelId: string } | null>("optimizer.routingModel", null);
  const base = setupFor(run.orch, run, orchestratorSystemPrompt(run.orch, run.room, run.agents));
  const target = routingModel ?? { providerId: base.providerId, modelId: base.modelId };
  const result = await callModel({
    providerId: target.providerId,
    modelId: target.modelId,
    system: base.system,
    messages: [{ role: "user", content: [{ type: "text", text: routingInstruction(userText, run.room.maxAgentsPerTurn) }] }],
    params: { effort: "low", maxTokens: 2000 },
    signal: run.signal,
    context: { conversationId: run.conversationId, agentId: run.orch.id, warRoomId: run.room.id, projectId: run.room.projectId, purpose: "routing" },
  });
  run.emit({ type: "status", agentId: run.orch.id, status: "idle" });
  const parsed = extractJson<{ reasoning?: string; answerDirectly?: boolean; steps?: { agentId?: string; instruction?: string }[]; synthesize?: boolean }>(result.text);
  const valid = new Map(run.agents.filter((a) => a.role === "agent").map((a) => [a.id, a]));
  const byName = new Map(run.agents.filter((a) => a.role === "agent").map((a) => [a.name.toLowerCase(), a]));
  const steps = (parsed?.steps ?? [])
    .map((s) => {
      const agent = (s.agentId && valid.get(s.agentId)) || (s.agentId && byName.get(s.agentId.toLowerCase()));
      return agent && s.instruction ? { agentId: agent.id, agentName: agent.name, instruction: String(s.instruction) } : null;
    })
    .filter((s): s is NonNullable<typeof s> => !!s)
    .filter((s, i, arr) => arr.findIndex((x) => x.agentId === s.agentId) === i)
    .slice(0, run.room.maxAgentsPerTurn);
  if (!parsed) {
    return { reasoning: "The orchestrator's routing reply could not be parsed; it will answer directly.", answerDirectly: true, steps: [], synthesize: false };
  }
  return {
    reasoning: String(parsed.reasoning ?? ""),
    answerDirectly: steps.length === 0 ? true : !!parsed.answerDirectly && steps.length === 0,
    steps,
    synthesize: steps.length > 1 ? parsed.synthesize !== false : !!parsed.synthesize && steps.length > 1,
  };
}

function needsApproval(room: Room, orch: Agent, plan: RoutingPlan) {
  if (plan.steps.length === 0) return false;
  if (orch.permissions.dispatchWithoutApproval || room.autonomy === "autonomous") return false;
  if (room.autonomy === "assisted") return true;
  // Semi-autonomous: ask before dispatching to 3+ agents at once (the costly case).
  return plan.steps.length >= 3;
}

async function executePlan(run: Run, plan: RoutingPlan, userMsg: typeof schema.messages.$inferSelect) {
  const excludeBase = [userMsg.id];
  const replies = await parallel(plan.steps, 3, async (step) => {
    const agent = run.agents.find((a) => a.id === step.agentId)!;
    const taskId = newId("task");
    await db.insert(schema.tasks).values({
      id: taskId,
      warRoomId: run.room.id,
      projectId: run.room.projectId,
      title: step.instruction.split("\n")[0].slice(0, 120),
      description: step.instruction,
      status: "in_progress",
      priority: 2,
      assigneeAgentId: agent.id,
      dependsOn: [],
      createdAt: now(),
      updatedAt: now(),
    });
    await logActivity({ type: "task_started", summary: `${agent.name}: ${step.instruction.slice(0, 120)}`, warRoomId: run.room.id, agentId: agent.id });
    const r = await agentTurn(run, agent, agentTaskInstruction(run.orch.name, step.instruction, userMsg.content), {
      attachmentIds: userMsg.attachmentIds,
      excludeIds: excludeBase,
      kind: "agent_reply",
      instruction: step.instruction,
      taskId,
    });
    await db
      .update(schema.tasks)
      .set({ status: r.ok ? "done" : "blocked", result: r.text.slice(0, 4000), updatedAt: now() })
      .where(eq(schema.tasks.id, taskId));
    await logActivity({ type: r.ok ? "task_done" : "task_failed", summary: `${agent.name} ${r.ok ? "finished" : "failed"}`, warRoomId: run.room.id, agentId: agent.id });
    return r;
  });
  const okReplies = replies.filter((r) => r.ok && r.text.trim());
  if (plan.synthesize && okReplies.length > 1 && !run.signal.aborted) {
    await orchestratorStream(
      run,
      synthesisInstruction(userMsg.content, okReplies.map((r) => ({ name: r.agent.name, text: r.text }))),
      [userMsg.id],
      "synthesis",
    );
  }
}

export interface CollectiveInput {
  warRoomId: string;
  content: string;
  attachmentIds: string[];
  mode: CollectiveMode;
  agentIds: string[];
  synthesize: boolean;
}

export async function runCollective(input: CollectiveInput, emit: (e: RunEvent) => void, signal: AbortSignal) {
  const { room, agents, orch, conv } = await loadRoom(input.warRoomId);
  const run: Run = {
    room,
    agents,
    orch,
    conversationId: conv.id,
    emit,
    signal,
    calls: 0,
    maxCalls: await getSetting<number>("orchestration.maxCallsPerRun", DEFAULT_MAX_CALLS_PER_RUN),
    agentNames: new Map(agents.map((a) => [a.id, a.name])),
  };
  const team = agents.filter((a) => a.role === "agent");
  const userMsg = await insertMessage({
    conversationId: conv.id,
    role: "user",
    content: input.content,
    attachmentIds: input.attachmentIds,
    meta: { mode: input.mode },
  });
  emit({ type: "message_created", message: toMessageDTO(userMsg) });
  await logActivity({ type: "user_message", summary: input.content.slice(0, 160) || "(attachments)", warRoomId: room.id });

  const selected = (input.agentIds.length ? team.filter((a) => input.agentIds.includes(a.id)) : []).filter(Boolean);

  switch (input.mode) {
    case "auto": {
      if (team.length === 0) {
        await orchestratorStream(run, input.content, [userMsg.id], "direct_answer", input.attachmentIds);
        break;
      }
      const plan = await route(run, input.content);
      await logActivity({
        type: "routing",
        summary: plan.steps.length ? `${orch.name} → ${plan.steps.map((s) => s.agentName).join(", ")}` : `${orch.name} answers directly`,
        warRoomId: room.id,
        agentId: orch.id,
        data: { reasoning: plan.reasoning },
      });
      if (plan.steps.length === 0) {
        await orchestratorStream(run, input.content, [userMsg.id], "direct_answer", input.attachmentIds);
        break;
      }
      const approval = needsApproval(room, orch, plan);
      const planMsg = await insertMessage({
        conversationId: conv.id,
        role: "assistant",
        agentId: orch.id,
        content: plan.reasoning,
        meta: { kind: "plan", plan, planStatus: approval ? "pending_approval" : "executed", userMessageId: userMsg.id },
      });
      emit({ type: "plan", message: toMessageDTO(planMsg) });
      if (approval) {
        emit({ type: "notice", level: "info", text: `${orch.name} is waiting for your approval before dispatching the work.` });
        break;
      }
      await executePlan(run, plan, userMsg);
      break;
    }
    case "direct":
    case "all": {
      const targets = input.mode === "all" ? team : selected;
      if (targets.length === 0) throw new OrchestrationError(input.mode === "all" ? "This War Room has no agents yet." : "Select at least one agent.");
      if (input.mode === "all" && targets.length > 4) {
        emit({ type: "notice", level: "warning", text: `Forcing all ${targets.length} agents to answer: ${targets.length} model calls.` });
      }
      const replies = await parallel(targets, 3, (agent) =>
        agentTurn(run, agent, input.content, { attachmentIds: input.attachmentIds, excludeIds: [userMsg.id], kind: "direct_answer" }),
      );
      const ok = replies.filter((r) => r.ok && r.text.trim());
      if (input.synthesize && ok.length > 1) {
        await orchestratorStream(run, synthesisInstruction(input.content, ok.map((r) => ({ name: r.agent.name, text: r.text }))), [userMsg.id], "synthesis");
      }
      break;
    }
    case "debate": {
      const participants = (selected.length ? selected : team).slice(0, Math.max(2, room.maxAgentsPerTurn));
      if (participants.length < 2) throw new OrchestrationError("A debate needs at least two agents.");
      await logActivity({ type: "debate", summary: `Debate: ${participants.map((a) => a.name).join(" vs ")}`, warRoomId: room.id });
      const round1 = await parallel(participants, 3, (agent) =>
        agentTurn(run, agent, `Debate round 1. Give your position on:\n\n${input.content}`, {
          attachmentIds: input.attachmentIds,
          excludeIds: [userMsg.id],
          kind: "debate_round",
          round: 1,
        }),
      );
      const ok1 = round1.filter((r) => r.ok);
      if (ok1.length < 2 || signal.aborted) break;
      const round1Ids = (await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.conversationId, conv.id)))
        .map((r) => r.id);
      const round2 = await parallel(ok1, 3, (r) =>
        agentTurn(
          run,
          r.agent,
          debateInstruction(input.content, r.text, ok1.filter((o) => o.agent.id !== r.agent.id).map((o) => ({ name: o.agent.name, text: o.text }))),
          { excludeIds: round1Ids, kind: "debate_round", round: 2 },
        ),
      );
      const final = round2.filter((r) => r.ok);
      if (final.length && !signal.aborted) {
        await orchestratorStream(
          run,
          synthesisInstruction(input.content, final.map((r) => ({ name: r.agent.name, text: r.text })), true),
          round1Ids,
          "synthesis",
        );
      }
      break;
    }
    case "synthesis": {
      await orchestratorStream(
        run,
        `${input.content ? `${input.content}\n\n` : ""}Write a synthesis of the discussion so far: decisions, open questions, disagreements, next steps.`,
        [userMsg.id],
        "synthesis",
      );
      break;
    }
  }

  const setup = setupFor(orch, run, "");
  await maybeCompress(conv.id, makeSummarizer(setup, { conversationId: conv.id, warRoomId: room.id })).catch(() => false);
}

/** Approve (or reject) a pending plan, then execute it. */
export async function decidePlan(warRoomId: string, planMessageId: string, approve: boolean, emit: (e: RunEvent) => void, signal: AbortSignal) {
  const { room, agents, orch, conv } = await loadRoom(warRoomId);
  const planMsg = await db.query.messages.findFirst({ where: eq(schema.messages.id, planMessageId) });
  if (!planMsg || planMsg.conversationId !== conv.id || planMsg.meta.kind !== "plan" || !planMsg.meta.plan) {
    throw new OrchestrationError("Plan not found");
  }
  if (planMsg.meta.planStatus !== "pending_approval") throw new OrchestrationError("This plan was already handled.");
  const updated = await updateMessage(planMsg.id, { meta: { ...planMsg.meta, planStatus: approve ? "approved" : "rejected" } });
  emit({ type: "message_done", message: toMessageDTO(updated) });
  await logActivity({ type: approve ? "plan_approved" : "plan_rejected", summary: `Plan ${approve ? "approved" : "rejected"} by user`, warRoomId: room.id });
  if (!approve) return;
  const userMsg = planMsg.meta.userMessageId
    ? await db.query.messages.findFirst({ where: eq(schema.messages.id, planMsg.meta.userMessageId) })
    : null;
  if (!userMsg) throw new OrchestrationError("Original message not found");
  const run: Run = {
    room,
    agents,
    orch,
    conversationId: conv.id,
    emit,
    signal,
    calls: 0,
    maxCalls: await getSetting<number>("orchestration.maxCallsPerRun", DEFAULT_MAX_CALLS_PER_RUN),
    agentNames: new Map(agents.map((a) => [a.id, a.name])),
  };
  // Re-validate agents (they may have been removed meanwhile).
  const plan: RoutingPlan = { ...planMsg.meta.plan, steps: planMsg.meta.plan.steps.filter((s) => agents.some((a) => a.id === s.agentId)) };
  await executePlan(run, plan, userMsg);
  const done = await updateMessage(planMsg.id, { meta: { ...planMsg.meta, planStatus: "executed" } });
  emit({ type: "message_done", message: toMessageDTO(done) });
}
