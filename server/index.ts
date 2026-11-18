import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { serve } from "@hono/node-server";
import { env, paths } from "./env";
import { initDatabase } from "./db/client";
import { log } from "./lib/logger";
import { seedCatalog } from "./providers/registry";
import { providerRoutes } from "./providers/routes";
import { chatRoutes } from "./chat/routes";
import { fileRoutes } from "./files/routes";
import { warRoomRoutes } from "./warrooms/routes";
import { usageRoutes } from "./usage/routes";
import { projectRoutes } from "./projects/routes";
import { systemRoutes } from "./system/routes";
import { skillRoutes } from "./skills/routes";
import { mcpRoutes } from "./mcp/routes";
import { mcpProxyRoutes } from "./mcp/proxy";
import { promptRoutes } from "./prompt/routes";
import { limitRoutes } from "./limits/routes";
import { secretRoutes } from "./secrets/routes";
import { tickPausedWork } from "./limits/store";
import { maybeGenerateDailyReports } from "./warrooms/reports";
import { memoryRoutes } from "./memory/routes";
import { BudgetExceededError } from "./usage/budget";
import { connectEnabledServers } from "./mcp/manager";

const app = new Hono();

/**
 * Local-only safety: the API binds to 127.0.0.1, and we additionally reject
 * requests whose Origin is not this app (blocks other websites in your browser
 * from calling the local API — a "drive-by localhost" request).
 */
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (origin) {
    const allowed = [`http://127.0.0.1:${env.port}`, `http://localhost:${env.port}`, "http://127.0.0.1:5317", "http://localhost:5317"];
    if (!allowed.includes(origin)) return c.json({ error: "Cross-origin request refused" }, 403);
  }
  await next();
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  if (err instanceof BudgetExceededError) return c.json({ error: err.message, code: "budget" }, 402);
  log.error(`${c.req.method} ${c.req.path}`, err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

const api = new Hono();
api.route("/", systemRoutes);
api.route("/", mcpProxyRoutes);
api.route("/", promptRoutes);
api.route("/", limitRoutes);
api.route("/", secretRoutes);
api.route("/", providerRoutes);
api.route("/", chatRoutes);
api.route("/", fileRoutes);
api.route("/", warRoomRoutes);
api.route("/", usageRoutes);
api.route("/", projectRoutes);
api.route("/", skillRoutes);
api.route("/", mcpRoutes);
api.route("/", memoryRoutes);
app.route("/api", api);

// Production: serve the built UI.
if (fs.existsSync(paths.webDist)) {
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };
  app.get("*", (c) => {
    const rel = decodeURIComponent(new URL(c.req.url).pathname);
    let file = path.resolve(paths.webDist, `.${rel}`);
    if (!file.startsWith(paths.webDist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(paths.webDist, "index.html");
    }
    return new Response(fs.readFileSync(file), {
      headers: { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream" },
    });
  });
}

async function main() {
  await initDatabase();
  await seedCatalog();
  void connectEnabledServers();
  // Paused work becomes "ready" once its quota window has reset (checked every minute).
  // Daily War Room progress reports (after the configured hour, catching up if the app was off).
  const tick = () => {
    void tickPausedWork();
    void maybeGenerateDailyReports();
  };
  tick();
  setInterval(tick, 60_000);
  serve({ fetch: app.fetch, hostname: env.host, port: env.port }, (info) => {
    log.info(`API listening on http://${env.host}:${info.port} (data: ${env.dataDir})`);
    if (fs.existsSync(paths.webDist)) log.info(`UI available at http://${env.host}:${info.port}`);
  });
}

main().catch((err) => {
  log.error("Startup failed", err);
  process.exit(1);
});
