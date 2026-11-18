import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anthropicAdapter } from "./anthropic";
import { createOpenAICompatibleAdapter } from "./openai-compatible";
import { getProviderDef } from "./catalog";
import type { StreamEvent } from "./types";

/**
 * The tool loops are exercised against local mock servers that speak each
 * provider's streaming wire format: round 1 asks for a tool, round 2 answers.
 */

let server: http.Server;
let base = "";
const requests: { path: string; body: Record<string, unknown> }[] = [];

function sse(res: http.ServerResponse, events: { event?: string; data: unknown }[]) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(`${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`);
  res.end();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url ?? "", body });
      const msgs = (body.messages ?? []) as { role: string; content: unknown }[];
      if (req.url?.startsWith("/v1/chat/completions")) {
        const hasToolResult = msgs.some((m) => m.role === "tool");
        const chunk = (delta: unknown, finish: string | null = null) => ({ id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] });
        if (!hasToolResult) {
          return sse(res, [
            { data: chunk({ role: "assistant", content: "Je vérifie." }) },
            { data: chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "srv__echo", arguments: '{"x":' } }] }) },
            { data: chunk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }) },
            { data: chunk({}, "tool_calls") },
            { data: { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } } },
            { data: "[DONE]" },
          ]);
        }
        return sse(res, [
          { data: chunk({ content: "Résultat : 42" }) },
          { data: chunk({}, "stop") },
          { data: { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 150, completion_tokens: 5, total_tokens: 155 } } },
          { data: "[DONE]" },
        ]);
      }
      if (req.url?.startsWith("/v1/messages")) {
        const hasToolResult = msgs.some((m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "tool_result"));
        const msgStart = (id: string) => ({
          event: "message_start",
          data: { type: "message_start", message: { id, type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 } } },
        });
        if (!hasToolResult) {
          return sse(res, [
            msgStart("msg_1"),
            { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "srv__echo", input: {} } } },
            { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"x": 1}' } } },
            { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
            { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 12 } } },
            { event: "message_stop", data: { type: "message_stop" } },
          ]);
        }
        return sse(res, [
          msgStart("msg_2"),
          { event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
          { event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Résultat : 42" } } },
          { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
          { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 6 } } },
          { event: "message_stop", data: { type: "message_stop" } },
        ]);
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function collect(it: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const tools = [{ name: "srv__echo", description: "echo", inputSchema: { type: "object", properties: { x: { type: "number" } } } }];

describe("tool loops", () => {
  it("OpenAI-compatible: runs the requested tool and sends the result back", async () => {
    const calls: unknown[] = [];
    const adapter = createOpenAICompatibleAdapter(getProviderDef("custom-openai"));
    const events = await collect(
      adapter.stream(
        {
          model: "m",
          messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
          tools,
          runTool: async (name, args) => {
            calls.push({ name, args });
            return { text: "42", isError: false };
          },
        },
        { secret: "k", baseUrl: `${base}/v1`, config: {} },
      ),
    );
    expect(calls).toEqual([{ name: "srv__echo", args: { x: 1 } }]);
    const text = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
    expect(text).toBe("Je vérifie.\n\nRésultat : 42");
    expect(events.filter((e) => e.type === "usage")).toHaveLength(2);
    const second = requests.filter((r) => r.path.startsWith("/v1/chat")).at(-1)!.body.messages as { role: string; tool_call_id?: string; content: string }[];
    expect(second.find((m) => m.role === "tool")).toMatchObject({ tool_call_id: "call_1", content: "42" });
  });

  it("Anthropic: runs tool_use blocks and returns tool_result blocks", async () => {
    const calls: unknown[] = [];
    const events = await collect(
      anthropicAdapter.stream(
        {
          model: "claude-haiku-5-5",
          messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
          tools,
          runTool: async (name, args) => {
            calls.push({ name, args });
            return { text: "42", isError: false };
          },
        },
        { secret: "sk-ant-test", baseUrl: base, config: {} },
      ),
    );
    expect(calls).toEqual([{ name: "srv__echo", args: { x: 1 } }]);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("")).toBe("Résultat : 42");
    const usages = events.filter((e) => e.type === "usage") as { usage: { inputTokens: number; cacheReadTokens: number } }[];
    expect(usages).toHaveLength(2);
    expect(usages[0].usage).toMatchObject({ inputTokens: 20, cacheReadTokens: 80 });
    const second = requests.filter((r) => r.path.startsWith("/v1/messages")).at(-1)!.body as { messages: { role: string; content: { type: string; tool_use_id?: string }[] }[]; tools: unknown[] };
    expect(second.tools).toHaveLength(1);
    const last = second.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(second.messages.at(-2)!.content[0]).toMatchObject({ type: "tool_use" });
  });

  it("stops after the round limit", async () => {
    const adapter = createOpenAICompatibleAdapter(getProviderDef("custom-openai"));
    let n = 0;
    const events = await collect(
      adapter.stream(
        { model: "m", messages: [{ role: "user", content: [{ type: "text", text: "go" }] }], tools, maxToolRounds: 0, runTool: async () => (n++, { text: "x", isError: false }) },
        { secret: "k", baseUrl: `${base}/v1`, config: {} },
      ),
    );
    expect(n).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "tool_round_limit" });
  });
});
