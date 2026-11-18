import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, "..");

/** Minimal .env loader (no dependency): KEY=VALUE lines, existing env wins. */
function loadDotEnv() {
  const file = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

export const env = {
  port: Number(process.env.WARROOM_PORT ?? 4317),
  /** Bind to loopback only: WAR ROOM is a local, single-user application. */
  host: "127.0.0.1",
  dataDir: path.resolve(ROOT_DIR, process.env.WARROOM_DATA_DIR ?? "data"),
  isProd: process.env.NODE_ENV === "production",
};

export const paths = {
  db: path.join(env.dataDir, "warroom.db"),
  files: path.join(env.dataDir, "files"),
  masterKey: path.join(env.dataDir, "master.key"),
  /** Empty, isolated working directory for CLI-based providers (no project files exposed). */
  cliSandbox: path.join(env.dataDir, "cli-sandbox"),
  migrations: path.join(ROOT_DIR, "drizzle"),
  webDist: path.join(ROOT_DIR, "dist", "web"),
};

for (const dir of [env.dataDir, paths.files, paths.cliSandbox]) {
  fs.mkdirSync(dir, { recursive: true });
}
