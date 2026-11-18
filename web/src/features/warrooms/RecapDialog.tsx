import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Download, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import type { UsageSummary } from "@shared/types";
import { api } from "@/lib/api";
import { useLimitState } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Dialog, Tabs } from "@/components/ui/primitives";
import { CostTag, ModelPicker } from "@/components/domain";
import { Markdown } from "../chat/Markdown";
import { t } from "@/i18n";

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * War Room context recap: the "data" version is compiled from WAR ROOM's records
 * (free, instant, always available); the "AI" version is a handoff brief written
 * by a model the user picks (e.g. another provider while Claude is limited).
 */
export function RecapDialog({ warRoomId, open, onOpenChange }: { warRoomId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [tab, setTab] = useState("data");
  const [model, setModel] = useState<{ providerId: string | null; modelId: string | null }>({ providerId: null, modelId: null });
  const limits = useLimitState();
  const recap = useQuery({ queryKey: ["recap", warRoomId], queryFn: () => api.get<{ title: string; markdown: string }>(`/warrooms/${warRoomId}/recap`), enabled: open, staleTime: 0 });
  const ai = useMutation({
    mutationFn: () => api.post<{ title: string; markdown: string; usage: UsageSummary; model: string }>(`/warrooms/${warRoomId}/recap/ai`, model),
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });
  const current = tab === "data" ? recap.data : ai.data;
  const claudePaused = limits.data?.shouldPause;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={t("Récapitulatif de contexte")}
      description={t("À transmettre à une autre IA ou à une personne pour reprendre le projet.")}
      footer={
        current ? (
          <>
            <Button variant="ghost" onClick={() => navigator.clipboard.writeText(current.markdown).then(() => toast.success(t("Copié")))}>
              <Copy /> {t("Copier")}
            </Button>
            <Button variant="secondary" onClick={() => download(current.title, current.markdown)}>
              <Download /> {t("Télécharger (.md)")}
            </Button>
          </>
        ) : undefined
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="-mx-5 -mt-4 mb-4 px-5"
        items={[
          { value: "data", label: t("À partir des données (gratuit)") },
          { value: "ai", label: t("Rédigé par une IA") },
        ]}
      />
      {tab === "data" ? (
        recap.isLoading ? (
          <p className="text-sm text-fg-muted">{t("Construction du récapitulatif…")}</p>
        ) : recap.data ? (
          <Markdown text={recap.data.markdown} />
        ) : (
          <p className="text-sm text-danger">{t("Impossible de construire le récapitulatif.")}</p>
        )
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-72">
              <ModelPicker providerId={model.providerId} modelId={model.modelId} onChange={(providerId, modelId) => setModel({ providerId, modelId })} />
            </div>
            <Button variant="primary" onClick={() => ai.mutate()} loading={ai.isPending} disabled={!model.modelId}>
              <WandSparkles /> {t("Générer")}
            </Button>
          </div>
          <p className="text-xs text-fg-muted">
            {t("Un seul appel au modèle choisi, avec le récapitulatif « données » en entrée.")} {claudePaused ? t("Claude est actuellement en pause : choisissez un autre fournisseur ou un modèle local.") : ""}
          </p>
          {ai.data ? (
            <>
              <div className="flex items-center gap-2 text-[11px] text-fg-subtle">
                {ai.data.model} · <CostTag costUsd={ai.data.usage.costUsd} costKind={ai.data.usage.costKind} />
              </div>
              <Markdown text={ai.data.markdown} />
            </>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
