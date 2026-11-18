import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { RunEvent } from "../../shared/types";
import { log } from "./logger";
import { cachedLang } from "./i18n";

export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new HTTPException(400, { message: msg });
  }
  return parsed.data;
}

export function notFound(what = "Resource"): never {
  throw new HTTPException(404, { message: cachedLang() === "en" ? `${what} not found` : `${what} introuvable` });
}

/** 404 with a complete, already-localized message. */
export function notFoundMessage(message: string): never {
  throw new HTTPException(404, { message });
}

export function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

/**
 * Run a long operation and stream RunEvents to the browser as Server-Sent Events.
 * If the browser disconnects, the AbortSignal fires and provider calls are cancelled.
 */
export function sseRun(c: Context, run: (emit: (e: RunEvent) => void, signal: AbortSignal) => Promise<void>) {
  return streamSSE(c, async (stream) => {
    const ac = new AbortController();
    stream.onAbort(() => ac.abort());
    let chain = Promise.resolve();
    const emit = (e: RunEvent) => {
      chain = chain.then(() => (stream.closed ? undefined : stream.writeSSE({ data: JSON.stringify(e) }))).catch(() => undefined);
    };
    try {
      await run(emit, ac.signal);
    } catch (err) {
      log.error("run failed", err);
      emit({ type: "error", error: err instanceof Error ? err.message : String(err) });
    }
    emit({ type: "run_done" });
    await chain;
  });
}

export const idParam = z.string().min(1).max(64);
