---
name: browser
description: >-
  Chrome browser control and adaptive URL reading: open pages, fetch one candidate URL,
  take ref snapshots, click, type, screenshot. No external server required.
  NOT for: sending prompts to AI providers like ChatGPT, Gemini, Grok (use web-ai skill instead).
  NOT for: system-level screen capture (use screen-capture skill).
  Triggers: browser, 브라우저, Chrome, 크롬, open page, navigate, snapshot,
  screenshot, 스크린샷, click element, type text, 웹페이지, page interaction,
  DOM, ref ID, 페이지 열기, 탭, tab, CDP, 브라우저 열기, adaptive fetch, URL 읽기
---

# Browser Control

Control Chrome browser via `agbrowse` commands.
Uses ref-based snapshots to identify page elements, then click/type by ref ID.

## Positioning (first-run note)

agbrowse is a **local Chrome / CDP** runtime. It deliberately does **not** offer:

- hosted / cloud / managed browser sessions (see Browserbase, Browser Use Cloud,
  Vercel agent-browser cloud-session flag for that shape)
- remote / external CDP endpoints (deferred — see `docs/EXTERNAL_CDP.md`)
- stealth, anti-detection, CAPTCHA bypass, or Cloudflare bypass
- benchmark / leaderboard score claims

If you need hosted infrastructure or detection evasion, agbrowse is not the
tool — use a hosted browser provider. Compare positioning in
[`docs/comparison.md`](../../docs/comparison.md). The release gate
`gate:no-cloud-claims` enforces this in CI.

## Prerequisites

- Node.js 18+
- Google Chrome (or Chromium/Brave) installed
- `playwright-core` installed:

```bash
cd <project-root>
npm install playwright-core
```

## Quick Start

```bash
agbrowse start                               # Start Chrome (CDP auto port)
agbrowse start --headless                    # Headless mode (server/CI/WSL)
agbrowse navigate "https://example.com"      # Go to URL
agbrowse fetch "https://example.com" --json  # Read one candidate URL; not search
agbrowse snapshot --interactive              # Interactive elements with ref IDs
agbrowse click e3                            # Click ref e3
agbrowse type e5 "hello" --submit           # Type + Enter
agbrowse screenshot                          # Save screenshot
agbrowse reload                              # Reload current page
```

For AI provider websites, use the bundled `web-ai` skill/command instead of
raw click/type sequences when possible:

```bash
agbrowse web-ai status --vendor chatgpt
agbrowse web-ai query --vendor gemini --url https://gemini.google.com/app --inline-only --prompt "Reply exactly OK"
```

For Runway, use the dedicated task-runner surface instead of `web-ai`.
The initial Runway command is read-only except navigation, focuses Apps and
Custom/tools, and never clicks `Generate`, `Run all`, payment, destructive, or
submit-like controls. For live smoke tests where the user explicitly submits
generation jobs, treat Runway Unlimited as a queue-capped task runner: allow at
most 2 active jobs, then poll completion signals for up to 10 minutes per model.
The poller is Playwright/CDP-based: it reads Runway DOM state, not Computer Use
state. Treat `In queue`, `Generating`, `Processing`, `loading animation`, and
right-rail percentage labels such as `18 50%` as active generation signals.
Do not treat two active jobs as terminal completion. Record `queue_full` only
when Runway shows the explicit `You're on a roll` / `Credits Mode` gate.

```bash
agbrowse runway selectors --surface apps
agbrowse runway status --surface auto --json
agbrowse runway preflight --surface custom-tools --json
agbrowse runway poll --timeout 600000 --interval 5000 --queue-limit 2 --after-count 17 --expected-item "18" --json
```

## Core Workflow

> **Always follow this pattern:**
> 1. `snapshot --interactive` → See elements + ref IDs
> 2. `click`/`type`/`press`/`select` → Interact using ref
> 3. `snapshot` → Verify result → Repeat

## Commands

### Browser Management

```bash
agbrowse start [--port <9222>] [--headless|--headed] [--chrome-path /path/to/chrome]
agbrowse stop
agbrowse status
agbrowse reset [--force]
```

### Observe

```bash
agbrowse snapshot                # Ref snapshot (all elements)
agbrowse snapshot --interactive  # Interactive elements only (recommended)
agbrowse snapshot --max-nodes 30 # Limit output for token budget
agbrowse screenshot              # Current viewport
agbrowse screenshot --full-page  # Full page
agbrowse screenshot --ref e5     # Specific ref element only
agbrowse screenshot --clip 0 0 320 180  # Clipped region in CSS pixels
agbrowse screenshot --json       # JSON output (path, dpr, viewport)
agbrowse text                    # Page text content
agbrowse text --format html      # HTML source
agbrowse get-dom                 # Full DOM HTML
agbrowse get-dom --selector ".card" --max-chars 2000
agbrowse console --clear --reload --duration 3000 # Buffered console logs
agbrowse network --reload --duration 1000         # Fresh page-load + async requests
```

### Adaptive URL Fetch (v2)

Use `agbrowse fetch` after a candidate URL already exists. Do not use it as the
first step for broad generic search.

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

Routing rule:

```text
generic search request -> use a search tool first
known URL / search-result URL / source URL -> use agbrowse fetch
```

#### Escalation Ladder (code execution order in index.mjs)

1. **Public endpoints + direct fetch** — known API resolvers (GitHub, Reddit, HN, Wikipedia, npm, PyPI, arXiv, Bluesky, Mastodon, Stack Exchange, dev.to, DOI/CrossRef, OpenLibrary, Wayback CDX, YouTube/X oEmbed, HN Algolia, V2EX, Lobsters, generic oEmbed), direct HTTP with identity headers, discovered RSS/Atom feeds, metadata extraction
2. **Third-party readers** — opt-in public readers like Jina (`--allow-third-party-reader`)
3. **Isolated Chrome render** — fresh Chrome profile + network API JSON discovery
4. **User session** — user's authenticated browser session (`--browser-session user`, explicit opt-in)
5. **Human-in-the-loop** — human resolves challenges (`--browser-session interactive`, 5-minute timeout)

Content scoring runs after each phase to decide whether to escalate.

#### Key Flags

| Flag | Values | Default | Description |
|------|--------|---------|-------------|
| `--browser` | `auto\|never\|required` | `auto` | Browser escalation mode |
| `--browser-session` | `none\|isolated\|existing\|user\|interactive` | `isolated` | Session/cookie boundary |
| `--identity` | `auto\|minimal\|chrome` | `auto` | Request identity headers (`auto` and `chrome` send browser-grade headers; `minimal` sends only Accept) |
| `--no-browser` | — | — | Alias for `--browser never` |
| `--allow-third-party-reader` | — | — | Enable Jina Reader |
| `--no-public-endpoints` | — | — | Skip known public endpoint resolvers |
| `--max-bytes` | number | `1048576` | Maximum response bytes per read (1 MB) |
| `--timeout-ms` | number | `15000` | Per-attempt timeout |
| `--selector` | CSS selector | — | Browser text extraction selector |
| `--allow-archive` | — | — | Accepted but deferred; emits a warning |
| `--trace` | — | — | Include all attempt traces |
| `--json` | — | — | JSON output |

#### JSON Contract

`--json` output is always intended to parse as one JSON object. Large selected
content is compacted before serialization and annotated with:

- `contentBytes`: original selected content size in UTF-8 bytes
- `contentLimitBytes`: content bytes retained in CLI JSON output
- `contentTruncated`: true when `content` was shortened for output safety

Do not treat `contentTruncated` as a failed fetch. Use `verdict`, `source`,
`finalUrl`, `warnings`, and `attempts` to decide whether another escalation is
needed.

#### Agent Workflow

When an agent needs to read a URL:

1. Use a search tool to discover candidate URLs first.
2. Run `agbrowse fetch <url> --json --trace --browser never` for HTTP-only reading.
3. If `verdict` is `weak_ok` or `blocked`, inspect `attempts` before escalating.
4. Public endpoints, RSS/Atom, oEmbed, and metadata are tried before any browser step — do not skip them.
5. Use `--allow-third-party-reader` only when the user or task allows a public third-party reader.
6. Use `--browser auto --browser-session isolated` for JS-rendered pages when a browser is needed.
7. Use `--browser-session user` or `interactive` only for the user's own authenticated browser state and human-supervised challenge handling.
8. Report boundaries plainly: `blocked`, `auth_required`, `paywall`, `challenge`, or `browser_required`. These are observations, not immediate stops — continue the legitimate ladder before the final boundary verdict.

Do not treat CAPTCHA, login, or paywall markers as "stop immediately" signals.
Do not claim that browser session mode "bypasses" paywalls — it uses the user's
own already-authorized browser state. Do not claim challenge resolution is
automated — it is human-supervised with a timeout.

#### Safety Model

- Automated CAPTCHA solving, credential stuffing, stealth libraries: **forbidden**
- Human assistance (browser-grade headers, user session, human resolves): **allowed with explicit opt-in**
- DNS rebinding guard enforced in fetch path and redirect chain — blocks hostnames resolving to private/loopback IPs (both A and AAAA records)
- User session final URL validated — redirects to private networks are rejected
- `safetyFlags` in result track which elevated capabilities were used (`user_session_used`, `human_action_taken`)

#### WAF Detection

Detects Cloudflare (managed challenge + Turnstile), Akamai Bot Manager, AWS WAF,
Imperva/Incapsula, DataDome, and PerimeterX from response headers before browser
escalation. WAF profile informs challenge classification and wait strategies.

### Snapshot Output Example

```
e1   link       "Gmail"
e2   link       "Images"
e3   textbox    "Search"           ← To type here: type e3 "query"
e4   button     "Google Search"    ← To click: click e4
e5   button     "I'm Feeling Lucky"
```

### Act

```bash
agbrowse click e3              # Click element
agbrowse click e3 --double     # Double-click
agbrowse click e3 --right      # Right-click / context menu
agbrowse type e3 "hello"       # Type text
agbrowse type e3 "hello" --submit  # Type + press Enter
agbrowse press Enter           # Press key
agbrowse press Escape
agbrowse press Tab
agbrowse hover e5              # Mouse hover
agbrowse select e7 "option1"   # Select dropdown option
agbrowse drag e3 e5            # Drag element to another
agbrowse move-mouse 400 300    # Move mouse only
agbrowse mouse-down            # Hold left mouse button
agbrowse mouse-up --right      # Release right mouse button
agbrowse mouse-click 400 300   # Click at pixel coordinates
```

### Navigate & Scroll

```bash
agbrowse navigate "https://example.com"  # Go to URL
agbrowse reload                           # Reload current page
agbrowse resize 1440 900                 # Resize browser window
agbrowse resize 0 0 --fullscreen         # Fullscreen or 1920x1080 viewport fallback
agbrowse tabs                             # List tabs
agbrowse active-tab --json                # Read the active target-id contract
agbrowse new-tab "https://example.com" --json
agbrowse tab-switch 2                     # Switch to tab 2
agbrowse tab-close <targetId> --json      # Close a tab by target id
agbrowse scroll down                      # Scroll down 500px
agbrowse scroll up --amount 1000          # Scroll up 1000px
agbrowse scroll --ref e15                 # Scroll element into view
agbrowse evaluate "document.title"        # Execute JS
```

### Wait & Sync

```bash
agbrowse wait 2000              # Wait 2 seconds
agbrowse wait-for e5            # Deprecated: wait for last-snapshot ref
agbrowse wait-for-selector ".toast-success" --timeout 30000
agbrowse wait-for-text "Dashboard" --timeout 30000
```

## Common Workflows

### Web Search

```bash
agbrowse start
agbrowse navigate "https://www.google.com"
agbrowse snapshot --interactive
# → e3 textbox "Search"
agbrowse type e3 "search query" --submit
agbrowse snapshot --interactive
# Click desired result link
agbrowse click e7
```

### Research Planning

```bash
agbrowse research plan --query "한국어 외부 정보 질문" --json
# Run provider/native search with plan.atomicQueries.
# Treat search rows as URL candidates, not evidence.
agbrowse research normalize-results --backend tavily --file results.json --json
# Then read candidate URLs with agbrowse fetch before answering.
```

Use this before broad Korean/current/source-sensitive searches. The plan output
splits the request into constraints and focused queries. The normalizer keeps
provider snippets as diagnostics only; original-page evidence still requires
`agbrowse fetch`, and dynamic/Naver/table/list cases may require browser
inspection after fetch.

### Form Filling

```bash
agbrowse snapshot --interactive
# → e1 textbox "Name", e2 textbox "Email", e3 button "Submit"
agbrowse type e1 "John Doe"
agbrowse type e2 "john@example.com"
agbrowse click e3
agbrowse snapshot  # Verify result
```

### SPA Login Flow

```bash
agbrowse navigate "https://app.example.com/login"
agbrowse snapshot --interactive
agbrowse type e1 "user@example.com"
agbrowse type e2 "password"
agbrowse click e3                    # Login button
agbrowse wait-for-text "Dashboard" --timeout 15000
agbrowse snapshot --interactive      # Verify logged in
```

### Long Page with Scrolling

```bash
agbrowse navigate "https://news.ycombinator.com"
agbrowse snapshot --interactive --max-nodes 20  # First 20 items
agbrowse scroll down
agbrowse snapshot --interactive --max-nodes 20  # Next items
```

### Multi-Tab Workflow

```bash
agbrowse navigate "https://docs.example.com"  # Tab 1
agbrowse new-tab "https://api.example.com" --json  # Tab 2
agbrowse active-tab --json       # Verify the current target id
agbrowse tabs                  # List tabs
agbrowse tab-switch 2          # Switch to tab 2
agbrowse snapshot --interactive
agbrowse tab-close <targetId> --json
```

### Inspect DOM / Console / Network

```bash
agbrowse navigate "https://example.com"
agbrowse get-dom --selector "main" --max-chars 4000
agbrowse console --clear --expression "console.log('probe')"
agbrowse network --reload --duration 2000 --filter example
```

## Recovery Strategy

If something goes wrong, follow this escalation path:

1. **`snapshot` fails** → Try `screenshot` for visual inspection
2. **Ref not found** → Re-run `snapshot --interactive` (refs reset on navigation and can go stale after page changes)
3. **CDP connection fails** → `status`, then `start` if Chrome is not running
4. **Chrome frozen** → ask before `reset --force`; reset deletes local browser state
5. **Fullscreen resize falls back in headless mode** → The command uses a 1920x1080 viewport fallback when window APIs are unavailable
6. **DOM ref unavailable** (Canvas/WebGL/Shadow DOM) → Use `agbrowse-vision-click` after confirming no usable ref exists

## Environment Variables

| Variable             | Default            | Description                               |
| -------------------- | ------------------ | ----------------------------------------- |
| `BROWSER_AGENT_HOME` | `~/.browser-agent` | Data directory (profile, screenshots)     |
| `CDP_PORT`           | `9222`             | Default Chrome DevTools Protocol port     |
| `CHROME_HEADLESS`    | `0`                | Set to `1` for headless mode; `start --headed` overrides it |
| `CHROME_NO_SANDBOX`  | `0`                | Set to `1` to disable sandbox (Docker/CI) |
| `CHROME_BINARY_PATH` | auto-detect        | Override Chrome/Chromium executable path  |

## Headless Mode (Server/CI/WSL)

```bash
agbrowse start --headless               # CLI flag
CHROME_HEADLESS=1 agbrowse start         # env var
CHROME_HEADLESS=1 agbrowse start --headed  # force a visible headed Chrome
```

- GUI 없는 환경(WSL, SSH, Docker, CI)에서 사용
- `--headless=new` (Chrome 112+) 사용 — full browser 기능 유지

## Troubleshooting

| Symptom                          | Cause                               | Fix                                            |
| -------------------------------- | ----------------------------------- | ---------------------------------------------- |
| CDP connection refused           | Chrome running with default profile | Close all Chrome, retry or `browser.mjs reset` |
| Windows: only test browser opens | Chrome singleton absorbs launch     | Close all Chrome → `browser.mjs start`         |
| Headless CDP not opening         | `--headless` not specified          | Add `--headless` flag                          |
| Port conflict                    | Other process on CDP port           | Use `--port <other>`                           |
| Fullscreen resize falls back     | Headless / unsupported window APIs  | Expected: command switches to a 1920x1080 viewport fallback |
| Snapshot returns many nodes      | Large page, token waste             | Use `--interactive --max-nodes 30`             |

## Notes

- Ref IDs come from the **last snapshot** and reset on navigation. Always re-run `snapshot` after `navigate`, `reload`, tab switches, or any action that changed the page.
- Prefer `wait-for-selector` or `wait-for-text` for async UI state. `wait-for <ref>` only works against the last persisted snapshot and is deprecated.
- Use `--interactive` to show only clickable/typeable elements (shorter list).
- Use `--max-nodes N` to cap output for token budget.
- Screenshots are saved to `~/.browser-agent/screenshots/`.
- Default CDP port is `9222`. Override with `--port` or `CDP_PORT` env var.
- `start --chrome-path /path/to/chrome` and `CHROME_BINARY_PATH` both override auto-detection.
- If CDP is already responding on the port, `start` reuses the existing instance.
- CDP reconnection uses exponential backoff (1s → 2s → 4s → 8s).
- `console` reads a page-side buffer. Use `--clear` before a flow and `--reload` if you want logs from a fresh navigation.
- `network` merges current page performance entries with optional live CDP capture. Use `--duration 0` for a fast current-state dump only, add a non-zero duration with `--reload` if the page triggers late `fetch`/XHR activity, and use `--live-only` to skip performance history.
- Non-DOM elements (Canvas, iframe, Shadow DOM): use **agbrowse-vision-click**.
