---
created: 2026-05-15
status: implemented
tags: [adaptive-fetch, browser, url-reader, jawdev]
---

# Adaptive Fetch V1 Closeout

## Implemented

agbrowse now has an adaptive URL reader exposed as:

```bash
agbrowse fetch <url>
```

The implementation lives under `skills/browser/adaptive-fetch/` and is wired
through `skills/browser/browser.mjs`.

It covers:

- URL validation and safety flags;
- trace records with redaction;
- public endpoint candidates;
- expanded public endpoint resolvers for GitHub, Reddit, Hacker News,
  Wikipedia, npm, PyPI, arXiv, Bluesky, Mastodon-compatible statuses, Stack
  Exchange, dev.to, DOI/CrossRef, OpenLibrary, Wayback CDX, YouTube oEmbed,
  X/Twitter oEmbed, HN Algolia, V2EX, Lobsters, and generic oEmbed discovery;
- discovered RSS/Atom feed candidates;
- neutral fetch and metadata extraction;
- reader adapter normalization;
- content scoring across candidates;
- opt-in third-party reader support;
- explicit browser modes: `auto`, `never`, `required`;
- compatibility alias: `--no-browser` for `--browser never`;
- explicit browser sessions: `none`, `isolated`, `existing`;
- isolated Chrome rendering and network JSON candidate discovery;
- challenge/login/paywall marker classification without bypass behavior.

## Documentation

Updated source-of-truth surfaces:

- `README.md`
- `skills/browser/SKILL.md`
- `structure/commands.md`
- `structure/CAPABILITY_TRUTH_TABLE.md`
- `devlog/_fin/260514_insane_search_adaptive_fetch/README.md`
- `devlog/_fin/260514_insane_search_adaptive_fetch/13_cli_jaw_implementation_plan_baseline.md`
- `devlog/_fin/260514_insane_search_adaptive_fetch/15_skill_frontmatter_routing_baseline.md`

The documented product boundary is:

```text
search tools find candidate URLs
agbrowse fetch reads and validates one known URL
```

## Verification

Primary local gates:

```bash
npm test -- test/integration/cli-help.test.mjs test/integration/browser-fetch-command.test.mjs test/unit/browser-adaptive-fetch-validators.test.mjs test/unit/browser-adaptive-fetch-trace.test.mjs test/unit/browser-adaptive-fetch-endpoints.test.mjs test/unit/browser-adaptive-fetch-transforms.test.mjs test/unit/browser-adaptive-fetch-reader-adapters.test.mjs test/unit/browser-adaptive-fetch-content-scorer.test.mjs test/unit/browser-adaptive-fetch-third-party-readers.test.mjs
npm run typecheck
bash structure/verify-counts.sh
bash structure/check-doc-drift.sh
git diff --check HEAD
```

## cli-jaw Mirror Contract

cli-jaw should mirror the agbrowse shape after this v1 proves stable:

- command: `cli-jaw browser fetch <url>`;
- same search-versus-URL trigger rule;
- same opt-in third-party reader boundary;
- same explicit browser mode/session split;
- same no challenge-solving, no stealth, no hidden credential use boundary;
- same result keys: `ok`, `verdict`, `source`, `finalUrl`, `title`, `content`,
  `summary`, `attempts`, `evidence`, `metadata`, `warnings`, `safetyFlags`,
  `browserMode`, `browserSession`, `chromeUsed`, `chromeRequired`.
