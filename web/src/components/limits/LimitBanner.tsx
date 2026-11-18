import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, PauseCircle, PlayCircle, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useLimitState } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { LimitReportDialog, windowSentence } from "./LimitReport";
import { locale, t } from "@/i18n";

function dismissedKey(k: string) {
  try {
    return sessionStorage.getItem(`wr-limit-dismiss-${k}`) === "1";
  } catch {
    return false;
  }
}

/**
 * Top-of-page banner for the Claude subscription quota:
 * - "ready": quota reset, paused work can resume (asks the user);
 * - "paused": guard is holding Claude calls until the reset;
 * - "warning": close to the threshold or predicted to hit it before the reset.
 */
export function LimitBanner() {
  const { data: state } = useLimitState();
  const qc = useQueryClient();
  const [report, setReport] = useState(false);
  const [, force] = useState(0);
  const resumeAll = useMutation({
    mutationFn: () => api.post<{ started: boolean; count?: number; reason?: string }>("/limits/paused/resume-all"),
    onSuccess: (r) => {
      if (r.started) toast.success(t("Reprise de {count} travail(aux) en arrière-plan.", { count: r.count }));
      else toast(r.reason ?? t("Rien à reprendre"));
      void qc.invalidateQueries({ queryKey: qk.limits });
      void qc.invalidateQueries({ queryKey: qk.paused });
      setTimeout(() => void qc.invalidateQueries(), 5000);
    },
  });
  if (!state || !state.enabled) return null;

  const warnWindows = state.windows.filter((w) => w.level === "warning");
  let kind: "ready" | "paused" | "warning" | null = null;
  if (state.readyCount > 0 && !state.shouldPause) kind = "ready";
  else if (state.shouldPause) kind = "paused";
  else if (warnWindows.length) kind = "warning";
  if (!kind) return <LimitReportDialog open={report} onOpenChange={setReport} />;

  const key = `${kind}-${state.resumeAt ?? ""}-${warnWindows.map((w) => w.resetsAt).join(",")}`;
  if (kind === "warning" && dismissedKey(key)) return null;
  const resumeTime = state.resumeAt ? new Date(state.resumeAt).toLocaleString(locale(), { weekday: "short", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-5 py-2 text-[13px]",
          kind === "ready" ? "border-success/30 bg-success/10" : kind === "paused" ? "border-danger/30 bg-danger/10" : "border-warning/30 bg-warning/10",
        )}
      >
        {kind === "ready" ? <PlayCircle className="size-4 shrink-0 text-success" /> : kind === "paused" ? <PauseCircle className="size-4 shrink-0 text-danger" /> : <AlertTriangle className="size-4 shrink-0 text-warning" />}
        <span className="min-w-0 flex-1">
          {kind === "ready" ? (
            <>
              <b>{t("Limites Claude réinitialisées.")}</b> {t("{count} travail(aux) mis en pause peuvent reprendre. Voulez-vous continuer ?", { count: state.readyCount })}
            </>
          ) : kind === "paused" ? (
            <>
              <b>{t("Claude en pause")}</b> ({state.pauseReason}). {resumeTime ? t("Les nouveaux appels Claude sont retenus jusqu'à {time}", { time: resumeTime }) : t("Les nouveaux appels Claude sont retenus")}
              {state.pausedCount ? ` · ${t("{count} travail(aux) en pause", { count: state.pausedCount })}` : ""}. {t("Les autres fournisseurs restent utilisables.")}
            </>
          ) : (
            <>
              <b>{t("Limite Claude proche.")}</b> {warnWindows.map((w) => windowSentence(w, state.pauseAt)).join(" — ")}
            </>
          )}
        </span>
        <div className="flex items-center gap-1.5">
          {kind === "ready" ? (
            <Button size="sm" variant="primary" onClick={() => resumeAll.mutate()} loading={resumeAll.isPending}>
              {t("Tout reprendre")}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setReport(true)}>
            {kind === "ready" ? t("Choisir") : t("Rapport")}
          </Button>
          {kind === "warning" ? (
            <button
              aria-label={t("Masquer")}
              className="rounded p-1 text-fg-subtle hover:bg-surface-2 hover:text-fg"
              onClick={() => {
                try {
                  sessionStorage.setItem(`wr-limit-dismiss-${key}`, "1");
                } catch {
                  /* ignore */
                }
                force((n) => n + 1);
              }}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <LimitReportDialog open={report} onOpenChange={setReport} />
    </>
  );
}
