import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, User, FileWarning, Download, CircleSlash } from "lucide-react";
import { toast } from "sonner";
import type { FileDTO, MessageDTO } from "@shared/types";
import { api } from "@/lib/api";
import { cn, fmtRelative } from "@/lib/utils";
import { AgentAvatar, UsageLine } from "@/components/domain";
import { Badge, Tooltip } from "@/components/ui/primitives";
import { Markdown } from "./Markdown";
import { fileIcon } from "./Composer";
import { ToolCallList } from "./ToolCalls";

export interface Speaker {
  name: string;
  icon: string;
  color: string;
  subtitle?: string;
}

function AttachmentChips({ ids }: { ids: string[] }) {
  const { data } = useQuery({
    queryKey: ["file-meta", ids.join(",")],
    queryFn: () => Promise.all(ids.map((id) => api.get<FileDTO>(`/files/${id}`).catch(() => null))),
    enabled: ids.length > 0,
    staleTime: Infinity,
  });
  if (!ids.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {(data ?? []).map((f, i) =>
        f ? (
          f.mime.startsWith("image/") ? (
            <a key={f.id} href={`/api/files/${f.id}/content`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
              <img src={`/api/files/${f.id}/content`} alt={f.name} className="h-24 max-w-48 object-cover" />
            </a>
          ) : (
            <a
              key={f.id}
              href={`/api/files/${f.id}/content?download=1`}
              className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-xs text-fg-muted hover:text-fg [&_svg]:size-3.5"
            >
              {fileIcon(f.mime)}
              <span className="max-w-48 truncate">{f.name}</span>
              <Download className="opacity-60" />
            </a>
          )
        ) : (
          <span key={ids[i]} className="text-xs text-fg-subtle">
            fichier supprimé
          </span>
        ),
      )}
    </div>
  );
}

export function MessageItem({ message, speaker, modelName, extra }: { message: MessageDTO; speaker?: Speaker; modelName?: string; extra?: ReactNode }) {
  const isUser = message.role === "user";
  const streaming = message.status === "streaming";
  const skipped = message.meta.skippedAttachments ?? [];
  return (
    <div className={cn("group flex gap-3 px-1 py-3", isUser && "")}>
      {isUser ? (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-muted">
          <User className="size-4" />
        </div>
      ) : (
        <AgentAvatar icon={speaker?.icon ?? "sparkles"} color={speaker?.color ?? "blue"} />
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium">{isUser ? "Vous" : (speaker?.name ?? "Assistant")}</span>
          {speaker?.subtitle ? <span className="text-xs text-fg-subtle">{speaker.subtitle}</span> : null}
          {!isUser && modelName ? <span className="text-[11px] text-fg-subtle">{modelName}</span> : null}
          {extra}
          <span className="text-[11px] text-fg-subtle">{fmtRelative(message.createdAt)}</span>
          {!isUser && message.content && !streaming ? (
            <Tooltip content="Copier">
              <button
                onClick={() => navigator.clipboard.writeText(message.content).then(() => toast.success("Copié"))}
                className="rounded p-0.5 text-fg-subtle opacity-0 transition-opacity hover:text-fg group-hover:opacity-100"
                aria-label="Copier"
              >
                <Copy className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {message.meta.instruction ? (
          <div className="mb-2 rounded-md border-l-2 border-accent/50 bg-accent-soft px-2.5 py-1.5 text-xs text-fg-muted">
            <span className="font-medium text-fg">Mission : </span>
            {message.meta.instruction}
          </div>
        ) : null}
        {message.meta.toolCalls?.length ? <ToolCallList calls={message.meta.toolCalls} /> : null}
        {isUser ? (
          <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{message.content}</div>
        ) : message.content ? (
          <Markdown text={message.content} />
        ) : streaming ? (
          <div className="flex items-center gap-1 py-1.5">
            <span className="size-1.5 animate-pulse-dot rounded-full bg-fg-subtle" />
            <span className="size-1.5 animate-pulse-dot rounded-full bg-fg-subtle [animation-delay:200ms]" />
            <span className="size-1.5 animate-pulse-dot rounded-full bg-fg-subtle [animation-delay:400ms]" />
          </div>
        ) : null}
        {streaming && message.content ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse-dot bg-accent align-middle" /> : null}
        <AttachmentChips ids={message.attachmentIds} />
        {skipped.length ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
            <FileWarning className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Non transmis au modèle : {skipped.map((s) => `${s.name} (${s.reason})`).join(" ; ")}. Le modèle ne les a pas vus.
            </span>
          </div>
        ) : null}
        {message.status === "error" ? (
          <div className="mt-2 flex items-start gap-1.5 rounded-md bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="whitespace-pre-wrap">{message.error ?? "Erreur"}</span>
          </div>
        ) : null}
        {message.status === "aborted" ? (
          <div className="mt-1.5">
            <Badge tone="neutral">
              <CircleSlash /> Interrompu
            </Badge>
          </div>
        ) : null}
        {message.meta.usage && !streaming ? <UsageLine usage={message.meta.usage} className="mt-2" /> : null}
      </div>
    </div>
  );
}

/** Scroll container that sticks to the bottom while new content streams in. */
export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}
