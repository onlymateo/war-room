import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths } from "../env";
import type { ChatTurn, GenerateRequest, ProviderAdapter, ProviderUsage, ResolvedCredentials, StreamEvent } from "./types";
import { ProviderError } from "./types";

/**
 * Claude Code bridge: runs the official `claude` CLI in headless mode
 * (`claude -p --output-format stream-json`) so the user's own Claude Pro/Max
 * login is used through Anthropic's supported interface. WAR ROOM never touches
 * the OAuth credentials: the CLI handles authentication itself.
 *
 * Hardening for every call:
 *  - `--tools ""`: no built-in tools (no Bash, no file edits, no web access);
 *  - `--strict-mcp-config` without config: none of the user's MCP servers load;
 *  - `--setting-sources ""`, `--disable-slash-commands`: no user hooks/settings/skills;
 *  - `--no-session-persistence`: nothing written to the Claude Code history;
 *  - `--permission-prompts none`: anything that would prompt is denied;
 *  - cwd is an empty sandbox folder under data/.
 */

const ATTACHMENT_NOTE = "[attachment not forwarded through the Claude Code bridge]";

/** The CLI takes a single prompt per call, so earlier turns are rendered as a transcript. */
export function renderTranscript(turns: ChatTurn[]): string {
  const textOf = (t: ChatTurn) =>
    t.content.map((p) => (p.type === "text" ? p.text : `${ATTACHMENT_NOTE} (${p.name})`)).join("\n");
  if (turns.length === 0) return "";
  const last = turns[turns.length - 1];
  const history = turns.slice(0, -1);
  if (history.length === 0) return textOf(last);
  const rendered = history
    .map((t) => `<turn role="${t.role}">\n${textOf(t)}\n</turn>`)
    .join("\n");
  return [
    "<conversation_history>",
    rendered,
    "</conversation_history>",
    "",
    "Continue the conversation above. Reply to this latest user message:",
    "",
    textOf(last),
  ].join("\n");
}

export interface CliResultEvent {
  type: "result";
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  stop_reason?: string | null;
  api_error_status?: number | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** Parses one JSONL line of `--output-format stream-json`. Exported for tests. */
export function parseCliLine(line: string):
  | { kind: "text"; delta: string }
  | { kind: "result"; event: CliResultEvent }
  | { kind: "rate_limit"; info: Record<string, unknown> }
  | { kind: "init"; model: string | null; apiKeySource: string | null }
  | { kind: "message_start" }
  | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (obj.type === "stream_event") {
    const ev = obj.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
    if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
      return { kind: "text", delta: ev.delta.text };
    }
    if (ev?.type === "message_start") return { kind: "message_start" };
    return null;
  }
  if (obj.type === "result") return { kind: "result", event: obj as unknown as CliResultEvent };
  if (obj.type === "rate_limit_event") return { kind: "rate_limit", info: (obj.rate_limit_info ?? {}) as Record<string, unknown> };
  if (obj.type === "system" && obj.subtype === "init") {
    return {
      kind: "init",
      model: typeof obj.model === "string" ? obj.model : null,
      apiKeySource: typeof obj.apiKeySource === "string" ? obj.apiKeySource : null,
    };
  }
  return null;
}

function binaryPath(creds: ResolvedCredentials): string {
  const configured = creds.config.binaryPath;
  return typeof configured === "string" && configured.trim() ? configured.trim() : "claude";
}

function childEnv(creds: ResolvedCredentials): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Ensure the subscription login is used rather than API billing, unless the user opted out.
  if (creds.config.useSubscription !== false) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }
  return env;
}

export const claudeCliAdapter: ProviderAdapter = {
  async *stream(req: GenerateRequest, creds: ResolvedCredentials): AsyncIterable<StreamEvent> {
    const promptFile = path.join(paths.cliSandbox, `sp-${crypto.randomUUID()}.txt`);
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model", req.model,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--permission-prompts", "none",
    ];
    if (req.system) {
      fs.writeFileSync(promptFile, req.system, "utf8");
      args.push("--system-prompt-file", promptFile);
    }
    if (req.params?.effort) args.push("--effort", req.params.effort);
    // Agent tools: only the WAR ROOM MCP proxy is loaded (strict config), so every
    // call goes through WAR ROOM's permissions and approvals.
    const mcpFile = path.join(paths.cliSandbox, `mcp-${crypto.randomUUID()}.json`);
    if (req.mcpProxyUrl) {
      fs.writeFileSync(mcpFile, JSON.stringify({ mcpServers: { warroom: { type: "http", url: req.mcpProxyUrl } } }), "utf8");
      args.push("--mcp-config", mcpFile, "--allowedTools", "mcp__warroom");
    }

    const child = spawn(binaryPath(creds), args, {
      cwd: paths.cliSandbox,
      env: childEnv(creds),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    // Event queue bridging the child's stdout to this async generator.
    const queue: StreamEvent[] = [];
    let wake: (() => void) | null = null;
    let finished = false;
    let failure: ProviderError | null = null;
    let stderr = "";
    let buffer = "";
    let rateLimit: Record<string, unknown> | null = null;
    let sawResult = false;
    // With tools, the CLI runs several model turns; separate their text like the API adapters do.
    let separateNext = false;
    let emittedText = false;

    const push = (e: StreamEvent) => {
      queue.push(e);
      wake?.();
    };
    const finish = (err?: ProviderError) => {
      if (err && !failure) failure = err;
      finished = true;
      wake?.();
    };

    const handleLine = (line: string) => {
      const parsed = parseCliLine(line);
      if (!parsed) return;
      if (parsed.kind === "text") {
        if (separateNext && emittedText) push({ type: "text", delta: "\n\n" });
        separateNext = false;
        emittedText = true;
        push({ type: "text", delta: parsed.delta });
      } else if (parsed.kind === "message_start") separateNext = true;
      else if (parsed.kind === "rate_limit") rateLimit = parsed.info;
      else if (parsed.kind === "result") {
        sawResult = true;
        const r = parsed.event;
        if (r.is_error) {
          finish(new ProviderError(r.result || "Claude Code reported an error.", r.api_error_status === 429 ? "rate_limit" : "unknown"));
          return;
        }
        const usage: ProviderUsage = {
          inputTokens: r.usage?.input_tokens ?? null,
          outputTokens: r.usage?.output_tokens ?? null,
          cacheReadTokens: r.usage?.cache_read_input_tokens ?? null,
          cacheWriteTokens: r.usage?.cache_creation_input_tokens ?? null,
          reportedCostUsd: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
          rateLimit,
        };
        push({ type: "usage", usage });
        push({ type: "done", stopReason: r.stop_reason ?? null });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      finish(
        new ProviderError(
          err.code === "ENOENT"
            ? "The `claude` command was not found. Install Claude Code or set its path in the provider settings."
            : `Could not start Claude Code: ${err.message}`,
          "unavailable",
        ),
      );
    });
    child.on("close", (code) => {
      if (buffer.trim()) handleLine(buffer);
      if (!sawResult && !failure) {
        const hint = /log ?in|auth|credential/i.test(stderr)
          ? " Run `claude` in a terminal and sign in with /login."
          : "";
        finish(new ProviderError(`Claude Code exited (code ${code}) without a result.${hint} ${stderr.trim().slice(-500)}`.trim(), "unavailable"));
      } else finish();
    });

    const onAbort = () => {
      child.kill();
      finish(new ProviderError("Request cancelled.", "aborted"));
    };
    if (req.signal?.aborted) onAbort();
    req.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdin.end(renderTranscript(req.messages), "utf8");

    try {
      while (true) {
        if (queue.length) {
          yield queue.shift()!;
          continue;
        }
        if (finished) break;
        await new Promise<void>((resolve) => (wake = resolve));
        wake = null;
      }
      if (failure) throw failure;
    } finally {
      req.signal?.removeEventListener("abort", onAbort);
      if (child.exitCode === null) child.kill();
      fs.rm(promptFile, { force: true }, () => {});
      fs.rm(mcpFile, { force: true }, () => {});
    }
  },

  async listModels() {
    // The CLI has no model-listing command; the catalog lists the current Claude models.
    return null;
  },

  async test(creds) {
    const version = await new Promise<string>((resolve, reject) => {
      const child = spawn(binaryPath(creds), ["--version"], { env: childEnv(creds), windowsHide: true });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", (err: NodeJS.ErrnoException) =>
        reject(
          new ProviderError(
            err.code === "ENOENT" ? "The `claude` command was not found on PATH." : err.message,
            "unavailable",
          ),
        ),
      );
      child.on("close", (code) => (code === 0 ? resolve(out.trim()) : reject(new ProviderError(`claude --version exited with ${code}`))));
    });
    // A real (tiny) request confirms the login works. It counts against your plan like any message.
    let text = "";
    for await (const ev of this.stream(
      { model: "claude-haiku-5-5", messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly: OK" }] }], params: { effort: "low" } },
      creds,
    )) {
      if (ev.type === "text") text += ev.delta;
    }
    return `Claude Code ${version} — signed in, test reply: "${text.trim().slice(0, 40)}"`;
  },
};
