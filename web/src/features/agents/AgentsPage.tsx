import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Bot, Crown, MessageSquare, Search, Swords, Trash2 } from "lucide-react";
import { useDeleteAgentDialog, useDeleteRoomDialog } from "../warrooms/deletion";
import { useAgents, useModels, useWarRooms } from "@/lib/queries";
import { fmtUsd } from "@/lib/utils";
import { t } from "@/i18n";
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
  const deleteAgent = useDeleteAgentDialog();
  const deleteRoom = useDeleteRoomDialog();

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
            ? t("{agents} dont {orchestrators}, répartis dans vos War Rooms.", {
                agents: total > 1 ? t("{count} agents", { count: total }) : t("{count} agent", { count: total }),
                orchestrators: orchestrators > 1 ? t("{count} orchestrateurs", { count: orchestrators }) : t("{count} orchestrateur", { count: orchestrators }),
              })
            : t("Tous les agents de vos War Rooms.")
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
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher un agent…")} className="pl-8" />
        </div>
        <Select value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)} className="w-56">
          <option value="">{t("Toutes les War Rooms")}</option>
          {(rooms.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-44">
          <option value="">{t("Tous les rôles")}</option>
          <option value="orchestrator">{t("Orchestrateurs")}</option>
          <option value="agent">{t("Agents spécialisés")}</option>
        </Select>
        <p className="ml-auto text-xs text-fg-subtle">{t("Les agents se créent et se configurent depuis leur War Room.")}</p>
      </div>

      {agents.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : agents.isError ? (
        <EmptyState title={t("Impossible de charger les agents")} description={(agents.error as Error).message} />
      ) : !total ? (
        <EmptyState
          icon={<Bot />}
          title={t("Aucun agent")}
          description={t("Créez une War Room : son orchestrateur analysera votre brief et proposera une équipe d'agents.")}
          action={
            <Link to="/warrooms/new">
              <Button variant="primary">{t("Créer une War Room")}</Button>
            </Link>
          }
        />
      ) : !filtered.length ? (
        <EmptyState title={t("Aucun agent ne correspond aux filtres")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Agent</th>
                <th className="px-3 py-2 text-left font-medium">{t("Rôle")}</th>
                <th className="px-3 py-2 text-left font-medium">War Room</th>
                <th className="px-3 py-2 text-left font-medium">{t("Modèle")}</th>
                <th className="px-3 py-2 text-right font-medium">Skills</th>
                <th className="px-3 py-2 text-right font-medium">MCP</th>
                <th className="px-3 py-2 text-right font-medium">Budget</th>
                <th className="w-20" />
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
                          <Crown /> {t("Orchestrateur")}
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
                        <Tooltip content={t("Cet agent utilise le modèle de l'orchestrateur de sa War Room")}>
                          <span className="text-fg-subtle">{t("hérité")}</span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{a.skills.length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">
                      {a.mcpServers.length}
                      {a.mcpServers.length && !a.permissions.useMcp ? (
                        <Tooltip content={t("Serveurs assignés mais permission MCP désactivée")}>
                          <span className="ml-1 text-warning">!</span>
                        </Tooltip>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{a.budgetUsd != null ? fmtUsd(a.budgetUsd) : "—"}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        {chatHref ? (
                          <Tooltip content={t("Discuter avec cet agent")}>
                            <Link to={chatHref}>
                              <Button variant="ghost" size="icon-sm" aria-label={t("Discuter avec {name}", { name: a.name })}>
                                <MessageSquare />
                              </Button>
                            </Link>
                          </Tooltip>
                        ) : null}
                        {a.role === "orchestrator" ? (
                          <Tooltip content={t("Un orchestrateur se supprime avec sa War Room : supprimer toute la War Room")}>
                            <Button
                              variant="danger-ghost"
                              size="icon-sm"
                              aria-label={t("Supprimer la War Room de {name}", { name: a.name })}
                              disabled={!a.warRoomId}
                              onClick={() => {
                                const room = rooms.data?.find((r) => r.id === a.warRoomId);
                                if (room) deleteRoom.ask({ id: room.id, name: room.name, agentCount: room.agentCount, openTasks: room.openTasks });
                              }}
                            >
                              <Trash2 />
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip content={t("Supprimer cet agent")}>
                            <Button variant="danger-ghost" size="icon-sm" aria-label={t("Supprimer {name}", { name: a.name })} onClick={() => deleteAgent.ask({ id: a.id, name: a.name, warRoomId: a.warRoomId })}>
                              <Trash2 />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {deleteAgent.dialog}
      {deleteRoom.dialog}
    </Page>
  );
}
