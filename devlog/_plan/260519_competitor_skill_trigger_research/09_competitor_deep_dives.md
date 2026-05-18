# Top Competitor Deep-Dives

Sources: GitHub research, web search (May 19, 2026)

## 1. 10x-chat (MikeChongCan/10x-chat) — CLOSEST CLI COMPETITOR

| Attribute | Detail |
|-----------|--------|
| **Type** | CLI (`npx 10x-chat@latest`) |
| **Language** | TypeScript (v0.10.13) |
| **Stars** | 36 |
| **Created** | 2026-02-22 |
| **Last push** | 2026-05-16 (active) |
| **License** | MIT |
| **Browser engine** | Playwright + Patchright (stealth-patched Playwright fork) |
| **Providers** | ChatGPT, Gemini, Claude, Grok, Perplexity, NotebookLM (6 total) |
| **Session resume** | Yes — persisted Playwright profiles under `~/.10x-chat/profiles/` |
| **Model selection** | Yes — `--model` flag (Gemini: Fast/Thinking/Deep Think/Pro) |

### Architecture Difference

10x-chat **launches a new headless Chromium** via Playwright with persistent browser contexts. It **owns the browser lifecycle entirely** — does NOT attach to a running browser. Users run `login <provider>` once (headed), then subsequent `chat` calls reuse stored profiles.

agbrowse is **CDP-attach-first** — connects to an already-running browser, preserving the user's live session and login state.

### Unique Features agbrowse Lacks

| Feature | Description | agbrowse Equivalent |
|---------|-------------|-------------------|
| **File bundling** | `--file "src/**/*.ts"` globs files into markdown bundle as prompt. Auto-excludes `.env`/secrets | Context packaging exists but not glob-based |
| **Image generation** | Dedicated `image` command for DALL-E, Imagen, Grok image gen | NOT SUPPORTED |
| **Deep research mode** | `research` command with long-timeout polling (5-10+ min) for deep research features | Partial — long polling exists but no dedicated command |
| **NotebookLM integration** | Full RPC-based notebook/source management (create, add URLs/files, summarize, chat) | NOT SUPPORTED |
| **Agent skill system** | Ships `SKILL.md` installable into Codex/Claude Code for cross-validation via other LLMs | agbrowse has skill too, but 10x-chat targets agent integration |
| **`--dry-run` / `--copy`** | Preview or clipboard-copy assembled prompt without sending | NOT SUPPORTED |
| **Session history** | Captures prompt bundles and responses as markdown; `history` command scrapes sidebars | NOT SUPPORTED |

### Competitive Assessment

**10x-chat is the single closest competitor.** It covers MORE providers (6 vs 3) and has MORE features (image gen, deep research, file bundling, NotebookLM). However:

- agbrowse's CDP-attach approach is fundamentally better for users who want to reuse their existing browser session
- 10x-chat's Playwright approach means it can't see or interact with an already-open conversation
- agbrowse has deeper per-provider tuning (Grok model verification, effort control normalization, copy-markdown fallback chain)
- 10x-chat depends on Patchright for anti-detection — fragile dependency

**Threat level: HIGH.** Growing feature set, active development, agent-integration focus.

---

## 2. Agentify Desktop (agentify-sh/desktop) — AI-TO-AI DELEGATION

| Attribute | Detail |
|-----------|--------|
| **Type** | Desktop app (Node.js/Electron) |
| **Install** | `npx @agentify/desktop` |
| **Language** | JavaScript |
| **Stars** | 394 |
| **Created** | 2026-01-13 |
| **Last push** | 2026-05-18 (actively maintained) |
| **License** | MPL-2.0 |
| **Browser engine** | **CDP** (default and recommended), Electron fallback |
| **Providers** | ChatGPT, Claude, Perplexity, Google AI Studio, Gemini, Grok (6) |

### Architecture

Agentify is **purpose-built for AI-to-AI delegation** — lets coding agents (Codex, Claude Code, OpenCode) use your paid AI subscriptions. It's not a general CLI tool; it's an MCP tool server that agents call.

### MCP Integration (Core Design)

Exposes MCP tools:
- `agentify_query` — send prompt to an AI service
- `agentify_read_page` — read current page content
- `agentify_navigate` — navigate tabs
- `agentify_ensure_ready` — wait for service to be ready
- `agentify_save_artifacts` — download generated files
- `agentify_show` / `agentify_hide` — control browser visibility

### Unique Features

| Feature | Description |
|---------|-------------|
| **Stable tab keys** | Persistent named sessions reusable across prompts |
| **Parallel hidden/visible tabs** | Multiple agents use separate sessions simultaneously |
| **Context packing** | Injects local repo/file context into prompts |
| **Artifact persistence** | Downloads generated images/files locally |
| **CAPTCHA pause** | Surfaces browser window for manual completion |

### Competitive Assessment

Agentify occupies a **narrower niche** than agbrowse: it's specifically for coding agents to delegate to AI services. It shares CDP as a mechanism but differs fundamentally in purpose (MCP tool server vs CLI automation tool).

**Threat level: MEDIUM.** Different target user, but overlapping infrastructure. Could eat into agbrowse's use case if MCP becomes the dominant AI-agent integration pattern.

---

## 3. bolt.new — CODE GENERATION WEB UI

| Attribute | Detail |
|-----------|--------|
| **Type** | Browser-only SaaS (StackBlitz) |
| **Public API** | NONE |
| **CLI** | NONE |
| **Automation projects** | NONE found |
| **MCP** | Consumes MCP servers as "Connectors" but no MCP server exposes bolt.new |
| **OSS clone** | **bolt.diy** (stackblitz-labs/bolt.diy) — MIT, 19+ LLMs, self-hostable |

### CDP Automation Workflow

Since no API exists, pure CDP automation is the only path:

1. Navigate to bolt.new, handle auth (cookie/session injection)
2. Locate chat textarea, type prompt, submit
3. Poll for streaming response (DOM mutations or WebSocket network idle)
4. Preview — WebContainer renders live preview in iframe
5. Export — click download/deploy, intercept via `Page.setDownloadBehavior`

### Challenges

- No stable selectors (React with hashed class names)
- WebContainer iframe is a separate execution context
- Auth gating and bot detection
- Heavy JavaScript — slow DOM operations

### Recommendation

**Target bolt.diy instead of bolt.new.** Self-hosted, no auth walls, no bot detection. Could even add a thin HTTP API wrapper around its Remix server for direct programmatic submission, bypassing CDP entirely.

### Competitive Assessment

bolt.new is a **greenfield opportunity** for agbrowse — no one has automated it yet. But the technical complexity is high and the audience is different from chat automation users.

**Opportunity level: MEDIUM-HIGH.** Clear gap, but high implementation cost.

---

## Comparative Matrix

| Feature | agbrowse | 10x-chat | Agentify Desktop |
|---------|----------|----------|------------------|
| **Browser approach** | CDP-attach | Playwright (own browser) | CDP |
| **Providers** | 3 (ChatGPT, Gemini, Grok) | 6 (+Claude, Perplexity, NotebookLM) | 6 (+Claude, Perplexity, AI Studio) |
| **CLI-first** | YES | YES | NO (MCP tool server) |
| **Session resume** | YES | YES | YES (stable tab keys) |
| **Model selection** | YES (normalized) | YES | Via prompt |
| **File input** | Context packaging | Glob bundling | Context packing |
| **Image gen** | NO | YES | Via artifact save |
| **MCP integration** | NO | Skill system | CORE |
| **Anti-detection** | None needed (attach) | Patchright | None needed (attach) |
| **Stars** | — | 36 | 394 |
| **Active** | YES | YES | YES |
