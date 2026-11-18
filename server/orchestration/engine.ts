import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { logActivity } from "../activity/log";
import { insertMessage, streamReply, toMessageDTO, updateMessage, makeSummarizer, type ModelSetup } from "../chat/service";
import { DEFAULT_MAX_HISTORY_TOKENS, fileNameMap, getSetting, maybeCompress, messagesToTurns } from "../memory/context";
import { callModel, extractJson } from "../runtime/llm";
import { assertClaudeAvailable, LimitPausedError } from "../limits/guard";
import { createPausedWork } from "../limits/store";
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
type MessageRow = typeof schema.messages.$inferSelect;

export class OrchestrationError extends Error {}

/** Hard cap on model calls per user message: protects against runaway loops. */
const DEFAULT_MAX_CALLS_PER_RUN = 12;

/** A unit of agent work that can be paused and resumed. */
export interface Step {
  agentId: string;
  /** Orchestrator instruction (agent_reply) or null when the agent answers the user directly. */
  instruction: string | null;
  kind: "agent_reply" | "direct_answer";
  taskId?: string;
}

/** Where a collective run stopped because of the subscription quota. */
export interface CollectivePausePayload {
  userMessageId: string;
  input: { mode: CollectiveMode; agentIds: string[]; synthesize: boolean };
  stage: "route" | "steps" | "synthesis" | "rerun";
  steps?: Step[];
  synthesize?: boolean;
  [key: string]: unknown;
}

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
  paused: { error: LimitPausedError; stage: CollectivePausePayload["stage"]; steps: Step[] } | null;
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

/** Model setup for a direct conversation with one agent (individual chat). */
export async function agentChatSetup(agentId: string): Promise<ModelSetup> {
  const agent = await db.query.agents.findFirst({ where: eq(schema.agents.id, agentId) });
  if (!agent) throw new OrchestrationError("Agent introuvable");
  if (agent.warRoomId) {
    const { room, agents, orch } = await loadRoom(agent.warRoomId);
    const system = agentSystemPrompt(agent, room, agents, agent.role === "orchestrator" ? null : orch.name);
    return setupFor(agent, { room, agents, orch }, system);
  }
  if (!agent.providerId || !agent.modelId) throw new OrchestrationError("This agent has no model.");
  return { providerId: agent.providerId, modelId: agent.modelId, system: agentSystemPrompt(agent, null, [], null), params: agent.params, agentId: agent.id };
}

function countCall(run: Run) {
  run.calls++;
  if (run.calls > run.maxCalls) {
    throw new OrchestrationError(`Safety stop: more than ${run.maxCalls} model calls for one message. Adjust "orchestration.maxCallsPerRun" in Settings if this is intended.`);
  }
}

function markPaused(run: Run, error: LimitPausedError, stage: CollectivePausePayload["stage"], step?: Step) {
  if (!run.paused) run.paused = { error, stage, steps: [] };
  else if (stage === "route" || stage === "rerun") run.paused.stage = stage;
  if (step) run.paused.steps.push(step);
}

async function threadTurns(run: Run, excludeIds: string[]): Promise<ChatTurn[]> {
  const rows = (
    await db.select().from(schema.messages).where(eq(schema.messages.conversationId, run.conversationId)).orderBy(asc(schema.messages.createdAt))
  ).filter((r) => !excludeIds.includes(r.id) && r.meta.kind !== "plan" && r.status !== "pending");
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

/** Remove an empty reply left by a pause, or keep a partial one marked as interrupted. */
async function settlePausedMessage(run: Run, msg: MessageRow | null) {
  if (!msg) return;
  const current = await db.query.messages.findFirst({ where: eq(schema.messages.id, msg.id) });
  if (!current) return;
  if (!current.content.trim()) {
    await db.delete(schema.messages).where(eq(schema.messages.id, msg.id));
    run.emit({ type: "message_done", message: { ...toMessageDTO(current), status: "aborted", content: "", meta: { ...current.meta, kind: "note" } } });
    return;
  }
  const row = await updateMessage(msg.id, { status: "aborted", error: "Interrompu : limite Claude. La tâche reprendra après la réinitialisation." });
  run.emit({ type: "message_done", message: toMessageDTO(row) });
}

type TurnResult = { agent: Agent; text: string; ok: boolean; paused?: LimitPausedError };

/** One agent answers, streaming into a new message of the collective thread. */
async function agentTurn(
  run: Run,
  agent: Agent,
  instructionText: string,
  opts: { attachmentIds?: string[]; excludeIds: string[]; kind: "agent_reply" | "debate_round" | "direct_answer"; instruction?: string; round?: number; taskId?: string },
): Promise<TurnResult> {
  let msg: MessageRow | null = null;
  try {
    const system = agentSystemPrompt(agent, run.room, run.agents, run.orch.name);
    const setup = setupFor(agent, run, system);
    // Quota guard before doing anything visible.
    await assertClaudeAvailable(setup.providerId);
    countCall(run);
    const history = await threadTurns(run, opts.excludeIds);
    const turns: ChatTurn[] = [...history, { role: "user", content: [{ type: "text", text: instructionText }] }];
    msg = await insertMessage({
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
    if (err instanceof LimitPausedError) {
      run.emit({ type: "status", agentId: agent.id, status: "idle" });
      await settlePausedMessage(run, msg);
      return { agent, text: "", ok: false, paused: err };
    }
    if (err instanceof OrchestrationError) throw err;
    run.emit({ type: "status", agentId: agent.id, messageId: msg?.id, status: "error" });
    run.emit({ type: "notice", level: "error", text: `${agent.name}: ${err instanceof Error ? err.message : String(err)}` });
    return { agent, text: "", ok: false };
  }
}

async function orchestratorStream(run: Run, instructionText: string, excludeIds: string[], kind: "synthesis" | "direct_answer", attachmentIds?: string[]) {
  const setup = setupFor(run.orch, run, orchestratorSystemPrompt(run.orch, run.room, run.agents));
  await assertClaudeAvailable(setup.providerId);
  countCall(run);
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
  } catch (err) {
    if (err instanceof LimitPausedError) await settlePausedMessage(run, msg);
    throw err;
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
  try {
    const result = await callModel({
      providerId: target.providerId,
      modelId: target.modelId,
      system: base.system,
      messages: [{ role: "user", content: [{ type: "text", text: routingInstruction(userText, run.room.maxAgentsPerTurn) }] }],
      params: { effort: "low", maxTokens: 2000 },
      signal: run.signal,
      context: { conversationId: run.conversationId, agentId: run.orch.id, warRoomId: run.room.id, projectId: run.room.projectId, purpose: "routing" },
    });
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
  } finally {
    run.emit({ type: "status", agentId: run.orch.id, status: "idle" });
  }
}

function needsApproval(room: Room, orch: Agent, plan: RoutingPlan) {
  if (plan.steps.length === 0) return false;
  if (orch.permissions.dispatchWithoutApproval || room.autonomy === "autonomous") return false;
  if (room.autonomy === "assisted") return true;
  // Semi-autonomous: ask before dispatching to 3+ agents at once (the costly case).
  return plan.steps.length >= 3;
}

/** Run agent steps in parallel; once the quota guard trips, remaining steps are kept for later instead of being called. */
async function runSteps(run: Run, steps: Step[], userMsg: MessageRow) {
  await parallel(steps, 3, async (step) => {
    const agent = run.agents.find((a) => a.id === step.agentId);
    if (!agent) return;
    if (run.paused) {
      markPaused(run, run.paused.error, "steps", step);
      return;
    }
    let taskId = step.taskId;
    if (step.kind === "agent_reply" && step.instruction) {
      if (taskId && (await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) }))) {
        await db.update(schema.tasks).set({ status: "in_progress", updatedAt: now() }).where(eq(schema.tasks.id, taskId));
      } else {
        taskId = newId("task");
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
      }
      await logActivity({ type: "task_started", summary: `${agent.name}: ${step.instruction.slice(0, 120)}`, warRoomId: run.room.id, agentId: agent.id });
    }
    const r =
      step.kind === "agent_reply" && step.instruction
        ? await agentTurn(run, agent, agentTaskInstruction(run.orch.name, step.instruction, userMsg.content), {
            attachmentIds: userMsg.attachmentIds,
            excludeIds: [userMsg.id],
            kind: "agent_reply",
            instruction: step.instruction,
            taskId,
          })
        : await agentTurn(run, agent, userMsg.content, { attachmentIds: userMsg.attachmentIds, excludeIds: [userMsg.id], kind: "direct_answer" });
    if (r.paused) {
      markPaused(run, r.paused, "steps", { ...step, taskId });
      if (taskId) {
        await db.update(schema.tasks).set({ status: "blocked", result: "En pause : limite Claude. Reprise possible après la réinitialisation.", updatedAt: now() }).where(eq(schema.tasks.id, taskId));
      }
      return;
    }
    if (taskId) {
      await db.update(schema.tasks).set({ status: r.ok ? "done" : "blocked", result: r.text.slice(0, 4000), updatedAt: now() }).where(eq(schema.tasks.id, taskId));
      await logActivity({ type: r.ok ? "task_done" : "task_failed", summary: `${agent.name} ${r.ok ? "finished" : "failed"}`, warRoomId: run.room.id, agentId: agent.id });
    }
  });
}

/** Synthesis over every completed agent reply to this user message (including ones from before a pause). */
async function synthesizeAfter(run: Run, userMsg: MessageRow) {
  const replies = (
    await db
      .select()
      .from(schema.messages)
      .where(and(eq(schema.messages.conversationId, run.conversationId), gt(schema.messages.createdAt, userMsg.createdAt - 1)))
      .orderBy(asc(schema.messages.createdAt))
  ).filter((m) => m.role === "assistant" && m.status === "complete" && (m.meta.kind === "agent_reply" || m.meta.kind === "direct_answer") && m.agentId !== run.orch.id && m.content.trim());
  if (replies.length < 2 || run.signal.aborted) return;
  try {
    await orchestratorStream(
      run,
      synthesisInstruction(userMsg.content, replies.map((r) => ({ name: run.agentNames.get(r.agentId!) ?? "Agent", text: r.content }))),
      [userMsg.id],
      "synthesis",
    );
  } catch (err) {
    if (err instanceof LimitPausedError) markPaused(run, err, "synthesis");
    else throw err;
  }
}

async function executeSteps(run: Run, steps: Step[], userMsg: MessageRow, synthesize: boolean) {
  await runSteps(run, steps, userMsg);
  if (run.paused) {
    if (run.paused.stage === "steps") (run.paused as { synthesize?: boolean }).synthesize = synthesize;
    return;
  }
  if (synthesize) await synthesizeAfter(run, userMsg);
}

export interface CollectiveInput {
  warRoomId: string;
  content: string;
  attachmentIds: string[];
  mode: CollectiveMode;
  agentIds: string[];
  synthesize: boolean;
}

async function buildRun(warRoomId: string, emit: (e: RunEvent) => void, signal: AbortSignal) {
  const { room, agents, orch, conv } = await loadRoom(warRoomId);
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
    paused: null,
  };
  return { run, conv };
}

/** Route and execute a user message according to its mode. Quota pauses are recorded on `run.paused`. */
async function dispatch(run: Run, input: Omit<CollectiveInput, "warRoomId">, userMsg: MessageRow) {
  const { room, orch } = run;
  const team = run.agents.filter((a) => a.role === "agent");
  const selected = input.agentIds.length ? team.filter((a) => input.agentIds.includes(a.id)) : [];
  try {
    switch (input.mode) {
      case "auto": {
        if (team.length === 0) {
          await orchestratorStream(run, input.content, [userMsg.id], "direct_answer", input.attachmentIds);
          break;
        }
        await assertClaudeAvailable(setupFor(orch, run, "").providerId);
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
          conversationId: run.conversationId,
          role: "assistant",
          agentId: orch.id,
          content: plan.reasoning,
          meta: { kind: "plan", plan, planStatus: approval ? "pending_approval" : "executed", userMessageId: userMsg.id },
        });
        run.emit({ type: "plan", message: toMessageDTO(planMsg) });
        if (approval) {
          run.emit({ type: "notice", level: "info", text: `${orch.name} is waiting for your approval before dispatching the work.` });
          break;
        }
        await executeSteps(run, plan.steps.map((s) => ({ agentId: s.agentId, instruction: s.instruction, kind: "agent_reply" as const })), userMsg, plan.synthesize);
        break;
      }
      case "direct":
      case "all": {
        const targets = input.mode === "all" ? team : selected;
        if (targets.length === 0) throw new OrchestrationError(input.mode === "all" ? "This War Room has no agents yet." : "Select at least one agent.");
        if (input.mode === "all" && targets.length > 4) {
          run.emit({ type: "notice", level: "warning", text: `Forcing all ${targets.length} agents to answer: ${targets.length} model calls.` });
        }
        await executeSteps(run, targets.map((a) => ({ agentId: a.id, instruction: null, kind: "direct_answer" as const })), userMsg, input.synthesize);
        break;
      }
      case "debate": {
        const participants = (selected.length ? selected : team).slice(0, Math.max(2, room.maxAgentsPerTurn));
        if (participants.length < 2) throw new OrchestrationError("A debate needs at least two agents.");
        await logActivity({ type: "debate", summary: `Debate: ${participants.map((a) => a.name).join(" vs ")}`, warRoomId: room.id });
        const round1 = await parallel(participants, 3, (agent) =>
          agentTurn(run, agent, `Debate round 1. Give your position on:\n\n${input.content}`, { attachmentIds: input.attachmentIds, excludeIds: [userMsg.id], kind: "debate_round", round: 1 }),
        );
        const paused1 = round1.find((r) => r.paused)?.paused;
        if (paused1) {
          markPaused(run, paused1, "rerun");
          break;
        }
        const ok1 = round1.filter((r) => r.ok);
        if (ok1.length < 2 || run.signal.aborted) break;
        const round1Ids = (await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.conversationId, run.conversationId))).map((r) => r.id);
        const round2 = await parallel(ok1, 3, (r) =>
          agentTurn(run, r.agent, debateInstruction(input.content, r.text, ok1.filter((o) => o.agent.id !== r.agent.id).map((o) => ({ name: o.agent.name, text: o.text }))), {
            excludeIds: round1Ids,
            kind: "debate_round",
            round: 2,
          }),
        );
        const paused2 = round2.find((r) => r.paused)?.paused;
        if (paused2) {
          markPaused(run, paused2, "rerun");
          break;
        }
        const final = round2.filter((r) => r.ok);
        if (final.length && !run.signal.aborted) {
          await orchestratorStream(run, synthesisInstruction(input.content, final.map((r) => ({ name: r.agent.name, text: r.text })), true), round1Ids, "synthesis");
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
  } catch (err) {
    if (!(err instanceof LimitPausedError)) throw err;
    markPaused(run, err, input.mode === "debate" ? "rerun" : input.mode === "synthesis" ? "synthesis" : "route");
  }
}

/** If the run was paused by the quota guard, record what remains so it can be resumed after the reset. */
async function finalizePause(run: Run, input: Omit<CollectiveInput, "warRoomId" | "content" | "attachmentIds">, userMsg: MessageRow) {
  if (!run.paused) return null;
  const p = run.paused;
  const payload: CollectivePausePayload = {
    userMessageId: userMsg.id,
    input: { mode: input.mode, agentIds: input.agentIds, synthesize: input.synthesize },
    stage: p.stage,
    steps: p.stage === "steps" ? p.steps : undefined,
    synthesize: (p as { synthesize?: boolean }).synthesize ?? input.synthesize,
  };
  const pending = p.stage === "steps" ? `${p.steps.length} mission(s) d'agent` : p.stage === "synthesis" ? "la synthèse" : "le traitement du message";
  const pw = await createPausedWork({
    kind: "collective",
    warRoomId: run.room.id,
    conversationId: run.conversationId,
    title: `${run.room.name} : ${userMsg.content.replace(/\s+/g, " ").slice(0, 80) || "message"} (${pending})`,
    payload,
    reason: p.error.message,
    resetsAt: p.error.resumeAt,
  });
  run.emit({
    type: "notice",
    level: "warning",
    text: `${p.error.message} En pause : ${pending}. WAR ROOM vous proposera de reprendre après la réinitialisation.`,
  });
  return pw;
}

export async function runCollective(input: CollectiveInput, emit: (e: RunEvent) => void, signal: AbortSignal) {
  const { run, conv } = await buildRun(input.warRoomId, emit, signal);
  const userMsg = await insertMessage({
    conversationId: conv.id,
    role: "user",
    content: input.content,
    attachmentIds: input.attachmentIds,
    meta: { mode: input.mode },
  });
  emit({ type: "message_created", message: toMessageDTO(userMsg) });
  await logActivity({ type: "user_message", summary: input.content.slice(0, 160) || "(attachments)", warRoomId: run.room.id });

  await dispatch(run, input, userMsg);
  await finalizePause(run, input, userMsg);
  if (!run.paused) {
    const setup = setupFor(run.orch, run, "");
    await maybeCompress(conv.id, makeSummarizer(setup, { conversationId: conv.id, warRoomId: run.room.id })).catch(() => false);
  }
}

/** Resume collective work paused by the quota guard, from where it stopped. */
export async function resumeCollective(pw: typeof schema.pausedWork.$inferSelect, emit: (e: RunEvent) => void, signal: AbortSignal) {
  if (!pw.warRoomId) throw new OrchestrationError("War Room introuvable");
  const payload = pw.payload as CollectivePausePayload;
  const { run } = await buildRun(pw.warRoomId, emit, signal);
  const userMsg = await db.query.messages.findFirst({ where: eq(schema.messages.id, payload.userMessageId) });
  if (!userMsg) throw new OrchestrationError("Le message d'origine n'existe plus.");
  await logActivity({ type: "limit_resumed", summary: `Reprise après limite Claude : ${pw.title}`, warRoomId: run.room.id });
  const input = { ...payload.input, content: userMsg.content, attachmentIds: userMsg.attachmentIds };
  if (payload.stage === "steps" && payload.steps?.length) {
    await executeSteps(run, payload.steps, userMsg, !!payload.synthesize);
  } else if (payload.stage === "synthesis") {
    await synthesizeAfter(run, userMsg);
  } else {
    await dispatch(run, input, userMsg);
  }
  return finalizePause(run, input, userMsg);
}

/** Approve (or reject) a pending plan, then execute it. */
export async function decidePlan(warRoomId: string, planMessageId: string, approve: boolean, emit: (e: RunEvent) => void, signal: AbortSignal) {
  const { run, conv } = await buildRun(warRoomId, emit, signal);
  const planMsg = await db.query.messages.findFirst({ where: eq(schema.messages.id, planMessageId) });
  if (!planMsg || planMsg.conversationId !== conv.id || planMsg.meta.kind !== "plan" || !planMsg.meta.plan) {
    throw new OrchestrationError("Plan not found");
  }
  if (planMsg.meta.planStatus !== "pending_approval") throw new OrchestrationError("This plan was already handled.");
  const updated = await updateMessage(planMsg.id, { meta: { ...planMsg.meta, planStatus: approve ? "approved" : "rejected" } });
  emit({ type: "message_done", message: toMessageDTO(updated) });
  await logActivity({ type: approve ? "plan_approved" : "plan_rejected", summary: `Plan ${approve ? "approved" : "rejected"} by user`, warRoomId: run.room.id });
  if (!approve) return;
  const userMsg = planMsg.meta.userMessageId ? await db.query.messages.findFirst({ where: eq(schema.messages.id, planMsg.meta.userMessageId) }) : null;
  if (!userMsg) throw new OrchestrationError("Original message not found");
  // Re-validate agents (they may have been removed meanwhile).
  const plan: RoutingPlan = { ...planMsg.meta.plan, steps: planMsg.meta.plan.steps.filter((s) => run.agents.some((a) => a.id === s.agentId)) };
  await executeSteps(run, plan.steps.map((s) => ({ agentId: s.agentId, instruction: s.instruction, kind: "agent_reply" as const })), userMsg, plan.synthesize);
  await finalizePause(run, { mode: "auto", agentIds: [], synthesize: plan.synthesize }, userMsg);
  const done = await updateMessage(planMsg.id, { meta: { ...planMsg.meta, planStatus: "executed" } });
  emit({ type: "message_done", message: toMessageDTO(done) });
}
