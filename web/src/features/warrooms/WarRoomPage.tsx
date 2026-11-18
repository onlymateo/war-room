import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft, MessageSquare, Network, Bot, ListTodo, Sparkles, Activity, BarChart3, Settings2, Crown, Trash2, FileText, CalendarClock, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeleteRoomDialog } from "./deletion";
import { useModels } from "@/lib/queries";
import { fmtUsd } from "@/lib/utils";
import { Badge, Skeleton, Tabs, Tooltip } from "@/components/ui/primitives";
import { AUTONOMY_HINT, AUTONOMY_LABEL, STRATEGY_HINT, STRATEGY_LABEL, modelLabel } from "@/components/domain";
import { useRoom } from "./shared";
import { CollectiveTab } from "./CollectiveTab";
import { OrgTab } from "./OrgTab";
import { AnalysisTab } from "./AnalysisTab";
import { ActivityTab, AgentsTab, RoomSettingsTab, RoomUsageTab, TasksTab } from "./RoomTabs";
import { ReportsTab } from "./ReportsTab";
import { RecapDialog } from "./RecapDialog";
import { SecretsDialog } from "./SecretsDialog";
import { t } from "@/i18n";

export default function WarRoomPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "collective";
  const { data, isLoading, error } = useRoom(id);
  const models = useModels();
  const navigate = useNavigate();
  const deleteRoom = useDeleteRoomDialog(() => navigate("/warrooms"));
  const [recapOpen, setRecapOpen] = useState(false);
  const [secretsOpen, setSecretsOpen] = useState(false);

  // ?recap=1 opens the context recap (link from the limit report).
  useEffect(() => {
    if (params.get("recap") === "1") {
      setRecapOpen(true);
      const next = new URLSearchParams(params);
      next.delete("recap");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  if (isLoading) {
    return (
      <div className="space-y-3 p-8">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-4 w-96" />
      </div>
    );
  }
  if (error || !data) return <div className="p-8 text-sm text-danger">{t("War Room introuvable.")}</div>;

  const { room, agents } = data;
  const orch = agents.find((a) => a.role === "orchestrator");
  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    setParams(next, { replace: true });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-border px-6 pt-4">
        <Link to="/warrooms" className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
          <ArrowLeft className="size-3.5" /> War Rooms
        </Link>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">{room.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              {orch ? (
                <span className="flex items-center gap-1">
                  <Crown className="size-3 text-amber-500" /> {orch.name} · {modelLabel(models.data ?? [], orch.providerId, orch.modelId)}
                </span>
              ) : null}
              <span>·</span>
              <span>{agents.length - 1} agents</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Tooltip content={t(AUTONOMY_HINT[room.autonomy])}>
              <span>
                <Badge tone="outline">{t(AUTONOMY_LABEL[room.autonomy])}</Badge>
              </span>
            </Tooltip>
            <Tooltip content={t(STRATEGY_HINT[room.costStrategy])}>
              <span>
                <Badge tone="outline">{t(STRATEGY_LABEL[room.costStrategy])}</Badge>
              </span>
            </Tooltip>
            <Tooltip content={t("Dépense API réellement facturée (hors usage couvert par un abonnement)")}>
              <span>
                <Badge tone={room.budgetUsd !== null && data.spentUsd >= room.budgetUsd * 0.8 ? "danger" : "neutral"}>
                  {fmtUsd(data.spentUsd)}
                  {room.budgetUsd !== null ? ` / ${fmtUsd(room.budgetUsd)}` : ""}
                </Badge>
              </span>
            </Tooltip>
            <Tooltip content={t("Clés secrètes : utilisables par les agents dans leurs outils, jamais lisibles par eux")}>
              <Button size="sm" variant="secondary" onClick={() => setSecretsOpen(true)}>
                <KeyRound /> {t("Clés")}
              </Button>
            </Tooltip>
            <Tooltip content={t("Récapitulatif du contexte, à transmettre à une autre IA")}>
              <Button size="sm" variant="secondary" onClick={() => setRecapOpen(true)}>
                <FileText /> {t("Récap contexte")}
              </Button>
            </Tooltip>
            <Tooltip content={t("Supprimer la War Room")}>
              <Button variant="danger-ghost" size="icon-sm" aria-label={t("Supprimer la War Room")} onClick={() => deleteRoom.ask({ id: room.id, name: room.name, agentCount: agents.length })}>
                <Trash2 />
              </Button>
            </Tooltip>
          </div>
        </div>
        <Tabs
          value={tab}
          onValueChange={setTab}
          className="mt-3 border-b-0"
          items={[
            { value: "collective", label: "Conversation", icon: <MessageSquare /> },
            { value: "org", label: t("Organisation"), icon: <Network /> },
            { value: "agents", label: "Agents", icon: <Bot />, count: agents.length },
            { value: "tasks", label: t("Tâches"), icon: <ListTodo /> },
            { value: "reports", label: t("Rapports"), icon: <CalendarClock /> },
            { value: "analysis", label: t("Analyse & Skills"), icon: <Sparkles /> },
            { value: "activity", label: t("Journal"), icon: <Activity /> },
            { value: "usage", label: t("Consommation"), icon: <BarChart3 /> },
            { value: "settings", label: t("Paramètres"), icon: <Settings2 /> },
          ]}
        />
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {tab === "collective" ? <CollectiveTab key={room.id} detail={data} /> : null}
        {tab === "org" ? <OrgTab detail={data} /> : null}
        {tab === "agents" ? <AgentsTab detail={data} /> : null}
        {tab === "tasks" ? <TasksTab detail={data} /> : null}
        {tab === "reports" ? <ReportsTab detail={data} /> : null}
        {tab === "analysis" ? <AnalysisTab detail={data} /> : null}
        {tab === "activity" ? <ActivityTab detail={data} /> : null}
        {tab === "usage" ? <RoomUsageTab detail={data} /> : null}
        {tab === "settings" ? <RoomSettingsTab detail={data} /> : null}
      </div>
      {deleteRoom.dialog}
      <RecapDialog warRoomId={room.id} open={recapOpen} onOpenChange={setRecapOpen} />
      <SecretsDialog warRoomId={room.id} agents={agents} open={secretsOpen} onOpenChange={setSecretsOpen} />
    </div>
  );
}
