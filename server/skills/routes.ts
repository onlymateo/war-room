import { Hono } from "hono";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { body, badRequest, notFound } from "../lib/http";
import { findSkill, installSkill, parseFrontMatter, scanSkills, uninstallSkill, WARROOM_SKILLS_DIR } from "./inventory";
import { db, schema } from "../db/client";

export const skillRoutes = new Hono();

skillRoutes.get("/skills", async (c) => {
  const skills = scanSkills();
  const agents = await db.select({ id: schema.agents.id, name: schema.agents.name, skills: schema.agents.skills }).from(schema.agents);
  return c.json(
    skills.map((s) => ({
      ...s,
      usedBy: agents.filter((a) => a.skills.includes(s.name) || a.skills.includes(s.id)).map((a) => ({ id: a.id, name: a.name })),
    })),
  );
});

skillRoutes.get("/skills/detail", async (c) => {
  const s = findSkill(c.req.query("id") ?? "");
  if (!s) notFound("Skill");
  const text = fs.readFileSync(path.join(s!.path, "SKILL.md"), "utf8");
  return c.json({ ...s, content: parseFrontMatter(text).body });
});

/** Install = copy into data/skills. Requires explicit confirmation for untrusted sources. */
skillRoutes.post("/skills/install", async (c) => {
  const input = await body(c, z.object({ id: z.string(), confirmUntrusted: z.boolean().default(false) }));
  const s = findSkill(input.id);
  if (!s) notFound("Skill");
  if (!s!.trusted && !input.confirmUntrusted) badRequest("This skill comes from an unverified source. Review it and confirm.");
  try {
    return c.json(installSkill(input.id));
  } catch (err) {
    badRequest(err instanceof Error ? err.message : String(err));
  }
});

/** Create a custom WAR ROOM skill. */
skillRoutes.post("/skills", async (c) => {
  const input = await body(
    c,
    z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "lowercase letters, digits and dashes"), description: z.string().min(5).max(1000), content: z.string().max(100_000) }),
  );
  const dir = path.join(WARROOM_SKILLS_DIR, input.name);
  if (fs.existsSync(dir)) badRequest("A skill with this name already exists.");
  fs.mkdirSync(dir, { recursive: true });
  const desc = input.description.replace(/\r?\n/g, " ");
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${input.name}\ndescription: ${desc}\n---\n\n${input.content}\n`, "utf8");
  return c.json(scanSkills({ includeMarketplace: false }).find((s) => s.name === input.name));
});

skillRoutes.delete("/skills", async (c) => {
  try {
    uninstallSkill(c.req.query("id") ?? "");
    return c.json({ ok: true });
  } catch (err) {
    badRequest(err instanceof Error ? err.message : String(err));
  }
});
