---
created: 2026-05-15
status: planning
tags: [jawdev, agbrowse, adaptive-fetch, browser, docs, closeout]
---

# Browser, Docs, And Closeout Phased Diff Plan

## Purpose

This continues `19_phased_diff_implementation_plan.md`. Phase 01-04 build the
non-browser core, public readers, Grok-borrowed adapter/scorer layer, and
optional third-party reader. This file covers Phase 05-07: browser escalation,
user-facing surfaces, structure docs, gates, and cli-jaw mirror readiness.

## Phase 05 — Browser Escalation And Network Candidates

### Files

NEW:

```text
skills/browser/adaptive-fetch/browser-runtime.mjs
skills/browser/adaptive-fetch/browser-escalation.mjs
skills/browser/adaptive-fetch/challenge-detector.mjs
```

MODIFY:

```text
skills/browser/adaptive-fetch/index.mjs
skills/browser/adaptive-fetch/reader-adapters.mjs
skills/browser/adaptive-fetch/content-scorer.mjs
skills/browser/browser.mjs
test/integration/browser-fetch-command.test.mjs
```

### Borrowed Ideas

`Scrapling` and `crawl4ai` influence only the adaptive browser fallback shape:

```text
weak/blocked/non-readable -> isolated browser render -> candidate scoring
```

They do not become dependencies.

### Diff Shape

`browser-runtime.mjs`:

```js
export async function getFetchBrowserPage(options = {}) {}
export async function closeFetchBrowserPage(pageRef, options = {}) {}
```

`browser-escalation.mjs`:

```js
export async function collectBrowserCandidate(url, options = {}) {}
export async function collectNetworkJsonCandidates(pageRef, options = {}) {}
```

`challenge-detector.mjs`:

```js
export function detectChallengeMarkers({ url, status, text, title }) {}
export function classifyAccessBoundary(markers = []) {}
```

Browser session rules:

```text
--browser never     -> no browser
--browser auto      -> browser only after weak/blocked/empty result
--browser required  -> browser after URL validation
--browser-session isolated -> render without logged-in profile
--browser-session existing -> explicit opt-in only
```

### Tests

- local SPA shell becomes readable after browser render;
- `--browser never` never starts Chrome;
- `--browser required` fails with `browser_required` if Chrome unavailable;
- browser text and network JSON candidates pass through scorer;
- login/challenge fixture does not trigger solving/click-through;
- no cookies/auth headers serialized into trace.

### Acceptance

- browser escalation is visible in `attempts`;
- challenge/login/paywall markers are not immediate stop words;
- final boundary verdict appears only after allowed public/non-browser/browser
  reads are exhausted.

### Verify

```bash
npm test -- browser-fetch-command
npm run typecheck
```

## Phase 06 — CLI, Help, Skill, Structure Docs

### Files

MODIFY:

```text
skills/browser/browser.mjs
skills/browser/SKILL.md
README.md
structure/commands.md
structure/CAPABILITY_TRUTH_TABLE.md
structure/str_func.md
```

MODIFY only if a local API route is added:

```text
structure/server_api.md
```

### Diff Shape

Command help:

```text
fetch <url> [--json] [--trace] [--browser auto|never|required]
  Read one URL or search-result URL through public endpoints, fetch, metadata,
  optional public readers, and browser escalation. Not generic search.
```

Skill wording:

```text
Use for URL reading, source/result-page extraction, blocked/empty/weak pages,
and post-search candidate analysis.
Do not use as the first step for broad generic search.
Do keep trying public and user-authorized representations before returning a
boundary verdict.
Do not solve challenges, cross logins/paywalls, use stealth, or use existing
cookies unless explicitly requested.
```

### Tests

- help text includes `fetch`, `--browser`, `--browser-session`,
  `--allow-third-party-reader`;
- broad search wording does not route directly to `agbrowse fetch`;
- URL/source/citation/reference wording routes to `agbrowse fetch`;
- docs mention opt-in third-party reader and existing-session boundary.

### Acceptance

- users and agents can tell when to use search vs fetch;
- structure docs reflect new command and file count;
- no claim that the feature bypasses WAF/CAPTCHA/paywalls.

### Verify

```bash
npm test -- browser-fetch-command
bash structure/verify-counts.sh
bash structure/check-doc-drift.sh
git diff --check HEAD -- skills/browser README.md structure devlog/_fin/260514_insane_search_adaptive_fetch
```

## Phase 07 — Integrated Gates And Mirror Readiness

### Files

MODIFY:

```text
devlog/_fin/260514_insane_search_adaptive_fetch/README.md
devlog/_fin/260514_insane_search_adaptive_fetch/13_cli_jaw_implementation_plan_baseline.md
devlog/_fin/260514_insane_search_adaptive_fetch/15_skill_frontmatter_routing_baseline.md
```

Optional new closeout note:

```text
devlog/_fin/<date>_adaptive_fetch_v1.md
```

### Diff Shape

Record final implementation facts:

```text
implemented command
implemented modules
test commands and results
known limitations
cli-jaw mirror contract
```

Mirror contract for cli-jaw:

```text
cli-jaw browser fetch <url>
```

should preserve:

```text
result JSON keys
trace redaction rules
browser/session option names
third-party reader opt-in
search-vs-URL routing wording
```

### Tests

- full focused adaptive-fetch suite;
- structure drift;
- command help contract;
- optional online smoke only when explicitly requested.

### Acceptance

- agbrowse v1 is shippable as standalone URL reader;
- cli-jaw can mirror without re-deciding product boundaries;
- plan zip can go to GPT Pro with implementation phases, not just research.

### Verify

```bash
npm run typecheck
npm test -- adaptive-fetch
bash structure/verify-counts.sh
bash structure/check-doc-drift.sh
git diff --check HEAD
```

## Commit Split Recommendation

When implementation starts, split commits by phase group:

```text
1. feat(browser): add adaptive fetch core and public readers
2. feat(browser): add reader scoring and optional third-party reader
3. feat(browser): add browser escalation for adaptive fetch
4. docs(browser): document adaptive fetch surface and mirror contract
```

If `skills/browser/browser.mjs` becomes too mixed for clean non-interactive
staging, use fewer commits rather than interactive staging.

