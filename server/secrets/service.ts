import { and, asc, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/client";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/crypto";
import { newId, now } from "../lib/ids";
import { serverLang, tx } from "../lib/i18n";

/**
 * War Room secrets: usable by agents, never readable by them.
 *
 * - The model only knows names/descriptions and writes `{{secret:NAME}}` in tool arguments.
 * - `substituteSecrets` puts the real values in, server-side, just before the tool runs.
 * - `redactSecrets` removes any value (and simple encodings of it) from tool results and
 *   error messages before they go back to the model, the UI or the logs.
 * - Values are AES-256-GCM encrypted at rest and never returned by the API.
 */

export const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const PLACEHOLDER_RE = /\{\{\s*secret:([A-Za-z0-9_]+)\s*\}\}/g;

export interface RunSecret {
  name: string;
  description: string;
  value: string;
  requireApproval: boolean;
  /** Empty = any MCP server. */
  serverIds: string[];
}

export function placeholder(name: string) {
  return `{{secret:${name}}}`;
}

/** Names referenced in a value (string, array, object — recursively). */
export function findSecretRefs(input: unknown, out = new Set<string>()): Set<string> {
  if (typeof input === "string") {
    for (const m of input.matchAll(PLACEHOLDER_RE)) out.add(m[1].toUpperCase());
  } else if (Array.isArray(input)) {
    for (const v of input) findSecretRefs(v, out);
  } else if (input && typeof input === "object") {
    for (const v of Object.values(input)) findSecretRefs(v, out);
  }
  return out;
}

/** Replace `{{secret:NAME}}` with the value everywhere in the arguments. Unknown names are left as-is (caller rejects them first). */
export function substituteSecrets<T>(input: T, secrets: RunSecret[]): T {
  const byName = new Map(secrets.map((s) => [s.name, s.value]));
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(PLACEHOLDER_RE, (m, name: string) => byName.get(name.toUpperCase()) ?? m);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(input) as T;
}

/** Remove secret values (raw, URL-encoded, base64, JSON-escaped) from text that will be shown or sent to a model. */
export function redactSecrets(text: string, secrets: RunSecret[]): string {
  let out = text;
  for (const s of secrets) {
    if (s.value.length < 4) continue;
    const variants = new Set([s.value, encodeURIComponent(s.value), Buffer.from(s.value).toString("base64"), JSON.stringify(s.value).slice(1, -1)]);
    for (const v of variants) {
      if (v.length >= 4) out = out.split(v).join(placeholder(s.name));
    }
  }
  return out;
}

/** Every stored secret (all rooms), cached, to scrub MCP server logs shown in the UI. */
let allSecretsCache: RunSecret[] | null = null;
export function invalidateSecretCache() {
  allSecretsCache = null;
}
export async function scrubAllSecrets(text: string): Promise<string> {
  if (!allSecretsCache) {
    const rows = await db.select().from(schema.roomSecrets);
    allSecretsCache = rows.map((r) => ({ name: r.name, description: "", value: decryptSecret(r.encryptedValue), requireApproval: false, serverIds: [] }));
  }
  return allSecretsCache.length ? redactSecrets(text, allSecretsCache) : text;
}

/** Secrets an agent may use in this War Room (decrypted, for server-side use only). */
export async function secretsForAgent(warRoomId: string, agentId: string): Promise<RunSecret[]> {
  const rows = await db.select().from(schema.roomSecrets).where(eq(schema.roomSecrets.warRoomId, warRoomId));
  return rows
    .filter((r) => r.agentIds.length === 0 || r.agentIds.includes(agentId))
    .map((r) => ({ name: r.name, description: r.description, value: decryptSecret(r.encryptedValue), requireApproval: r.requireApproval, serverIds: r.serverIds }));
}

/** Every secret of a room (for redaction of logs/results even when an agent is not allowed to use some). */
export async function allRoomSecrets(warRoomId: string): Promise<RunSecret[]> {
  const rows = await db.select().from(schema.roomSecrets).where(eq(schema.roomSecrets.warRoomId, warRoomId));
  return rows.map((r) => ({ name: r.name, description: r.description, value: decryptSecret(r.encryptedValue), requireApproval: r.requireApproval, serverIds: r.serverIds }));
}

export async function markSecretsUsed(warRoomId: string, names: string[]) {
  for (const name of names) {
    await db
      .update(schema.roomSecrets)
      .set({ lastUsedAt: now(), useCount: sql`${schema.roomSecrets.useCount} + 1` })
      .where(and(eq(schema.roomSecrets.warRoomId, warRoomId), eq(schema.roomSecrets.name, name)));
  }
}

/** Prompt section listing the secrets an agent can use (names and descriptions only). */
export function secretsPromptSection(secrets: RunSecret[]): string {
  if (!secrets.length) return "";
  return [
    "Secrets are available for your tool calls. You cannot see their values and must never try to obtain, print or guess them.",
    `To use one, write ${placeholder("NAME")} inside a tool argument (for example in a header or a parameter); WAR ROOM inserts the real value when the tool runs, and hides it in tool results.`,
    ...secrets.map((s) => `- ${placeholder(s.name)}${s.description ? ` — ${s.description}` : ""}`),
  ].join("\n");
}

// ---------------------------------------------------------------- CRUD (values are write-only)

export function toSecretDTO(r: typeof schema.roomSecrets.$inferSelect) {
  return {
    id: r.id,
    warRoomId: r.warRoomId,
    name: r.name,
    description: r.description,
    hint: r.hint,
    agentIds: r.agentIds,
    serverIds: r.serverIds,
    requireApproval: r.requireApproval,
    lastUsedAt: r.lastUsedAt,
    useCount: r.useCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export async function listSecrets(warRoomId: string) {
  const rows = await db.select().from(schema.roomSecrets).where(eq(schema.roomSecrets.warRoomId, warRoomId)).orderBy(asc(schema.roomSecrets.name));
  return rows.map(toSecretDTO);
}

export async function createSecret(warRoomId: string, input: { name: string; value: string; description?: string; agentIds?: string[]; serverIds?: string[]; requireApproval?: boolean }) {
  const name = input.name.trim().toUpperCase();
  const lang = await serverLang();
  if (!SECRET_NAME_RE.test(name)) {
    throw new Error(tx(lang, "Nom invalide : lettres majuscules, chiffres et _ (ex. ROBLOX_API_KEY).", "Invalid name: uppercase letters, digits and _ only (e.g. ROBLOX_API_KEY)."));
  }
  const existing = await db.query.roomSecrets.findFirst({ where: and(eq(schema.roomSecrets.warRoomId, warRoomId), eq(schema.roomSecrets.name, name)) });
  if (existing) throw new Error(tx(lang, `Une clé ${name} existe déjà dans cette War Room.`, `A key named ${name} already exists in this War Room.`));
  const ts = now();
  const row = {
    id: newId("sec"),
    warRoomId,
    name,
    description: input.description?.trim() ?? "",
    encryptedValue: encryptSecret(input.value),
    hint: maskSecret(input.value),
    agentIds: input.agentIds ?? [],
    serverIds: input.serverIds ?? [],
    requireApproval: input.requireApproval ?? false,
    lastUsedAt: null,
    useCount: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  await db.insert(schema.roomSecrets).values(row);
  invalidateSecretCache();
  return toSecretDTO(row);
}

export async function updateSecret(id: string, input: { value?: string; description?: string; agentIds?: string[]; serverIds?: string[]; requireApproval?: boolean }) {
  const set: Partial<typeof schema.roomSecrets.$inferInsert> = { updatedAt: now() };
  if (input.value) {
    set.encryptedValue = encryptSecret(input.value);
    set.hint = maskSecret(input.value);
  }
  if (input.description !== undefined) set.description = input.description.trim();
  if (input.agentIds !== undefined) set.agentIds = input.agentIds;
  if (input.serverIds !== undefined) set.serverIds = input.serverIds;
  if (input.requireApproval !== undefined) set.requireApproval = input.requireApproval;
  await db.update(schema.roomSecrets).set(set).where(eq(schema.roomSecrets.id, id));
  invalidateSecretCache();
  const row = await db.query.roomSecrets.findFirst({ where: eq(schema.roomSecrets.id, id) });
  return row ? toSecretDTO(row) : null;
}

export async function deleteSecret(id: string) {
  await db.delete(schema.roomSecrets).where(eq(schema.roomSecrets.id, id));
  invalidateSecretCache();
}
