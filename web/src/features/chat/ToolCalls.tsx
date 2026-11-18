import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Wrench, ShieldAlert, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ToolApprovalRequest, ToolCallRecord } from "@shared/types";
import { api } from "@/lib/api";
import { cn, fmtMs } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";

const STATUS: Record<ToolCallRecord["status"], { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
  running: { label: "en cours", tone: "accent" },
  awaiting_approval: { label: "attend votre accord", tone: "warning" },
  done: { label: "ok", tone: "success" },
  error: { label: "erreur", tone: "danger" },
  denied: { label: "refusé", tone: "danger" },
};

function ToolCallRow({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const st = STATUS[call.status];
  return (
    <div className="rounded-md border border-border bg-surface-2/50">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
        <ChevronRight className={cn("size-3 shrink-0 text-fg-subtle transition-transform", open && "rotate-90")} />
        {call.status === "running" ? <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" /> : <Wrench className="size-3.5 shrink-0 text-fg-subtle" />}
        <span className="truncate">
          <span className="text-fg-muted">{call.serverName} › </span>
          <span className="font-mono">{call.tool}</span>
        </span>
        <Badge tone={st.tone} className="ml-auto">
          {st.label}
        </Badge>
        {call.durationMs !== undefined ? <span className="text-[11px] text-fg-subtle">{fmtMs(call.durationMs)}</span> : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          <div>
            <div className="mb-0.5 text-[11px] text-fg-subtle">Arguments</div>
            <pre className="max-h-40 overflow-auto rounded bg-bg p-2 font-mono text-[11px]">{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          {call.resultPreview ? (
            <div>
              <div className="mb-0.5 text-[11px] text-fg-subtle">Résultat (extrait transmis au modèle)</div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-bg p-2 font-mono text-[11px]">{call.resultPreview}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ToolCallList({ calls }: { calls: ToolCallRecord[] }) {
  if (!calls.length) return null;
  return (
    <div className="my-2 space-y-1">
      {calls.map((c) => (
        <ToolCallRow key={c.id} call={c} />
      ))}
    </div>
  );
}

/** Approvals currently displayed by a page's live stream (the global panel skips those). */
const shownByPage = new Set<string>();

/**
 * Floating panel for approvals requested by runs without a live page (e.g. work
 * resumed in the background after a quota reset). Polls the server.
 */
export function GlobalApprovals() {
  const { data } = useQuery({ queryKey: ["tool-approvals"], queryFn: () => api.get<ToolApprovalRequest[]>("/tool-approvals"), refetchInterval: 4000 });
  const orphan = (data ?? []).filter((a) => !shownByPage.has(a.approvalId));
  if (!orphan.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40 w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-3 shadow-2xl">
      <div className="mb-2 text-xs font-medium text-fg-muted">Autorisations en attente (travail en arrière-plan)</div>
      <ApprovalCards approvals={orphan} global />
    </div>
  );
}

/** Cards asking the user to approve or refuse sensitive tool calls requested by agents. */
export function ApprovalCards({ approvals, global }: { approvals: ToolApprovalRequest[]; global?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const ids = approvals.map((a) => a.approvalId).join(",");
  useEffect(() => {
    if (global) return;
    const list = ids ? ids.split(",") : [];
    list.forEach((id) => shownByPage.add(id));
    return () => list.forEach((id) => shownByPage.delete(id));
  }, [ids, global]);
  if (!approvals.length) return null;
  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await api.post(`/tool-approvals/${id}`, { approve });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mb-2 space-y-2">
      {approvals.map((a) => (
        <div key={a.approvalId} className="rounded-lg border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-center gap-2 text-[13px]">
            <ShieldAlert className="size-4 shrink-0 text-warning" />
            <span>
              <b>{a.agentName ?? "Un agent"}</b> veut exécuter un outil sensible : <span className="text-fg-muted">{a.serverName} › </span>
              <span className="font-mono">{a.tool}</span>
            </span>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-bg p-2 font-mono text-[11px]">{JSON.stringify(a.args, null, 2)}</pre>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => decide(a.approvalId, true)} loading={busy === a.approvalId}>
              <Check /> Autoriser
            </Button>
            <Button size="sm" variant="ghost" onClick={() => decide(a.approvalId, false)} disabled={busy === a.approvalId}>
              <X /> Refuser
            </Button>
            <span className="ml-auto self-center text-[11px] text-fg-subtle">Sans réponse sous 10 min, l'appel est refusé.</span>
          </div>
        </div>
      ))}
    </div>
  );
}
