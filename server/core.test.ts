import { describe, expect, it } from "vitest";
import { computeCost, estimateTokens } from "./usage/cost";
import { encryptSecret, decryptSecret, maskSecret } from "./lib/crypto";
import { redact } from "./lib/logger";
import { extractJson } from "./runtime/llm";
import { parseCliLine, renderTranscript } from "./providers/claude-cli";
import { toOpenAIMessages } from "./providers/openai-compatible";
import { messagesToTurns, normalizeTurns } from "./memory/context";
import { adjustTier, pickModelFromList } from "./usage/optimizer";
import { matchSkill, parseFrontMatter, type SkillInfo } from "./skills/inventory";
import { isToolAllowed } from "./mcp/tools";
import { computeWindow, parseRateLimitInfo } from "./limits/guard";
import type { schema } from "./db/client";

const claudePrice = { inputPrice: 4, outputPrice: 20, cacheReadPrice: 0.2, cacheWritePrice: 5 };

describe("computeCost", () => {
  it("computes Anthropic-style cost from exact tokens (cache counted separately)", () => {
    const r = computeCost("api_billed", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 10_000, cacheWriteTokens: 2000 }, claudePrice, false);
    // 1000*4 + 500*20 + 10000*0.2 + 2000*5 = 4000+10000+2000+10000 = 26000 per 1M
    expect(r.costUsd).toBeCloseTo(0.026, 8);
    expect(r.costKind).toBe("api_billed");
    expect(r.contextTokens).toBe(13_000);
  });

  it("does not double count cached tokens for OpenAI-style usage", () => {
    const r = computeCost("api_billed", { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 400 }, { ...claudePrice, cacheReadPrice: 1 }, true);
    expect(r.costUsd).toBeCloseTo((600 * 4 + 400 * 1) / 1e6, 10);
    expect(r.contextTokens).toBe(1000);
  });

  it("returns unknown instead of inventing a cost when the price is missing", () => {
    const r = computeCost("api_billed", { inputTokens: 10, outputTokens: 10 }, { inputPrice: null, outputPrice: null, cacheReadPrice: null, cacheWritePrice: null }, true);
    expect(r).toMatchObject({ costUsd: null, costKind: "unknown" });
  });

  it("returns unknown when tokens were not reported", () => {
    expect(computeCost("api_billed", null, claudePrice, false)).toMatchObject({ costUsd: null, costKind: "unknown", contextTokens: null });
  });

  it("returns unknown when cache tokens exist but the cache price is unknown", () => {
    const r = computeCost("api_billed", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 5 }, { ...claudePrice, cacheReadPrice: null }, false);
    expect(r.costKind).toBe("unknown");
  });

  it("never reports subscription usage as money spent", () => {
    const r = computeCost("subscription", { inputTokens: 2, outputTokens: 3, reportedCostUsd: 0.0007 }, null, false);
    expect(r).toMatchObject({ costKind: "subscription", costUsd: 0.0007 });
  });

  it("uses a provider-reported cost when present (e.g. OpenRouter)", () => {
    expect(computeCost("api_billed", { inputTokens: 1, outputTokens: 1, reportedCostUsd: 0.5 }, null, true).costUsd).toBe(0.5);
  });

  it("local models cost nothing", () => {
    expect(computeCost("local", { inputTokens: 100, outputTokens: 100 }, null, true)).toMatchObject({ costUsd: 0, costKind: "local" });
  });

  it("estimates tokens roughly", () => {
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
  });
});

describe("secrets", () => {
  it("round-trips encryption and produces a different ciphertext each time", () => {
    const a = encryptSecret("sk-ant-api03-secret-value");
    const b = encryptSecret("sk-ant-api03-secret-value");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret-value");
    expect(decryptSecret(a)).toBe("sk-ant-api03-secret-value");
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("hello");
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("masks secrets to the last 4 characters", () => {
    expect(maskSecret("sk-1234567890abcd")).toBe("••••abcd");
  });

  it("redacts keys in log lines", () => {
    const line = redact('calling with sk-ant-api03-AAAAAAAAAAAAAAAAAAAA and {"api_key":"xyzxyzxyzxyz"} Bearer abcdefghijklmnop');
    expect(line).not.toContain("AAAAAAAAAAAA");
    expect(line).not.toContain("xyzxyzxyzxyz");
    expect(line).not.toContain("abcdefghijklmnop");
  });
});

describe("extractJson", () => {
  it("reads fenced JSON", () => {
    expect(extractJson('Voici:\n```json\n{"a": 1, "b": "x}"}\n```')).toEqual({ a: 1, b: "x}" });
  });
  it("reads JSON surrounded by prose", () => {
    expect(extractJson('Sure! {"steps": [{"agentId": "a"}]} done')).toEqual({ steps: [{ agentId: "a" }] });
  });
  it("returns null on garbage", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("Claude Code CLI bridge", () => {
  it("parses text deltas, results and rate limit events", () => {
    expect(parseCliLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}')).toEqual({ kind: "text", delta: "Hi" });
    const result = parseCliLine('{"type":"result","is_error":false,"total_cost_usd":0.01,"usage":{"input_tokens":3,"output_tokens":4}}');
    expect(result?.kind).toBe("result");
    expect(parseCliLine('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}')).toEqual({ kind: "rate_limit", info: { status: "allowed" } });
    expect(parseCliLine("not json")).toBeNull();
    expect(parseCliLine('{"type":"system","subtype":"init","model":"claude-haiku-5-5","apiKeySource":"none"}')).toEqual({ kind: "init", model: "claude-haiku-5-5", apiKeySource: "none" });
  });

  it("renders history as a transcript and keeps the latest message last", () => {
    const text = renderTranscript([
      { role: "user", content: [{ type: "text", text: "Q1" }] },
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "Q2" }] },
    ]);
    expect(text).toContain('<turn role="user">\nQ1');
    expect(text).toContain('<turn role="assistant">\nA1');
    expect(text.trim().endsWith("Q2")).toBe(true);
  });

  it("sends a single message as-is", () => {
    expect(renderTranscript([{ role: "user", content: [{ type: "text", text: "Hello" }] }])).toBe("Hello");
  });

  it("states that attachments were not forwarded", () => {
    expect(renderTranscript([{ role: "user", content: [{ type: "image", mime: "image/png", base64: "", name: "a.png" }] }])).toContain("not forwarded");
  });
});

describe("OpenAI-compatible message mapping", () => {
  it("maps images to data URLs and keeps the system prompt first", () => {
    const out = toOpenAIMessages("SYS", [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", mime: "image/png", base64: "AAA", name: "x.png" }] }]);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
    expect(JSON.stringify(out[1])).toContain("data:image/png;base64,AAA");
  });
});

type MessageRow = typeof schema.messages.$inferSelect;
const msg = (id: string, role: "user" | "assistant", content: string, extra: Partial<MessageRow> = {}): MessageRow => ({
  id,
  conversationId: "c",
  role,
  agentId: null,
  content,
  status: "complete",
  error: null,
  providerId: null,
  modelId: null,
  attachmentIds: [],
  meta: {},
  createdAt: Number(id.replace(/\D/g, "")) || 0,
  ...extra,
});

describe("context building", () => {
  it("keeps the newest messages within the token budget", () => {
    const rows = [msg("m1", "user", "a".repeat(4000)), msg("m2", "assistant", "b".repeat(4000)), msg("m3", "user", "c".repeat(40))];
    const { turns, dropped } = messagesToTurns(rows, { maxHistoryTokens: 1100 }, new Map());
    expect(dropped).toBeGreaterThan(0);
    expect(turns[turns.length - 1].content[0]).toMatchObject({ text: "c".repeat(40) });
    expect(turns[0].role).toBe("user");
  });

  it("labels other agents' messages with their name", () => {
    const rows = [msg("m1", "user", "hi"), msg("m2", "assistant", "answer", { agentId: "ag" })];
    const { turns } = messagesToTurns(rows, { maxHistoryTokens: 10_000, agentNames: new Map([["ag", "Architect"]]) }, new Map());
    expect((turns[1].content[0] as { text: string }).text.startsWith("[Architect]")).toBe(true);
  });

  it("merges consecutive same-role turns and drops a leading assistant turn", () => {
    const out = normalizeTurns([
      { role: "assistant", content: [{ type: "text", text: "x" }] },
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "user", content: [{ type: "text", text: "b" }] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toHaveLength(2);
  });
});

describe("cost optimizer", () => {
  const model = (id: string, providerId: string, tier: "economy" | "balanced" | "premium", inputPrice: number | null) =>
    ({ id: `${providerId}:${id}`, providerId, modelId: id, tier, inputPrice, enabled: true }) as typeof schema.models.$inferSelect;

  it("shifts tiers according to the strategy", () => {
    expect(adjustTier("balanced", "quality")).toBe("premium");
    expect(adjustTier("balanced", "economy")).toBe("economy");
    expect(adjustTier("premium", "strict")).toBe("economy");
    expect(adjustTier("premium", "balanced")).toBe("premium");
  });

  it("prefers the orchestrator's provider, then the requested tier, then the cheapest", () => {
    const models = [model("a", "p1", "premium", 5), model("b", "p2", "economy", 0.1), model("c", "p1", "economy", 1), model("d", "p1", "economy", 0.5)];
    expect(pickModelFromList(models, ["p1", "p2"], "economy", "p1")?.modelId).toBe("d");
    expect(pickModelFromList(models, ["p2"], "premium", "p1")?.modelId).toBe("b");
    expect(pickModelFromList(models, [], "economy", "p1")).toBeNull();
  });
});

describe("per-agent MCP tool allowlist", () => {
  it("allows every tool of a server without an entry, only listed tools otherwise", () => {
    expect(isToolAllowed({}, "srv", "anything")).toBe(true);
    expect(isToolAllowed(undefined, "srv", "anything")).toBe(true);
    expect(isToolAllowed({ srv: ["script_read"] }, "srv", "script_read")).toBe(true);
    expect(isToolAllowed({ srv: ["script_read"] }, "srv", "save_place")).toBe(false);
    expect(isToolAllowed({ srv: [] }, "srv", "script_read")).toBe(false);
    expect(isToolAllowed({ other: [] }, "srv", "script_read")).toBe(true);
  });
});

describe("Claude limit guard", () => {
  const H = 3_600_000;
  const t0 = 1_800_000_000_000;
  const reset = t0 + 3 * H;

  it("parses Claude Code rate_limit_info (seconds -> ms)", () => {
    const out = parseRateLimitInfo(
      { status: "allowed", unifiedWindows: { five_hour: { utilization: 0.04, resetsAt: 1795008000, status: "allowed" }, seven_day: { utilization: 0.18, resetsAt: 1795125600, status: "allowed" } } },
      t0,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ window: "five_hour", snap: { utilization: 0.04, resetsAt: 1795008000_000, status: "allowed", observedAt: t0 } });
  });

  it("predicts when the pause threshold will be reached from the recent rate", () => {
    const snaps = [
      { utilization: 0.5, resetsAt: reset, status: "allowed", observedAt: t0 },
      { utilization: 0.6, resetsAt: reset, status: "allowed", observedAt: t0 + 0.5 * H },
    ];
    const w = computeWindow("five_hour", "5 h", snaps, t0 + 0.5 * H, 0.8, 0.95, 90 * 60_000);
    expect(w.ratePerHour).toBeCloseTo(0.2, 6);
    // 0.35 left to 95 % at 0.2/h -> 1.75 h after the last observation, before the reset.
    expect(w.etaPauseAt).toBe(t0 + 0.5 * H + 1.75 * H);
    expect(w.willHitBeforeReset).toBe(true);
    expect(w.level).toBe("ok");
  });

  it("warns when the threshold is predicted within the hour, pauses above it", () => {
    const fast = [
      { utilization: 0.5, resetsAt: reset, status: "allowed", observedAt: t0 },
      { utilization: 0.7, resetsAt: reset, status: "allowed", observedAt: t0 + 0.25 * H },
    ];
    expect(computeWindow("five_hour", "5 h", fast, t0 + 0.25 * H, 0.8, 0.95, 90 * 60_000).level).toBe("warning");
    const high = [{ utilization: 0.96, resetsAt: reset, status: "allowed", observedAt: t0 }];
    expect(computeWindow("five_hour", "5 h", high, t0, 0.8, 0.95, 90 * 60_000).level).toBe("critical");
    const rejected = [{ utilization: 1, resetsAt: reset, status: "rejected", observedAt: t0 }];
    expect(computeWindow("five_hour", "5 h", rejected, t0, 0.8, 0.95, 90 * 60_000).level).toBe("exhausted");
  });

  it("treats a window as reset once its reset time has passed", () => {
    const snaps = [{ utilization: 1, resetsAt: reset, status: "rejected", observedAt: t0 }];
    const w = computeWindow("five_hour", "5 h", snaps, reset + 1, 0.8, 0.95, 90 * 60_000);
    expect(w).toMatchObject({ isReset: true, level: "ok", utilization: null });
  });

  it("ignores observations from a previous window when computing the rate", () => {
    const snaps = [
      { utilization: 0.9, resetsAt: t0, status: "allowed", observedAt: t0 - H },
      { utilization: 0.1, resetsAt: reset, status: "allowed", observedAt: t0 + 0.1 * H },
    ];
    expect(computeWindow("five_hour", "5 h", snaps, t0 + 0.1 * H, 0.8, 0.95, 90 * 60_000).ratePerHour).toBeNull();
  });
});

describe("skills", () => {
  it("parses SKILL.md front matter", () => {
    const { data, body } = parseFrontMatter("---\nname: pdf\ndescription: Work with PDFs\n  across pages\n---\n# Body");
    expect(data).toEqual({ name: "pdf", description: "Work with PDFs across pages" });
    expect(body).toBe("# Body");
  });

  it("matches recommended skill names against the inventory", () => {
    const inv = [{ name: "postgresql-expert" }, { name: "react" }] as SkillInfo[];
    expect(matchSkill("PostgreSQL", inv)?.name).toBe("postgresql-expert");
    expect(matchSkill("React", inv)?.name).toBe("react");
    expect(matchSkill("Kubernetes", inv)).toBeNull();
  });
});
