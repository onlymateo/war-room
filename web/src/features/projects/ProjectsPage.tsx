import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Plus, Swords } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { fmtRelative, fmtUsd } from "@/lib/utils";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Badge, Card, Dialog, EmptyState, Page, PageHeader, Progress, Skeleton } from "@/components/ui/primitives";

export const PROJECT_STATUS_LABEL: Record<Project["status"], string> = {
  active: "Actif",
  paused: "En pause",
  done: "Terminé",
  archived: "Archivé",
};

export const PROJECT_STATUS_TONE: Record<Project["status"], "success" | "warning" | "accent" | "neutral"> = {
  active: "success",
  paused: "warning",
  done: "accent",
  archived: "neutral",
};

export default function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const projects = useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>("/projects") });

  useEffect(() => {
    if (params.get("new") === "1") {
      setOpen(true);
      params.delete("new");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  return (
    <Page>
      <PageHeader
        icon={<FolderKanban />}
        title="Projects"
        description={t("Un projet regroupe plusieurs War Rooms, leurs tâches, décisions et dépenses.")}
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus /> {t("Nouveau projet")}
          </Button>
        }
      />

      {projects.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : projects.isError ? (
        <EmptyState title={t("Impossible de charger les projets")} description={(projects.error as Error).message} />
      ) : !projects.data?.length ? (
        <EmptyState
          icon={<FolderKanban />}
          title={t("Aucun projet")}
          description={t("Créez un projet pour regrouper vos War Rooms, suivre les tâches et contrôler le budget.")}
          action={
            <Button variant="primary" onClick={() => setOpen(true)}>
              <Plus /> {t("Créer un projet")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.map((p) => {
            const total = p.taskTotal ?? 0;
            const done = p.taskDone ?? 0;
            const ratio = total ? done / total : 0;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="group">
                <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-border-strong">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="truncate text-[14px] font-semibold">{p.name}</h3>
                    <Badge tone={PROJECT_STATUS_TONE[p.status]}>{t(PROJECT_STATUS_LABEL[p.status])}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 min-h-[2.5em] text-xs text-fg-muted">{p.description || t("Pas de description.")}</p>
                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-fg-subtle">
                      <span>{t("Progression")}</span>
                      <span className="tabular-nums">
                        {t("{done}/{total} tâches", { done, total })}
                      </span>
                    </div>
                    <Progress value={total ? ratio : 0} tone={ratio >= 1 && total ? "success" : "accent"} />
                  </div>
                  <div className="mt-4 flex items-center gap-3 text-[11px] text-fg-subtle">
                    <span className="flex items-center gap-1">
                      <Swords className="size-3" /> {(p.warRoomCount ?? 0) > 1 ? t("{count} War Rooms", { count: p.warRoomCount ?? 0 }) : t("{count} War Room", { count: p.warRoomCount ?? 0 })}
                    </span>
                    <span className="tabular-nums">
                      {p.budgetUsd != null
                        ? t("{spent} facturé / {budget}", { spent: fmtUsd(p.spentUsd ?? 0), budget: fmtUsd(p.budgetUsd) })
                        : t("{spent} facturé", { spent: fmtUsd(p.spentUsd ?? 0) })}
                    </span>
                    <span className="ml-auto">{fmtRelative(p.updatedAt)}</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <CreateProjectDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

function CreateProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [objectives, setObjectives] = useState("");
  const [budget, setBudget] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post<Project>("/projects", {
        name: name.trim(),
        description,
        objectives,
        budgetUsd: budget.trim() ? Number(budget) : null,
      }),
    onSuccess: () => {
      toast.success(t("Projet créé"));
      void qc.invalidateQueries({ queryKey: qk.projects });
      onOpenChange(false);
      setName("");
      setDescription("");
      setObjectives("");
      setBudget("");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const budgetInvalid = budget.trim() !== "" && (!Number.isFinite(Number(budget)) || Number(budget) < 0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Nouveau projet")}
      description={t("Les War Rooms et tâches pourront y être rattachées ensuite.")}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Annuler")}
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!name.trim() || budgetInvalid} onClick={() => create.mutate()}>
            {t("Créer")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Nom")}>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="SaaS Analytics" maxLength={120} />
        </Field>
        <Field label={t("Description")}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </Field>
        <Field label={t("Objectifs")}>
          <Textarea value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={3} placeholder={t("Un objectif par ligne")} />
        </Field>
        <Field label={t("Budget API (USD)")} hint={t("Limite stricte sur les coûts facturés par API. Les abonnements ne sont pas comptés. Laisser vide = pas de limite.")}>
          <Input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder={t("ex. 50")} />
        </Field>
      </div>
    </Dialog>
  );
}
