import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queries";

/**
 * `?resume=<pausedWorkId>` on a conversation page resumes that paused work right
 * there, so the reply streams live in its own conversation.
 */
export function useResumeParam(run: (url: string, body: unknown, onDone?: () => void) => Promise<void>, ready: boolean, onDone?: () => void) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const started = useRef<string | null>(null);
  useEffect(() => {
    const id = params.get("resume");
    if (!id || !ready || started.current === id) return;
    started.current = id;
    const next = new URLSearchParams(params);
    next.delete("resume");
    setParams(next, { replace: true });
    void run(`/limits/paused/${id}/resume`, {}, () => {
      void qc.invalidateQueries({ queryKey: qk.limits });
      void qc.invalidateQueries({ queryKey: qk.paused });
      onDone?.();
    });
  }, [params, ready, run, setParams, qc, onDone]);
}
