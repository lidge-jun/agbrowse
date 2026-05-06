# Phase 4 — DOM / snapshot diagnostics (`web-ai doctor`)

A single command that produces a self-contained repair packet when a
provider DOM changes. Splits into 2 PRs. Depends on Phase 3 — `doctor`
reuses capability probes.

## Decisions resolved (post-critique)

- **Disk writes:** **off by default**. Add `--output <path>` only if needed
  later. Phase 5 churn-log owns persistent history.
- **`doctor diff`:** **dropped** for now. Phase 5 churn-log records can be
  diffed with downstream tools later.
- **Auto-run as `status --full`:** **no**. `doctor` stays explicit so
  `status` calls remain fast.
- **Copy fallback diagnostics (added per critique):** every report includes
  copy-button selector counts and intercepted-copy status — agents need this
  to debug the `--allow-copy-markdown-fallback` path.
- **`lastSession.before/after` snapshot diff (added per critique):** when a
  session is in `polling`/`complete`, the report carries the
  `composer-before` and `composer-after` short snippets for that session.

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Hashing primitive | NEW `web-ai/dom-hash.mjs`; unit tests. |
| **PR2** | Doctor command | NEW `web-ai/doctor.mjs`; MODIFY `cli.mjs` (command + dispatch + human print); MODIFY skill/README docs; provider feature maps. |

## Diagnostic report shape

```json
{
  "vendor": "chatgpt",
  "url": "https://chatgpt.com/c/...",
  "capturedAt": "2026-05-01T07:36:50.421Z",
  "features": [
    {
      "feature": "composer",
      "selectorsTried": ["#prompt-textarea", "[data-testid='composer-textarea']", "div[contenteditable='true']"],
      "selectorMatches": [{"selector":"div[contenteditable='true']","matched":1,"visible":true}],
      "state": "ok",
      "domHash": "sha1:..."
    },
    {
      "feature": "model-picker",
      "selectorsTried": ["...","..."],
      "selectorMatches": [],
      "state": "fail",
      "next": "model-fallback",
      "domHash": "sha1:..."
    },
    {
      "feature": "copy-fallback",
      "selectorsTried": ["button[aria-label='Copy']", "button[data-testid='copy-button']"],
      "selectorMatches": [{"selector":"button[aria-label='Copy']","matched":1,"visible":true}],
      "interceptStatus": "ready",
      "state": "ok",
      "domHash": "sha1:..."
    }
  ],
  "lastSession": {
    "sessionId": "01J...",
    "status": "polling",
    "deadlineAt": "...",
    "composerBefore": "<short snippet>",
    "composerAfter": "<short snippet>"
  },
  "warnings": []
}
```

Report capped at 4 KB by default. `--full` raises the cap to ~16 KB and
includes raw selector text snippets.

## Diffs (PR1)

### NEW `web-ai/dom-hash.mjs`

API surface:

```js
export async function domHashAround(page, selectors, options = {}) {}
export function normalizeDomForHash(html) {}
export async function selectorMatchSummary(page, selectors) {}
```

Skeleton:

```js
import { createHash } from 'node:crypto';

export async function domHashAround(page, selectors, options = {}) {
    const maxChars = options.maxChars ?? 8192;
    const html = await page.evaluate((sels) => {
        const node = sels.map(s => document.querySelector(s)).find(Boolean);
        return node ? node.outerHTML : 'missing';
    }, selectors).catch(() => 'missing');
    return `sha1:${createHash('sha1').update(normalizeDomForHash(html).slice(0, maxChars)).digest('hex')}`;
}

export function normalizeDomForHash(html) {
    return String(html)
        .replace(/\sdata-message-id="[^"]*"/g, '')
        .replace(/\saria-busy="[^"]*"/g, '')
        .replace(/\sstyle="[^"]*"/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function selectorMatchSummary(page, selectors) {
    return Promise.all(selectors.map(async selector => ({
        selector,
        matched: await page.locator(selector).count().catch(() => 0),
        visible: await page.locator(selector).first().isVisible().catch(() => false),
    })));
}
```

## Diffs (PR2)

### NEW `web-ai/doctor.mjs`

API surface:

```js
export async function runDoctor(deps, options = {}) {}
export function featureDefinitionsForVendor(vendor) {}
export async function diagnoseFeature(page, feature, options = {}) {}
```

Skeleton:

```js
import { domHashAround, selectorMatchSummary } from './dom-hash.mjs';
import { chatGptCapabilities } from './chatgpt.mjs';
import { geminiCapabilities } from './gemini-live.mjs';
import { grokCapabilities } from './grok-live.mjs';
import { findActiveSession } from './session.mjs';

export async function runDoctor(deps, options = {}) {
    const page = await deps.getPage();
    const vendor = options.vendor || 'chatgpt';
    const features = await Promise.all(
        featureDefinitionsForVendor(vendor).map(f => diagnoseFeature(page, f, options))
    );
    const lastSession = findActiveSession({ vendor, conversationUrl: page.url() });
    return {
        vendor,
        url: page.url(),
        capturedAt: new Date().toISOString(),
        features,
        lastSession: lastSession ? summarizeForDoctor(lastSession) : null,
        warnings: [],
    };
}

export function featureDefinitionsForVendor(vendor) {
    switch (vendor) {
        case 'chatgpt': return CHATGPT_FEATURES;
        case 'gemini': return GEMINI_FEATURES;
        case 'grok': return GROK_FEATURES;
        default: return [];
    }
}

export async function diagnoseFeature(page, feature, options = {}) {
    return {
        feature: feature.feature,
        selectorsTried: feature.selectors,
        selectorMatches: await selectorMatchSummary(page, feature.selectors),
        state: 'unknown',
        domHash: await domHashAround(page, feature.selectors, options),
    };
}
```

`CHATGPT_FEATURES`, `GEMINI_FEATURES`, `GROK_FEATURES` are arrays of
`{ feature, selectors }` objects defined locally — `composer`, `model-picker`,
`upload`, `response-feed`, `copy-fallback`, `streaming-indicator`.

`summarizeForDoctor(session)` returns a small object with sessionId, status,
deadlineAt, and the `composerBefore`/`composerAfter` snippets if the session
captured them. Capturing those snippets is wired into Phase 1 PR2 (the
provider `send` saves a short composer-before snippet on the session;
`poll`/`completion` saves composer-after).

### MODIFY `web-ai/cli.mjs` — command set

Before:

```js
const COMMANDS = new Set(['render', 'status', 'send', 'poll', 'query', 'stop', 'context-dry-run', 'context-render']);
```

After (Phase 1 already added `sessions`/`resume`/`reattach`):

```js
const COMMANDS = new Set([
    'render', 'status', 'send', 'poll', 'query', 'stop',
    'sessions', 'resume', 'reattach',
    'doctor',
    'context-dry-run', 'context-render',
]);
```

### MODIFY `web-ai/cli.mjs` — dispatch

Before:

```js
const result = command === 'sessions'
    ? await runSessionsCommand(argv.slice(1), values)
    : isContextCommand(command)
        ? await runContextCommand(command, input, values)
        : await runCommand(command, deps, input);
```

After:

```js
const result = command === 'doctor'
    ? await runDoctor(deps, { vendor: input.vendor, full: values.full })
    : command === 'sessions'
        ? await runSessionsCommand(argv.slice(1), values)
        : isContextCommand(command)
            ? await runContextCommand(command, input, values)
            : await runCommand(command, deps, input);
```

### MODIFY `web-ai/cli.mjs` — human print

Before:

```js
else printHuman(command, result);
```

After:

```js
else if (command === 'doctor') printDoctorHuman(result);
else printHuman(command, result);
```

`printDoctorHuman` prints a 30-line summary: one row per feature, with
worst state highlighted at the top.

### MODIFY `skills/web-ai/SKILL.md`

Before:

```md
agbrowse web-ai context-render
```

After:

```md
agbrowse web-ai context-render
agbrowse web-ai doctor --vendor <chatgpt|gemini|grok> --json
```

### MODIFY `README.md`

Before:

```md
upload never appears | provider UI changed | run `snapshot`, `get-dom`, and update provider selectors
```

After:

```md
upload never appears | provider UI changed | run `agbrowse web-ai doctor --vendor <v> --json`
```

## Public-surface changes

- New command: `web-ai doctor`.
- `domHash` semantics documented so a downstream churn-watcher (Phase 5)
  can dedup reports.
- Each provider exposes `<vendor>Features` array (used by `doctor`) — these
  are not part of the SKILL surface but are an internal contract `doctor`
  depends on.

## Test plan

- Unit: `domHashAround` is stable across cosmetic attr changes
  (`data-message-id`, inline `style`) and unstable across structural
  changes.
- Unit: `selectorMatchSummary` returns counts and visibility booleans for a
  fake page.
- Unit: `runDoctor` produces a report whose `features[]` length matches
  `featureDefinitionsForVendor(vendor).length`.
- Privacy: fake DOM with long user-text and token-like strings; assert the
  default report stays under 4 KB and raw snippets only appear with `--full`.
- Contract: `web-ai doctor --json` is parseable and has all required keys.

## Smoke plan

- Run doctor against ChatGPT before and after a synthetic model-picker DOM
  change in a fake page; expect only the `model-picker` feature's `domHash`
  to shift.
- Run doctor against Grok with composer hidden behind a modal; expect
  `composer.state = 'warn'` with selector evidence.
- Run doctor with an active polling session; expect `lastSession` to include
  `composerBefore`/`composerAfter` snippets capped at 4 KB.

## Exit criteria

- `web-ai doctor` is the single command an agent runs when any other command
  fails so it can identify which feature broke.
- The default report is small enough (< 4 KB) for an agent to attach to a
  follow-up prompt.
- Each provider's feature list is the source of truth `doctor` consumes.

## Phase 4+ expansion (post-research, 2026-05-01)

Based on GPT Pro and Grok research into Vercel Labs agent-browser,
Stagehand, and Playwright MCP patterns. See
`context/260501_gpt_pro_phase4plus_research.md` for full analysis.

### PR1 expansion: AX hash alongside DOM hash

Add `hashInteractiveSurface()` to `dom-hash.mjs` — hashes only interactive
elements (buttons, textboxes, links, menuitems) rather than full DOM. This
is the hash that matters for agent operations. Separate from structural
`domHash` because cosmetic class-name changes shouldn't trigger churn
alerts when interactive surface is unchanged.

```js
export async function hashInteractiveSurface(page, {
    includeRoles = ['button', 'textbox', 'link', 'menuitem'],
} = {}) {}
```

### PR2 expansion: DoctorReportV2 fields

Doctor report shape upgraded with three new sections:

1. **`dom.interactiveHash`** — AX hash of interactive surface only.
2. **`dom.selectorCounts`** — per-feature count of matched selectors.
3. **`copyFallback`** — dedicated section with `interceptedCopyStatus`,
   `visibleCopyRefs`, selector counts.
4. **`debug`** (opt-in) — `consoleErrors[]` and `networkFailures[]` via
   `--include-console` and `--include-network`. Body content never stored;
   only URL host, status, resource type, and short error text.

Default off for `debug` — provider pages may contain user data in console
logs and network payloads. Only host-level metadata is safe.

### Future: snapshot section in doctor

Phase 7 adds `snapshot` section to doctor report. Phase 4 prepares the
slot by reserving the field in the report schema but leaving it `null`
until Phase 7 lands.

## Risks

- **Most likely regression:** diagnostic output leaks large prompt text or
  sensitive DOM (auth tokens in `data-*`, user PII in transcript).
- **Test:** fake DOM with long user text and token-like strings; assert the
  report is under 4 KB by default and raw snippets only appear with
  `--full`. Cover the copy-fallback feature's `interceptStatus` does not
  carry the actual copied text.
- **New risk (post-research):** `--include-console` / `--include-network`
  inadvertently captures PII from provider pages. Mitigate by never
  storing response bodies, only URL host + status + resource type.

## cli-jaw mirror

cli-jaw already has a **diagnose** surface that this phase folds into the
same shape:

- `src/browser/web-ai/...` exports diagnostics primitives (per the
  `tests/unit/browser-web-ai-diagnostics.test.ts` suite).
- HTTP route `/api/browser/web-ai/diagnose` accepts `--vendor` and
  `--stage` filters; CLI exposes it as `web-ai diagnose`.

Phase 4 reconciles the two surfaces:

| Item | cli-jaw status |
| --- | --- |
| `dom-hash` primitive | **Ports as-is** to `src/browser/web-ai/dom-hash.ts`. Reuse from cli-jaw's diagnose helpers if equivalent already exists. |
| `runDoctor` | **Rename / consolidate** — keep the HTTP `/diagnose` name on the route; CLI command becomes `web-ai doctor` (alias of existing `diagnose`) so terminology matches agbrowse. Or vice versa: pick one name in both repos. Recommend: standardize on `doctor` in both because it implies more than a single-stage probe. |
| Feature-level `domHash` | **Add** — current diagnose lists stages but not selector hashes. Phase 4 augments diagnose output with `domHash` per feature. |
| `lastSession.composerBefore/composerAfter` snippets | **Wire through** — Phase 1 in cli-jaw will save these on `session.ts` records. Phase 4 reads them back. |
| Privacy cap (≤4 KB default) | **Apply equally** — same test asserts in both repos. |
| Skill docs | `cli-jaw/skills_ref/web-ai/SKILL.md` already mentions `web-ai diagnose`. Update to `doctor` (or add alias) and document the new fields. |

**Naming decision (post-closeout, GPT Pro):** keep `diagnose` as a
**deprecated alias** for `doctor` for one full minor release in cli-jaw.
Do **not** rename-only. New work targets `doctor`; `diagnose` continues to
respond identically until it is removed. Phase 4 PR2 documents the
deprecation in `cli-jaw/skills_ref/web-ai/SKILL.md`.

PR slicing in cli-jaw mirrors agbrowse:

- **PR1**: `dom-hash.ts` + tests.
- **PR2**: extend `/api/browser/web-ai/diagnose` response with
  `features[].domHash`, add the `web-ai doctor` CLI alias, update SKILL.
