import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn, GenerateRequest, ProviderAdapter, ResolvedCredentials, StreamEvent } from "./types";
import { ProviderError } from "./types";

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-opus-5"]);

function client(creds: ResolvedCredentials) {
  if (!creds.secret) throw new ProviderError("No Anthropic API key configured.", "auth");
  return new Anthropic({ apiKey: creds.secret, baseURL: creds.baseUrl ?? undefined, maxRetries: 2 });
}

function toAnthropicMessages(turns: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.content.map((part): Anthropic.Beta.BetaContentBlockParam => {
      switch (part.type) {
        case "text":
          return { type: "text", text: part.text };
        case "image":
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: part.mime as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: part.base64,
            },
          };
        case "pdf":
          return {
            type: "document",
            title: part.name,
            source: { type: "base64", media_type: "application/pdf", data: part.base64 },
          };
      }
    }),
  }));
}

export function mapAnthropicError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderError("Request cancelled.", "aborted");
  if (err instanceof Anthropic.AuthenticationError) return new ProviderError("Anthropic rejected the API key (401).", "auth");
  if (err instanceof Anthropic.PermissionDeniedError) return new ProviderError("This API key is not allowed to use this model (403).", "auth");
  if (err instanceof Anthropic.NotFoundError) return new ProviderError("Model not found for this API key (404).", "not_found");
  if (err instanceof Anthropic.RateLimitError) return new ProviderError("Anthropic rate limit reached (429). Retry shortly.", "rate_limit");
  if (err instanceof Anthropic.BadRequestError) return new ProviderError(`Anthropic rejected the request: ${err.message}`, "bad_request");
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError("Could not reach the Anthropic API.", "unavailable");
  if (err instanceof Anthropic.APIError) return new ProviderError(`Anthropic API error ${err.status ?? ""}: ${err.message}`, "unavailable");
  return new ProviderError(err instanceof Error ? err.message : String(err));
}

export const anthropicAdapter: ProviderAdapter = {
  async *stream(req: GenerateRequest, creds: ResolvedCredentials): AsyncIterable<StreamEvent> {
    const anthropic = client(creds);
    const useFallback = FALLBACK_MODELS.has(req.model);
    const messages = toAnthropicMessages(req.messages);
    const tools: Anthropic.Beta.BetaToolUnion[] | undefined = req.tools?.length
      ? req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema }))
      : undefined;
    const maxRounds = req.tools?.length && req.runTool ? (req.maxToolRounds ?? 8) : 0;
    let anyText = false;
    try {
      // Tool loop: each round is one API call; tool results are sent back until the model stops asking.
      for (let round = 0; ; round++) {
        const stream = anthropic.beta.messages.stream(
          {
            model: req.model,
            max_tokens: req.params?.maxTokens ?? 32_000,
            ...(req.system ? { system: req.system } : {}),
            messages,
            ...(tools ? { tools } : {}),
            // Automatic prompt caching: repeated prefixes (system prompt + history + earlier rounds) are billed at the cache-read rate.
            cache_control: { type: "ephemeral" },
            ...(req.params?.effort ? { output_config: { effort: req.params.effort } } : {}),
            ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal: req.signal },
        );

        let roundText = false;
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            if (anyText && !roundText) yield { type: "text", delta: "\n\n" };
            roundText = true;
            anyText = true;
            yield { type: "text", delta: event.delta.text };
          }
        }
        const final = await stream.finalMessage();
        yield {
          type: "usage",
          usage: {
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            cacheReadTokens: final.usage.cache_read_input_tokens ?? null,
            cacheWriteTokens: final.usage.cache_creation_input_tokens ?? null,
          },
        };
        if (final.stop_reason === "refusal") {
          throw new ProviderError("The model declined this request (refusal).", "bad_request");
        }
        const toolUses = final.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (final.stop_reason !== "tool_use" || toolUses.length === 0 || !req.runTool) {
          yield { type: "done", stopReason: final.stop_reason ?? null, modelUsed: final.model };
          return;
        }
        if (round >= maxRounds) {
          yield { type: "text", delta: "\n\n_[WAR ROOM : limite de tours d'outils atteinte pour cette réponse.]_" };
          yield { type: "done", stopReason: "tool_round_limit", modelUsed: final.model };
          return;
        }
        // Send the full assistant content back unchanged (thinking blocks included), then the results.
        messages.push({ role: "assistant", content: final.content as unknown as Anthropic.Beta.BetaContentBlockParam[] });
        const results = await Promise.all(
          toolUses.map(async (tu) => {
            const r = await req.runTool!(tu.name, (tu.input ?? {}) as Record<string, unknown>);
            return { type: "tool_result" as const, tool_use_id: tu.id, content: r.text, is_error: r.isError };
          }),
        );
        messages.push({ role: "user", content: results });
      }
    } catch (err) {
      throw mapAnthropicError(err);
    }
  },

  async listModels(creds) {
    const anthropic = client(creds);
    try {
      const out = [];
      for await (const m of anthropic.models.list()) {
        const extra = m as unknown as { max_input_tokens?: number; max_tokens?: number };
        out.push({
          modelId: m.id,
          displayName: m.display_name,
          contextWindow: extra.max_input_tokens ?? null,
          maxOutputTokens: extra.max_tokens ?? null,
        });
      }
      return out;
    } catch (err) {
      throw mapAnthropicError(err);
    }
  },

  async test(creds) {
    const models = await this.listModels(creds);
    return `Connected. ${models?.length ?? 0} models available for this key.`;
  },
};
