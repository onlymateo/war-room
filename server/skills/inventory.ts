import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { env } from "../env";
import { estimateTokens } from "../usage/cost";

/**
 * Skills inventory (Agent Skills format: a folder with a SKILL.md that has
 * `name` and `description` in YAML front matter).
 *
 * Sources scanned (read-only):
 *  - Claude Code user skills:        ~/.claude/skills/<name>/SKILL.md            → installed
 *  - Claude Code plugin marketplaces: ~/.claude/plugins/marketplaces/** /SKILL.md → available (not installed)
 *  - WAR ROOM skills:                 data/skills/<name>/SKILL.md                 → installed in WAR ROOM
 *
 * WAR ROOM never writes to ~/.claude. "Installing" a skill copies it into
 * data/skills, after explicit confirmation, so agents can use it.
 */

export interface SkillInfo {
  id: string; // stable id: `${source}:${relative path}`
  name: string;
  description: string;
  source: "claude-code-user" | "claude-code-marketplace" | "warroom";
  sourceLabel: string;
  path: string;
  status: "installed" | "available";
  version: string | null;
  category: string | null;
  updatedAt: number;
  /** Estimated tokens added to an agent's prompt when this skill is assigned (SKILL.md body). */
  contextTokens: number;
  trusted: boolean;
}

export const WARROOM_SKILLS_DIR = path.join(env.dataDir, "skills");
const CLAUDE_DIR = path.join(os.homedir(), ".claude");

export function parseFrontMatter(text: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      currentKey = kv[1];
      data[currentKey] = kv[2].replace(/^["']|["']$/g, "").trim();
    } else if (currentKey && /^\s+\S/.test(line)) {
      data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim();
    }
  }
  return { data, body: m[2] };
}

function findSkillFiles(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".git")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === "SKILL.md") out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

function readSkill(file: string, source: SkillInfo["source"], root: string): SkillInfo | null {
  try {
    const text = fs.readFileSync(file, "utf8");
    const { data, body } = parseFrontMatter(text);
    const rel = path.relative(root, path.dirname(file)).replace(/\\/g, "/");
    const name = data.name || path.basename(path.dirname(file));
    const parts = rel.split("/");
    const sourceLabel =
      source === "claude-code-user"
        ? "Claude Code (user skills)"
        : source === "warroom"
          ? "WAR ROOM"
          : `Claude Code marketplace · ${parts[0]}${parts.includes("plugins") || parts.includes("external_plugins") ? ` · ${parts[parts.findIndex((x) => x === "plugins" || x === "external_plugins") + 1]}` : ""}`;
    return {
      id: `${source}:${rel}`,
      name,
      description: data.description ?? "",
      source,
      sourceLabel,
      path: path.dirname(file),
      status: source === "claude-code-marketplace" ? "available" : "installed",
      version: data.version ?? null,
      category: data.category ?? null,
      updatedAt: fs.statSync(file).mtimeMs,
      contextTokens: estimateTokens(body),
      // Official marketplace and the user's own skills are treated as trusted sources.
      trusted: source !== "claude-code-marketplace" || parts[0]?.startsWith("claude-plugins-official"),
    };
  } catch {
    return null;
  }
}

export function scanSkills(opts: { includeMarketplace?: boolean } = {}): SkillInfo[] {
  fs.mkdirSync(WARROOM_SKILLS_DIR, { recursive: true });
  const userRoot = path.join(CLAUDE_DIR, "skills");
  const marketRoot = path.join(CLAUDE_DIR, "plugins", "marketplaces");
  const includeMarketplace = opts.includeMarketplace ?? true;
  const results: SkillInfo[] = [];
  for (const f of findSkillFiles(WARROOM_SKILLS_DIR, 2)) {
    const s = readSkill(f, "warroom", WARROOM_SKILLS_DIR);
    if (s) results.push(s);
  }
  for (const f of findSkillFiles(userRoot, 2)) {
    const s = readSkill(f, "claude-code-user", userRoot);
    if (s) results.push(s);
  }
  for (const f of includeMarketplace ? findSkillFiles(marketRoot, 7) : []) {
    const s = readSkill(f, "claude-code-marketplace", marketRoot);
    if (s) results.push(s);
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function findSkill(id: string): SkillInfo | null {
  return scanSkills().find((s) => s.id === id) ?? null;
}

/** Copy a skill folder into WAR ROOM's skills directory (explicit user action only). */
export function installSkill(id: string): SkillInfo {
  const skill = findSkill(id);
  if (!skill) throw new Error("Skill not found");
  if (skill.source === "warroom") return skill;
  const target = path.join(WARROOM_SKILLS_DIR, skill.name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase());
  if (fs.existsSync(target)) throw new Error(`A WAR ROOM skill named "${skill.name}" already exists.`);
  fs.cpSync(skill.path, target, { recursive: true, filter: (src) => !/node_modules|\.git/.test(src) });
  return readSkill(path.join(target, "SKILL.md"), "warroom", WARROOM_SKILLS_DIR)!;
}

export function uninstallSkill(id: string) {
  const skill = findSkill(id);
  if (!skill || skill.source !== "warroom") throw new Error("Only WAR ROOM skills can be removed from here.");
  const resolved = path.resolve(skill.path);
  if (!resolved.startsWith(path.resolve(WARROOM_SKILLS_DIR) + path.sep)) throw new Error("Refusing to delete outside the skills folder");
  fs.rmSync(resolved, { recursive: true, force: true });
}

/** Body of the skills assigned to an agent, injected into its system prompt. */
export function skillsPromptSection(skillNames: string[]): string {
  if (!skillNames.length) return "";
  const installed = scanSkills({ includeMarketplace: false });
  const blocks: string[] = [];
  for (const name of skillNames) {
    const s = installed.find((x) => x.name === name || x.id === name);
    if (!s) continue;
    try {
      const { body } = parseFrontMatter(fs.readFileSync(path.join(s.path, "SKILL.md"), "utf8"));
      blocks.push(`<skill name="${s.name}">\n${body.trim().slice(0, 40_000)}\n</skill>`);
    } catch {
      /* skip unreadable skill */
    }
  }
  return blocks.length
    ? `You have these skills (reference material written by humans; follow them when relevant):\n${blocks.join("\n\n")}`
    : "";
}

/** Fuzzy match of a recommended skill name against the inventory. */
export function matchSkill(name: string, skills: SkillInfo[]): SkillInfo | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const n = norm(name);
  if (!n) return null;
  return (
    skills.find((s) => norm(s.name) === n) ??
    skills.find((s) => norm(s.name).includes(n) || (n.length > 3 && n.includes(norm(s.name)))) ??
    null
  );
}
