import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, Search, ShieldAlert, Download, Trash2, Eye, Info } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { fmtRelative, fmtTokens } from "@/lib/utils";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Card, Dialog, EmptyState, Page, PageHeader, Skeleton, Tooltip } from "@/components/ui/primitives";
import { Markdown } from "@/features/chat/Markdown";

interface Skill {
  id: string;
  name: string;
  description: string;
  source: "claude-code-user" | "claude-code-marketplace" | "warroom";
  sourceLabel: string;
  path: string;
  status: "installed" | "available";
  version: string | null;
  category: string | null;
  updatedAt: number;
  contextTokens: number;
  trusted: boolean;
  usedBy: { id: string; name: string }[];
}

const SOURCE_LABEL: Record<Skill["source"], string> = {
  warroom: "WAR ROOM",
  "claude-code-user": "Claude Code (utilisateur)",
  "claude-code-marketplace": "Marketplace Claude Code",
};

export default function SkillsPage() {
  const qc = useQueryClient();
  const skills = useQuery({ queryKey: qk.skills, queryFn: () => api.get<Skill[]>("/skills") });
  const [status, setStatus] = useState<"all" | "installed" | "available">("all");
  const [source, setSource] = useState<"all" | Skill["source"]>("all");
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [installTarget, setInstallTarget] = useState<Skill | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (skills.data ?? []).filter(
      (s) =>
        (status === "all" || s.status === status) &&
        (source === "all" || s.source === source) &&
        (!needle || s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)),
    );
  }, [skills.data, status, source, q]);

  const counts = useMemo(() => {
    const list = skills.data ?? [];
    return { installed: list.filter((s) => s.status === "installed").length, available: list.filter((s) => s.status === "available").length };
  }, [skills.data]);

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/skills?id=${encodeURIComponent(id)}`),
    onSuccess: () => {
      toast.success(t("Skill supprimé de WAR ROOM"));
      void qc.invalidateQueries({ queryKey: qk.skills });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Page>
      <PageHeader
        icon={<Sparkles />}
        title="Skills"
        description={t("Compétences au format Agent Skills (SKILL.md) détectées sur cette machine et installées dans WAR ROOM.")}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus /> {t("Créer un skill")}
          </Button>
        }
      />

      <Card className="mb-5 flex items-start gap-2.5 px-4 py-3 text-xs text-fg-muted">
        <Info className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="space-y-1">
          <p>
            {t("Sources analysées en lecture seule :")} <span className="text-fg">~/.claude/skills</span> {t("(vos skills Claude Code),")}{" "}
            <span className="text-fg">~/.claude/plugins/marketplaces</span> {t("(disponibles, non installés) et")} <span className="text-fg">data/skills</span>{" "}
            {t("(WAR ROOM). WAR ROOM ne modifie jamais")} <span className="text-fg">~/.claude</span>.
          </p>
          <p>
            {t("« Installer dans WAR ROOM » copie le skill dans")} <span className="text-fg">data/skills</span>.{" "}
            {t("On attribue ensuite un skill à un agent depuis les paramètres de l'agent dans une War Room : son contenu est injecté dans le prompt système de l'agent, ce qui consomme du contexte à chaque appel.")}
          </p>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher un skill…")} className="pl-8" />
        </div>
        <div className="w-44">
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="all">{t("Tous ({count})", { count: (skills.data ?? []).length })}</option>
            <option value="installed">{t("Installés ({count})", { count: counts.installed })}</option>
            <option value="available">{t("Disponibles ({count})", { count: counts.available })}</option>
          </Select>
        </div>
        <div className="w-56">
          <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">{t("Toutes les sources")}</option>
            <option value="warroom">WAR ROOM</option>
            <option value="claude-code-user">{t("Claude Code (utilisateur)")}</option>
            <option value="claude-code-marketplace">{t("Marketplace Claude Code")}</option>
          </Select>
        </div>
      </div>

      {skills.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : skills.isError ? (
        <EmptyState title={t("Impossible de charger les skills")} description={(skills.error as Error).message} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Sparkles />}
          title={t("Aucun skill ne correspond")}
          description={t("Modifiez les filtres, ou créez un skill personnalisé pour vos agents.")}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> {t("Créer un skill")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((s) => (
            <Card key={s.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold">{s.name}</span>
                    {s.version ? <Badge tone="outline">v{s.version}</Badge> : null}
                    {s.category ? <Badge>{s.category}</Badge> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={s.status === "installed" ? "success" : "neutral"}>{s.status === "installed" ? t("Installé") : t("Disponible")}</Badge>
                    <Badge tone="outline" title={s.sourceLabel}>
                      {t(SOURCE_LABEL[s.source])}
                    </Badge>
                    {!s.trusted ? (
                      <Badge tone="warning">
                        <ShieldAlert /> {t("Source non vérifiée")}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="mt-2 line-clamp-3 text-xs text-fg-muted">{s.description || t("Pas de description.")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                <Tooltip content={t("Estimation (≈4 caractères par token) des tokens ajoutés au prompt d'un agent auquel ce skill est attribué")}>
                  <span>{t("~{count} tokens (estimation)", { count: fmtTokens(s.contextTokens, { compact: true }) })}</span>
                </Tooltip>
                <span>{t("Format Agent Skills (SKILL.md)")}</span>
                <span>{t("Modifié {time}", { time: fmtRelative(s.updatedAt) })}</span>
              </div>
              <div className="mt-1.5 text-[11px] text-fg-subtle">
                {s.usedBy.length ? (
                  <>{t("Utilisé par :")} <span className="text-fg-muted">{s.usedBy.map((a) => a.name).join(", ")}</span></>
                ) : (
                  t("Attribué à aucun agent")
                )}
              </div>
              <div className="mt-auto flex items-center justify-end gap-1.5 pt-3">
                <Button size="sm" variant="ghost" onClick={() => setDetailId(s.id)}>
                  <Eye /> {t("Détails")}
                </Button>
                {s.status === "available" ? (
                  <Button size="sm" variant="secondary" onClick={() => setInstallTarget(s)}>
                    <Download /> {t("Installer dans WAR ROOM")}
                  </Button>
                ) : null}
                {s.source === "warroom" ? (
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    loading={remove.isPending && remove.variables === s.id}
                    onClick={() => {
                      if (confirm(t("Supprimer le skill « {name} » de WAR ROOM ? Le dossier data/skills correspondant sera effacé.", { name: s.name }))) remove.mutate(s.id);
                    }}
                  >
                    <Trash2 /> {t("Supprimer")}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      <SkillDetailDialog id={detailId} onClose={() => setDetailId(null)} />
      <InstallDialog skill={installTarget} onClose={() => setInstallTarget(null)} />
      <CreateSkillDialog open={createOpen} onOpenChange={setCreateOpen} />
    </Page>
  );
}

function SkillDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["skill-detail", id],
    queryFn: () => api.get<Skill & { content: string }>(`/skills/detail?id=${encodeURIComponent(id!)}`),
    enabled: !!id,
  });
  const d = detail.data;
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()} title={d?.name ?? "Skill"} description={d ? `${d.sourceLabel} · ${d.path}` : undefined} size="xl">
      {detail.isLoading ? (
        <Skeleton className="h-64" />
      ) : detail.isError ? (
        <p className="text-xs text-danger">{(detail.error as Error).message}</p>
      ) : d ? (
        <div className="space-y-3">
          <p className="text-xs text-fg-muted">{d.description}</p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge tone={d.status === "installed" ? "success" : "neutral"}>{d.status === "installed" ? t("Installé") : t("Disponible")}</Badge>
            <Badge tone="outline">{t("~{count} tokens (estimation)", { count: fmtTokens(d.contextTokens, { compact: true }) })}</Badge>
            {!d.trusted ? <Badge tone="warning">{t("Source non vérifiée")}</Badge> : null}
          </div>
          <div className="rounded-lg border border-border bg-bg p-4">
            {d.content.trim() ? <Markdown text={d.content} /> : <p className="text-xs text-fg-subtle">{t("SKILL.md sans contenu.")}</p>}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

function InstallDialog({ skill, onClose }: { skill: Skill | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const install = useMutation({
    mutationFn: (s: Skill) => api.post("/skills/install", { id: s.id, confirmUntrusted: !s.trusted && confirmed }),
    onSuccess: () => {
      toast.success(t("Skill installé dans WAR ROOM"));
      void qc.invalidateQueries({ queryKey: qk.skills });
      setConfirmed(false);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const close = () => {
    setConfirmed(false);
    onClose();
  };
  return (
    <Dialog
      open={!!skill}
      onOpenChange={(v) => !v && close()}
      title={t("Installer « {name} »", { name: skill?.name ?? "" })}
      description={t("Le dossier du skill sera copié dans data/skills. Rien n'est modifié dans ~/.claude.")}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" disabled={!!skill && !skill.trusted && !confirmed} loading={install.isPending} onClick={() => skill && install.mutate(skill)}>
            <Download /> {t("Installer")}
          </Button>
        </>
      }
    >
      {skill ? (
        <div className="space-y-3 text-xs text-fg-muted">
          <p>{t("Source :")} <span className="text-fg">{skill.sourceLabel}</span></p>
          <p>
            {t("Coût en contexte estimé :")} <span className="text-fg">{t("~{count} tokens", { count: fmtTokens(skill.contextTokens) })}</span>{" "}
            {t("ajoutés au prompt système de chaque agent auquel vous l'attribuerez.")}
          </p>
          {!skill.trusted ? (
            <div className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-warning">
              <p className="flex items-center gap-1.5 font-medium">
                <ShieldAlert className="size-4" /> {t("Source non vérifiée")}
              </p>
              <p>
                {t("Ce skill ne provient pas d'une source reconnue. Son contenu sera injecté dans les prompts de vos agents et pourrait contenir des instructions malveillantes (injection de prompt). Lisez-le dans « Détails » avant de l'installer.")}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-fg">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                {t("J'ai relu ce skill et j'accepte de l'installer.")}
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function CreateSkillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const nameValid = /^[a-z0-9][a-z0-9-]{1,60}$/.test(name);
  const create = useMutation({
    mutationFn: () => api.post("/skills", { name, description, content }),
    onSuccess: () => {
      toast.success(t("Skill créé"));
      void qc.invalidateQueries({ queryKey: qk.skills });
      setName("");
      setDescription("");
      setContent("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Créer un skill WAR ROOM")}
      description={t("Enregistré dans data/skills/<nom>/SKILL.md, au format Agent Skills.")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" disabled={!nameValid || description.trim().length < 5} loading={create.isPending} onClick={() => create.mutate()}>
            {t("Créer")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Nom")} hint={name && !nameValid ? t("Lettres minuscules, chiffres et tirets (2 à 61 caractères).") : t("Ex. : revue-securite-api")}>
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder={t("mon-skill")} />
        </Field>
        <Field label={t("Description")} hint={t("Quand et pourquoi utiliser ce skill (au moins 5 caractères).")}>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Checklist de revue de sécurité pour les API REST")} />
        </Field>
        <Field label={t("Contenu (Markdown)")} hint={content ? t("~{count} tokens (estimation)", { count: fmtTokens(Math.ceil(content.length / 4)) }) : undefined}>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} className="font-mono text-xs" placeholder={t("# Mon skill\n\nInstructions pour l'agent…")} />
        </Field>
      </div>
    </Dialog>
  );
}
