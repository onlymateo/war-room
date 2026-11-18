import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import { newId, now } from "../lib/ids";
import { logActivity } from "../activity/log";
import { callModel, extractJson } from "../runtime/llm";
import { loadRoom, setupFor } from "../orchestration/engine";
import { ANALYSIS_INSTRUCTION, orchestratorSystemPrompt } from "../orchestration/prompts";
import { matchSkill, scanSkills } from "../skills/inventory";
import { pickModel } from "../usage/optimizer";
import { wrapDocument } from "../files/service";
import { DEFAULT_PERMISSIONS } from "../../shared/types";

export interface AnalysisResult {
  summary: string;
  domains: string[];
  agents: { name: string; function: string; description: string; systemPrompt: string; tier: "economy" | "balanced" | "premium"; icon: string }[];
  tasks: { title: string; description: string; assignee: string; dependsOn: string[]; priority: number }[];
  skills: {
    name: string;
    why: string;
    agent: string;
    priority: "required" | "recommended" | "optional";
    contextCost: string;
    risks: string;
    /** Filled by WAR ROOM from the real inventory (not by the model). */
    status: "installed" | "available" | "missing";
    matchId: string | null;
    matchSource: string | null;
  }[];
  mcp: { name: string; why: string; agent: string; sensitive: boolean }[];
  risks: string[];
  questions: string[];
  generatedAt: number;
  model: string;
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** The orchestrator reads the brief (and attached documents) and proposes a team, tasks, skills and MCP servers. */
export async function analyzeBrief(warRoomId: string): Promise<AnalysisResult> {
  const { room, agents, orch } = await loadRoom(warRoomId);
  const files = await db.select().from(schema.files).where(eq(schema.files.warRoomId, warRoomId));
  const docs = files
    .filter((f) => f.textContent)
    .slice(0, 5)
    .map((f) => wrapDocument(f.name, f.textContent!.slice(0, 30_000)))
    .join("\n\n");
  const setup = setupFor(orch, { room, agents, orch }, orchestratorSystemPrompt(orch, room, agents));
  const result = await callModel({
    providerId: setup.providerId,
    modelId: setup.modelId,
    system: setup.system,
    messages: [{ role: "user", content: [{ type: "text", text: `${docs ? `Reference documents:\n${docs}\n\n` : ""}${ANALYSIS_INSTRUCTION}` }] }],
    params: { ...setup.params, maxTokens: 16_000 },
    context: { agentId: orch.id, warRoomId, projectId: room.projectId, purpose: "analysis" },
  });
  const raw = extractJson<Record<string, unknown>>(result.text);
  if (!raw) throw new Error("The orchestrator did not return a readable analysis. Try again or use a stronger model.");

  const inventory = scanSkills();
  const analysis: AnalysisResult = {
    summary: str(raw.summary),
    domains: arr<string>(raw.domains).map(String),
    agents: arr<Record<string, unknown>>(raw.agents).slice(0, 10).map((a) => ({
      name: str(a.name, "Agent").slice(0, 80),
      function: str(a.function),
      description: str(a.description),
      systemPrompt: str(a.systemPrompt),
      tier: (["economy", "balanced", "premium"].includes(str(a.tier)) ? a.tier : "balanced") as "economy" | "balanced" | "premium",
      icon: str(a.icon, "bot"),
    })),
    tasks: arr<Record<string, unknown>>(raw.tasks).slice(0, 20).map((t) => ({
      title: str(t.title).slice(0, 200),
      description: str(t.description),
      assignee: str(t.assignee),
      dependsOn: arr<string>(t.dependsOn).map(String),
      priority: Math.min(3, Math.max(1, Number(t.priority) || 2)),
    })),
    skills: arr<Record<string, unknown>>(raw.skills).slice(0, 20).map((s) => {
      const match = matchSkill(str(s.name), inventory);
      return {
        name: str(s.name),
        why: str(s.why),
        agent: str(s.agent),
        priority: (["required", "recommended", "optional"].includes(str(s.priority)) ? s.priority : "recommended") as "required" | "recommended" | "optional",
        contextCost: str(s.contextCost, "unknown"),
        risks: str(s.risks),
        status: match ? match.status : "missing",
        matchId: match?.id ?? null,
        matchSource: match?.sourceLabel ?? null,
      };
    }),
    mcp: arr<Record<string, unknown>>(raw.mcp).slice(0, 10).map((m) => ({
      name: str(m.name),
      why: str(m.why),
      agent: str(m.agent),
      sensitive: !!m.sensitive,
    })),
    risks: arr<string>(raw.risks).map(String),
    questions: arr<string>(raw.questions).map(String),
    generatedAt: now(),
    model: `${setup.providerId}/${setup.modelId}`,
  };
  await db.update(schema.warRooms).set({ analysis: analysis, updatedAt: now() }).where(eq(schema.warRooms.id, warRoomId));
  await logActivity({
    type: "analysis",
    summary: `${orch.name} analyzed the brief: ${analysis.agents.length} agents, ${analysis.tasks.length} tasks proposed`,
    warRoomId,
    agentId: orch.id,
  });
  return analysis;
}

/** Create the agents the user kept from the proposal, with models picked by the cost optimizer, plus the tasks. */
export async function applyAnalysis(warRoomId: string, agentNames: string[], createTasks: boolean) {
  const { room, orch } = await loadRoom(warRoomId);
  const analysis = room.analysis as AnalysisResult | null;
  if (!analysis) throw new Error("Run the analysis first.");
  const existing = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, warRoomId)).orderBy(asc(schema.agents.position));
  const ts = now();
  const created: { name: string; id: string; model: string }[] = [];
  let position = existing.length;
  for (const proposal of analysis.agents.filter((a) => agentNames.includes(a.name))) {
    if (existing.some((e) => e.name.toLowerCase() === proposal.name.toLowerCase())) continue;
    const model = await pickModel(proposal.tier, room.costStrategy, orch.providerId);
    const id = newId("agent");
    const skills = analysis.skills
      .filter((s) => s.agent.toLowerCase() === proposal.name.toLowerCase() && s.status === "installed")
      .map((s) => s.name);
    await db.insert(schema.agents).values({
      id,
      warRoomId,
      role: "agent",
      name: proposal.name,
      icon: proposal.icon,
      color: "slate",
      description: proposal.description,
      function: proposal.function,
      personality: "",
      providerId: model?.providerId ?? orch.providerId,
      modelId: model?.modelId ?? orch.modelId,
      systemPrompt: proposal.systemPrompt,
      params: {},
      skills,
      mcpServers: [],
      memory: "",
      tokenLimit: null,
      budgetUsd: null,
      priority: 0,
      permissions: DEFAULT_PERMISSIONS,
      position: position++,
      createdAt: ts,
      updatedAt: ts,
    });
    created.push({ name: proposal.name, id, model: `${model?.providerId ?? orch.providerId}/${model?.modelId ?? orch.modelId}` });
  }
  let taskCount = 0;
  if (createTasks) {
    const all = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, warRoomId));
    const idsByTitle = new Map<string, string>();
    for (const t of analysis.tasks) idsByTitle.set(t.title, newId("task"));
    for (const t of analysis.tasks) {
      const assignee = all.find((a) => a.name.toLowerCase() === t.assignee.toLowerCase());
      await db.insert(schema.tasks).values({
        id: idsByTitle.get(t.title)!,
        warRoomId,
        projectId: room.projectId,
        title: t.title,
        description: t.description,
        status: "todo",
        priority: t.priority,
        assigneeAgentId: assignee?.id ?? null,
        dependsOn: t.dependsOn.map((d) => idsByTitle.get(d)).filter((x): x is string => !!x),
        createdAt: ts,
        updatedAt: ts,
      });
      taskCount++;
    }
  }
  await logActivity({ type: "team_applied", summary: `${created.length} agents and ${taskCount} tasks created from the analysis`, warRoomId });
  return { created, taskCount };
}
