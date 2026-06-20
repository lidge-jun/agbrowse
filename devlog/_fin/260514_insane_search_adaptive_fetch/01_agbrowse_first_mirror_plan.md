---
created: 2026-05-14
status: planning
tags: [jawdev, agbrowse, adaptive-fetch, mirror-plan, search-helper]
---

# agbrowse-First Mirror Plan

## Decision

Implement adaptive fetch in agbrowse first.

Then mirror the proven shape into cli-jaw as:

```bash
cli-jaw browser fetch <url>
```

The reason is simple: agbrowse already owns the standalone browser/CDP runtime.
cli-jaw can call or wrap that proven behavior later, but agbrowse should not wait
for a cli-jaw-specific implementation.

## Product Boundary

agbrowse adaptive fetch is not search.

```text
Native search tool -> candidate URLs
agbrowse fetch     -> validated content from one URL
```

That boundary makes agbrowse useful as a search-tool helper without turning it
into a search engine, crawler, or anti-blocking product.

The implementation target is stronger than a conservative blocker: agbrowse
should inspect more legitimate representations than insane-search where it can,
while keeping challenge-solving, credential use, and stealth outside the action
set.

## User-Facing Contract

Primary command:

```bash
agbrowse fetch "<url>"
agbrowse fetch "<url>" --json
agbrowse fetch "<url>" --json --trace
agbrowse fetch "<url>" --browser never
agbrowse fetch "<url>" --browser required
agbrowse fetch "<url>" --browser auto --browser-session isolated
```

Optional command flags for v1:

```text
--json
--trace
--browser auto|never|required
--browser-session none|isolated|existing
--max-bytes <n>
--timeout-ms <n>
--selector <css>
--no-public-endpoints
--allow-third-party-reader
--allow-archive
```

Compatibility alias:

```text
--no-browser -> --browser never
```

Default privacy posture:

```text
--browser auto
--browser-session none or isolated
third-party reader off
archive off
```

`existing` browser session/cookie use must be explicit. The default must not
quietly send logged-in cookies, private membership state, or signed URLs to a
page just because non-Chrome fetch was weak.

Deferred flags:

```text
--bulk
--save-artifact
--third-party-reader
```

Bulk and artifact modes should be separate slices because they increase storage,
rate-limit, and UX complexity.

## Proposed File Map

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

MODIFY:

```text
skills/browser/browser.mjs
skills/browser/SKILL.md
README.md
structure/commands.md
structure/CAPABILITY_TRUTH_TABLE.md
structure/str_func.md
```

MODIFY only if a local HTTP API route is exposed:

```text
structure/server_api.md
```

TEST:

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

## Execution Slices

### Slice 1 — Safe URL Fetch Core

Build:

- URL validation;
- timeout and max-byte bounds;
- content-type classification;
- redirect limit;
- browser mode parsing (`auto`, `never`, `required`);
- browser session parsing (`none`, `isolated`, `existing`);
- SSRF/private-network defenses: scheme allowlist, credential-in-URL rejection,
  localhost/private/link-local deny by default, DNS and redirect target
  re-checks;
- token/header redaction for URL, request, and network trace fields;
- trace attempt recording;
- human and JSON output.

Acceptance:

- invalid URLs fail before network work;
- binary content is rejected as unsupported;
- weak/empty HTML returns a weak verdict, not a fake success;
- trace redacts sensitive headers/query material.

### Slice 2 — Endpoint And Metadata Readers

Build:

- RSS/Atom discovery;
- canonical URL and OpenGraph metadata;
- JSON endpoint candidate resolver for a small approved set;
- clean text transform for HTML;
- intercept-mcp-style fallback layering where several reader attempts normalize
  into one URL-to-markdown/text result shape;
- agent-fetch-style content scoring using text length, text density, metadata
  completeness, JSON-LD presence, title quality, and source trust;
- Jina Reader-style third-party public reader support behind
  `--allow-third-party-reader`, never as a default endpoint.

Acceptance:

- public endpoint success returns `source: "public_endpoint"`;
- metadata-only results are marked `weak_ok`;
- no third-party dependency is installed silently.
- third-party readers such as Jina are not default public endpoints; they require
  an explicit opt-in flag if included at all.
- the selected result records why it won, not just that it returned text.

### Slice 3 — Browser Escalation

Build:

- reuse existing Chrome/CDP session code;
- navigate only after earlier phases are weak or blocked when
  `--browser auto`;
- navigate after URL validation when `--browser required`;
- never navigate when `--browser never`;
- do not use existing persistent profile cookies unless
  `--browser-session existing` is explicitly set;
- collect title, visible text, DOM text, and network JSON candidates;
- score browser-visible text and network JSON candidates through the same
  content scorer used by non-browser reader attempts;
- classify login/CAPTCHA/paywall/challenge markers and continue safe
  public/non-browser attempts before returning a final boundary verdict.

Acceptance:

- empty SPA shells can become `strong_ok` after browser render;
- login/challenge pages do not force immediate stop;
- CAPTCHA/challenge handling means: try every public endpoint, RSS, metadata,
  non-browser, isolated-browser, and network-candidate path that does not solve,
  click through, stealth, or use private credentials;
- return a boundary verdict only when the remaining path requires crossing the
  access boundary.
- browser escalation is visible in `attempts`.

### Slice 4 — Skill, README, Structure Docs

Build:

- update browser skill frontmatter and command examples;
- add search keyword consolidation for search-result/source/citation/reference
  URL routing;
- update README command list;
- update structure docs and capability truth table;
- add tests for help text.

Acceptance:

- docs say adaptive fetch is URL-only;
- docs push agents to maximize allowed attempts instead of treating boundary
  words as an immediate anti-pattern;
- docs distinguish allowed non-browser/public endpoint reads from disallowed
  challenge-solving, credential use, or stealth actions;
- doc drift scripts pass.

## Result Schema

Use stable JSON keys from the first slice:

```json
{
  "ok": true,
  "verdict": "strong_ok",
  "source": "browser",
  "finalUrl": "https://example.com/article",
  "browserMode": "auto",
  "browserSession": "isolated",
  "chromeUsed": true,
  "chromeRequired": false,
  "title": "Example title",
  "content": "Readable extracted text...",
  "summary": "Browser render produced readable text after native fetch was weak.",
  "attempts": [],
  "safetyFlags": []
}
```

Verdicts:

```text
strong_ok
weak_ok
blocked
auth_required
challenge
paywall
unsupported
error
```

Sources:

```text
public_endpoint
fetch
metadata
reader
browser
network_api
```

## Mirror Back To cli-jaw

After agbrowse passes implementation and tests, cli-jaw can mirror this in one of
two ways:

1. Wrap `agbrowse fetch <url>` from `cli-jaw browser fetch <url>`.
2. Port the `.mjs` modules back into cli-jaw's browser package if cli-jaw needs a
   fully internal implementation.

Preferred first mirror:

```text
cli-jaw browser fetch -> agbrowse fetch-compatible result schema
```

That keeps one behavior contract across both tools while avoiding duplicate
research-reader logic during the first pass.

## Guardrails

- Maximize all public and user-authorized read paths before giving up.
- Treat public endpoints, RSS, metadata, non-browser fetch, and isolated browser
  reads as normal attempts, even if the primary HTML page shows a challenge.
- Return a boundary verdict only when the remaining path requires solving a
  challenge, crossing login/paywall access, using private credentials, or using
  stealth/anti-detection behavior.
- Do not auto-install Python, curl impersonation libraries, or reader services.
- Do not treat a broad search query as a URL.
- Do not bulk crawl without explicit scope and rate limits.
- Do not store page contents unless a later artifact slice explicitly adds that.

## Verification Commands

Planned verification once code exists:

```bash
npm run typecheck
npm test -- test/unit/browser-adaptive-fetch-validators.test.mjs test/unit/browser-adaptive-fetch-endpoints.test.mjs test/unit/browser-adaptive-fetch-transforms.test.mjs test/unit/browser-adaptive-fetch-trace.test.mjs test/integration/browser-fetch-command.test.mjs
bash structure/check-doc-drift.sh
bash structure/verify-counts.sh
git diff --check HEAD
```

If the repo has no TypeScript typecheck gate for these `.mjs` files, keep the
configured typecheck command but rely on focused unit/integration tests for the
adaptive-fetch module.
