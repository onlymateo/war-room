import { useRef, useState, type ReactNode, type KeyboardEvent, type DragEvent, type ClipboardEvent } from "react";
import { Paperclip, ArrowUp, Square, X, FileText, Image as ImageIcon, Film, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn, fmtBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/primitives";
import type { FileDTO } from "@shared/types";

export function fileIcon(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon />;
  if (mime.startsWith("video/")) return <Film />;
  return <FileText />;
}

export function Composer({
  onSend,
  onStop,
  running,
  disabled,
  disabledReason,
  placeholder = "Écrire un message…",
  scope,
  toolbar,
  allowEmpty,
}: {
  onSend: (content: string, attachments: FileDTO[]) => void | Promise<void>;
  onStop?: () => void;
  running?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  placeholder?: string;
  scope?: { conversationId?: string; warRoomId?: string; projectId?: string };
  toolbar?: ReactNode;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<FileDTO[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const upload = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setUploading((n) => n + arr.length);
    for (const f of arr) {
      const form = new FormData();
      form.append("file", f);
      if (scope?.conversationId) form.append("conversationId", scope.conversationId);
      if (scope?.warRoomId) form.append("warRoomId", scope.warRoomId);
      if (scope?.projectId) form.append("projectId", scope.projectId);
      try {
        const [stored] = await api.upload<FileDTO[]>("/files", form);
        setFiles((prev) => [...prev, stored]);
      } catch (err) {
        toast.error(`${f.name} : ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const canSend = !disabled && !running && uploading === 0 && (text.trim().length > 0 || files.length > 0 || allowEmpty);

  const send = async () => {
    if (!canSend) return;
    const content = text;
    const attachments = files;
    setText("");
    setFiles([]);
    if (taRef.current) taRef.current.style.height = "";
    await onSend(content, attachments);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };

  const onPaste = (e: ClipboardEvent) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length) {
      e.preventDefault();
      void upload(pasted);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn("rounded-xl border bg-surface shadow-sm transition-colors", dragOver ? "border-accent" : "border-border", disabled && "opacity-60")}
    >
      {files.length || uploading ? (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
          {files.map((f) => (
            <span key={f.id} className="flex h-7 items-center gap-1.5 rounded-md bg-surface-2 pl-2 pr-1 text-xs text-fg-muted [&_svg]:size-3.5">
              {fileIcon(f.mime)}
              <span className="max-w-40 truncate text-fg">{f.name}</span>
              <span className="text-fg-subtle">{fmtBytes(f.size)}</span>
              <button onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))} className="rounded p-0.5 hover:bg-surface-3" aria-label="Retirer">
                <X />
              </button>
            </span>
          ))}
          {uploading ? (
            <span className="flex h-7 items-center gap-1.5 px-2 text-xs text-fg-subtle">
              <Loader2 className="size-3.5 animate-spin" /> Envoi…
            </span>
          ) : null}
        </div>
      ) : null}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`;
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        rows={1}
        disabled={disabled}
        placeholder={disabled && disabledReason ? disabledReason : placeholder}
        className="block max-h-[280px] min-h-[52px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[13.5px] leading-relaxed outline-none placeholder:text-fg-subtle"
      />
      <div className="flex items-center gap-2 px-2.5 pb-2.5">
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />
        <Tooltip content="Joindre des fichiers (ou glisser-déposer, coller une image)">
          <Button variant="ghost" size="icon-sm" onClick={() => inputRef.current?.click()} disabled={disabled} aria-label="Joindre">
            <Paperclip />
          </Button>
        </Tooltip>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">{toolbar}</div>
        {running ? (
          <Button variant="secondary" size="sm" onClick={onStop}>
            <Square className="!size-3 fill-current" /> Arrêter
          </Button>
        ) : (
          <Button variant="primary" size="icon-sm" onClick={() => void send()} disabled={!canSend} aria-label="Envoyer">
            <ArrowUp />
          </Button>
        )}
      </div>
    </div>
  );
}
