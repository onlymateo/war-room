import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "../db/client";
import type { AnalysisResult as Analysis } from "./analysis";
import { dateLocale, serverLang, tx } from "../lib/i18n";

/**
 * Context recap of a War Room, built only from stored data (no model call), so it
 * is always available, including when the Claude quota is exhausted. It is meant
 * to be pasted into another AI (or read by a human) to continue the work.
 */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
/** Markdown removed and whitespace collapsed, so excerpts render as plain text inside a list. */
const plain = (s: string) =>
  s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+|^\s*\d+\.\s+/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export async function buildRecap(warRoomId: string, opts: { recentMessages?: number } = {}): Promise<{ title: string; markdown: string }> {
  const room = await db.query.warRooms.findFirst({ where: eq(schema.warRooms.id, warRoomId) });
  const lang = await serverLang();
  const t = (fr: string, en: string) => tx(lang, fr, en);
  const date = (ts: number) => new Date(ts).toLocaleString(dateLocale(lang), { dateStyle: "short", timeStyle: "short" });
  if (!room) throw new Error(t("War Room introuvable", "War Room not found"));
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
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? t("non assignée", "unassigned");
  const modelName = (p: string | null, m: string | null) => (p && m ? (models.find((x) => x.providerId === p && x.modelId === m)?.displayName ?? m) : t("modèle de l'orchestrateur", "orchestrator's model"));

  const out: string[] = [];
  out.push(t(`# Récapitulatif de contexte — ${room.name}`, `# Context recap — ${room.name}`));
  out.push(
    t(
      `_Généré le ${date(Date.now())} par WAR ROOM à partir des données du projet. À transmettre à une autre IA (ou à une personne) pour reprendre le travail._`,
      `_Generated on ${date(Date.now())} by WAR ROOM from the project data. Hand it to another AI (or a person) to continue the work._`,
    ),
  );

  out.push(t("## Projet", "## Project"));
  if (project) {
    const objectives = project.objectives ? clip(project.objectives, 500) : null;
    out.push(
      t(
        `- **Projet parent :** ${project.name}${objectives ? ` — objectifs : ${objectives}` : ""}`,
        `- **Parent project:** ${project.name}${objectives ? ` — objectives: ${objectives}` : ""}`,
      ),
    );
  }
  if (room.description) out.push(t(`- **Description :** ${room.description}`, `- **Description:** ${room.description}`));
  if (room.objective) out.push(t(`- **Objectif :** ${room.objective}`, `- **Objective:** ${room.objective}`));
  if (room.communication) out.push(t(`- **Préférences de communication :** ${room.communication}`, `- **Communication preferences:** ${room.communication}`));
  if (room.brief) out.push(`\n### Brief\n${clip(room.brief, 6000)}`);
  if (analysis?.summary) {
    out.push(t(`\n### Compréhension du projet (analyse de l'orchestrateur)\n${analysis.summary}`, `\n### Understanding of the project (orchestrator's analysis)\n${analysis.summary}`));
    if (analysis.domains?.length) out.push(t(`Domaines : ${analysis.domains.join(", ")}.`, `Domains: ${analysis.domains.join(", ")}.`));
  }

  const decisions = memories.filter((m) => m.kind === "decision" || m.kind === "constraint" || m.kind === "fact");
  if (room.sharedMemory || decisions.length) {
    out.push(t("## Décisions, contraintes et faits établis", "## Decisions, constraints and established facts"));
    if (room.sharedMemory) out.push(clip(room.sharedMemory, 6000));
    for (const m of decisions.slice(0, 25)) out.push(`- (${m.kind === "decision" ? t("décision", "decision") : m.kind === "constraint" ? t("contrainte", "constraint") : t("fait", "fact")}) ${clip(m.content, 400)}`);
  }

  out.push(t("## Équipe", "## Team"));
  for (const a of agents) {
    out.push(
      `- **${a.name}**${a.role === "orchestrator" ? t(" (orchestrateur)", " (orchestrator)") : ""} — ${a.function || a.description || "—"} · ${modelName(a.providerId, a.modelId)}${a.skills.length ? t(` · skills : ${a.skills.join(", ")}`, ` · skills: ${a.skills.join(", ")}`) : ""}`,
    );
  }

  const groups: [string, string[]][] = [
    [t("Terminées", "Done"), ["done"]],
    [t("En cours", "In progress"), ["in_progress", "review"]],
    [t("Bloquées ou en pause", "Blocked or paused"), ["blocked"]],
    [t("À faire", "To do"), ["todo"]],
  ];
  if (tasks.length) {
    out.push(t("## Tâches", "## Tasks"));
    for (const [label, statuses] of groups) {
      const list = tasks.filter((k) => statuses.includes(k.status));
      if (!list.length) continue;
      out.push(`### ${label} (${list.length})`);
      for (const k of list.slice(0, 20)) {
        out.push(
          `- ${plain(k.title)} — ${name(k.assigneeAgentId)}${k.status === "done" && k.result ? `\n  ${t("Résultat :", "Result:")} ${clip(plain(k.result), 400)}` : ""}${k.status === "blocked" && k.result ? ` (${clip(plain(k.result), 160)})` : ""}`,
        );
      }
      if (list.length > 20) out.push(t(`- … et ${list.length - 20} autres`, `- … and ${list.length - 20} more`));
    }
  }

  if (paused.length) {
    out.push(t("## Travail interrompu (limite Claude)", "## Interrupted work (Claude limit)"));
    for (const p of paused) out.push(`- ${p.title}${p.resetsAt ? t(` — reprise possible après ${date(p.resetsAt)}`, ` — can resume after ${date(p.resetsAt)}`) : ""}`);
  }

  if (conv?.summary || messages.length) {
    out.push(t("## Échanges récents", "## Recent exchanges"));
    if (conv?.summary) out.push(`${t("### Résumé des échanges plus anciens", "### Summary of older exchanges")}\n${clip(conv.summary, 4000)}`);
    for (const m of messages.filter((x) => x.meta.kind !== "plan" && x.content.trim())) {
      const who = m.role === "user" ? t("Utilisateur", "User") : (agents.find((a) => a.id === m.agentId)?.name ?? "Assistant");
      out.push(`**${who}** (${date(m.createdAt)})${t(" :", ":")}\n${clip(m.content, 1200)}`);
    }
  }

  if (files.length) {
    out.push(t("## Fichiers de référence", "## Reference files"));
    out.push(t("Les fichiers ne sont pas inclus dans ce récapitulatif ; transmettez-les séparément si nécessaire.", "Files are not included in this recap; share them separately if needed."));
    for (const f of files.slice(0, 30)) out.push(`- ${f.name}${f.extraction !== "text" ? t(" (pas de texte extrait)", " (no text extracted)") : ""}`);
  }

  if (analysis?.questions?.length || analysis?.risks?.length) {
    out.push(t("## Points ouverts", "## Open points"));
    for (const q of analysis?.questions ?? []) out.push(t(`- Question : ${q}`, `- Question: ${q}`));
    for (const r of analysis?.risks ?? []) out.push(t(`- Risque : ${r}`, `- Risk: ${r}`));
  }

  const next = tasks.filter((k) => k.status !== "done").slice(0, 5);
  out.push(t("## Pour reprendre", "## How to continue"));
  out.push(
    [
      t(
        `Tu reprends le projet « ${room.name} »${room.objective ? `, dont l'objectif est : ${room.objective}` : ""}.`,
        `You are taking over the project "${room.name}"${room.objective ? `, whose objective is: ${room.objective}` : ""}.`,
      ),
      t(
        "Appuie-toi sur le contexte ci-dessus : respecte les décisions et contraintes établies, ne refais pas les tâches terminées.",
        "Rely on the context above: respect the established decisions and constraints, and do not redo completed tasks.",
      ),
      next.length
        ? t(`Prochaines étapes probables : ${next.map((k) => k.title).join(" ; ")}.`, `Likely next steps: ${next.map((k) => k.title).join("; ")}.`)
        : t("Demande à l'utilisateur la prochaine étape s'il ne l'a pas précisée.", "Ask the user for the next step if they have not specified it."),
      t("Si une information te manque, pose la question plutôt que de supposer.", "If any information is missing, ask rather than assume."),
    ].join(" "),
  );

  return { title: t(`Récapitulatif — ${room.name}`, `Recap — ${room.name}`), markdown: out.join("\n\n") };
}
