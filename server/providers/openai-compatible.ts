import OpenAI from "openai";
import type { ChatTurn, GenerateRequest, ProviderAdapter, ProviderDefinition, ResolvedCredentials, StreamEvent } from "./types";
import { ProviderError } from "./types";

type ChatParam = OpenAI.Chat.Completions.ChatCompletionMessageParam;

function makeClient(def: ProviderDefinition, creds: ResolvedCredentials) {
  if (def.requiresSecret && !creds.secret) throw new ProviderError(`No API key configured for ${def.name}.`, "auth");
  const baseURL = creds.baseUrl ?? def.defaultBaseUrl ?? undefined;
  return new OpenAI({
    // Local servers (Ollama, LM Studio) ignore the key but the SDK requires a non-empty value.
    apiKey: creds.secret ?? "not-needed",
    baseURL,
    maxRetries: 2,
    defaultHeaders: def.id === "openrouter" ? { "X-Title": "WAR ROOM" } : undefined,
  });
}

export function toOpenAIMessages(system: string | undefined, turns: ChatTurn[]): ChatParam[] {
  const out: ChatParam[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const t of turns) {
    if (t.role === "assistant") {
      out.push({ role: "assistant", content: t.content.map((p) => (p.type === "text" ? p.text : "")).join("\n") });
      continue;
    }
    const hasMedia = t.content.some((p) => p.type !== "text");
    if (!hasMedia) {
      out.push({ role: "user", content: t.content.map((p) => (p.type === "text" ? p.text : "")).join("\n") });
      continue;
    }
    out.push({
      role: "user",
      content: t.content.map((p): OpenAI.Chat.Completions.ChatCompletionContentPart => {
        if (p.type === "text") return { type: "text", text: p.text };
        if (p.type === "image") return { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } };
        return { type: "file", file: { filename: p.name, file_data: `data:application/pdf;base64,${p.base64}` } };
      }),
    });
  }
  return out;
}

function mapError(def: ProviderDefinition, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIUserAbortError) return new ProviderError("Request cancelled.", "aborted");
  if (err instanceof OpenAI.AuthenticationError) return new ProviderError(`${def.name} rejected the API key (401).`, "auth");
  if (err instanceof OpenAI.PermissionDeniedError) return new ProviderError(`${def.name}: access denied (403).`, "auth");
  if (err instanceof OpenAI.NotFoundError) return new ProviderError(`${def.name}: model or endpoint not found (404).`, "not_found");
  if (err instanceof OpenAI.RateLimitError) return new ProviderError(`${def.name}: rate limit or quota reached (429).`, "rate_limit");
  if (err instanceof OpenAI.BadRequestError) return new ProviderError(`${def.name} rejected the request: ${err.message}`, "bad_request");
  if (err instanceof OpenAI.APIConnectionError)
    return new ProviderError(
      def.id === "ollama" ? "Ollama is not reachable on localhost:11434. Is it running?" : `Could not reach ${def.name}.`,
      "unavailable",
    );
  if (err instanceof OpenAI.APIError) return new ProviderError(`${def.name} error ${err.status ?? ""}: ${err.message}`, "unavailable");
  return new ProviderError(err instanceof Error ? err.message : String(err));
}

export function createOpenAICompatibleAdapter(def: ProviderDefinition): ProviderAdapter {
  return {
    async *stream(req: GenerateRequest, creds: ResolvedCredentials): AsyncIterable<StreamEvent> {
      const client = makeClient(def, creds);
      const maxField = def.maxTokensField ?? "max_tokens";
      try {
        const stream = await client.chat.completions.create(
          {
            model: req.model,
            messages: toOpenAIMessages(req.system, req.messages),
            stream: true,
            stream_options: { include_usage: true },
            ...(req.params?.temperature !== undefined ? { temperature: req.params.temperature } : {}),
            ...(req.params?.maxTokens ? { [maxField]: req.params.maxTokens } : {}),
          },
          { signal: req.signal },
        );
        let finish: string | null = null;
        let modelUsed: string | undefined;
        for await (const chunk of stream) {
          modelUsed = chunk.model ?? modelUsed;
          const choice = chunk.choices?.[0];
          const delta = choice?.delta?.content;
          if (delta) yield { type: "text", delta };
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) {
            const u = chunk.usage as OpenAI.CompletionUsage & { cost?: number };
            yield {
              type: "usage",
              usage: {
                inputTokens: u.prompt_tokens ?? null,
                outputTokens: u.completion_tokens ?? null,
                cacheReadTokens: u.prompt_tokens_details?.cached_tokens ?? null,
                cacheWriteTokens: null,
                reportedCostUsd: typeof u.cost === "number" ? u.cost : null,
              },
            };
          }
        }
        yield { type: "done", stopReason: finish, modelUsed };
      } catch (err) {
        throw mapError(def, err);
      }
    },

    async listModels(creds) {
      const client = makeClient(def, creds);
      try {
        const out = [];
        for await (const m of client.models.list()) {
          const extra = m as unknown as { context_length?: number; name?: string };
          out.push({ modelId: m.id, displayName: extra.name ?? m.id, contextWindow: extra.context_length ?? null });
        }
        return out;
      } catch (err) {
        throw mapError(def, err);
      }
    },

    async test(creds) {
      const models = await this.listModels(creds);
      return `Connected. ${models?.length ?? 0} models listed.`;
    },
  };
}
