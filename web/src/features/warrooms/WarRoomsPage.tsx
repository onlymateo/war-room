import { Link } from "react-router";
import { Plus, Swords, Users, ListTodo, Trash2 } from "lucide-react";
import { useModels, useWarRooms } from "@/lib/queries";
import { fmtRelative, fmtUsd } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, Page, PageHeader, Progress, Skeleton, Tooltip } from "@/components/ui/primitives";
import { AgentAvatar, AUTONOMY_LABEL, STRATEGY_LABEL, modelLabel } from "@/components/domain";
import { useDeleteRoomDialog } from "./deletion";

export default function WarRoomsPage() {
  const rooms = useWarRooms();
  const models = useModels();
  const deleteRoom = useDeleteRoomDialog();
  return (
    <Page>
      <PageHeader
        icon={<Swords />}
        title="War Rooms"
        description="Un environnement de travail par projet : un orchestrateur, des agents spécialisés, une conversation collective."
        actions={
          <Link to="/warrooms/new">
            <Button variant="primary">
              <Plus /> Nouvelle War Room
            </Button>
          </Link>
        }
      />
      {rooms.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : !rooms.data?.length ? (
        <EmptyState
          icon={<Swords />}
          title="Aucune War Room"
          description="Créez une War Room, donnez un brief à votre orchestrateur : il proposera une équipe d'agents, des tâches et les Skills utiles."
          action={
            <Link to="/warrooms/new">
              <Button variant="primary">
                <Plus /> Créer la première
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rooms.data.map((r) => (
            <Link key={r.id} to={`/warrooms/${r.id}`}>
              <Card className="h-full p-4 transition-colors hover:border-border-strong">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold">{r.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{r.description || r.objective || "Pas de description"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {r.status !== "active" ? <Badge tone="warning">{r.status}</Badge> : null}
                    <Tooltip content="Supprimer la War Room">
                      <Button
                        variant="danger-ghost"
                        size="icon-sm"
                        aria-label={`Supprimer ${r.name}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          deleteRoom.ask({ id: r.id, name: r.name, agentCount: r.agentCount, openTasks: r.openTasks });
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                {r.orchestrator ? (
                  <div className="mt-4 flex items-center gap-2.5">
                    <AgentAvatar icon={r.orchestrator.icon} color={r.orchestrator.color} size="sm" />
                    <div className="min-w-0 text-xs">
                      <span className="font-medium">{r.orchestrator.name}</span>
                      <span className="text-fg-subtle"> · {modelLabel(models.data ?? [], r.orchestrator.providerId, r.orchestrator.modelId)}</span>
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <Badge>
                    <Users /> {Math.max(0, r.agentCount - 1)} agents
                  </Badge>
                  <Badge>
                    <ListTodo /> {r.openTasks} tâches ouvertes
                  </Badge>
                  <Badge tone="outline">{AUTONOMY_LABEL[r.autonomy]}</Badge>
                  <Badge tone="outline">{STRATEGY_LABEL[r.costStrategy]}</Badge>
                </div>
                <div className="mt-4 space-y-1">
                  <div className="flex justify-between text-[11px] text-fg-subtle">
                    <span>Dépense API {fmtUsd(r.spentUsd)}{r.budgetUsd !== null ? ` / ${fmtUsd(r.budgetUsd)}` : ""}</span>
                    <span>Mis à jour {fmtRelative(r.updatedAt)}</span>
                  </div>
                  {r.budgetUsd ? <Progress value={r.spentUsd / r.budgetUsd} tone={r.spentUsd / r.budgetUsd > 0.8 ? "danger" : "accent"} /> : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {deleteRoom.dialog}
    </Page>
  );
}
