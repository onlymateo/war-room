import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { t } from "@/i18n";

/** Shared delete flows for War Rooms and agents, with a confirmation that lists what is removed. */

export function useDeleteRoomDialog(onDeleted?: () => void) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; name: string; agentCount: number; openTasks?: number } | null>(null);
  const mutation = useMutation({
    mutationFn: (id: string) => api.del(`/warrooms/${id}`),
    onSuccess: () => {
      toast.success(t("War Room « {name} » supprimée", { name: target?.name }));
      setTarget(null);
      void qc.invalidateQueries({ queryKey: qk.warrooms });
      void qc.invalidateQueries({ queryKey: qk.agents });
      void qc.invalidateQueries({ queryKey: qk.dashboard });
      onDeleted?.();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const dialog = (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(v) => !v && setTarget(null)}
      title={t("Supprimer « {name} » ?", { name: target?.name ?? "" })}
      description={t("Suppression définitive.")}
      details={[
        t("L'orchestrateur et {count} agent(s), avec leurs conversations individuelles", { count: Math.max(0, (target?.agentCount ?? 1) - 1) }),
        t("La conversation collective, les tâches, le journal et les mémoires de cette War Room"),
        t("Conservés : les fichiers (détachés de la War Room) et l'historique de consommation, pour que vos dépenses restent exactes"),
      ]}
      loading={mutation.isPending}
      onConfirm={() => target && mutation.mutate(target.id)}
    />
  );
  return { ask: setTarget, dialog };
}

export function useDeleteAgentDialog(onDeleted?: () => void) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; name: string; warRoomId: string | null } | null>(null);
  const mutation = useMutation({
    mutationFn: (id: string) => api.del(`/agents/${id}`),
    onSuccess: () => {
      toast.success(t("Agent « {name} » supprimé", { name: target?.name }));
      if (target?.warRoomId) void qc.invalidateQueries({ queryKey: qk.warroom(target.warRoomId) });
      setTarget(null);
      void qc.invalidateQueries({ queryKey: qk.agents });
      void qc.invalidateQueries({ queryKey: qk.warrooms });
      onDeleted?.();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const dialog = (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(v) => !v && setTarget(null)}
      title={t("Supprimer l'agent « {name} » ?", { name: target?.name ?? "" })}
      description={t("Suppression définitive.")}
      details={[
        t("Sa configuration, sa mémoire et sa conversation individuelle"),
        t("Ses tâches restent dans la War Room, sans personne d'assigné"),
        t("Ses messages dans la conversation collective et l'historique de consommation sont conservés"),
      ]}
      loading={mutation.isPending}
      onConfirm={() => target && mutation.mutate(target.id)}
    />
  );
  return { ask: setTarget, dialog };
}
