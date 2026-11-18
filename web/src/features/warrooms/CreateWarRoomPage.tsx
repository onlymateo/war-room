import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Swords, Upload, X, Crown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { FileDTO } from "@shared/types";
import { api } from "@/lib/api";
import { qk, useUsableModels } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { cn, fmtBytes } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, Page, PageHeader } from "@/components/ui/primitives";
import { AUTONOMY_HINT, AUTONOMY_LABEL, ModelPicker, STRATEGY_HINT, STRATEGY_LABEL } from "@/components/domain";

type Autonomy = keyof typeof AUTONOMY_LABEL;
type Strategy = keyof typeof STRATEGY_LABEL;

function OptionCards<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg border px-3 py-2.5 text-left transition-colors",
            value === o.value ? "border-accent/70 bg-accent-soft" : "border-border hover:border-border-strong",
          )}
        >
          <div className="text-[13px] font-medium">{o.label}</div>
          <div className="mt-0.5 text-xs text-fg-muted">{o.hint}</div>
        </button>
      ))}
    </div>
  );
}

export default function CreateWarRoomPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { models, isLoading } = useUsableModels();
  const projects = useQuery({ queryKey: qk.projects, queryFn: () => api.get<Project[]>("/projects") });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [brief, setBrief] = useState("");
  const [projectId, setProjectId] = useState("");
  const [files, setFiles] = useState<FileDTO[]>([]);
  const [uploading, setUploading] = useState(false);
  const [orchName, setOrchName] = useState("ATLAS");
  const [personality, setPersonality] = useState("Calme, structuré, factuel. Pose les bonnes questions avant d'agir.");
  const [orchModel, setOrchModel] = useState<{ providerId: string | null; modelId: string | null }>({ providerId: null, modelId: null });
  const [autonomy, setAutonomy] = useState<Autonomy>("semi");
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [budget, setBudget] = useState("");
  const [maxAgents, setMaxAgents] = useState("3");
  const [communication, setCommunication] = useState("Réponses en français, concises et structurées.");
  const [analyze, setAnalyze] = useState(true);

  // Default orchestrator model: Claude Opus 5.5 when connected, else a premium model, else the first available.
  const defaultModel = models.find((m) => m.modelId === "claude-opus-5-5") ?? models.find((m) => m.tier === "premium" && !m.modelId.includes("fable")) ?? models[0];
  const effectiveModel =
    orchModel.providerId && orchModel.modelId
      ? orchModel
      : defaultModel
        ? { providerId: defaultModel.providerId, modelId: defaultModel.modelId }
        : { providerId: null, modelId: null };

  const upload = async (list: FileList) => {
    setUploading(true);
    for (const f of Array.from(list)) {
      const form = new FormData();
      form.append("file", f);
      try {
        const [stored] = await api.upload<FileDTO[]>("/files", form);
        setFiles((prev) => [...prev, stored]);
      } catch (err) {
        toast.error(`${f.name} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    setUploading(false);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>("/warrooms", {
        name: name.trim(),
        description,
        objective,
        brief,
        projectId: projectId || null,
        autonomy,
        costStrategy: strategy,
        budgetUsd: budget ? Number(budget) : null,
        maxAgentsPerTurn: Number(maxAgents) || 3,
        communication,
        fileIds: files.map((f) => f.id),
        orchestrator: {
          name: orchName.trim() || "ATLAS",
          personality,
          providerId: effectiveModel.providerId,
          modelId: effectiveModel.modelId,
          icon: "crown",
          color: "amber",
          description: "Orchestrateur principal de la War Room.",
        },
      }),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: qk.warrooms });
      navigate(`/warrooms/${id}?tab=analysis${analyze && brief.trim() ? "&analyze=1" : ""}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
  });

  const canCreate = name.trim() && effectiveModel.providerId && !uploading;

  return (
    <Page className="max-w-3xl">
      <Link to="/warrooms" className="mb-4 inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> War Rooms
      </Link>
      <PageHeader icon={<Swords />} title="Nouvelle War Room" description="Décrivez le projet : l'orchestrateur l'analysera et proposera une organisation." />

      <div className="space-y-5">
        <Card className="space-y-4 p-5">
          <h2 className="text-[13px] font-semibold">Projet</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom de la War Room">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="SaaS Analytics" autoFocus />
            </Field>
            <Field label="Projet (optionnel)">
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">Aucun</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Développer une plateforme SaaS d'analyse de données." />
          </Field>
          <Field label="Objectif">
            <Input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Lancer un MVP utilisable en 3 mois." />
          </Field>
          <Field label="Brief initial" hint="Plus il est précis, meilleure sera l'analyse. Vous pourrez le modifier ensuite.">
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={7} placeholder="Je souhaite développer une application SaaS permettant de…" />
          </Field>
          <Field label="Fichiers de référence" hint="Cahier des charges, maquettes, notes… Le texte extrait est fourni à l'orchestrateur lors de l'analyse.">
            <div className="flex flex-wrap items-center gap-1.5">
              {files.map((f) => (
                <span key={f.id} className="flex h-7 items-center gap-1.5 rounded-md bg-surface-2 pl-2 pr-1 text-xs">
                  <span className="max-w-48 truncate">{f.name}</span>
                  <span className="text-fg-subtle">{fmtBytes(f.size)}</span>
                  <button onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="rounded p-0.5 hover:bg-surface-3" aria-label="Retirer">
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <label className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 text-xs text-fg-muted hover:text-fg">
                {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Ajouter
                <input type="file" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
              </label>
            </div>
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            <Crown className="size-4 text-amber-500" /> Orchestrateur principal
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom">
              <Input value={orchName} onChange={(e) => setOrchName(e.target.value)} placeholder="ATLAS, NEXUS, COMMANDER…" />
            </Field>
            <Field label="Modèle" hint="Un modèle performant est recommandé : il planifie et synthétise.">
              {isLoading ? (
                <Input disabled value="Chargement…" />
              ) : models.length ? (
                <ModelPicker providerId={effectiveModel.providerId} modelId={effectiveModel.modelId} onChange={(providerId, modelId) => setOrchModel({ providerId, modelId })} />
              ) : (
                <Link to="/providers" className="text-xs text-accent hover:underline">
                  Connectez d'abord un fournisseur →
                </Link>
              )}
            </Field>
          </div>
          <Field label="Personnalité">
            <Input value={personality} onChange={(e) => setPersonality(e.target.value)} />
          </Field>
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="text-[13px] font-semibold">Gouvernance et coûts</h2>
          <Field label="Niveau d'autonomie">
            <OptionCards value={autonomy} onChange={setAutonomy} options={(Object.keys(AUTONOMY_LABEL) as Autonomy[]).map((k) => ({ value: k, label: AUTONOMY_LABEL[k], hint: AUTONOMY_HINT[k] }))} />
          </Field>
          <Field label="Stratégie de coût">
            <OptionCards value={strategy} onChange={setStrategy} options={(Object.keys(STRATEGY_LABEL) as Strategy[]).map((k) => ({ value: k, label: STRATEGY_LABEL[k], hint: STRATEGY_HINT[k] }))} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Budget API maximum ($)" hint="Appels bloqués une fois atteint. Ne concerne pas l'usage couvert par un abonnement.">
              <Input type="number" min={0} step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Illimité" />
            </Field>
            <Field label="Agents max par message" hint="Limite combien d'agents l'orchestrateur peut solliciter à la fois.">
              <Input type="number" min={1} max={10} value={maxAgents} onChange={(e) => setMaxAgents(e.target.value)} />
            </Field>
          </div>
          <Field label="Préférences de communication">
            <Input value={communication} onChange={(e) => setCommunication(e.target.value)} />
          </Field>
        </Card>

        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-[13px] text-fg-muted">
            <input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} className="accent-[var(--accent)]" />
            Lancer l'analyse du brief après la création (1 appel au modèle de l'orchestrateur)
          </label>
          <Button variant="primary" size="lg" onClick={() => create.mutate()} disabled={!canCreate} loading={create.isPending}>
            Créer la War Room
          </Button>
        </div>
      </div>
    </Page>
  );
}
