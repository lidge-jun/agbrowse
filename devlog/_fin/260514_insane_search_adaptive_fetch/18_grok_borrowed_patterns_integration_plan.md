---
created: 2026-05-15
status: planning
tags: [jawdev, agbrowse, adaptive-fetch, grok, integration-plan]
---

# Grok Borrowed Patterns Integration Plan

## Short Answer

The earlier plan fully centered `insane-search`. Grok's other repo findings were
recorded, but only partly folded into implementation design.

This document closes that gap. It maps each non-insane-search finding to a
specific agbrowse module, test, or backlog decision.

## Integration Map

| Repo/tool | What to borrow | v1 status | Planned home |
| --- | --- | --- | --- |
| `intercept-mcp` | Layer several URL-to-markdown/read attempts and normalize output | Include | `reader-adapters.mjs`, `transforms.mjs` |
| `agent-fetch` | Score multiple extraction candidates before declaring success | Include | `content-scorer.mjs` |
| `jina-ai/reader` | Public reader path for pages that normal fetch cannot read well | Include as opt-in | `third-party-readers.mjs` |
| `Scrapling` | Adaptive HTTP/browser fallback model | Reference only | `browser-escalation.mjs` |
| `crawl4ai` | Browser fallback and LLM-friendly extraction ideas | Reference only | `browser-escalation.mjs`, `content-scorer.mjs` |
| `nab` | API-first browsing/research helper ideas | Backlog | later endpoint resolver review |
| `trajectorykit` | Multi-tier research/fetch fallback ideas | Backlog | later endpoint resolver review |

## Slice A — Reader Adapter Layer

Add:

```text
skills/browser/adaptive-fetch/reader-adapters.mjs
test/unit/browser-adaptive-fetch-reader-adapters.test.mjs
```

Responsibility:

- accept raw fetch, metadata, public endpoint, third-party reader, browser, and
  network candidates;
- normalize them to one internal candidate shape;
- keep warnings and evidence per candidate;
- never treat "some text exists" as automatic success.

Why:

This is the usable part of the `intercept-mcp` pattern. It lets agbrowse try
several legal representations and compare them instead of returning the first
weak result.

## Slice B — Content Scorer

Add:

```text
skills/browser/adaptive-fetch/content-scorer.mjs
test/unit/browser-adaptive-fetch-content-scorer.test.mjs
```

Responsibility:

- score title quality;
- score readable text length;
- score text density;
- score metadata completeness;
- score JSON-LD/OpenGraph evidence;
- penalize challenge/login/paywall shells;
- return the winning candidate plus explanation.

Why:

This borrows the useful `agent-fetch` idea: extraction is a competition between
candidates. A metadata-only page can be useful, but article text or public JSON
should win when it is stronger.

## Slice C — Optional Third-Party Readers

Add:

```text
skills/browser/adaptive-fetch/third-party-readers.mjs
test/unit/browser-adaptive-fetch-third-party-readers.test.mjs
```

Responsibility:

- support Jina Reader-style URL-to-markdown only when
  `--allow-third-party-reader` is present;
- label the source as `third_party_reader`;
- include trace warnings for rate limits, network errors, or unsupported URLs;
- never classify it as an official public endpoint.

Why:

This can let agbrowse see more public page content than a plain fetch, but it
changes privacy and data-routing assumptions. It must be explicit.

## Slice D — Browser Fallback References

No direct dependency:

```text
Scrapling
crawl4ai
```

Borrow only:

- the idea that browser fallback should be adaptive, not default;
- browser output should be converted into the same candidate shape as other
  readers;
- browser/network evidence should be scored, not blindly trusted.

Reject:

- stealth claims;
- anti-detection behavior;
- CAPTCHA solving;
- login/paywall crossing;
- surprise dependency installation.

## Slice E — Backlog References

Keep these as later research references:

```text
nab
trajectorykit
```

Possible later borrow:

- more public endpoint resolvers;
- agent research workflow ideas;
- richer trace summaries.

Do not make them v1 dependencies.

## Acceptance Criteria

- `05_diff_level_browser_fetch_plan.md` names the adapter, scorer, and
  third-party reader modules.
- `08_test_strategy.md` requires adapter, scorer, and opt-in reader tests.
- `17_grok_similar_repo_research.md` records which repos are included, partial,
  or backlog.
- The final v1 goal remains stronger than insane-search on legitimate
  representations, while still refusing challenge solving, credential use,
  stealth, and access-wall crossing.

