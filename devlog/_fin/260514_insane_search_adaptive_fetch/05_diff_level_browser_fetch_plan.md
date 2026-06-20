---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, browser, diff-plan]
---

# Diff-Level Browser Fetch Plan

## Goal

Add a traceable adaptive URL reader under:

```bash
agbrowse fetch <url>
```

This command is not generic search. It reads a URL or search-result URL using a
bounded ladder: public endpoints, RSS/JSON, neutral fetch, metadata extraction,
and existing browser render/network inspection. First implementation is `.mjs`
inside `skills/browser/`, matching the surrounding agbrowse command code.

## Planned File Changes

Build order is defined in `19_phased_diff_implementation_plan.md` and
`20_phased_diff_browser_docs_closeout_plan.md`. This file remains the
module-level diff map; the phase files are the execution sequence.

### New Module

NEW:

```text
skills/browser/adaptive-fetch/index.mjs
skills/browser/adaptive-fetch/validators.mjs
skills/browser/adaptive-fetch/endpoint-resolvers.mjs
skills/browser/adaptive-fetch/reader-adapters.mjs
skills/browser/adaptive-fetch/content-scorer.mjs
skills/browser/adaptive-fetch/fetcher.mjs
skills/browser/adaptive-fetch/metadata.mjs
skills/browser/adaptive-fetch/third-party-readers.mjs
skills/browser/adaptive-fetch/transforms.mjs
skills/browser/adaptive-fetch/browser-escalation.mjs
skills/browser/adaptive-fetch/browser-runtime.mjs
skills/browser/adaptive-fetch/challenge-detector.mjs
skills/browser/adaptive-fetch/safety.mjs
skills/browser/adaptive-fetch/trace.mjs
```

### CLI And API

MODIFY:

```text
skills/browser/browser.mjs
skills/browser/SKILL.md
README.md
structure/commands.md
structure/CAPABILITY_TRUTH_TABLE.md
structure/str_func.md
```

MODIFY only if a local HTTP API endpoint is added:

```text
structure/server_api.md
```

### Skills

MODIFY:

```text
skills/browser/SKILL.md
```

### Tests

NEW:

```text
test/unit/browser-adaptive-fetch-validators.test.mjs
test/unit/browser-adaptive-fetch-endpoints.test.mjs
test/unit/browser-adaptive-fetch-reader-adapters.test.mjs
test/unit/browser-adaptive-fetch-content-scorer.test.mjs
test/unit/browser-adaptive-fetch-third-party-readers.test.mjs
test/unit/browser-adaptive-fetch-transforms.test.mjs
test/unit/browser-adaptive-fetch-trace.test.mjs
test/integration/browser-fetch-command.test.mjs
```

## Type Contracts

Use JSDoc typedefs in `skills/browser/adaptive-fetch/index.mjs` or a dedicated
`types` comment block. Do not add TypeScript tooling for this slice.

```js
/**
 * @typedef {'strong_ok'|'weak_ok'|'blocked'|'auth_required'|'challenge'|'paywall'|'browser_required'|'unsupported'|'error'} AdaptiveFetchVerdict
 * @typedef {'public_endpoint'|'fetch'|'reader'|'metadata'|'browser'|'network_api'} AdaptiveFetchSource
 * @typedef {'auto'|'never'|'required'} BrowserMode
 * @typedef {'none'|'isolated'|'existing'} BrowserSessionMode
 *
 * @typedef {object} AdaptiveFetchResult
 * @property {boolean} ok
 * @property {AdaptiveFetchVerdict} verdict
 * @property {AdaptiveFetchSource} source
 * @property {string} finalUrl
 * @property {BrowserMode} browserMode
 * @property {BrowserSessionMode} browserSession
 * @property {boolean} chromeUsed
 * @property {boolean} chromeRequired
 * @property {string} summary
 * @property {Array<object>} attempts
 */
```

## Borrowed Pattern Mapping

Grok's non-insane-search repo research maps into planned files this way:

| Source | Borrow | agbrowse file |
| --- | --- | --- |
| `intercept-mcp` | URL-to-markdown fallback layering and normalized result envelopes | `reader-adapters.mjs`, `transforms.mjs` |
| `agent-fetch` | multiple extraction candidates scored before success | `content-scorer.mjs`, `metadata.mjs` |
| `jina-ai/reader` | public reader as an explicit opt-in path | `third-party-readers.mjs` |
| `Scrapling` | adaptive HTTP-to-browser escalation concept | `browser-escalation.mjs` |
| `crawl4ai` | browser fallback and LLM-friendly extraction reference | `browser-escalation.mjs`, `content-scorer.mjs` |
| `nab`, `trajectorykit` | API-first and multi-tier fallback references | `endpoint-resolvers.mjs`, later backlog |

These are design references, not new dependencies. Do not copy stealth,
TLS-impersonation, CAPTCHA, auto-install, or credential behavior.

## Reader Adapter Shape

All non-browser readers should normalize into one shape before scoring:

```js
/**
 * @typedef {object} ReaderCandidate
 * @property {'fetch'|'metadata'|'public_endpoint'|'third_party_reader'|'browser'|'network_api'} source
 * @property {string} finalUrl
 * @property {string} title
 * @property {string} text
 * @property {string} contentType
 * @property {Array<string>} evidence
 * @property {Array<string>} warnings
 */
```

`reader-adapters.mjs` owns this normalization. `content-scorer.mjs` decides
whether the best candidate is `strong_ok`, `weak_ok`, or still needs escalation.

## `skills/browser/browser.mjs` Diff Shape

Before:

```js
switch (subcommand) {
  case 'status':
  case 'start':
  case 'snapshot':
  case 'web-ai':
    ...
}
```

After:

```js
switch (subcommand) {
  case 'fetch':
    return runAdaptiveFetchCli(args.slice(1));
  case 'status':
  case 'start':
  case 'snapshot':
  case 'web-ai':
    ...
}
```

Add help:

```text
fetch <url> [--json] [--trace] [--browser auto|never|required] [--selector <css>]
  Adaptive URL reading. Not generic web search.
```

## Browser Escalation Import Shape

`browser-escalation.mjs` should import or receive only the small browser helpers
it needs. Avoid making the pure fetch modules depend on the Chrome lifecycle.

```js
import { getFetchBrowserPage } from './browser-runtime.mjs';
```

Do not import the root `browser.mjs` CLI file from the adaptive-fetch library.
That file owns command dispatch and can create circular import or side-effect
risk. Extract the minimal browser runtime helpers instead.

## Browser Mode Behavior

| Mode | Fetch/core | Browser render | Failure when Chrome needed |
| --- | --- | --- | --- |
| `auto` | Yes | Only if weak/blocked/empty | `browser_required` if unavailable |
| `never` | Yes | Never | `weak_ok`/`blocked` with no browser attempt |
| `required` | URL validation only first | Yes | `browser_required` |

## Browser Session Behavior

| Session mode | Existing cookies? | Render allowed? | Default role |
| --- | --- | --- | --- |
| `none` | No | No | safest non-browser mode |
| `isolated` | No | Yes | safest render mode |
| `existing` | Yes | Yes | explicit opt-in only |

`existing` must never be silent default because it can send the user's logged-in
cookies to the target URL.

## Scheduler Order

```text
1. public_endpoint
2. fetch
3. reader
4. metadata
5. browser
6. network_api
7. boundary verdict
```

Boundary verdicts stop the ladder:

- `auth_required`
- `unsupported`
- `blocked` when retries are exhausted

CAPTCHA/challenge detection should not stop the ladder early. It stops only
challenge-solving, click-through, credential use, and stealth behavior. The
scheduler should still try public endpoint, RSS, metadata, non-browser,
isolated-browser, and network-candidate paths before emitting a final boundary
verdict.

## CLI Output

Default human output:

```text
ok: true
verdict: strong_ok
source: public_endpoint
final_url: ...
summary: Reddit JSON endpoint succeeded after native fetch was weak.
```

`--json` output:

```json
{
  "ok": true,
  "verdict": "strong_ok",
  "source": "public_endpoint",
  "finalUrl": "https://...",
  "content": "...",
  "attempts": []
}
```

`--trace` prints attempt table or includes attempts in JSON.

## Non-Goals In Code

Do not implement actions that cross access boundaries:

- challenge solving;
- login/paywall crossing;
- stealth browser or anti-detection behavior;
- default existing-profile cookie use;
- automatic dependency install;
- site-specific hardcoded engine branches;
- new MCP browser tool registration.

Do implement maximum legitimate surface coverage before returning a boundary
verdict.

## Verification Commands

```bash
npm run typecheck
npm test -- adaptive-fetch
bash structure/verify-counts.sh
```

If route or command docs change:

```bash
npm run gate:all
```
