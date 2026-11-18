import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router";
import {
  LayoutDashboard, Swords, FolderKanban, Bot, MessagesSquare, Cpu, Sparkles, Plug, BarChart3, Files, Settings, PanelLeftClose,
  PanelLeftOpen, Search, Sun, Moon, CircleUser,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLimitState, useSettings, useSystemStatus } from "@/lib/queries";
import { LimitBanner } from "../limits/LimitBanner";
import { LimitReportDialog, WindowMeter } from "../limits/LimitReport";
import { GlobalApprovals } from "@/features/chat/ToolCalls";
import { Kbd, StatusDot, Tooltip } from "../ui/primitives";
import { CommandPalette } from "./CommandPalette";
import { t } from "@/i18n";

export const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/warrooms", label: "War Rooms", icon: Swords },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/chats", label: "Chats", icon: MessagesSquare },
  { to: "/providers", label: "Models & Providers", icon: Cpu },
  { to: "/skills", label: "Skills", icon: Sparkles },
  { to: "/mcp", label: "MCP Servers", icon: Plug },
  { to: "/usage", label: "Usage & Costs", icon: BarChart3 },
  { to: "/files", label: "Files & Knowledge", icon: Files },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function readCollapsed() {
  try {
    return localStorage.getItem("wr-sidebar") === "collapsed";
  } catch {
    return false;
  }
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("wr-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
    setDark(next);
  };
  return { dark, toggle };
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const status = useSystemStatus();
  const settings = useSettings();
  const limits = useLimitState();
  const [quotaReport, setQuotaReport] = useState(false);
  const theme = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    try {
      localStorage.setItem("wr-sidebar", collapsed ? "collapsed" : "open");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setCollapsed((v) => !v);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        navigate("/chats?new=1");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const s = status.data;
  const systemState: "ok" | "error" | "warning" | "unknown" = status.isError
    ? "error"
    : !s
      ? "unknown"
      : s.providers.error > 0 || s.mcp.error > 0
        ? "warning"
        : s.providers.configured > 0
          ? "ok"
          : "warning";
  const displayName = (settings.data?.["user.displayName"] as string) || t("Vous");

  return (
    <div className="flex h-full">
      <aside className={cn("flex shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200", collapsed ? "w-[56px]" : "w-[232px]")}>
        <div className={cn("flex h-14 items-center gap-2.5 border-b border-border", collapsed ? "justify-center px-0" : "px-4")}>
          <div className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-3">
            <div className="size-2.5 rounded-full bg-accent" />
            <div className="absolute inset-1 rounded-full border border-accent/40" />
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="text-[13px] font-semibold tracking-[0.12em]">WAR ROOM</div>
              <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
                <StatusDot status={systemState} className="size-1.5" />
                {status.isError ? t("API injoignable") : s ? t(s.providers.configured > 1 ? "{count} fournisseurs connectés" : "{count} fournisseur connecté", { count: s.providers.configured }) : "…"}
              </div>
            </div>
          ) : null}
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className={cn(
            "mx-2 mt-3 flex h-8 items-center gap-2 rounded-md border border-border bg-surface-2 text-[13px] text-fg-subtle hover:text-fg",
            collapsed ? "justify-center px-0" : "px-2.5",
          )}
          aria-label={t("Rechercher")}
        >
          <Search className="size-3.5" />
          {!collapsed ? (
            <>
              <span className="flex-1 text-left">{t("Rechercher…")}</span>
              <Kbd>Ctrl K</Kbd>
            </>
          ) : null}
        </button>

        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2">
          {NAV.map((item) => (
            <Tooltip key={item.to} content={collapsed ? item.label : null} side="right">
              <NavLink
                to={item.to}
                end={"end" in item ? item.end : false}
                className={({ isActive }) =>
                  cn(
                    "flex h-8 items-center gap-2.5 rounded-md text-[13px] transition-colors [&_svg]:size-4 [&_svg]:shrink-0",
                    collapsed ? "justify-center" : "px-2.5",
                    isActive ? "bg-surface-3 text-fg font-medium" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                  )
                }
              >
                <item.icon />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </NavLink>
            </Tooltip>
          ))}
        </nav>

        <div className="space-y-1 border-t border-border p-2">
          {!collapsed && limits.data && limits.data.windows.some((w) => w.utilization !== null || w.isReset) ? (
            <button onClick={() => setQuotaReport(true)} className="block w-full space-y-1.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-2" title={t("Rapport des limites Claude")}>
              <div className="text-[11px] text-fg-subtle">{t("Abonnement Claude")}</div>
              {limits.data.windows.map((w) => (
                <WindowMeter key={w.key} w={w} pauseAt={limits.data!.pauseAt} compact />
              ))}
            </button>
          ) : null}
          {!collapsed && s ? (
            <div className="space-y-1 px-2.5 py-1.5 text-[11px] text-fg-subtle">
              <div className="flex items-center justify-between">
                <span>{t("Fournisseurs")}</span>
                <span className="flex items-center gap-1.5">
                  <StatusDot status={s.providers.error ? "error" : s.providers.ok ? "ok" : "unknown"} className="size-1.5" />
                  {s.providers.ok}/{s.providers.configured} OK
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>{t("Serveurs MCP")}</span>
                <span className="flex items-center gap-1.5">
                  <StatusDot status={s.mcp.error ? "error" : s.mcp.connected ? "ok" : "unknown"} className="size-1.5" />
                  {s.mcp.connected}/{s.mcp.total}
                </span>
              </div>
            </div>
          ) : null}
          <div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "")}>
            <NavLink to="/settings" className={cn("flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg", collapsed ? "justify-center" : "px-2.5")}>
              <CircleUser className="size-4 shrink-0" />
              {!collapsed ? <span className="truncate">{displayName}</span> : null}
            </NavLink>
            <Tooltip content={theme.dark ? t("Thème clair") : t("Thème sombre")} side="right">
              <button onClick={theme.toggle} className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={t("Changer de thème")}>
                {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </Tooltip>
            <Tooltip content={collapsed ? t("Déplier (Ctrl B)") : t("Replier (Ctrl B)")} side="right">
              <button onClick={() => setCollapsed((v) => !v)} className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={t("Replier la barre latérale")}>
                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <LimitBanner />
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <GlobalApprovals />
      <LimitReportDialog open={quotaReport} onOpenChange={setQuotaReport} />
    </div>
  );
}
