/** Row shapes returned by the API (mirrors server/db/schema.ts). */
import type { AgentParams, AgentPermissions, Autonomy, CostKind, CostStrategy, TaskStatus } from "@shared/types";
export type * from "@shared/types";

export interface Agent {
  id: string;
  warRoomId: string | null;
  role: "orchestrator" | "agent";
  name: string;
  icon: string;
  color: string;
  description: string;
  function: string;
  personality: string;
  providerId: string | null;
  modelId: string | null;
  systemPrompt: string;
  params: AgentParams;
  skills: string[];
  mcpServers: string[];
  /** Per-server tool allowlist; a server without an entry exposes all its tools. */
  mcpTools: Record<string, string[]>;
  memory: string;
  tokenLimit: number | null;
  budgetUsd: number | null;
  priority: number;
  permissions: AgentPermissions;
  position: number;
  createdAt: number;
  updatedAt: number;
  warRoomName?: string | null;
}

export interface WarRoom {
  id: string;
  projectId: string | null;
  name: string;
  description: string;
  objective: string;
  brief: string;
  autonomy: Autonomy;
  costStrategy: CostStrategy;
  budgetUsd: number | null;
  maxAgentsPerTurn: number;
  communication: string;
  sharedMemory: string;
  analysis: Analysis | null;
  status: "active" | "paused" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface WarRoomListItem extends WarRoom {
  agentCount: number;
  openTasks: number;
  orchestrator: Agent | null;
  spentUsd: number;
}

export interface Analysis {
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

export interface Conversation {
  id: string;
  kind: "chat" | "warroom" | "agent";
  warRoomId: string | null;
  agentId: string | null;
  title: string;
  providerId: string | null;
  modelId: string | null;
  params: AgentParams;
  systemPrompt: string;
  archived: boolean;
  summary: string | null;
  summaryUpTo: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: string;
  warRoomId: string | null;
  projectId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  assigneeAgentId: string | null;
  dependsOn: string[];
  result: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Activity {
  id: string;
  warRoomId: string | null;
  projectId: string | null;
  agentId: string | null;
  type: string;
  summary: string;
  data: Record<string, unknown> | null;
  createdAt: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  objectives: string;
  status: "active" | "paused" | "done" | "archived";
  budgetUsd: number | null;
  createdAt: number;
  updatedAt: number;
  taskTotal?: number;
  taskDone?: number;
  warRoomCount?: number;
  spentUsd?: number;
}

export interface UsageEvent {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  agentId: string | null;
  warRoomId: string | null;
  providerId: string;
  modelId: string;
  purpose: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  contextTokens: number | null;
  costUsd: number | null;
  costKind: CostKind;
  latencyMs: number | null;
  status: "ok" | "error" | "aborted";
  createdAt: number;
}

export interface Memory {
  id: string;
  scope: "global" | "project" | "warroom" | "agent" | "conversation";
  scopeId: string | null;
  kind: "fact" | "decision" | "constraint" | "summary" | "note";
  content: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}
