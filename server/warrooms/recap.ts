import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { AnalysisResult as Analysis } from "./analysis";

/**
 * Context recap of a War Room, built only from stored data (no model call), so it
 * is always available, including when the Claude quota is exhausted. It is meant
 * to be pasted into another AI (or read by a human) to continue the work.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const date = (ts: number) => new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export async function buildRecap(warRoomId: string, opts: { recentMessages?: number } = {}): Promise<{ title: string; markdown: string }> {
  const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, warRoomId) });
  if (!room) throw new Error("War Room introuvable");
  const project = room.projectId ? await db.query.projects.findFirst({ where: eq(schema.projects.id, room.projectId) }) : null;
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.warRoomId, warRoomId)).orderBy(asc(schema.agents.position));
  const models = await db.select().from(schema.models);
  const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.warRoomId, warRoomId)).orderBy(asc(schema.tasks.priority), desc(schema.tasks.updatedAt));
  const conv = await db.query.conversations.findFirst({ where: and(eq(schema.conversations.warRoomId, warRoomId), eq(schema.conversations.kind, "warroom")) });
  const messages = conv
    ? (await db.select().from(schema.messages).where(eq(schema.messages.conversationId, conv.id)).orderBy(desc(schema.messages.createdAt)).limit(opts.recentMessages ?? 14)).reverse()
    : [];
  const memIds = [warRoomId, ...(room.projectId ? [room.projectId] : []), ...agents.map((a) => a.id)];
  const memories = await db
    .select()
    .from(schema.memories)
    .where(or(inArray(schema.memories.scopeId, memIds), eq(schema.memories.scope, "global")))
    .orderBy(desc(schema.memories.updatedAt))
    .limit(40);
  const files = await db.select({ name: schema.files.name, extraction: schema.files.extraction }).from(schema.files).where(eq(schema.files.warRoomId, warRoomId));
  const paused = await db.select().from(schema.pausedWork).where(and(eq(schema.pausedWork.warRoomId, warRoomId), inArray(schema.pausedWork.status, ["paused", "ready"])));
  const analysis = room.analysis as Analysis | null;
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? "non assignée";
  const modelName = (p: string | null, m: string | null) => (p && m ? (models.find((x) => x.providerId === p && x.modelId === m)?.displayName ?? m) : "modèle de l'orchestrateur");

  const out: string[] = [];
  out.push(`# Récapitulatif de contexte — ${room.name}`);
  out.push(`_Généré le ${date(Date.now())} par WAR ROOM à partir des données du projet. À transmettre à une autre IA (ou à une personne) pour reprendre le travail._`);

  out.push("## Projet");
  if (project) out.push(`- **Projet parent :** ${project.name}${project.objectives ? ` — objectifs : ${clip(project.objectives, 500)}` : ""}`);
  if (room.description) out.push(`- **Description :** ${room.description}`);
  if (room.objective) out.push(`- **Objectif :** ${room.objective}`);
  if (room.communication) out.push(`- **Préférences de communication :** ${room.communication}`);
  if (room.brief) out.push(`\n### Brief\n${clip(room.brief, 6000)}`);
  if (analysis?.summary) {
    out.push(`\n### Compréhension du projet (analyse de l'orchestrateur)\n${analysis.summary}`);
    if (analysis.domains?.length) out.push(`Domaines : ${analysis.domains.join(", ")}.`);
  }

  const decisions = memories.filter((m) => m.kind === "decision" || m.kind === "constraint" || m.kind === "fact");
  if (room.sharedMemory || decisions.length) {
    out.push("## Décisions, contraintes et faits établis");
    if (room.sharedMemory) out.push(clip(room.sharedMemory, 6000));
    for (const m of decisions.slice(0, 25)) out.push(`- (${m.kind === "decision" ? "décision" : m.kind === "constraint" ? "contrainte" : "fait"}) ${clip(m.content, 400)}`);
  }

  out.push("## Équipe");
  for (const a of agents) {
    out.push(`- **${a.name}**${a.role === "orchestrator" ? " (orchestrateur)" : ""} — ${a.function || a.description || "—"} · ${modelName(a.providerId, a.modelId)}${a.skills.length ? ` · skills : ${a.skills.join(", ")}` : ""}`);
  }

  const groups: [string, string[]][] = [
    ["Terminées", ["done"]],
    ["En cours", ["in_progress", "review"]],
    ["Bloquées ou en pause", ["blocked"]],
    ["À faire", ["todo"]],
  ];
  if (tasks.length) {
    out.push("## Tâches");
    for (const [label, statuses] of groups) {
      const list = tasks.filter((t) => statuses.includes(t.status));
      if (!list.length) continue;
      out.push(`### ${label} (${list.length})`);
      for (const t of list.slice(0, 20)) {
        out.push(`- ${t.title} — ${name(t.assigneeAgentId)}${t.status === "done" && t.result ? `\n  Résultat : ${clip(t.result.replace(/\s+/g, " "), 400)}` : ""}${t.status === "blocked" && t.result ? ` (${clip(t.result, 160)})` : ""}`);
      }
      if (list.length > 20) out.push(`- … et ${list.length - 20} autres`);
    }
  }

  if (paused.length) {
    out.push("## Travail interrompu (limite Claude)");
    for (const p of paused) out.push(`- ${p.title}${p.resetsAt ? ` — reprise possible après ${date(p.resetsAt)}` : ""}`);
  }

  if (conv?.summary || messages.length) {
    out.push("## Échanges récents");
    if (conv?.summary) out.push(`### Résumé des échanges plus anciens\n${clip(conv.summary, 4000)}`);
    for (const m of messages.filter((x) => x.meta.kind !== "plan" && x.content.trim())) {
      const who = m.role === "user" ? "Utilisateur" : (agents.find((a) => a.id === m.agentId)?.name ?? "Assistant");
      out.push(`**${who}** (${date(m.createdAt)}) :\n${clip(m.content, 1200)}`);
    }
  }

  if (files.length) {
    out.push("## Fichiers de référence");
    out.push("Les fichiers ne sont pas inclus dans ce récapitulatif ; transmettez-les séparément si nécessaire.");
    for (const f of files.slice(0, 30)) out.push(`- ${f.name}${f.extraction !== "text" ? " (pas de texte extrait)" : ""}`);
  }

  if (analysis?.questions?.length || analysis?.risks?.length) {
    out.push("## Points ouverts");
    for (const q of analysis?.questions ?? []) out.push(`- Question : ${q}`);
    for (const r of analysis?.risks ?? []) out.push(`- Risque : ${r}`);
  }

  const next = tasks.filter((t) => t.status !== "done").slice(0, 5);
  out.push("## Pour reprendre");
  out.push(
    [
      `Tu reprends le projet « ${room.name} »${room.objective ? `, dont l'objectif est : ${room.objective}` : ""}.`,
      "Appuie-toi sur le contexte ci-dessus : respecte les décisions et contraintes établies, ne refais pas les tâches terminées.",
      next.length ? `Prochaines étapes probables : ${next.map((t) => t.title).join(" ; ")}.` : "Demande à l'utilisateur la prochaine étape s'il ne l'a pas précisée.",
      "Si une information te manque, pose la question plutôt que de supposer.",
    ].join(" "),
  );

  return { title: `Récapitulatif — ${room.name}`, markdown: out.join("\n\n") };
}
