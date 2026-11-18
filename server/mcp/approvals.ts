import { newId } from "../lib/ids";
import type { ToolApprovalRequest } from "../../shared/types";

/**
 * Pending human approvals for sensitive MCP tools. A tool call waits here until
 * the user answers in the UI, the run is cancelled, or the timeout expires
 * (which counts as a refusal).
 */
interface Pending {
  request: ToolApprovalRequest;
  resolve: (approved: boolean) => void;
}

const pending = new Map<string, Pending>();
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export function requestApproval(
  info: Omit<ToolApprovalRequest, "approvalId" | "requestedAt">,
  signal: AbortSignal | undefined,
  onRequested: (request: ToolApprovalRequest) => void,
  timeoutMs = APPROVAL_TIMEOUT_MS,
): Promise<boolean> {
  const request: ToolApprovalRequest = { ...info, approvalId: newId("appr"), requestedAt: Date.now() };
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      pending.delete(request.approvalId);
      resolve(approved);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const onAbort = () => finish(false);
    if (signal?.aborted) return finish(false);
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(request.approvalId, { request, resolve: finish });
    onRequested(request);
  });
}

/** Returns false when the approval no longer exists (already answered, expired or cancelled). */
export function resolveApproval(approvalId: string, approved: boolean): boolean {
  const p = pending.get(approvalId);
  if (!p) return false;
  p.resolve(approved);
  return true;
}

export function listPendingApprovals(): ToolApprovalRequest[] {
  return [...pending.values()].map((p) => p.request);
}
