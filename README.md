<p align="center">
  <img src="assets/agbrowse-logo.png" alt="agbrowse logo" width="220">
</p>

# agbrowse

Standalone Chrome/CDP browser automation and web-ai CLI for AI agents.

`agbrowse` is a serverless extraction of the cli-jaw / 30_browser browser
workflow. It gives an agent a small CLI surface for:

- DOM/ref based browser control
- screenshots and coordinate clicks
- console/network/DOM diagnostics
- structured web-ai prompt rendering
- live ChatGPT, Gemini, and Grok web UI execution
- file upload and context-package upload for implemented providers

It does not require a long-running MCP server. Each command is a short-lived
Node process that reconnects to the same Chrome DevTools Protocol endpoint.

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
  `browser_click_ref`
- offline DOM churn eval fixtures
- trace and safety-policy schemas
- benchmark trajectory schema and offline bundle writer

Beta surfaces:

- ChatGPT, Gemini, and Grok live web-ai send/poll/query flows
- provider model and reasoning-effort selection
- provider source/citation quality checks

Experimental or deferred surfaces:

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
node skills/browser/browser.mjs web-ai render --vendor chatgpt --prompt "hello"
```

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
target id > vendor latest > legacy baseline. Each completion / timeout
updates the session record with `status`, `conversationUrl`, and `answer`.

**Session-to-tab binding** (Phase 9.1): every session owns its own tab.
The record stores `targetId`, `tabId`, and `tabState` (`createdAt`,
`lastActiveAt`, `recoveryCount`, `closeCount`). If the bound tab is closed
mid-operation, the runtime auto-recovers once by creating a new tab and
navigating to the saved `conversationUrl`.

Add `--deadline <iso>` to override the default deadline (now + `--timeout`)
and `--navigate` to allow `sessions resume` to switch tabs when the saved
`conversationUrl` differs from the current tab.

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

Initial `errorCode` catalog:

- `cdp.unreachable`, `cdp.target-mismatch`
- `provider.composer-not-visible`, `provider.model-mismatch`,
  `provider.attachment-preflight`, `provider.attachment-evidence-missing`,
  `provider.commit-not-verified`, `provider.poll-timeout`,
  `provider.runtime-disabled`
- `capability.unsupported`
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

Current headed ChatGPT UI may expose Pro as a `Heavy` composer pill. The runtime
treats `Heavy` as active Pro/Heavy and can select the direct DOM fallback
`[data-testid="model-switcher-gpt-5-5-pro-thinking-effort"]`.

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

- `fast`, `flash`, `gemini-fast`
- `thinking`, `think`, `gemini-thinking` selects the Gemini 3 Flash Thinking model
- `pro`, `gemini-pro`, `3.1-pro`

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
  --file /tmp/context.txt \
  --prompt "Read the attached file and answer with its sentinel."
```

Upload success is not input-only. The runtime verifies visible attachment
evidence before send and sent-turn evidence after send where the provider DOM
exposes it.

## Context Packages

Use context packages when the prompt plus files would be too large or when you
want untrusted file content separated from the main instruction block.

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
clipboard.

```bash
agbrowse web-ai query \
  --vendor chatgpt \
  --model pro \
  --inline-only \
  --allow-copy-markdown-fallback \
  --prompt "Return a markdown table."
```

The fallback is opt-in because provider copy buttons are UI details and can
change.

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
