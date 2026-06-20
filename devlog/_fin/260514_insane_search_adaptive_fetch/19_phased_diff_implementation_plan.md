---
created: 2026-05-15
status: planning
tags: [jawdev, agbrowse, adaptive-fetch, diff-plan, phases]
---

# Phased Diff Implementation Plan

## Purpose

This is the buildable plan. The earlier docs explain why adaptive fetch belongs
in agbrowse and which upstream ideas matter. This document turns that research
into ordered implementation phases with exact file scope, diff shape, tests, and
acceptance gates.

The goal is not "research parity." The goal is a working `agbrowse fetch <url>`
surface that sees more legitimate public/user-authorized representations than
`insane-search`, while still refusing challenge solving, credential use,
stealth, and access-wall crossing.

## Phase Order

| Phase | Name | Main outcome |
| --- | --- | --- |
| 01 | Core contracts and URL safety | Command-independent adaptive fetch result model, validation, trace, and safety. |
| 02 | Public endpoints, fetch, metadata | First useful non-browser reads with weak/strong verdicts. |
| 03 | Grok borrowed reader/scorer layer | `intercept-mcp` and `agent-fetch` ideas become actual modules. |
| 04 | Optional third-party readers | Jina-style reader support behind explicit opt-in. |
| 05 | Browser escalation and network candidates | See `20_phased_diff_browser_docs_closeout_plan.md`. |
| 06 | CLI, help, skill, structure docs | See `20_phased_diff_browser_docs_closeout_plan.md`. |
| 07 | Integrated gates and mirror readiness | See `20_phased_diff_browser_docs_closeout_plan.md`. |

## Phase 01 — Core Contracts And URL Safety

### Files

NEW:

```text
skills/browser/adaptive-fetch/index.mjs
skills/browser/adaptive-fetch/validators.mjs
skills/browser/adaptive-fetch/safety.mjs
skills/browser/adaptive-fetch/trace.mjs
test/unit/browser-adaptive-fetch-validators.test.mjs
test/unit/browser-adaptive-fetch-trace.test.mjs
```

MODIFY:

```text
skills/browser/browser.mjs
```

### Diff Shape

`index.mjs` exports pure orchestration entrypoints:

```js
export async function runAdaptiveFetch(input, deps = {}) {}
export function normalizeAdaptiveFetchOptions(raw = {}) {}
```

`validators.mjs` owns:

```js
export function classifyHtmlStrength({ html, text, title, positiveProof = [] }) {}
export function classifyBoundarySignals({ status, headers, text, url }) {}
```

`safety.mjs` owns:

```js
export function validateFetchUrl(rawUrl, options = {}) {}
export function redactTraceValue(value) {}
export function redactHeaders(headers = {}) {}
```

`trace.mjs` owns:

```js
export function createAttemptTrace(input) {}
export function appendAttempt(trace, attempt) {}
export function summarizeAttempts(attempts = []) {}
```

`browser.mjs` only wires the subcommand stub:

```js
case 'fetch':
  return runAdaptiveFetchCli(args.slice(1));
```

No Chrome work lands in Phase 01.

### Tests

- invalid scheme rejected before network;
- credential-in-URL rejected;
- localhost/private/link-local rejected by default;
- challenge-like tiny HTML is not `strong_ok`;
- readable text with positive proof is `strong_ok`;
- trace redacts tokens, cookies, auth headers, and sensitive query fields.

### Acceptance

- `agbrowse fetch <url> --json` can return a structured local validation result;
- no browser launch;
- no network trace leaks secrets;
- command surface exists but is allowed to return `unsupported` until Phase 02.

### Verify

```bash
npm test -- browser-adaptive-fetch-validators browser-adaptive-fetch-trace
npm run typecheck
```

## Phase 02 — Public Endpoints, Fetch, Metadata

### Files

NEW:

```text
skills/browser/adaptive-fetch/endpoint-resolvers.mjs
skills/browser/adaptive-fetch/fetcher.mjs
skills/browser/adaptive-fetch/metadata.mjs
skills/browser/adaptive-fetch/transforms.mjs
test/unit/browser-adaptive-fetch-endpoints.test.mjs
test/unit/browser-adaptive-fetch-transforms.test.mjs
```

MODIFY:

```text
skills/browser/adaptive-fetch/index.mjs
```

### Diff Shape

`endpoint-resolvers.mjs`:

```js
export function resolvePublicEndpointCandidates(url) {}
```

Initial approved shapes:

```text
GitHub raw/API metadata where safe
Reddit public JSON
Hacker News item/user APIs
arXiv export/API pages
Wikipedia REST/page summary
npm/PyPI package metadata
Bluesky public AT Protocol
Mastodon-compatible public status/account APIs
Stack Exchange question API
dev.to article JSON
DOI/CrossRef works API
OpenLibrary works/books JSON
Wayback CDX
YouTube oEmbed
X/Twitter oEmbed
HN Algolia item API
V2EX topic API
Lobsters story JSON
generic oEmbed discovery
RSS/Atom discovery candidates
```

`fetcher.mjs`:

```js
export async function fetchTextCandidate(url, options = {}) {}
```

`metadata.mjs`:

```js
export function extractMetadataFromHtml(html, url) {}
```

`transforms.mjs`:

```js
export function htmlToReadableText(html) {}
export function dedupeCandidateUrls(urls = []) {}
```

### Tests

- public endpoint resolver only emits known safe endpoint shapes;
- unsupported domains do not get fake site-specific scrapers;
- metadata extracts canonical URL, OpenGraph, JSON-LD, and title;
- weak metadata-only page returns `weak_ok`, not `strong_ok`;
- fetch respects max bytes, timeout, and content-type rejection.

### Acceptance

- normal public pages can return useful `fetch` or `metadata` results;
- public endpoint hits return `source: "public_endpoint"`;
- weak pages are explicit weak results, not false success.

### Verify

```bash
npm test -- browser-adaptive-fetch-endpoints browser-adaptive-fetch-transforms
npm run typecheck
```

## Phase 03 — Grok Borrowed Reader/Scorer Layer

This is the missing step the research alone did not provide.

### Files

NEW:

```text
skills/browser/adaptive-fetch/reader-adapters.mjs
skills/browser/adaptive-fetch/content-scorer.mjs
test/unit/browser-adaptive-fetch-reader-adapters.test.mjs
test/unit/browser-adaptive-fetch-content-scorer.test.mjs
```

MODIFY:

```text
skills/browser/adaptive-fetch/index.mjs
skills/browser/adaptive-fetch/metadata.mjs
skills/browser/adaptive-fetch/transforms.mjs
```

### Borrowed Ideas

`intercept-mcp` becomes:

```text
multiple readers -> one normalized ReaderCandidate shape
```

`agent-fetch` becomes:

```text
multiple candidates -> score -> best candidate + explanation
```

### Diff Shape

`reader-adapters.mjs`:

```js
export function fromFetchResult(result) {}
export function fromMetadataResult(result) {}
export function fromPublicEndpointResult(result) {}
export function fromBrowserResult(result) {}
export function fromNetworkCandidate(result) {}
export function normalizeReaderCandidates(results = []) {}
```

`content-scorer.mjs`:

```js
export function scoreReaderCandidate(candidate, options = {}) {}
export function chooseBestReaderCandidate(candidates = [], options = {}) {}
export function verdictFromScore(score, candidate) {}
```

Score inputs:

```text
readable text length
text density
metadata completeness
JSON-LD presence
title quality
source trust
challenge/login/paywall penalties
```

### Tests

- fetch, metadata, public endpoint, browser, and network shapes normalize to one
  candidate contract;
- article text beats metadata-only shell;
- public endpoint with full body beats generic HTML shell;
- challenge text is penalized even with status 200;
- winner explanation is included in trace evidence.

### Acceptance

- success is selected by candidate quality, not by first response order;
- trace can explain why a candidate won;
- this phase directly reflects Grok's non-insane-search research.

### Verify

```bash
npm test -- browser-adaptive-fetch-reader-adapters browser-adaptive-fetch-content-scorer
npm run typecheck
```

## Phase 04 — Optional Third-Party Readers

### Files

NEW:

```text
skills/browser/adaptive-fetch/third-party-readers.mjs
test/unit/browser-adaptive-fetch-third-party-readers.test.mjs
```

MODIFY:

```text
skills/browser/adaptive-fetch/index.mjs
skills/browser/adaptive-fetch/reader-adapters.mjs
skills/browser/adaptive-fetch/safety.mjs
```

### Diff Shape

`third-party-readers.mjs`:

```js
export function shouldUseThirdPartyReader(options = {}) {}
export function buildJinaReaderUrl(url) {}
export async function fetchThirdPartyReaderCandidate(url, options = {}) {}
```

Rules:

```text
default off
enabled only by --allow-third-party-reader
source is third_party_reader, not public_endpoint
rate-limit or reader failure becomes trace warning
no private URLs, localhost, signed URLs, credential URLs, or auth headers
```

### Tests

- disabled by default;
- enabled only by explicit option;
- refuses private/local/credential URLs;
- labels source as `third_party_reader`;
- failures do not become fake success.

### Acceptance

- Jina-style reading exists as a user-authorized tool;
- privacy boundary is visible in result trace;
- no dependency install and no hidden external data routing.

### Verify

```bash
npm test -- browser-adaptive-fetch-third-party-readers
npm run typecheck
```

## Continue

Phase 05-07 are specified in:

```text
20_phased_diff_browser_docs_closeout_plan.md
```
