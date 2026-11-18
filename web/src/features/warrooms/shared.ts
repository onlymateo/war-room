import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Agent, WarRoom } from "@/lib/types";

export interface RoomDetail {
  room: WarRoom;
  agents: Agent[];
  collectiveConversationId: string | null;
  spentUsd: number;
  agentSpentUsd: Record<string, number>;
}

export function useRoom(id: string) {
  return useQuery({ queryKey: qk.warroom(id), queryFn: () => api.get<RoomDetail>(`/warrooms/${id}`) });
}

export const STATUS_LABEL: Record<string, string> = {
  routing: "analyse la demande",
  working: "travaille",
  synthesizing: "synthétise",
  answering: "répond",
  idle: "disponible",
  error: "erreur",
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  todo: "À faire",
  in_progress: "En cours",
  review: "En revue",
  done: "Terminé",
  blocked: "Bloqué",
};

export const TASK_STATUSES = ["todo", "in_progress", "review", "done", "blocked"] as const;
