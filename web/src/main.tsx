import { StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { getLang, onLangChange, t } from "./i18n";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { queryClient } from "./lib/queries";
import { AppShell } from "./components/layout/AppShell";
import { TooltipProvider, Skeleton } from "./components/ui/primitives";
import "./styles.css";

const DashboardPage = lazy(() => import("./features/dashboard/DashboardPage"));
const WarRoomsPage = lazy(() => import("./features/warrooms/WarRoomsPage"));
const CreateWarRoomPage = lazy(() => import("./features/warrooms/CreateWarRoomPage"));
const WarRoomPage = lazy(() => import("./features/warrooms/WarRoomPage"));
const AgentChatPage = lazy(() => import("./features/warrooms/AgentChatPage"));
const ProjectsPage = lazy(() => import("./features/projects/ProjectsPage"));
const ProjectPage = lazy(() => import("./features/projects/ProjectPage"));
const AgentsPage = lazy(() => import("./features/agents/AgentsPage"));
const ChatsPage = lazy(() => import("./features/chats/ChatsPage"));
const ProvidersPage = lazy(() => import("./features/providers/ProvidersPage"));
const SkillsPage = lazy(() => import("./features/skills/SkillsPage"));
const McpPage = lazy(() => import("./features/mcp/McpPage"));
const UsagePage = lazy(() => import("./features/usage/UsagePage"));
const FilesPage = lazy(() => import("./features/files/FilesPage"));
const SettingsPage = lazy(() => import("./features/settings/SettingsPage"));

function Loading() {
  return (
    <div className="mx-auto max-w-6xl space-y-3 px-8 py-8">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="mt-6 h-40 w-full" />
    </div>
  );
}

function RoutedBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}

function NotFound() {
  return <div className="p-10 text-sm text-fg-muted">{t("Page introuvable.")}</div>;
}

/** Re-mounts the whole app when the language changes, so every t() call re-renders. */
function LangRoot({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState(getLang());
  useEffect(() => {
    document.documentElement.lang = lang;
    const off = onLangChange(setLangState);
    return () => {
      off();
    };
  }, [lang]);
  return <div key={lang} className="contents">{children}</div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangRoot>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <AppShell>
            <RoutedBoundary>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/warrooms" element={<WarRoomsPage />} />
                <Route path="/warrooms/new" element={<CreateWarRoomPage />} />
                <Route path="/warrooms/:id" element={<WarRoomPage />} />
                <Route path="/warrooms/:id/agents/:agentId" element={<AgentChatPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:id" element={<ProjectPage />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/chats" element={<ChatsPage />} />
                <Route path="/chats/:id" element={<ChatsPage />} />
                <Route path="/providers" element={<ProvidersPage />} />
                <Route path="/skills" element={<SkillsPage />} />
                <Route path="/mcp" element={<McpPage />} />
                <Route path="/usage" element={<UsagePage />} />
                <Route path="/files" element={<FilesPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </RoutedBoundary>
          </AppShell>
          <Toaster theme="system" position="bottom-right" toastOptions={{ className: "!bg-surface-2 !border-border !text-fg" }} />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
    </LangRoot>
  </StrictMode>,
);
