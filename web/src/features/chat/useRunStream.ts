import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { streamRun } from "@/lib/api";
import type { MessageDTO, RunEvent, ToolApprovalRequest, ToolCallRecord } from "@shared/types";

function upsertToolCall(m: MessageDTO, call: ToolCallRecord): MessageDTO {
  const calls = m.meta.toolCalls ?? [];
  const next = calls.some((c) => c.id === call.id) ? calls.map((c) => (c.id === call.id ? call : c)) : [...calls, call];
  return { ...m, meta: { ...m.meta, toolCalls: next } };
}

/**
 * Holds a message list and applies RunEvents from an SSE run to it
 * (messages, deltas, plans, MCP tool calls and approval requests), with cancellation.
 */
export function useRunStream(initial: MessageDTO[] = []) {
  const [messages, setMessages] = useState<MessageDTO[]>(initial);
  const [running, setRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState<Record<string, string>>({});
  const [approvals, setApprovals] = useState<ToolApprovalRequest[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((e: RunEvent) => {
    switch (e.type) {
      case "message_created":
      case "plan":
      case "message_done":
        setMessages((prev) => (prev.some((m) => m.id === e.message.id) ? prev.map((m) => (m.id === e.message.id ? e.message : m)) : [...prev, e.message]));
        break;
      case "delta":
        setMessages((prev) => prev.map((m) => (m.id === e.messageId ? { ...m, content: m.content + e.text } : m)));
        break;
      case "tool_call":
        if (e.messageId) setMessages((prev) => prev.map((m) => (m.id === e.messageId ? upsertToolCall(m, e.call) : m)));
        break;
      case "tool_approval":
        setApprovals((a) => [...a.filter((x) => x.approvalId !== e.request.approvalId), e.request]);
        break;
      case "tool_approval_resolved":
        setApprovals((a) => a.filter((x) => x.approvalId !== e.approvalId));
        break;
      case "status":
        if (e.agentId) setAgentStatus((s) => ({ ...s, [e.agentId!]: e.status }));
        break;
      case "notice":
        if (e.level === "error") toast.error(e.text);
        else if (e.level === "warning") toast.warning(e.text);
        else toast(e.text);
        break;
      case "error":
        toast.error(e.error);
        break;
      case "run_done":
        break;
    }
  }, []);

  const run = useCallback(
    async (url: string, body: unknown, onDone?: () => void) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setRunning(true);
      try {
        await streamRun(url, body, apply, ac.signal);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
        setAgentStatus({});
        setApprovals([]);
        abortRef.current = null;
        onDone?.();
      }
    },
    [apply],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return { messages, setMessages, running, run, stop, agentStatus, approvals };
}
