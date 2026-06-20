---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, cli-jaw-architecture]
---

# cli-jaw Fit

## Current Repo Signals

cli-jaw already has the foundation for a safer adaptive fetch feature:

- `bin/commands/browser.ts` exposes browser/CDP primitives.
- `src/routes/browser.ts` exposes snapshot, screenshot, navigate, text, DOM,
  console, network, evaluate, and web-ai routes.
- `src/browser/connection.ts` owns local Chrome/CDP lifecycle.
- `src/browser/actions.ts` and `src/browser/primitives.ts` own interaction
  primitives.
- `src/browser/web-ai/source-audit.ts` and related modules already treat web
  answers as auditable artifacts.
- `structure/CAPABILITY_TRUTH_TABLE.md` explicitly freezes unsupported browser
  MCP and hosted/cloud claims.

## Selected Module Boundary

User decision on 2026-05-14: attach this feature under the existing `browser`
command family.

Add a browser-family module, while keeping the code internally separated from
low-level CDP primitives:

```text
src/browser/adaptive-fetch/
  index.ts
  types.ts
  scheduler.ts
  validators.ts
  endpoint-resolvers.ts
  metadata.ts
  transforms.ts
  browser-escalation.ts
  safety.ts
  trace.ts
```

Why under `browser`:

- cli-jaw already teaches users and agents that `browser` owns web-page
  observation, DOM, text, network, and web-ai workflows.
- The escalation path relies on the existing CDP browser runtime.
- Avoids introducing a new top-level command before the behavior is proven.
- Still keeps fetch policy modular so it does not pollute `actions.ts` or
  `connection.ts`.

## CLI Surface

Selected command:

```bash
cli-jaw browser fetch "https://example.com" --json --trace
```

This should be documented as "adaptive URL reading" rather than generic web
search. The command can still call public APIs, RSS, Jina, and metadata paths
before it uses a visible browser; the user-facing namespace is about where the
web interaction capability lives, not a promise that every phase opens Chrome.

## Server/API Surface

Defer a public HTTP API for v1 unless the Web UI needs it. If exposed, keep it
under the browser route family:

```text
POST /api/browser/fetch
```

Request:

```json
{
  "url": "https://example.com",
  "intent": "read",
  "successSelectors": ["article"],
  "maxAttempts": 8,
  "allowBrowser": true,
  "allowArchives": false
}
```

Response:

```json
{
  "ok": true,
  "verdict": "strong_ok",
  "content": "...",
  "finalUrl": "https://example.com",
  "source": "public_api|fetch|jina|metadata|browser|archive",
  "attempts": [],
  "summary": "..."
}
```

## Prompt/Skill Integration

The feature can be connected through skill frontmatter and prompt guidance.
Suggested skill frontmatter shape:

```yaml
---
name: browser-fetch
description: >
  Adaptive URL reading through cli-jaw browser fetch. Use when a user provides a
  URL, a search result URL needs extraction, normal fetch/WebFetch returns
  402/403/blocked, a page renders as an empty SPA shell, or content requires
  public API/RSS/metadata/browser-network inspection. Do NOT use for generic web
  search before candidate URLs exist.
---
```

Good triggers:

- "이 URL 읽어줘"
- "검색 결과 링크 본문 뽑아줘"
- "403/402/blocked"
- "본문이 안 읽혀"
- "빈 페이지만 나와"
- "Reddit/GitHub/YouTube/RSS URL 분석"

Bad trigger:

- generic "검색해줘" with no URL or selected result.

The feature should be advertised to agents as:

- use for blocked/empty web pages;
- prefer public APIs and RSS first;
- do not use for simple web search;
- stop at login/paywall/CAPTCHA;
- read trace before retrying;
- never silently install dependencies.

This can be a skill-level behavior later, but the first implementation should be
a tested library and command, not only prompt instructions.

## Existing Docs To Update During Build

If this becomes a real command/API, update:

- `structure/commands.md`
- `structure/server_api.md` if adding `/api/browser/fetch`
- `structure/INDEX.md`
- `structure/CAPABILITY_TRUTH_TABLE.md` if capability labels change
- root `AGENTS.md` only if the command/API/orchestration surface changes
- `bin/commands/browser.ts` help or new command help
- relevant browser skill frontmatter/description docs

Run:

```bash
bash structure/verify-counts.sh
npm run typecheck
```

Then add focused tests for the new module.
