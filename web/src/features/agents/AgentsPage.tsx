import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Bot, Crown, MessageSquare, Search, Swords } from "lucide-react";
import { useAgents, useModels, useWarRooms } from "@/lib/queries";
import { fmtUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card, EmptyState, Page, PageHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { AgentAvatar, modelLabel } from "@/components/domain";

export default function AgentsPage() {
  const agents = useAgents();
  const models = useModels();
  const rooms = useWarRooms();
  const [roomFilter, setRoomFilter] = useState("");
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (agents.data ?? []).filter((a) => {
      if (roomFilter && a.warRoomId !== roomFilter) return false;
      if (role && a.role !== role) return false;
      if (!needle) return true;
      return [a.name, a.function, a.description, a.warRoomName ?? ""].some((s) => s.toLowerCase().includes(needle));
    });
  }, [agents.data, roomFilter, role, q]);

  const total = agents.data?.length ?? 0;
  const orchestrators = (agents.data ?? []).filter((a) => a.role === "orchestrator").length;

  return (
    <Page wide>
      <PageHeader
        icon={<Bot />}
        title="Agents"
        description={
          total
            ? `${total} agent${total > 1 ? "s" : ""} dont ${orchestrators} orchestrateur${orchestrators > 1 ? "s" : ""}, répartis dans vos War Rooms.`
            : "Tous les agents de vos War Rooms."
        }
        actions={
          <Link to="/warrooms">
            <Button>
              <Swords /> War Rooms
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un agent…" className="pl-8" />
        </div>
        <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="w-56">
          <option value="">Toutes les War Rooms</option>
          {(rooms.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
          <option value="">Tous les rôles</option>
          <option value="orchestrator">Orchestrateurs</option>
          <option value="agent">Agents spécialisés</option>
        </Select>
        <p className="ml-auto text-xs text-fg-subtle">Les agents se créent et se configurent depuis leur War Room.</p>
      </div>

      {agents.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : agents.isError ? (
        <EmptyState title="Impossible de charger les agents" description={(agents.error as Error).message} />
      ) : !total ? (
        <EmptyState
          icon={<Bot />}
          title="Aucun agent"
          description="Créez une War Room : son orchestrateur analysera votre brief et proposera une équipe d'agents."
          action={
            <Link to="/warrooms/new">
              <Button variant="primary">Créer une War Room</Button>
            </Link>
          }
        />
      ) : !filtered.length ? (
        <EmptyState title="Aucun agent ne correspond aux filtres" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Agent</th>
                <th className="px-3 py-2 text-left font-medium">Rôle</th>
                <th className="px-3 py-2 text-left font-medium">War Room</th>
                <th className="px-3 py-2 text-left font-medium">Modèle</th>
                <th className="px-3 py-2 text-right font-medium">Skills</th>
                <th className="px-3 py-2 text-right font-medium">MCP</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((a) => {
                const chatHref = a.warRoomId ? `/warrooms/${a.warRoomId}/agents/${a.id}` : null;
                return (
                  <tr key={a.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <AgentAvatar icon={a.icon} color={a.color} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">{a.name}</div>
                          <div className="max-w-sm truncate text-xs text-fg-muted">{a.function || a.description || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {a.role === "orchestrator" ? (
                        <Badge tone="warning">
                          <Crown /> Orchestrateur
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Agent</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {a.warRoomId ? (
                        <Link to={`/warrooms/${a.warRoomId}`} className="text-fg-muted hover:text-fg hover:underline">
                          {a.warRoomName ?? "War Room"}
                        </Link>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {a.providerId && a.modelId ? (
                        <span className="text-fg-muted">{modelLabel(models.data ?? [], a.providerId, a.modelId)}</span>
                      ) : (
                        <Tooltip content="Cet agent utilise le modèle de l'orchestrateur de sa War Room">
                          <span className="text-fg-subtle">hérité</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{a.skills.length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">
                      {a.mcpServers.length}
                      {a.mcpServers.length && !a.permissions.useMcp ? (
                        <Tooltip content="Serveurs assignés mais permission MCP désactivée">
                          <span className="ml-1 text-warning">!</span>
                        </Tooltip>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{a.budgetUsd != null ? fmtUsd(a.budgetUsd) : "—"}</td>
                    <td className="px-2 py-2.5">
                      {chatHref ? (
                        <Tooltip content="Discuter avec cet agent">
                          <Link to={chatHref}>
                            <Button variant="ghost" size="icon-sm" aria-label={`Discuter avec ${a.name}`}>
                              <MessageSquare />
                            </Button>
                          </Link>
                        </Tooltip>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  );
}
