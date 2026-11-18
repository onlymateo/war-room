# Project status

## Implemented and tested end to end

- **Providers**: Claude Code (subscription), Anthropic API, OpenAI-compatible endpoints (OpenAI, Gemini, Mistral, DeepSeek, xAI, OpenRouter, Ollama, custom server). Connection test, model discovery, editable prices, encrypted keys.
- **Standalone chats**: streaming, switching models mid-conversation, settings (system prompt, effort, temperature, max tokens), rename, archive, delete, full-text search, attachments.
- **War Rooms**:
  - creation (brief, files, orchestrator, autonomy, strategy, budget);
  - brief analysis (team, tasks, Skills, MCP, risks, questions) and creation of the proposed team;
  - fully configurable agents;
  - group conversation with Auto, Targeted, All, Debate and Synthesis modes;
  - human approval of plans;
  - individual chats with each agent;
  - organizational view and live activity view;
  - kanban tasks, activity log, per-agent usage and context;
  - deletion of War Rooms and agents with a confirmation listing what is removed.
- **Usage**: exact tokens per call (input, output, cache), labeled costs, context used versus the model's window, budgets with alerts at 50, 80 and 100 %, Claude Code subscription quota.
- **Optimization**:
  - bounded history and automatic compression by summarization;
  - optional cheaper routing and summary models;
  - model choice by tier according to the strategy;
  - Anthropic prompt caching;
  - caps on agents and calls per message.
- **Skills**: real inventory (the user's Claude Code Skills, plugin marketplace, WAR ROOM Skills), installation into WAR ROOM (confirmation required for unverified sources), custom Skill creation, injection into agent prompts, recommendations checked against the inventory.
- **MCP**: adding STDIO and HTTP servers, connect and disconnect, tools, resources, prompts, logs, manual tool testing, sensitive tools, assignment to agents.
- **MCP tool calls by agents**: tool loop for the Anthropic API and OpenAI-compatible APIs; for Claude Code, WAR ROOM exposes the agent's tools through a temporary local MCP server, so every call goes through the same checks. Permissions checked on every call, human approval for sensitive tools (automatic refusal after 10 minutes), results truncated to 20,000 characters, caps on rounds and calls, calls shown in messages and the activity log. Each agent can be limited to a subset of a server's tools (checkboxes with estimated token cost); on a new assignment, only non-sensitive tools are checked by default.
- **Claude limit guard (subscription)**:
  - 5-hour and weekly window measurements returned by Claude Code on every call, stored over time;
  - consumption rate and predicted time of reaching the threshold;
  - warning banner and sidebar meters;
  - clean pause at the threshold (95 % by default) or when Claude refuses: chat reply kept pending, remaining agent missions, routing or synthesis set aside;
  - reset detection every minute, then an offer to resume (in place with streaming, or everything in the background);
  - limits report: status, paused work, usage per War Room and per agent within the window.
  Limitation: measurements are only updated on each call made by WAR ROOM (there is no way to read them without a call).
- **Per-War Room secret keys** ("Clés" button): encrypted values, never sent back to the browser nor shown to models. Agents write `{{secret:NAME}}` in MCP tool arguments; WAR ROOM inserts the value at execution time and masks it (raw, URL-encoded, base64, JSON-escaped) in results, errors and MCP logs. Per-agent and per-server restrictions, optional approval before each use, usage counter. Limitation: a key sent to a tool goes wherever that tool sends it.
- **War Room context recap**: built from the data (free, available even while Claude is paused) or written by the AI of your choice; can be copied and downloaded as Markdown.
- **Daily progress reports**: one per active War Room every day (configurable time, catch-up if the application was off), built without any AI call, plus on-demand generation.
- **Prompt improvement**: "Améliorer" (Improve) button in every conversation; rewrite by a low-cost model with a short context excerpt, cost shown, approval before sending.
- **Projects**: list, detail, Summary, Kanban, List and Timeline views, decisions, attaching War Rooms.
- **Files and memory**: upload, preview, download, tags, text extraction (text, code, CSV, JSON, PDF, DOCX), structured memory by scope.
- **Interface**: dark and light themes, collapsible sidebar, global search (Ctrl K), keyboard shortcuts, toasts, empty states, per-page error handling.

## Not implemented yet

| Feature | Current situation | Next step |
|---|---|---|
| MCP tools in standalone chats | Reserved for War Room agents | Choice of MCP servers per conversation |
| Images returned by an MCP tool | Reported to the model but not forwarded | Forwarding to models that accept images |
| Vector RAG | Keyword search, documents sent as text | Embeddings and libSQL vector columns |
| Automatic injection of structured memories (Memory page) | Only the War Room's shared memory, each agent's memory and summaries are injected | Selective retrieval by scope |
| Contradiction detection in memory | — | Verification pass by a low-cost model |
| Periodic re-evaluation of Skills | On-demand analysis ("Relancer l'analyse" button) | Triggers: new phase, new language detected |
| Searching for Skills on the Internet | Local sources and official marketplace only | Configurable, verified sources |
| Excel (.xlsx) and archives | Stored but no text extraction; the interface says so | Server-side extraction |
| Videos | Stored and previewable, not forwarded to models; the interface says so | Depending on the connected models |
| Codex CLI or Gemini CLI bridge (OpenAI and Google subscriptions) | Not implemented | Same approach as Claude Code |
| File version history, S3 storage | Simple local storage | Storage abstraction |
