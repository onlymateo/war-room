import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Download, Eye, Files, Loader2, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk, useWarRooms } from "@/lib/queries";
import type { FileDTO, Project } from "@/lib/types";
import { fmtBytes, fmtRelative } from "@/lib/utils";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Badge, Card, Dialog, EmptyState, Page, PageHeader, Skeleton, Tabs, Tooltip } from "@/components/ui/primitives";
import { fileIcon } from "@/features/chat/Composer";
import { MemoryPanel } from "./MemoryPanel";

const EXTRACTION: Record<FileDTO["extraction"], { label: string; tone: "success" | "neutral" | "warning" | "danger"; hint: string }> = {
  text: { label: "Texte extrait", tone: "success", hint: "Le texte est indexé et peut être transmis aux modèles." },
  none: { label: "Aucun texte", tone: "neutral", hint: "Le fichier a été lu mais ne contient pas de texte exploitable (ex. PDF scanné)." },
  unsupported: {
    label: "Non extrait",
    tone: "neutral",
    hint: "Format sans extraction de texte. Les images peuvent tout de même être envoyées aux modèles compatibles vision.",
  },
  failed: { label: "Échec d'extraction", tone: "danger", hint: "L'extraction du texte a échoué. Le fichier reste stocké." },
};

export default function FilesPage() {
  const [tab, setTab] = useState<"files" | "memory">("files");
  return (
    <Page wide>
      <PageHeader icon={<Files />} title="Files & Knowledge" description={t("Documents stockés localement et mémoire structurée de vos projets et agents.")} />
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "files" | "memory")}
        className="mb-5"
        items={[
          { value: "files", label: t("Fichiers"), icon: <Files /> },
          { value: "memory", label: t("Mémoire"), icon: <Brain /> },
        ]}
      />
      {tab === "files" ? <FilesTab /> : <MemoryPanel />}
    </Page>
  );
}

function FilesTab() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [projectId, setProjectId] = useState("");
  const [warRoomId, setWarRoomId] = useState("");
  const [uploadProject, setUploadProject] = useState("");
  const [uploadRoom, setUploadRoom] = useState("");
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<FileDTO | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const focus = params.get("focus");
    if (focus) {
      setPreview(focus);
      params.delete("focus");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const scope = { q: debounced || undefined, projectId: projectId || undefined, warRoomId: warRoomId || undefined };
  const files = useQuery({
    queryKey: qk.files(scope),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (scope.q) sp.set("q", scope.q);
      if (scope.projectId) sp.set("projectId", scope.projectId);
      if (scope.warRoomId) sp.set("warRoomId", scope.warRoomId);
      return api.get<FileDTO[]>(`/files${sp.size ? `?${sp}` : ""}`);
    },
  });
  const projects = useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>("/projects") });
  const rooms = useWarRooms();
  const projectName = (id: string | null) => (id ? projects.data?.find((p) => p.id === id)?.name : null);
  const roomName = (id: string | null) => (id ? rooms.data?.find((r) => r.id === id)?.name : null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["files"] });

  const upload = async (list: FileList) => {
    const arr = Array.from(list);
    setUploading((n) => n + arr.length);
    let ok = 0;
    for (const f of arr) {
      const form = new FormData();
      form.append("file", f);
      if (uploadProject) form.append("projectId", uploadProject);
      if (uploadRoom) form.append("warRoomId", uploadRoom);
      try {
        await api.upload<FileDTO[]>("/files", form);
        ok++;
      } catch (err) {
        toast.error(t("{name} : {error}", { name: f.name, error: (err as Error).message }));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (ok) toast.success(ok > 1 ? t("{count} fichiers importés", { count: ok }) : t("{count} fichier importé", { count: ok }));
    invalidate();
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/files/${id}`),
    onSuccess: () => {
      toast.success(t("Fichier supprimé"));
      setToDelete(null);
      invalidate();
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const saveTags = useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) => api.patch<FileDTO>(`/files/${id}`, { tags }),
    onSuccess: invalidate,
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-subtle">{t("Rattacher au projet")}</span>
          <Select value={uploadProject} onChange={(e) => setUploadProject(e.target.value)} className="w-48">
            <option value="">{t("Aucun")}</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-subtle">{t("Rattacher à la War Room")}</span>
          <Select value={uploadRoom} onChange={(e) => setUploadRoom(e.target.value)} className="w-48">
            <option value="">{t("Aucune")}</option>
            {(rooms.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files).then(() => (e.target.value = ""))} />
        <Button variant="primary" onClick={() => inputRef.current?.click()} loading={uploading > 0}>
          {uploading ? null : <Upload />} {t("Importer des fichiers")}
        </Button>
        <p className="ml-auto max-w-sm text-[11px] text-fg-subtle">
          {t("Max 50 Mo par fichier. Les fichiers restent sur cette machine (dossier data/files). Le texte des PDF, Word, CSV, code et fichiers texte est extrait.")}
        </p>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher par nom…")} className="pl-8" />
        </div>
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="w-48">
          <option value="">{t("Tous les projets")}</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={warRoomId} onChange={(e) => setWarRoomId(e.target.value)} className="w-48">
          <option value="">{t("Toutes les War Rooms")}</option>
          {(rooms.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        {files.isFetching ? <Loader2 className="size-3.5 animate-spin text-fg-subtle" /> : null}
      </div>

      {files.isLoading ? (
        <Skeleton className="h-60 w-full" />
      ) : files.isError ? (
        <EmptyState title={t("Impossible de charger les fichiers")} description={(files.error as Error).message} />
      ) : !files.data?.length ? (
        <EmptyState
          icon={<Files />}
          title={debounced || projectId || warRoomId ? t("Aucun fichier ne correspond") : t("Aucun fichier")}
          description={t("Importez des documents ici ou joignez-les directement dans un chat.")}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-border text-xs text-fg-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{t("Nom")}</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">{t("Taille")}</th>
                <th className="px-3 py-2 text-left font-medium">Extraction</th>
                <th className="px-3 py-2 text-left font-medium">{t("Rattachement")}</th>
                <th className="px-3 py-2 text-left font-medium">Tags</th>
                <th className="px-3 py-2 text-left font-medium">{t("Ajouté")}</th>
                <th className="w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {files.data.map((f) => {
                const ex = EXTRACTION[f.extraction];
                const scopes = [projectName(f.projectId), roomName(f.warRoomId), f.conversationId ? t("conversation") : null].filter(Boolean);
                return (
                  <tr key={f.id} className="hover:bg-surface-2/50">
                    <td className="max-w-xs px-4 py-2">
                      <button onClick={() => setPreview(f.id)} className="flex min-w-0 items-center gap-2 text-left hover:underline [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-subtle">
                        {fileIcon(f.mime)}
                        <span className="truncate">{f.name}</span>
                      </button>
                    </td>
                    <td className="max-w-40 truncate px-3 py-2 text-xs text-fg-muted">{f.mime}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-fg-muted">{fmtBytes(f.size)}</td>
                    <td className="px-3 py-2">
                      <Tooltip content={t(ex.hint)}>
                        <span>
                          <Badge tone={ex.tone}>{t(ex.label)}</Badge>
                        </span>
                      </Tooltip>
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{scopes.length ? scopes.join(" · ") : <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-3 py-2">
                      <TagsEditor tags={f.tags} onSave={(tags) => saveTags.mutate({ id: f.id, tags })} />
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">{fmtRelative(f.createdAt)}</td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-0.5">
                        <Tooltip content={t("Prévisualiser")}>
                          <Button variant="ghost" size="icon-sm" onClick={() => setPreview(f.id)} aria-label={t("Prévisualiser")}>
                            <Eye />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t("Télécharger")}>
                          <a href={`/api/files/${f.id}/content?download=1`}>
                            <Button variant="ghost" size="icon-sm" aria-label={t("Télécharger")}>
                              <Download />
                            </Button>
                          </a>
                        </Tooltip>
                        <Tooltip content={t("Supprimer")}>
                          <Button variant="ghost" size="icon-sm" onClick={() => setToDelete(f)} aria-label={t("Supprimer")}>
                            <Trash2 />
                          </Button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <PreviewDialog fileId={preview} onClose={() => setPreview(null)} />
      <Dialog
        open={!!toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        size="sm"
        title={t("Supprimer le fichier ?")}
        description={t("Le fichier est supprimé du disque. Les messages qui le citaient afficheront « fichier supprimé ».")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)}>
              {t("Annuler")}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => toDelete && remove.mutate(toDelete.id)}>
              {t("Supprimer")}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-fg-muted">
          <span className="font-medium text-fg">{toDelete?.name}</span> {t("sera supprimé définitivement.")}
        </p>
      </Dialog>
    </div>
  );
}

function TagsEditor({ tags, onSave }: { tags: string[]; onSave: (tags: string[]) => void }) {
  const initial = useMemo(() => tags.join(", "), [tags]);
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const commit = () => {
    const next = [...new Set(value.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 30).map((t) => t.slice(0, 40));
    if (next.join(", ") !== initial) onSave(next);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setValue(initial);
      }}
      placeholder={t("ajouter des tags…")}
      className="h-7 w-44 rounded border border-transparent bg-transparent px-1.5 text-xs text-fg-muted placeholder:text-fg-subtle hover:border-border focus:border-accent/60 focus:outline-none"
    />
  );
}

function PreviewDialog({ fileId, onClose }: { fileId: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["file-detail", fileId],
    queryFn: () => api.get<FileDTO & { textPreview: string | null }>(`/files/${fileId}`),
    enabled: !!fileId,
  });
  const f = detail.data;
  const content = f ? `/api/files/${f.id}/content` : "";
  return (
    <Dialog
      open={!!fileId}
      onOpenChange={(v) => !v && onClose()}
      size="xl"
      title={f?.name ?? t("Fichier")}
      description={f ? `${f.mime} · ${fmtBytes(f.size)} · ${t(EXTRACTION[f.extraction].label)}` : undefined}
      footer={
        f ? (
          <a href={`${content}?download=1`}>
            <Button>
              <Download /> {t("Télécharger")}
            </Button>
          </a>
        ) : undefined
      }
    >
      {detail.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : detail.isError || !f ? (
        <p className="text-[13px] text-fg-muted">{t("Fichier introuvable.")}</p>
      ) : /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(f.mime) ? (
        <img src={content} alt={f.name} className="mx-auto max-h-[65vh] rounded-md border border-border" />
      ) : f.mime === "application/pdf" ? (
        <iframe src={content} title={f.name} className="h-[65vh] w-full rounded-md border border-border bg-white" />
      ) : f.mime.startsWith("video/") && /mp4|webm|ogg/.test(f.mime) ? (
        <video src={content} controls className="mx-auto max-h-[65vh] rounded-md border border-border" />
      ) : f.textPreview ? (
        <div className="space-y-2">
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-bg p-3 font-mono text-xs leading-relaxed">{f.textPreview}</pre>
          {f.textPreview.length >= 20_000 ? <p className="text-[11px] text-fg-subtle">{t("Aperçu limité aux 20 000 premiers caractères.")}</p> : null}
        </div>
      ) : (
        <p className="text-[13px] text-fg-muted">{t("Pas d'aperçu disponible pour ce type de fichier. Téléchargez-le pour l'ouvrir.")}</p>
      )}
    </Dialog>
  );
}
