# agbrowse

Standalone Chrome/CDP browser automation for AI agents.

`agbrowse` is a serverless extraction of the cli-jaw / 30_browser browser
workflow. It gives an agent a small CLI surface for:

- DOM/ref based browser control
- screenshots and coordinate clicks
- console/network/DOM diagnostics
- Oracle-style web-ai prompt rendering
- live ChatGPT, Gemini, and Grok web UI execution
- file upload and context-package upload for implemented providers

It does not require a long-running MCP server. Each command is a short-lived
Node process that reconnects to the same Chrome DevTools Protocol endpoint.

## Status

This repository is packaged as a standalone skill/runtime.

What is considered ready:

- `agbrowse` CLI bin
- persistent Chrome profile under `BROWSER_AGENT_HOME`
- stable default CDP port `9222`
- explicit `--port` / `CDP_PORT` override
- active tab persistence via CDP target id
- browser primitive tests
- web-ai contract tests
- ChatGPT, Gemini, and Grok core web-ai flows

What remains intentionally out of scope for the standalone runtime:

- cli-jaw server APIs
- root cli-jaw watcher/notification dashboards
- guaranteed provider account access
- captcha or Cloudflare bypass
- billing/subscription entitlement checks

Provider UIs change frequently. Live web-ai flows are smoke-tested behavior, not
a contractual API from the providers.

## Install

From npm or GitHub once published:

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
`/json/version`, `agbrowse` reuses it. If another non-CDP process owns the
port, startup fails instead of silently choosing a different port.

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
agbrowse tabs
agbrowse tab-switch 2
agbrowse tab-switch <targetId>
agbrowse evaluate "document.title"
```

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

The `web-ai` command drives provider websites through the same browser session.

Supported commands:

```bash
agbrowse web-ai render
agbrowse web-ai status
agbrowse web-ai send
agbrowse web-ai poll
agbrowse web-ai query
agbrowse web-ai stop
agbrowse web-ai context-dry-run
agbrowse web-ai context-render
```

Supported providers:

| Provider | Inline | File upload | Context package upload | Model select | Copy fallback |
| --- | ---: | ---: | ---: | ---: | ---: |
| ChatGPT | yes | yes | yes | yes | yes |
| Gemini | yes | yes | yes | yes | yes |
| Grok | yes | yes | yes | yes | yes |

Unsupported provider requests fail closed before browser mutation.

### Render First

```bash
agbrowse web-ai render \
  --vendor chatgpt \
  --project "agbrowse" \
  --goal "review the upload flow" \
  --prompt "Find the riskiest edge case."
```

The envelope is Oracle-style:

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

### Gemini

```bash
agbrowse web-ai query \
  --vendor gemini \
  --url https://gemini.google.com/app \
  --model fast \
  --inline-only \
  --prompt "Reply exactly GEMINI_OK"
```

Model aliases:

- `fast`, `flash`, `gemini-fast`
- `thinking`, `think`, `gemini-thinking`
- `pro`, `gemini-pro`, `3.1-pro`

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
want Oracle-style untrusted file separation.

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
  --vendor grok \
  --url https://grok.com/ \
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
| `BROWSER_AGENT_HOME` | `~/.browser-agent` | profile, screenshots, state |
| `CDP_PORT` | `9222` | default DevTools port |
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
