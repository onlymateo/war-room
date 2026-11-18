import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Swords, FolderKanban, ListTodo, Activity as ActivityIcon, Cpu, Plug, BarChart3, AlertTriangle, MessagesSquare,
  ArrowRight, Plus, Gauge,
} from "lucide-react";
import { api } from "@/lib/api";
import { qk, useProviders, useSystemStatus } from "@/lib/queries";
import { cn, fmtRelative, fmtTokens, fmtUsd, fmtPct } from "@/lib/utils";
import type { Activity, Conversation, Project, Task, WarRoom } from "@/lib/types";
import { SubscriptionQuota, type BudgetsData } from "./shared";
import { Badge, Card, CardHeader, EmptyState, Page, PageHeader, Progress, Skeleton, Stat, StatusDot } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

interface DashboardData {
  rooms: WarRoom[];
  projects: Project[];
  tasksInProgress: Task[];
  agentCount: number;
  recentConversations: Conversation[];
  activity: Activity[];
  usage24h: { calls: number; inputTokens: number | null; outputTokens: number | null; billedUsd: number; errors: number | null } | undefined;
}

const REFRESH = 15_000;

const SCOPE_LABEL: Record<string, string> = { global: "Global", project: "Projet", warroom: "War Room", agent: "Agent" };

function ListLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors hover:bg-surface-2">
      {children}
    </Link>
  );
}

function convHref(c: Conversation) {
  if (c.kind === "chat") return `/chats/${c.id}`;
  if (c.kind === "agent" && c.warRoomId && c.agentId) return `/warrooms/${c.warRoomId}/agents/${c.agentId}`;
  return c.warRoomId ? `/warrooms/${c.warRoomId}` : "/chats";
}

export default function DashboardPage() {
  const dash = useQuery({ queryKey: qk.dashboard, queryFn: () => api.get<DashboardData>("/dashboard"), refetchInterval: REFRESH });
  const budgets = useQuery({ queryKey: qk.budgets, queryFn: () => api.get<BudgetsData>("/usage/budgets"), refetchInterval: REFRESH });
  const status = useSystemStatus();
  const providers = useProviders();
  const navigate = useNavigate();

  const d = dash.data;
  const connected = (providers.data ?? []).filter((p) => p.configured && p.enabled);
  const alerts = (budgets.data?.items ?? []).filter((b) => b.level !== null && b.level >= 0.5);
  const nothingConfigured = !providers.isLoading && connected.length === 0;

  if (dash.isLoading) {
    return (
      <Page>
        <PageHeader title="Dashboard" icon={<LayoutDashboard />} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="mt-6 h-64" />
      </Page>
    );
  }

  if (dash.isError) {
    return (
      <Page>
        <PageHeader title="Dashboard" icon={<LayoutDashboard />} />
        <EmptyState icon={<AlertTriangle />} title="Impossible de charger le dashboard" description={(dash.error as Error).message} />
      </Page>
    );
  }

  const u = d?.usage24h;

  return (
    <Page wide>
      <PageHeader
        title="Dashboard"
        description="Vue d'ensemble en temps réel de vos War Rooms, agents et consommation IA."
        icon={<LayoutDashboard />}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate("/chats?new=1")}>
                <MessagesSquare /> Nouveau chat
              </Button>
            <Button variant="primary" onClick={() => navigate("/warrooms/new")}>
                <Plus /> Nouvelle War Room
              </Button>
          </>
        }
      />

      {nothingConfigured ? (
        <Card className="mb-6 border-accent/40">
          <div className="flex flex-col gap-4 px-5 py-5 md:flex-row md:items-center">
            <div className="flex-1">
              <h2 className="text-[15px] font-semibold">Bienvenue dans WAR ROOM</h2>
              <p className="mt-1 text-[13px] text-fg-muted">Deux étapes pour démarrer :</p>
              <ol className="mt-3 space-y-2 text-[13px]">
                <li className="flex items-start gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">1</span>
                  <span>
                    Connectez un fournisseur IA dans <Link to="/providers" className="text-accent underline-offset-2 hover:underline">Models & Providers</Link> — votre abonnement Claude via
                    Claude Code, une clé API, ou Ollama en local.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-semibold text-fg-muted">2</span>
                  <span>Créez une War Room, donnez un brief à votre orchestrateur et laissez-le proposer une équipe d'agents.</span>
                </li>
              </ol>
            </div>
            <Button variant="primary" size="lg" onClick={() => navigate("/providers")}>
                Connecter un fournisseur <ArrowRight />
              </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="War Rooms actives" value={d?.rooms.length ?? 0} hint={`${d?.agentCount ?? 0} agents au total`} />
        <Stat label="Tâches en cours" value={d?.tasksInProgress.length ?? 0} />
        <Stat
          label="Appels IA (24 h)"
          value={u?.calls ?? 0}
          hint={u?.errors ? `${u.errors} en erreur` : "tokens et coûts exacts rapportés par les fournisseurs"}
        />
        <Stat
          label="Facturé API (24 h)"
          value={fmtUsd(u?.billedUsd ?? 0)}
          hint={`↑ ${fmtTokens(u?.inputTokens ?? null, { compact: true })} · ↓ ${fmtTokens(u?.outputTokens ?? null, { compact: true })} tokens`}
        />
      </div>

      {alerts.length ? (
        <div className="mt-4 space-y-2">
          {alerts.map((a) => (
            <div
              key={`${a.scope}-${a.id}`}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]",
                a.level! >= 1 ? "border-danger/40 bg-danger/10 text-danger" : "border-warning/40 bg-warning/10 text-warning",
              )}
            >
              <AlertTriangle className="size-4 shrink-0" />
              <span className="font-medium">{a.level! >= 1 ? "Budget atteint" : `Budget à ${Math.round(a.level! * 100)} %`}</span>
              <span className="text-fg-muted">
                {SCOPE_LABEL[a.scope]} · {a.name} — {fmtUsd(a.spentUsd)} / {fmtUsd(a.limitUsd)}
              </span>
              <Link to="/usage" className="ml-auto text-xs underline-offset-2 hover:underline">
                Détails
              </Link>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader
              title="War Rooms actives"
              actions={
                <Link to="/warrooms" className="text-xs text-fg-muted hover:text-fg">
                  Tout voir
                </Link>
              }
            />
            {d?.rooms.length ? (
              <div className="divide-y divide-border">
                {d.rooms.map((r) => (
                  <ListLink key={r.id} to={`/warrooms/${r.id}`}>
                    <Swords className="size-4 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{r.name}</div>
                      {r.objective || r.description ? <div className="truncate text-xs text-fg-muted">{r.objective || r.description}</div> : null}
                    </div>
                    <span className="text-xs text-fg-subtle">{fmtRelative(r.updatedAt)}</span>
                  </ListLink>
                ))}
              </div>
            ) : (
              <EmptyState
                className="m-4"
                icon={<Swords />}
                title="Aucune War Room"
                description="Une War Room réunit un orchestrateur et des agents spécialisés autour d'un projet."
                action={
                  <Button variant="primary" size="sm" onClick={() => navigate("/warrooms/new")}>
                      <Plus /> Créer une War Room
                    </Button>
                }
              />
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Tâches en cours" />
              {d?.tasksInProgress.length ? (
                <div className="divide-y divide-border">
                  {d.tasksInProgress.map((t) => (
                    <ListLink key={t.id} to={t.warRoomId ? `/warrooms/${t.warRoomId}?tab=tasks` : "/projects"}>
                      <ListTodo className="size-4 shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="text-xs text-fg-subtle">{fmtRelative(t.updatedAt)}</span>
                    </ListLink>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucune tâche en cours.</p>
              )}
            </Card>
            <Card>
              <CardHeader
                title="Projets actifs"
                actions={
                  <Link to="/projects" className="text-xs text-fg-muted hover:text-fg">
                    Tout voir
                  </Link>
                }
              />
              {d?.projects.length ? (
                <div className="divide-y divide-border">
                  {d.projects.map((p) => (
                    <ListLink key={p.id} to={`/projects/${p.id}`}>
                      <FolderKanban className="size-4 shrink-0 text-fg-subtle" />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-fg-subtle">{fmtRelative(p.updatedAt)}</span>
                    </ListLink>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-6 text-center text-xs text-fg-subtle">
                  Aucun projet actif. <Link to="/projects?new=1" className="text-accent hover:underline">Créer un projet</Link>
                </p>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Dernières conversations" />
            {d?.recentConversations.length ? (
              <div className="divide-y divide-border">
                {d.recentConversations.map((c) => (
                  <ListLink key={c.id} to={convHref(c)}>
                    <MessagesSquare className="size-4 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    <Badge tone="outline">{c.kind === "chat" ? "Chat" : c.kind === "agent" ? "Agent" : "War Room"}</Badge>
                    <span className="text-xs text-fg-subtle">{fmtRelative(c.updatedAt)}</span>
                  </ListLink>
                ))}
              </div>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucune conversation pour l'instant.</p>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Fournisseurs IA"
              actions={
                <Link to="/providers" className="text-xs text-fg-muted hover:text-fg">
                  Gérer
                </Link>
              }
            />
            {connected.length ? (
              <div className="divide-y divide-border">
                {connected.map((p) => (
                  <ListLink key={p.id} to="/providers">
                    <StatusDot status={p.status === "ok" ? "ok" : p.status === "error" ? "error" : "unknown"} />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-fg-subtle">{p.modelCount} modèles</span>
                  </ListLink>
                ))}
              </div>
            ) : (
              <div className="px-4 py-5 text-center text-xs text-fg-subtle">
                <Cpu className="mx-auto mb-2 size-5" />
                Aucun fournisseur connecté.
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Serveurs MCP"
              actions={
                <Link to="/mcp" className="text-xs text-fg-muted hover:text-fg">
                  Gérer
                </Link>
              }
            />
            <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
              <Plug className="size-4 text-fg-subtle" />
              {status.data ? (
                status.data.mcp.total ? (
                  <span>
                    {status.data.mcp.connected}/{status.data.mcp.total} connectés
                    {status.data.mcp.error ? <span className="ml-2 text-danger">{status.data.mcp.error} en erreur</span> : null}
                  </span>
                ) : (
                  <span className="text-fg-subtle">Aucun serveur configuré</span>
                )
              ) : (
                <span className="text-fg-subtle">inconnu</span>
              )}
            </div>
          </Card>

          {budgets.data?.claudeCodeRateLimit ? <SubscriptionQuota raw={budgets.data.claudeCodeRateLimit} /> : null}

          <Card>
            <CardHeader
              title="Consommation"
              actions={
                <Link to="/usage" className="text-xs text-fg-muted hover:text-fg">
                  <BarChart3 className="inline size-3.5" /> Détails
                </Link>
              }
            />
            <div className="space-y-2 px-4 py-3">
              {(budgets.data?.items ?? []).slice(0, 5).map((b) => (
                <div key={`${b.scope}-${b.id}`} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-fg-muted">
                      {SCOPE_LABEL[b.scope]} · {b.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {fmtUsd(b.spentUsd)}
                      {b.limitUsd !== null ? <span className="text-fg-subtle"> / {fmtUsd(b.limitUsd)}</span> : <span className="text-fg-subtle"> · sans limite</span>}
                    </span>
                  </div>
                  {b.limitUsd ? (
                    <Progress value={b.spentUsd / b.limitUsd} tone={(b.level ?? 0) >= 1 ? "danger" : (b.level ?? 0) >= 0.8 ? "warning" : "accent"} />
                  ) : null}
                </div>
              ))}
              {!budgets.data?.items.length ? <p className="text-xs text-fg-subtle">Aucune dépense enregistrée.</p> : null}
              <p className="flex items-center gap-1.5 pt-1 text-[11px] text-fg-subtle">
                <Gauge className="size-3" /> Seules les dépenses API réelles sont comptées ; l'usage d'abonnement est exclu.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Activité récente" />
            {d?.activity.length ? (
              <ol className="space-y-0 px-4 py-2">
                {d.activity.map((a) => (
                  <li key={a.id} className="flex gap-2.5 py-1.5 text-xs">
                    <ActivityIcon className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
                    <div className="min-w-0 flex-1">
                      {a.warRoomId ? (
                        <Link to={`/warrooms/${a.warRoomId}`} className="text-fg hover:underline">
                          {a.summary}
                        </Link>
                      ) : (
                        <span className="text-fg">{a.summary}</span>
                      )}
                      <div className="text-[11px] text-fg-subtle">{fmtRelative(a.createdAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-4 py-6 text-center text-xs text-fg-subtle">Aucune activité.</p>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
