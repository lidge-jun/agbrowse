---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, implementation-plan]
---

# Implementation Plan

## Part 1 — Easy Explanation

When a normal web page read fails, cli-jaw should not immediately give up or
blindly open a browser. It should try a small, transparent ladder:

1. Is there a public API or feed for this platform?
2. Can a normal fetch or clean reader get the content?
3. Does metadata contain enough useful information?
4. If the page is JavaScript-only, can our existing local browser render it?
5. If the browser shows that the page uses a public JSON endpoint, can we read
   that endpoint directly?
6. If the page needs login, paywall, or CAPTCHA, stop and say exactly that.

Every step should be visible in a trace.

## Part 2 — Diff-Level Plan

### Phase 1: Pure Types And Validators

NEW:

```text
src/browser/adaptive-fetch/types.ts
src/browser/adaptive-fetch/validators.ts
src/browser/adaptive-fetch/trace.ts
src/browser/adaptive-fetch/index.ts
tests/unit/adaptive-fetch-validators.test.ts
```

Contracts:

```ts
export type AdaptiveFetchVerdict =
  | 'strong_ok'
  | 'weak_ok'
  | 'challenge'
  | 'blocked'
  | 'auth_required'
  | 'unsupported'
  | 'unknown';

export interface AdaptiveFetchAttempt {
  phase: 'public_endpoint' | 'fetch' | 'reader' | 'metadata' | 'browser' | 'archive';
  method: string;
  url: string;
  status?: number;
  bodyBytes?: number;
  verdict: AdaptiveFetchVerdict;
  reasons: string[];
  elapsedMs: number;
}
```

### Phase 2: Public Endpoint Resolvers

NEW:

```text
src/browser/adaptive-fetch/endpoint-resolvers.ts
tests/unit/adaptive-fetch-endpoints.test.ts
```

Initial resolvers:

- GitHub URL to `gh`/REST guidance, not forced network in unit tests.
- Reddit `.json`.
- Hacker News Firebase/Algolia.
- arXiv Atom.
- Wikipedia REST.
- npm/PyPI registry JSON.
- RSS/Atom discovery.

No platform resolver should run unless the URL or intent matches clearly.

### Phase 3: Neutral Fetch, Reader, Metadata

NEW:

```text
src/browser/adaptive-fetch/fetcher.ts
src/browser/adaptive-fetch/metadata.ts
src/browser/adaptive-fetch/transforms.ts
tests/unit/adaptive-fetch-transforms.test.ts
tests/unit/adaptive-fetch-metadata.test.ts
```

Capabilities:

- bounded fetch with timeout;
- challenge marker detection;
- tiny-body detection;
- OGP/JSON-LD extraction;
- domain-agnostic URL transforms;
- optional Jina Reader attempt when allowed.

### Phase 4: Browser Escalation

NEW:

```text
src/browser/adaptive-fetch/browser-escalation.ts
tests/unit/adaptive-fetch-browser-escalation.test.ts
```

MODIFY:

```text
src/browser/index.ts
```

Only expose existing internal browser helpers if needed. Do not duplicate CDP
connection logic.

Behavior:

- navigate through existing browser runtime;
- get text/DOM;
- optionally capture network requests;
- redact sensitive request data;
- return `auth_required` if login/paywall/CAPTCHA is detected.

### Phase 5: Browser CLI Surface

MODIFY:

```text
bin/commands/browser.ts
structure/commands.md
structure/INDEX.md
```

Command:

```bash
cli-jaw browser fetch "https://example.com" --json --trace
```

Add help text that makes the boundary clear:

```text
fetch <url>
  Adaptive URL reading. Tries public endpoints, RSS/JSON, neutral fetch,
  metadata/Jina, and browser render/network inspection when needed.
  Not a generic search command.
```

### Phase 6: Skill/Prompt Integration

Only after the CLI/library is stable:

NEW or MODIFY:

```text
skills_ref/browser/SKILL.md
```

or a separate browser-family skill:

```text
skills_ref/browser-fetch/SKILL.md
```

Frontmatter must include search-adjacent triggers without hijacking simple
search:

```yaml
description: >
  Use for URL reading, search result URL extraction, blocked fetches, empty
  pages, 402/403 responses, public API/RSS/metadata extraction, and
  browser-network inspection. Do not use for generic web search before candidate
  URLs exist.
```

The skill should teach agents:

- native CLI search finds candidate URLs;
- `cli-jaw browser fetch` reads and validates candidate URLs;
- if no URL exists yet, search first;
- if URL exists or built-in fetch failed, use browser fetch.

## Explicit Non-Goals For First Build

- No Python `curl_cffi` port.
- No automatic `pip install`.
- No stealth browser dependency.
- No CAPTCHA handling.
- No login/paywall bypass.
- No bulk crawler.
- No MCP browser tool registration.

## agbrowse Implementation Result — 2026-05-15

The first build landed in agbrowse, not cli-jaw. That was intentional: agbrowse
already owns the browser/CDP runtime and can prove the URL-reader behavior before
cli-jaw mirrors it.

Actual agbrowse paths:

```text
skills/browser/adaptive-fetch/index.mjs
skills/browser/adaptive-fetch/safety.mjs
skills/browser/adaptive-fetch/validators.mjs
skills/browser/adaptive-fetch/trace.mjs
skills/browser/adaptive-fetch/endpoint-resolvers.mjs
skills/browser/adaptive-fetch/fetcher.mjs
skills/browser/adaptive-fetch/metadata.mjs
skills/browser/adaptive-fetch/transforms.mjs
skills/browser/adaptive-fetch/reader-adapters.mjs
skills/browser/adaptive-fetch/content-scorer.mjs
skills/browser/adaptive-fetch/third-party-readers.mjs
skills/browser/adaptive-fetch/browser-runtime.mjs
skills/browser/adaptive-fetch/browser-escalation.mjs
skills/browser/adaptive-fetch/challenge-detector.mjs
skills/browser/browser.mjs
```

Actual agbrowse command:

```bash
agbrowse fetch "<url>" --json --trace --browser auto --browser-session none
```

The cli-jaw mirror should now treat this baseline as a porting target:

- use `cli-jaw browser fetch <url>` as the mirror command;
- keep the same search-versus-URL boundary;
- keep third-party readers opt-in;
- keep browser modes explicit;
- keep existing profile/cookie reads behind explicit opt-in;
- preserve the traceable result envelope.

Required result keys for the mirror:

```text
ok, verdict, source, finalUrl, title, content, summary, attempts, evidence,
metadata, warnings, safetyFlags, browserMode, browserSession, chromeUsed,
chromeRequired
```

The mirror may be implemented in TypeScript, but it should not change behavior
just because the target language differs.
