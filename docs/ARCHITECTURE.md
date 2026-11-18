# Architecture

## Overview

```
web/ (Vite + React 19)  ──HTTP/SSE──►  server/ (Hono on Node, 127.0.0.1:4317)  ──►  SQLite (libSQL) in data/
                                              │
                                              ├─► Anthropic API (official SDK)
                                              ├─► OpenAI-compatible APIs (OpenAI, Gemini, Mistral, DeepSeek, xAI, OpenRouter, Ollama…)
                                              ├─► Official `claude` CLI (Pro/Max subscription)
                                              └─► MCP servers (official SDK, STDIO / Streamable HTTP)
```

## Decisions

| Decision | Reason |
|---|---|
| **Persistent Node server (Hono) rather than Next.js** | MCP STDIO processes, long-running orchestrations and SSE streams must stay alive. A single, stable process is more reliable than route handlers. The interface is a desktop SPA: server-side rendering brings nothing. |
| **Vite + React + Tailwind v4 + shadcn-style components (Radix)** | Fast and lightweight. Components are hand-written in `web/src/components/ui` to keep full control of the style (sober, Linear/Raycast-like). |
| **SQLite via libSQL + Drizzle** | One local file, no service to install, versioned migrations (`drizzle/`). libSQL supports vectors natively, which prepares for RAG. |
| **In-house adapters, no Vercel AI SDK or LangGraph** | Two adapters cover every provider: the official Anthropic SDK, and the `openai` SDK for compatible endpoints. This gives exact token counts (cache included) with no intermediate layer. Orchestration is an explicit engine, easier to keep cost-efficient than a graph framework. |
| **SSE for real time** | A one-way server-to-browser stream is enough for streaming replies. Disconnecting cancels the run on the server. |

## Server modules

| Folder | Responsibility |
|---|---|
| `server/providers` | Provider catalog, adapters (Anthropic, OpenAI-compatible, Claude Code CLI), registry, connection tests, model discovery. |
| `server/runtime/llm.ts` | **Single entry point for every model call**: checks budgets and the Claude limit guard, streams, records one `usage_events` row with the provider's numbers. |
| `server/chat` | Standalone chats and individual conversations with an agent. `streamReply` is shared by every kind of conversation. |
| `server/orchestration` | Group conversation engine: routing by the orchestrator, parallel agent execution, debate, synthesis, human approval, loop safeguard, resumable pauses. |
| `server/warrooms` | War Room, agent, task and activity-log API; brief analysis and application of the proposal; context recap; daily progress reports. |
| `server/memory` | Context building (token budget, compression by summarization), structured memory. |
| `server/usage` | Cost computation, budgets, optimizer (model choice by tier), aggregates. |
| `server/limits` | Claude subscription limit guard: quota snapshots, prediction, paused work, resume, report. |
| `server/skills` | Skills inventory (Agent Skills format), installation into WAR ROOM, injection into prompts. |
| `server/mcp` | MCP server connections, tools, resources, prompts, logs, permission checks, agent tool gateway and the local MCP proxy used by the Claude Code bridge. |
| `server/secrets` | Per-War Room secret keys: encrypted storage, substitution into tool arguments, masking in results and logs. |
| `server/files` | Upload, validation, text extraction (text, code, PDF, DOCX), per-model attachment preparation. |
| `server/prompt` | Prompt improvement with a low-cost model. |
| `server/projects`, `server/system` | Projects, settings, global search, dashboard. |

## Orchestration (group conversation)

1. The user's message is stored.
2. **Auto mode**: the orchestrator receives the team and the request, and returns a JSON plan: chosen agents, an instruction for each, synthesis or not. The call is short (low effort) and can use a cheaper routing model (`optimizer.routingModel` setting). It may decide to answer on its own.
3. **Approval**, depending on the autonomy level:
   - Assisted: every plan waits for the user's approval.
   - Semi-autonomous: approval is requested as soon as the plan involves 3 or more agents.
   - Autonomous: direct execution.
4. Agents run in parallel (at most 3 at a time). A task is created and tracked for each mission.
5. The orchestrator synthesizes when there are several answers.
6. Safeguards: maximum number of agents per message (per War Room) and maximum number of model calls per message (`orchestration.maxCallsPerRun`, 12 by default).

Other modes:

- Targeted (`@Agent`);
- All;
- Debate: positions, then cross-examination, then synthesis;
- Synthesis.

## Context and costs

- **Bounded history**: only the most recent messages that fit within `context.maxHistoryTokens` (estimated) are sent.
- **Compression**: beyond `context.compressThresholdTokens`, older messages are summarized once. The summary replaces them in subsequent calls; the full history stays in the database and in the interface.
- **On-demand attachments**: files are only sent with the message they are attached to; later messages refer to them by name.
- **Caching**: automatic prompt caching on the Anthropic API. Cache reads are counted separately.
- **Honest costs**: every cost carries a type.
  - `api_billed`: exact tokens × known price.
  - `subscription`: covered by the subscription. The value shown is the API-equivalent reported by Claude Code, never presented as money spent.
  - `local`: local model, no per-token cost.
  - `unknown`: price or tokens unavailable; no number is made up.
- **Budgets**: global monthly, project, War Room, agent. They are checked before every call and only count money actually billed.

## Security

- The API only listens on `127.0.0.1` and rejects requests coming from another web origin (protection against websites calling the local API).
- API keys, sensitive MCP variables and War Room secret keys are encrypted with AES-256-GCM, using a master key in `data/master.key` (or `WARROOM_MASTER_KEY`). They are never sent back to the browser and are masked in logs (`redact`).
- **Claude Code bridge**: built-in tools disabled (`--tools ""`), no user MCP server or settings loaded, no session persistence, execution in an empty `data/cli-sandbox` folder. Agent tools are only reachable through WAR ROOM's local MCP proxy, so every call goes through the same permission checks.
- Files: 50 MB maximum, executables rejected, names sanitized. Imported HTML and SVG are never rendered inline.
- **Prompt-injection defense**: documents are wrapped in `<document>` tags with an instruction not to follow what they say. Messages from other agents are flagged as information. Unverified third-party Skills require explicit confirmation.
- **MCP**: an agent can only call a tool if it has the MCP permission, the server is assigned to it and the tool is in its allowlist. Tools marked sensitive require human confirmation.
- **Secret keys**: agents only see `{{secret:NAME}}` references; values are substituted server-side at execution time and masked in tool results, errors and logs.
- No code produced by an agent is executed.
