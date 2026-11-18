import crypto from "node:crypto";
import fs from "node:fs";
import { paths } from "../env";

/**
 * Secrets (API keys, MCP env/headers) are encrypted at rest with AES-256-GCM.
 * The master key lives in data/master.key (created on first run, mode 0600) or
 * in WARROOM_MASTER_KEY. Secrets are decrypted only in the server process and
 * are never sent to the browser.
 */
let cachedKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.WARROOM_MASTER_KEY;
  if (fromEnv) {
    const k = Buffer.from(fromEnv, "base64");
    if (k.length !== 32) throw new Error("WARROOM_MASTER_KEY must be 32 bytes, base64-encoded");
    cachedKey = k;
    return k;
  }
  if (fs.existsSync(paths.masterKey)) {
    cachedKey = Buffer.from(fs.readFileSync(paths.masterKey, "utf8").trim(), "base64");
    return cachedKey;
  }
  const k = crypto.randomBytes(32);
  fs.writeFileSync(paths.masterKey, k.toString("base64"), { mode: 0o600 });
  cachedKey = k;
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unsupported secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Display hint for a stored secret: never reveals more than the last 4 characters. */
export function maskSecret(plain: string): string {
  if (plain.length <= 8) return "••••";
  return `••••${plain.slice(-4)}`;
}
