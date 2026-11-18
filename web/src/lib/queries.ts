import { useQuery, QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { ModelDTO, ProviderDTO } from "@shared/types";
import type { Agent, WarRoomListItem } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export const qk = {
  providers: ["providers"] as const,
  models: ["models"] as const,
  status: ["system-status"] as const,
  settings: ["settings"] as const,
  warrooms: ["warrooms"] as const,
  warroom: (id: string) => ["warroom", id] as const,
  agents: ["agents"] as const,
  chats: (q: string, archived: boolean) => ["chats", q, archived] as const,
  conversation: (id: string) => ["conversation", id] as const,
  agentConversation: (id: string) => ["agent-conversation", id] as const,
  tasks: (scope: Record<string, string | undefined>) => ["tasks", scope] as const,
  activity: (warRoomId?: string) => ["activity", warRoomId ?? "all"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["project", id] as const,
  files: (scope: Record<string, string | undefined>) => ["files", scope] as const,
  usage: (days: number, warRoomId?: string) => ["usage", days, warRoomId ?? "all"] as const,
  contexts: (warRoomId?: string) => ["contexts", warRoomId ?? "all"] as const,
  budgets: ["budgets"] as const,
  skills: ["skills"] as const,
  mcp: ["mcp"] as const,
  memories: (scope?: string, scopeId?: string) => ["memories", scope ?? "all", scopeId ?? ""] as const,
  dashboard: ["dashboard"] as const,
};

export function useProviders() {
  return useQuery({ queryKey: qk.providers, queryFn: () => api.get<ProviderDTO[]>("/providers") });
}

export function useModels() {
  return useQuery({ queryKey: qk.models, queryFn: () => api.get<ModelDTO[]>("/models") });
}

/** Models the user can call now: enabled models of configured + enabled providers. */
export function useUsableModels() {
  const providers = useProviders();
  const models = useModels();
  const usable = new Set((providers.data ?? []).filter((p) => p.configured && p.enabled).map((p) => p.id));
  const list = (models.data ?? []).filter((m) => m.enabled && usable.has(m.providerId));
  return { models: list, providers: providers.data ?? [], isLoading: providers.isLoading || models.isLoading };
}

export function useSystemStatus() {
  return useQuery({
    queryKey: qk.status,
    queryFn: () =>
      api.get<{ version: string; dataDir: string; providers: { configured: number; ok: number; error: number }; mcp: { total: number; connected: number; error: number } }>(
        "/system/status",
      ),
    refetchInterval: 30_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.get<Record<string, unknown>>("/settings") });
}

export function useWarRooms() {
  return useQuery({ queryKey: qk.warrooms, queryFn: () => api.get<WarRoomListItem[]>("/warrooms") });
}

export function useAgents() {
  return useQuery({ queryKey: qk.agents, queryFn: () => api.get<Agent[]>("/agents") });
}
