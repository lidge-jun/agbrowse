<p align="center">
  <img src="assets/agbrowse-logo.png" alt="agbrowse logo" width="220">
</p>

# agbrowse

[![npm](https://img.shields.io/npm/v/agbrowse?label=npm)](https://www.npmjs.com/package/agbrowse)
[![Contract Drift Check](https://github.com/lidge-jun/agbrowse/actions/workflows/contract-drift.yml/badge.svg)](https://github.com/lidge-jun/agbrowse/actions/workflows/contract-drift.yml)
[![GitHub stars](https://img.shields.io/github/stars/lidge-jun/agbrowse?style=flat&label=stars)](https://github.com/lidge-jun/agbrowse)
[![GitHub Pages ready](https://img.shields.io/badge/GitHub%20Pages-docs%20ready-111827)](docs/index.html)
[![Node](https://img.shields.io/badge/node-%3E%3D18-0f766e)](package.json)
[![Package license](https://img.shields.io/badge/package%20metadata-MIT-1f2937)](package.json)

Standalone Chrome/CDP browser automation and web-ai CLI for AI agents. It turns
browser work into small, inspectable terminal commands: observe the page,
act by stable references, collect screenshots/console/network evidence, and run
ChatGPT, Gemini, or Grok web UI sessions without paying an MCP token tax.

`agbrowse` is a serverless extraction of the cli-jaw / 30_browser browser
workflow. It gives an agent a small CLI surface for:

- DOM/ref based browser control
- screenshots and coordinate clicks
- console/network/DOM diagnostics
- adaptive reading for one candidate URL via `agbrowse fetch`
- structured web-ai prompt rendering
- live ChatGPT, Gemini, and Grok web UI execution
- file upload and context-package upload for implemented providers
- ChatGPT code-mode zip generation and later artifact re-extraction

It does not require a long-running MCP server. Each command is a short-lived
Node process that reconnects to the same Chrome DevTools Protocol endpoint.

## Public Surface

| Surface | Link | Status |
| --- | --- | --- |
| npm package | [`agbrowse`](https://www.npmjs.com/package/agbrowse) | public package metadata |
| Repository | [`lidge-jun/agbrowse`](https://github.com/lidge-jun/agbrowse) | public source |
| Docs landing page | [`docs/index.html`](docs/index.html) | local Pages entrypoint, deploys after an authorized push |
| Architecture source | [`structure/INDEX.md`](structure/INDEX.md) | capability and release truth source |
| Production notes | [`docs/production-readiness.md`](docs/production-readiness.md) | verification and risk checklist |

GitHub Pages is intentionally documented as **ready, not live** in this local
state because the GitHub Pages API currently returns 404 for this repository.
The added Pages workflow publishes `/docs` once the owner authorizes a push.

## Quick Start

```bash
npm install -g agbrowse
agbrowse --help
agbrowse skills get core --full
agbrowse start
agbrowse navigate "https://chatgpt.com/"
agbrowse snapshot --interactive --max-nodes 120
```

For web-ai smoke tests after logging in to the provider:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Reply exactly AGBROWSE_OK"
```

For long Pro / Deep Think runs that should survive shell exit:

```bash
SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \
        --prompt "..." --json | jq -r .sessionId)
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800
```

Agent rule: observe before acting. Use `status`, `tabs`, `snapshot
--interactive`, and `web-ai status` before mutating a page. Set
`AGBROWSE_JSON_ERRORS=1` for parseable failure envelopes.

## What It Is Good For

- **Browser automation for agents**: navigate, snapshot, click refs, type,
  capture screenshots, inspect console/network, and keep the active CDP target
  stable across commands.
- **Web-AI execution**: submit and poll ChatGPT, Gemini, and Grok sessions with
  provider-specific model selection and fail-closed capability checks.
- **ChatGPT code artifacts**: ask ChatGPT to build a small project, package it
  as `/mnt/data/*.zip`, retrieve the zip headlessly, and re-extract it later
  from the same saved conversation.
- **Evidence-heavy research**: require source audits, save answer artifacts, and
  preserve traces without relying on hidden browser state.
- **Standalone skill distribution**: install bundled `browser`, `web-ai`, and
  `vision-click` skills into cli-jaw or Codex skill roots.

## Architecture Snapshot

```text
agent shell
  -> agbrowse bin
  -> browser skill runtime
  -> Chrome DevTools Protocol
  -> target tab / provider web UI

web-ai command
  -> provider adapter
  -> tab/session guard
  -> prompt renderer
  -> poller + artifact writer
  -> source/trace/policy gates
```

The runtime keeps browser state under `BROWSER_AGENT_HOME` and stores durable
web-ai sessions separately from the shell process, so a later `poll` can resume
the same provider tab by session id.

## Verification Policy

Use the smallest gate that matches the changed surface:

```bash
npm run typecheck
npm run test:release-gates
npm run smoke:bins
npm run test:mcp
npm run test:source-audit
npm run test:trace-policy
npm run gate:all
```

Current remote CI signal: the scheduled `Contract Drift Check` workflow is
passing on `main`. Release publishing remains manual through `release.yml`.

## Safety Model

- Provider DOMs are treated as untrusted and can drift.
- Unsupported vendors, unsupported model aliases, missing composers, and unsafe
  context-package paths fail closed.
- `~/.browser-agent` contains browser profile/session state and must not be
  committed or shared.
- CAPTCHA bypass, stealth, credential stuffing, and guaranteed provider account
  entitlement checks are out of scope.
- The package metadata says MIT; this repository currently has no standalone
  root `LICENSE` file, so downstream users should rely on package metadata until
  one is added.

## Status

This repository is packaged as a standalone skill/runtime.

Architecture and release-claim source of truth live in
[`structure/INDEX.md`](structure/INDEX.md) and the Phase 11+ truth table lives
in [`structure/phase_status.md`](structure/phase_status.md). Update that folder
when CLI, web-ai, MCP, eval, or release-gate behavior changes.

Ready surfaces:

- `agbrowse` CLI bin
- persistent Chrome profile under `BROWSER_AGENT_HOME`
- stable default CDP port `9222`
- explicit `--port` / `CDP_PORT` override
- active tab persistence via CDP target id
- browser primitive tests
- web-ai contract tests
- source-audit and answer-artifact gates for research workflows
- narrow MCP bridge surface: `web_ai_*`, `browser_snapshot`, and
  `browser_click_ref` with strict input schemas
- offline DOM churn eval fixtures
- trace and safety-policy schemas
- benchmark trajectory schema and offline bundle writer

Beta surfaces:

- ChatGPT, Gemini, and Grok live web-ai send/poll/query flows
- provider model and reasoning-effort selection
- provider source/citation quality checks

Experimental or deferred surfaces:

- adaptive URL fetch (`agbrowse fetch <url>`) as a URL reader, not search
- hosted/cloud browser operation
- remote `external-cdp` provider mode
- broader MCP production bridge beyond the listed tools
- leaderboard or competitor benchmark score claims

What remains intentionally out of scope for the standalone runtime:

- cli-jaw server APIs
- root cli-jaw watcher/notification dashboards
- guaranteed provider account access
- captcha or Cloudflare bypass
- billing/subscription entitlement checks

Provider UIs change frequently. Live web-ai flows are smoke-tested behavior, not
a contractual API from the providers.

## Install CLI

From npm:

```bash
npm install -g agbrowse
```

From this repository:

```bash
git clone https://github.com/lidge-jun/agbrowse.git
cd agbrowse
npm install
npm link
```

Direct local usage without linking:

```bash
node skills/browser/browser.mjs status
node skills/browser/browser.mjs fetch https://example.com --json --trace
node skills/browser/browser.mjs web-ai render --vendor chatgpt --prompt "hello"
```

## Adaptive URL Fetch (v2)

`agbrowse fetch <url>` reads one candidate URL through a 6-phase adaptive
escalation ladder and returns evidence. It is useful after a search tool or
user has produced a URL.

```bash
agbrowse fetch "https://example.com/article"
agbrowse fetch "https://example.com/article" --json --trace
agbrowse fetch "https://example.com/article" --browser never
agbrowse fetch "https://example.com/article" --no-browser
agbrowse fetch "https://example.com/article" --browser required
agbrowse fetch "https://example.com/article" --allow-third-party-reader
agbrowse fetch "https://example.com/article" --browser-session user
agbrowse fetch "https://example.com/article" --browser-session interactive
agbrowse fetch "https://example.com/article" --identity chrome
```

Escalation ladder (code execution order): public endpoints + direct fetch with
identity headers → third-party readers (opt-in) → isolated Chrome render +
network API discovery → user session (opt-in) → human-in-the-loop (interactive).
Content scoring runs after each phase to decide whether to escalate.

Key flags: `--browser auto|never|required`, `--browser-session
none|isolated|existing|user|interactive`, `--identity auto|minimal|chrome`,
`--no-public-endpoints`, `--max-bytes N`, `--timeout-ms N`, `--selector CSS`,
`--allow-third-party-reader`, `--allow-archive`. Run `agbrowse fetch --help`
for full flag reference.

In `--json` mode the selected `content` field is bounded before serialization
so stdout remains parseable even when a public endpoint returns a large JSON
document. Results include `contentBytes`, `contentLimitBytes`, and
`contentTruncated`; truncation means only the CLI output was compacted, not that
the source was rejected. `--max-bytes` remains the per-attempt read limit.

Automated CAPTCHA solving, credential stuffing, and stealth are forbidden.
Human assistance (browser-grade headers, user session, human resolves) is
allowed with explicit opt-in flags (`--browser-session user|interactive`).
Built-in public endpoint candidates include GitHub, Reddit, Hacker News,
Wikipedia, npm, PyPI, arXiv, Bluesky, Mastodon-compatible statuses, Stack
Exchange, dev.to, DOI/CrossRef, OpenLibrary, Wayback CDX, YouTube oEmbed,
X/Twitter oEmbed, HN Algolia, V2EX, Lobsters, and generic oEmbed discovery.

## Requirements

- Node.js 18+
- Google Chrome, Chromium, or Brave
- `playwright-core`
- Codex CLI only if you use `vision-click`

On macOS and desktop Linux, headed Chrome is recommended for web-ai provider
sites because provider anti-bot checks often reject headless sessions.

## Browser Lifecycle

Default runtime state:

| Setting | Default |
| --- | --- |
| data dir | `~/.browser-agent` |
| profile dir | `~/.browser-agent/browser-profile` |
| CDP port | `9222` |
| screenshot dir | `~/.browser-agent/screenshots` |
| state file | `~/.browser-agent/browser-state.json` |

The default port does not fluctuate. It stays `9222` unless you pass `--port` or
set `CDP_PORT`.

```bash
agbrowse start
agbrowse status
agbrowse stop
```

Use a custom home and port when running multiple isolated instances:

```bash
BROWSER_AGENT_HOME="$HOME/.browser-agent-work" CDP_PORT=9333 agbrowse start
BROWSER_AGENT_HOME="$HOME/.browser-agent-work" CDP_PORT=9333 agbrowse web-ai status --vendor chatgpt
```

If Chrome is already listening on the selected CDP port and responds to
`/json/version`, `agbrowse` reuses it and emits a stderr warning when the
running CDP endpoint appears to differ from agbrowse's persisted browser
state (no prior state, port mismatch, or `startedAt` more than an hour old).
If another non-CDP process owns the port, startup fails instead of silently
choosing a different port.

## First Login

Provider web-ai flows need a logged-in browser profile. Do this once:

```bash
agbrowse start
agbrowse navigate "https://chatgpt.com/"
agbrowse navigate "https://gemini.google.com/app"
agbrowse navigate "https://grok.com/"
```

Complete login manually in the headed Chrome window. The profile is reused for
later commands.

Do not commit or share `~/.browser-agent`; it contains browser session state.

## Install Bundled Skills

`npm install -g agbrowse` installs the `agbrowse` and
`agbrowse-vision-click` commands immediately. It does not automatically mutate
any agent runtime. To register the bundled skills, choose the target skill root
explicitly:

```bash
agbrowse skills install --target ~/.cli-jaw-3460/skills
```

For Codex:

```bash
agbrowse skills install --target ~/.codex/skills
```

The default mode copies the bundled `browser`, `web-ai`, and `vision-click`
skill directories. Use `--json` when another agent will parse the result:

```bash
agbrowse skills install --target ~/.cli-jaw-3460/skills --json
```

Use `--link` if you want the target skill directories to track the globally
installed npm package:

```bash
agbrowse skills install --target ~/.cli-jaw-3460/skills --link
```

Existing target skills are preserved by default. Replace them explicitly with:

```bash
agbrowse skills install --target ~/.cli-jaw-3460/skills --force
```

## Core Browser Commands

```bash
agbrowse start [--port 9222] [--headless] [--chrome-path /path/to/chrome]
agbrowse stop
agbrowse status
agbrowse reset --force
```

Observe:

```bash
agbrowse snapshot --interactive --max-nodes 80
agbrowse screenshot --json
agbrowse screenshot --full-page
agbrowse text
agbrowse text --format html
agbrowse get-dom --selector "main" --max-chars 4000
agbrowse console --clear --reload --duration 3000
agbrowse network --reload --duration 2000 --filter api
```

Act:

```bash
agbrowse click e3
agbrowse type e5 "hello" --submit
agbrowse press Enter
agbrowse hover e7
agbrowse mouse-click 400 300
agbrowse resize 1440 900
agbrowse evaluate "document.title"
```

### Tab Management (Phase 9.1)

Multi-tab support isolates each web-ai session in its own browser tab.

```bash
agbrowse tabs                          # list all tabs
agbrowse tab-switch 2                  # switch by index
agbrowse tab-switch <targetId>         # switch by CDP target id
agbrowse new-tab <url>                 # create a new tab
agbrowse tab-close <targetId>          # close a tab
agbrowse tab-cleanup                   # close idle tabs and enforce max-tabs
agbrowse tab-cleanup --include-untracked --idle-after 10m
```

Web-ai tab behavior:

```bash
# Default: new tab per send/query (Phase 9.1)
agbrowse web-ai send --vendor chatgpt --inline-only --prompt "hello"

# Legacy: reuse the existing active tab
agbrowse web-ai send --vendor chatgpt --reuse-tab --inline-only --prompt "hello"
export AGBROWSE_REUSE_TAB=1            # global legacy mode
```

Session-to-tab binding is strong: `poll` and `stop` with `--session` resolve
the session's bound tab, not the globally active tab. If the tab was closed,
the runtime auto-recovers by creating a new tab and navigating to the saved
`conversationUrl`.

Tab limits:

| Setting | Default | Env var |
| --- | --- | --- |
| Max tabs | 10 | `AGBROWSE_MAX_TABS` |
| Idle timeout | 30 min | `AGBROWSE_TAB_IDLE` |

`send` and `query` run tab cleanup before opening another tab. Cleanup never
closes tabs pinned in the current process or tabs bound to active web-ai
sessions. Use `agbrowse tabs --json` to inspect `lastActiveAt`, `idleForMs`,
and `pinned` state before manual cleanup.

Recommended loop:

```text
snapshot --interactive -> act -> snapshot -> verify
```

Refs are scoped to the latest snapshot. Re-run `snapshot --interactive` after
navigation, reload, tab switch, or any major page mutation.

## Vision Click

Use `vision-click` only when a target is visible in a screenshot but has no
usable DOM/ref target, such as canvas/WebGL-heavy UIs.

```bash
agbrowse screenshot --json
agbrowse-vision-click "the visible Submit button"
```

The vision path handles device-pixel-ratio correction before sending
`page.mouse.click()` coordinates.

## Web AI

The `web-ai` command drives ChatGPT / Gemini / Grok web UIs through the same
Chrome that `agbrowse start` spawns. It treats provider DOM as untrusted and
fails closed when required selectors, models, or capabilities are not
observed.

Commands:

```bash
agbrowse web-ai render            # render the prompt envelope only
agbrowse web-ai status            # check active tab + composer
agbrowse web-ai send              # submit and return a sessionId
agbrowse web-ai poll              # wait for completion
agbrowse web-ai query             # send + poll
agbrowse web-ai stop              # press Escape on the active tab
agbrowse web-ai project-sources   # list/add ChatGPT Project Sources
agbrowse web-ai code              # generate + retrieve ChatGPT code zip artifacts
agbrowse web-ai code-extract      # re-retrieve zip artifacts from an old conversation
agbrowse web-ai context-dry-run   # preview a context package
agbrowse web-ai context-render    # render full prompt + context text
```

Provider matrix:

| Provider | Inline | File upload | Context package | Model select | Copy fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| ChatGPT | yes | yes | yes | yes | yes |
| Gemini  | yes | yes | yes | yes | yes |
| Grok    | yes | yes | **fail-closed** (see Context Packages) | yes | yes |

Unsupported vendors and unsupported model aliases fail closed before any
browser mutation.

Every prompt automatically appends an `[INSTRUCTIONS]` block telling the
model to use web search and cite sources inline. Run `web-ai render` to
inspect the exact text that is typed into the composer.

### Polling Timeouts

`web-ai poll` / `query` / `watch` accept `--timeout <seconds>`. Default:

| Vendor | Default `--timeout` | Roughly |
| --- | ---: | --- |
| ChatGPT | 1200 | 20 minutes |
| Gemini  | 1200 | 20 minutes |
| Grok    | 600  | 10 minutes |

Pass `--timeout 1800` for unusually long Pro/Deep Think runs. The provider
tab and the agbrowse Chrome process stay open across a poll timeout —
only the polling loop gives up.

### Sessions

`web-ai send` returns a 26-char ULID `sessionId` that survives shell exit,
OS sleep, and Bash timeouts. Sessions persist at
`$BROWSER_AGENT_HOME/web-ai-sessions.json` (default `~/.browser-agent`).

```bash
# Long Pro / Deep Think run — fire-and-forget from one shell, resume from another.
SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \
        --prompt "long Pro prompt..." --json | jq -r .sessionId)

# Later, in any shell, on the same machine:
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800
```

`poll` resolves the session in priority order: `--session <id>` > active
target id > vendor latest > legacy baseline. On a shared CDP port, session-less
`poll`/`stop` auto-bind only when exactly one active provider session exists;
two or more active sessions fail closed with `session.target-ambiguous` and
candidate `sessionId`/`targetId` evidence. Each completion / timeout updates
the session record with `status`, `conversationUrl`, and `answer`. Completed
sessions also expose local artifact descriptors in
`agbrowse web-ai sessions show <id>` when transcript, report, or image artifacts
were saved.

**Session-to-tab binding** (Phase 9.1): every session owns its own tab.
The record stores `targetId`, `tabId`, and `tabState` (`createdAt`,
`lastActiveAt`, `recoveryCount`, `closeCount`). `stop --session <id>` resolves
that bound tab and sends Escape as an interrupt without taking over the running
poll's target lease. If the bound tab is closed mid-operation, the runtime
auto-recovers once by creating a new tab and navigating to the saved
`conversationUrl` where the command permits navigation.

Temporary Chat sessions are never archived, including when archive mode is
forced, because they are not durable ChatGPT conversations.

Add `--deadline <iso>` to override the default deadline (now + `--timeout`)
and `--navigate` to allow `sessions resume` to switch tabs when the saved
`conversationUrl` differs from the current tab.

#### Durable session recovery

Session recovery is target-bound. `poll --session`, `watch --session`,
`sessions resume`, and `sessions reattach` resolve the session's stored target
first, then recover/navigate only when the command permits it. Use
`agbrowse web-ai sessions doctor <id> --json` when a shell was interrupted or
a provider tab outlived a local timeout.

### Failure envelope

Set `AGBROWSE_JSON_ERRORS=1` (or pass `--json`) for machine-readable
failures. Every error becomes:

```json
{
  "ok": false,
  "status": "error",
  "error": {
    "name": "WebAiError",
    "errorCode": "cdp.target-mismatch",
    "stage": "connect",
    "message": "active tab is not ChatGPT: https://example.com/",
    "retryHint": "tab-switch",
    "vendor": "chatgpt",
    "mutationAllowed": false,
    "selectorsTried": [],
    "evidence": { "url": "https://example.com/" }
  }
}
```

Poll-stage target drift is returned as a command result, not just an error
envelope. The result includes `ok: false`, `status: "target-mismatch"`,
`expectedTargetId`, `actualTargetId`, `port`, a `targetMismatch` object, and a
`recovery` command such as:

```bash
agbrowse web-ai poll --vendor chatgpt --session "$SID" --navigate --json
```

Initial `errorCode` catalog:

- `cdp.unreachable`, `cdp.target-mismatch`
- `provider.composer-not-visible`, `provider.model-mismatch`,
  `provider.attachment-preflight`, `provider.attachment-evidence-missing`,
  `provider.commit-not-verified`, `provider.poll-timeout`,
  `provider.runtime-disabled`
- `capability.unsupported`
- `session.target-ambiguous`
- `context.over-budget`, `context.symlink-rejected`
- `grok.context-pack-not-allowed`
- `internal.unhandled`

Exit code is `1` on every failure; `--json` always lands a single parseable
envelope on `stderr` (no double-printing).

### Render First

```bash
agbrowse web-ai render \
  --vendor chatgpt \
  --project "agbrowse" \
  --goal "review the upload flow" \
  --prompt "Find the riskiest edge case."
```

The envelope is structured and stable:

```text
[SYSTEM]
...

[USER]
## Project
...

## Goal
...

## Question
...
```

### ChatGPT

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Reply exactly CHATGPT_OK"
```

Model aliases:

- `instant`, `fast`, `gpt-5.3`
- `thinking`, `think`, `gpt-5.5-thinking`
- `pro`, `gpt-5.5-pro`

Current headed ChatGPT UI may expose a simplified `Intelligence` picker instead
of the older model row plus separate effort submenu. The runtime maps
`thinking --effort light|standard|extended|heavy` to `Instant|Medium|High|Extra
High`, and maps Pro requests through `Pro Extended` when that is the visible Pro
entry. Legacy `model-switcher-*` rows and composer-pill fallbacks remain
supported.

### ChatGPT Code Mode

`web-ai code` is a ChatGPT-only beta for generating small codebases through the
visible ChatGPT web UI, then retrieving the resulting zip without clicking a
download button. The prompt contract asks ChatGPT to create a durable
`PLAN.md` or `00_plan.md` checklist inside the generated artifact, use
`turn_plan.update_turn_plan` only when that tool is actually available during
the response, allow longer 20+ item todo lists for complex work, treat that
visible todo UI as transient after completion,
implement, self-check, package, and answer with both a human clickable sandbox
link and a machine-readable plain path. Each `web-ai code` call automatically
uploads `skills/web-ai/modules/gpt-dev-agent-context.zip` as the first
attachment so ChatGPT has the Linux sandbox and serial-agent build rules before
the user build spec.

Single zip:

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --prompt "Create a Flask hello-world MVP." \
  --output-zip ./result.zip
```

Several named zips:

```bash
agbrowse web-ai code \
  --vendor chatgpt \
  --model thinking \
  --effort standard \
  --multi-zip \
  --output-dir ./artifacts \
  --prompt "Create backend.zip and frontend.zip as separate deliverables."
```

Later extraction from an existing conversation:

```bash
agbrowse web-ai code-extract \
  --vendor chatgpt \
  --url "https://chatgpt.com/c/<conversation-id>" \
  --output-zip ./result.zip
```

If the ChatGPT conversation tab is already open, `--url` can be omitted. If the
conversation was created by agbrowse and the session record still exists, pass
`--session <sessionId>` instead. Multiple old zips can be recovered with
`--multi-zip --output-dir ./artifacts`.

The extractor does not send a follow-up prompt. It scans the saved conversation
JSON for `/mnt/data/*.zip`, mints the provider download URL, fetches the
cookie-bound payload inside the page, validates the zip, and writes it locally.
The original conversation URL/session/current tab plus a logged-in ChatGPT
browser profile are still required; a copied `/mnt/data/result.zip` line alone
is not enough.

Expected final assistant answer shape:

```text
DOWNLOAD: [result.zip](sandbox:/mnt/data/result.zip)
MACHINE: /mnt/data/result.zip
```

For multi-zip output, ChatGPT repeats the same two-line block for each zip. The
`DOWNLOAD:` line is for humans in the ChatGPT UI; the `MACHINE:` line is for
agbrowse and other automation.

New code-mode runs fail closed if the recovered code zip does not contain
`PLAN.md` or `00_plan.md`. `code-extract` remains able to recover old
conversations, but old artifacts may predate the plan-file contract.
Do not treat disappearance of the visible todo UI after the response finishes
as a failure; the zip-root plan file is the durable checklist. Small generated
projects usually need 5-10 plan items, but complex projects may use 20 or more.
Completed items in the zip-root plan file should be marked `[x]` before final
packaging.

Verify recovered archives locally when correctness matters:

```bash
unzip -t ./result.zip
unzip -l ./result.zip
```

### Gemini

```bash
agbrowse web-ai query \
  --vendor gemini \
  --url https://gemini.google.com/app \
  --model deepthink \
  --inline-only \
  --prompt "Reply exactly GEMINI_OK"
```

Model aliases:

- `flash-lite`, `fast`, `gemini-fast`
- `flash`, `gemini-flash`
- `pro`, `gemini-pro`
- `thinking`, `think`, `gemini-thinking` are legacy compatibility aliases for `pro`

Versioned UI labels such as Gemini 3.n Pro are normalized internally; prefer the
stable aliases above.

Tool aliases:

- `deepthink`, `deep-think`, `deep_think`, `deep think`

Gemini `deepthink` activates the visible `Deep think` tool before submitting
the prompt. It is intentionally separate from the `thinking` model alias.

### Grok

```bash
agbrowse web-ai query \
  --vendor grok \
  --url https://grok.com/ \
  --model expert \
  --inline-only \
  --prompt "Reply exactly GROK_OK"
```

Model aliases:

- `auto`, `automatic`
- `fast`, `quick`
- `expert`, `thinking`, `think`
- `grok-4.3`, `grok43`, `grok-43`, `beta`
- `heavy`

## File Upload

```bash
agbrowse web-ai query \
  --vendor gemini \
  --url https://gemini.google.com/app \
  --model fast \
  --file /path/to/user-requested-file.pdf \
  --prompt "Summarize the attached file."
```

Use `--file` only when the user explicitly wants that single file uploaded. For
source/project context, use context packaging instead of creating a temporary
`.txt`/`.md` file.

Upload success is not input-only. The runtime verifies visible attachment
evidence before send and sent-turn evidence after send where the provider DOM
exposes it.

`--max-upload-file-size <bytes>` sets the per-file cap for live provider
uploads through `--file`. This is intentionally separate from context package
selection: `--max-context-file-size <bytes>` is the preferred context budget
flag, while `--max-file-size <bytes>` remains a legacy alias for that context
budget.

## Generated Images

ChatGPT generated-image output is beta and opt-in:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --inline-only \
  --output-image ./out.png \
  --prompt "Create an image of a small robot holding a banana."
```

When ChatGPT returns multiple images for one `--output-image ./out.png`
request, agbrowse writes sibling files as `out.png`, `out-2.png`,
`out-3.png`. Explicit image output is fail-closed: if no generated image can be
detected or saved, the command returns `provider.image-output` instead of
silently succeeding.

Image input remains regular upload:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --file ./input.png \
  --prompt "Describe this image."
```

## Batch Follow-Ups

ChatGPT batch follow-ups are explicit and sequential in the same command:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --prompt "Analyze this design." \
  --follow-up "Summarize the risks." \
  --follow-up "List the next three actions."
```

This is an in-command batch mode. For a later follow-up in the same saved
conversation window, use `query --session <id> --prompt <text>`:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --session "$SID" \
  --inline-only \
  --output-image ./next.png \
  --prompt "Create another image in this same conversation."
```

`--follow-up` is ChatGPT-only and cannot be combined with `--research deep`.

## Deep Research

`--research deep` activates ChatGPT Deep Research mode as an experimental beta:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --research deep \
  --timeout 1800 \
  --prompt "Research the current official status and cite sources."
```

Deep Research saves a report artifact when available, records
`researchMode: "deep"` in the session, and skips auto archive. Account blocks
or missing provider UI surfaces are reported explicitly; do not treat this as a
ready cross-provider capability.

## ChatGPT Project Sources

Project Sources are append-only and require an explicit ChatGPT project URL:

```bash
agbrowse web-ai project-sources list \
  --chatgpt-url https://chatgpt.com/g/project_123 --json

agbrowse web-ai project-sources add \
  --chatgpt-url https://chatgpt.com/g/project_123 \
  --file ./docs/context.md \
  --dry-run summary
```

`--dry-run` validates the project URL and local files without browser mutation.
Live `add` waits for upload evidence before reporting `uploaded: true`. Delete,
replace, and clear operations are intentionally unsupported.

## Context Packages

Use context packages when the prompt plus files would be too large or when you
want untrusted file content separated from the main instruction block.

Upload transport writes one `web-ai-context-package-<id>.zip` archive. The
archive contains `CONTEXT_PACKAGE.md` plus the selected source files; do not
create a temporary `.txt` or `.md` file yourself for source context.

> Use ChatGPT or Gemini for context packaging. Grok context packages **fail
> closed** by default — `web-ai send/query --vendor grok` with
> `--context-from-files` / `--context-file` / `--context-transport upload`
> throws with `stage: 'grok-context-pack-not-allowed'`. Pass
> `--allow-grok-context-pack` to override deliberately; the runtime still
> emits `grok-context-pack-not-recommended` when the override is used.

Dry run:

```bash
agbrowse web-ai context-dry-run \
  --vendor chatgpt \
  --prompt "Review these files" \
  --context-from-files "web-ai/*.mjs" \
  --json
```

Live upload:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --url https://chatgpt.com/ \
  --context-from-files "web-ai/*.mjs" \
  --context-transport upload \
  --prompt "Reply exactly CONTEXT_OK if the package contains question.mjs."
```

Inline context:

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --inline-only \
  --context-from-files "web-ai/question.mjs" \
  --context-transport inline \
  --prompt "Review this file."
```

## Copy Markdown Fallback

`--allow-copy-markdown-fallback` asks the runtime to use the provider Copy
button after the DOM response completes. The implementation intercepts the
page's `navigator.clipboard.writeText/write` call and does not read the OS
clipboard. The flag is the explicit policy opt-in for this capture path; do
not pair it with `--unsafe-allow` in normal CLI use.

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Return a markdown table."
```

The fallback is opt-in because provider copy buttons are UI details and can
change. A custom policy can still disable it with `allowClipboardWrite: false`,
or allow MCP/server-side copy capture with `allowClipboardWrite: true`.

## Source Audit

Use `--require-source-audit` on `poll` or `query` when a research answer must
carry inline sources next to factual claims. The audit checks completed
`answerText` locally and fails closed when claims are unsourced.

```bash
agbrowse web-ai query \
  --vendor grok \
  --model expert \
  --inline-only \
  --require-source-audit \
  --source-audit-scope "official product docs and release notes" \
  --source-audit-date "2026-05-05" \
  --prompt "Summarize the latest official product changes with sources."
```

Absence claims such as "no official response was found" require
`--source-audit-scope` and `--source-audit-date`. Use
`--source-audit-ratio <0..1>` only when partial sourcing is deliberate; the
default requires every detected claim to carry an inline source.

## Active Tab Safety

`tab-switch` stores a CDP target id, and mutating commands resolve the active
page by that target id before falling back to page order.

```bash
agbrowse tabs
agbrowse tab-switch 0DD58EC9517DB9514D37AE74AC21829F
agbrowse web-ai status --vendor gemini
```

For live web-ai work, prefer passing `--url` so the provider runtime can verify
the target host before mutation.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BROWSER_AGENT_HOME` | `~/.browser-agent` | profile, screenshots, state, **`web-ai-sessions.json`** session store |
| `CDP_PORT` | `9222` | default DevTools port |
| `AGBROWSE_JSON_ERRORS` | unset | set `1` to force JSON failure envelopes regardless of `--json` |
| `CHROME_HEADLESS` | unset | set `1` for headless startup |
| `CHROME_NO_SANDBOX` | unset | set `1` only in Docker/CI if needed |
| `CHROME_BINARY_PATH` | auto-detect | custom Chrome executable |
| `BROWSER_SCRIPT` | bundled browser script | used by vision-click |

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `CDP connection failed` | Chrome is not running on the selected port | `agbrowse start` |
| port in use but not CDP | another process owns `9222` | choose `CDP_PORT=9333` or stop the process |
| provider says sign in | profile is not logged in | open the provider URL and log in manually |
| wrong tab was used | stale active target | run `tabs`, then `tab-switch <targetId>` |
| upload never appears | provider UI changed | run `snapshot`, `get-dom`, and update provider selectors |
| Cloudflare/human check | provider anti-bot page | complete the check manually in headed Chrome |

## Development

```bash
npm install
npm test
npm run test:unit
npm run test:integration
```

Useful focused checks:

```bash
npx vitest run test/unit/browser-active-tab.test.mjs --reporter=verbose
npx vitest run test/integration/web-ai-cli-contract.test.mjs --reporter=verbose
```

## Release

`agbrowse` ships with a release script modeled after the cli-jaw release
scripts.

```bash
npm run release          # first release keeps package.json version; later releases bump patch
npm run release -- minor
npm run release -- major
npm run release -- 0.2.0
```

Preview releases:

```bash
npm run release:preview
npm run release:preview -- 0.2.0
```

The default script verifies the package, pushes a git tag, then runs
`npm publish --access public`. If the npm account requires browser-based
authentication, npm will print the auth URL during that publish step.

The release path includes named claim gates for MCP, source audit, trace/policy,
structure drift, fixture evals, package dry-run, and high-severity dependency
audit. Use `npm run test:mcp`, `npm run test:source-audit`, and
`npm run test:release-gates` when checking those surfaces directly.

Phase 22 also wires single-name release gates that fold those checks into one
runner (`scripts/release-gates.mjs`):

```bash
npm run gate:all                                  # run every named gate
npm run gate:typecheck                            # node --check + structure drift
npm run gate:tests                                # unit + MCP + source-audit + trace-policy
npm run gate:truth-table-fresh                    # CAPABILITY_TRUTH_TABLE.md ≤ 7 days old
npm run gate:mcp-scope-frozen                     # only the 2 frozen browser_* tools
npm run gate:no-experimental-in-readme-ready-section
```

The capability/claim truth table for both `agbrowse` and the `cli-jaw` mirror
lives at [`structure/CAPABILITY_TRUTH_TABLE.md`](structure/CAPABILITY_TRUTH_TABLE.md);
update that file in the same commit as any capability or claim change.

Strict-migration baseline checks shipped alongside the gates:

```bash
npm run check:strict-baseline    # JSDoc opt-in regression guard
npm run check:module-graph       # module dependency graph regression
npm run smoke:bins               # published bin entrypoints boot
npm run typecheck                # tsc --noEmit on the strict surface
```

For npm trusted publishing through GitHub Actions, configure npm's trusted
publisher for:

```text
Repository: lidge-jun/agbrowse
Workflow:   release.yml
```

Then run:

```bash
AGBROWSE_PUBLISH_VIA_GITHUB=1 npm run release
```

That path pushes the version tag and dispatches `.github/workflows/release.yml`
with `id-token: write`, so npm can publish through OIDC instead of a long-lived
token or OTP prompt.

## Security Notes

- Do not expose the CDP port to untrusted networks.
- Do not commit `BROWSER_AGENT_HOME`.
- `evaluate` executes arbitrary page JavaScript and should only be used by a
  trusted local agent.
- Provider accounts, subscriptions, and generated content remain the user's
  responsibility.

## License

MIT
