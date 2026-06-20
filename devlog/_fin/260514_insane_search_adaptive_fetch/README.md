---
created: 2026-05-14
status: implemented-v1
tags: [jawdev, adaptive-fetch, web-research, browser, source-analysis]
upstream: https://github.com/fivetaku/insane-search
upstream_commit: b4ab9384399a8df58503268764ba43ed5520156d
---

# Insane Search Adaptive Fetch Study — agbrowse Mirror

## Purpose

Analyze `fivetaku/insane-search` and plan an agbrowse-first version of the same
class of feature: resilient URL reading when a normal fetch returns a block
page, empty SPA shell, weak metadata, or platform-specific content that is better
served through a public endpoint.

This folder was copied from the cli-jaw planning set into agbrowse so the first
implementation could be planned against agbrowse's own browser/CDP runtime.

As of 2026-05-15, the agbrowse v1 implementation exists in the repository under
`skills/browser/adaptive-fetch/` and is exposed through:

```bash
agbrowse fetch <url>
```

## agbrowse-First Decision

Implement the first safe version in agbrowse, then let cli-jaw mirror or wrap it
later.

Recommended user-facing agbrowse surface:

```bash
agbrowse fetch <url> [--json] [--trace]
```

Later cli-jaw surface:

```bash
cli-jaw browser fetch <url>
```

The product boundary is strict:

```text
search tool = find candidate URLs
agbrowse fetch = read, validate, and explain one candidate URL
```

Do not turn agbrowse into a generic search engine. This feature is a URL reader
and evidence extractor for URLs that already exist, including URLs produced by a
separate search tool.

## Success Target

The final agbrowse feature should see more legitimate surfaces than
`insane-search`, not fewer. "Boundary-safe" does not mean "stop early"; it means
keep trying every public or user-authorized representation before returning a
boundary verdict.

Target coverage:

- public APIs and official endpoints;
- RSS/Atom;
- metadata, canonical links, JSON-LD, OpenGraph;
- non-browser HTTP fetch;
- optional third-party public readers;
- isolated Chrome render;
- network JSON candidate discovery;
- existing profile/cookie reads only by explicit opt-in.

## Core Finding

`insane-search` is not mainly a giant site-by-site scraper. Its strongest idea is
a typed adaptive fetch scheduler:

1. route known platforms to official or public APIs first;
2. try cheap generic readers and URL transforms;
3. validate content before declaring success;
4. classify WAF/challenge signals by product, not target site;
5. escalate only when the previous layer produced a block/challenge verdict;
6. preserve a per-attempt trace so the agent can explain why it escalated.

For agbrowse, the selected direction is a browser-family ES module
adaptive-fetch module that reuses existing Chrome/CDP infrastructure and keeps
high-risk bypass behavior explicitly out of scope.

## Files

| File | Purpose |
| --- | --- |
| `01_agbrowse_first_mirror_plan.md` | Phase plan and implementation order for agbrowse first, cli-jaw mirror second. |
| `02_surface_design_chrome_boundaries.md` | CLI surface split between non-Chrome URL reading and Chrome escalation. |
| `03_agbrowse_skill_reinforcement_plan.md` | Exact browser skill wording, trigger rules, and documentation updates for agbrowse. |
| `04_search_keyword_consolidation_plan.md` | Search keyword buckets that route broad search to search tools and URL/result reads to `agbrowse fetch`. |
| `05_diff_level_browser_fetch_plan.md` | File-by-file implementation plan for agbrowse `fetch`. |
| `06_engine_flow.md` | The scheduler, verdict, WAF profile, and trace model. |
| `07_safety_and_risk.md` | Security, legal, UX, dependency, and product risks. |
| `08_test_strategy.md` | Unit, integration, browser, and optional live-smoke coverage. |
| `09_eli5_visual_explanation.md` | Elementary-school-level visual explanation. |
| `10_upstream_inventory.md` | What exists in the upstream repo and which files were inspected. |
| `11_principles.md` | The operating principles behind insane-search. |
| `12_cli_jaw_fit_baseline.md` | Copied baseline: how this maps onto cli-jaw's current architecture. |
| `13_cli_jaw_implementation_plan_baseline.md` | Copied baseline: proposed phased implementation for cli-jaw. |
| `14_open_questions.md` | Decisions to settle before build. |
| `15_skill_frontmatter_routing_baseline.md` | Copied baseline plus agbrowse routing notes. |
| `16_gpt_pro_validation_report.md` | GPT Pro repo comparison and plan validation report with applied corrections. |
| `17_grok_similar_repo_research.md` | Grok Expert similar-repository research and borrow/non-goal shortlist. |
| `18_grok_borrowed_patterns_integration_plan.md` | Exact plan for folding non-insane-search Grok findings into agbrowse. |
| `19_phased_diff_implementation_plan.md` | Phase 01-04 diff plan: core, readers, scorer, third-party reader. |
| `20_phased_diff_browser_docs_closeout_plan.md` | Phase 05-07 diff plan: browser escalation, docs, gates, mirror readiness. |

## Implemented Result

The shipped v1 follows the approved agbrowse-first direction:

- `skills/browser/adaptive-fetch/*.mjs` implements validation, safety flags,
  trace records, public endpoint candidates, discovered RSS/Atom feeds, neutral
  fetch/metadata transforms, reader adapters, scoring, opt-in third-party reader
  support, browser
  escalation, network JSON candidate discovery, and challenge classification.
- `skills/browser/browser.mjs` exposes `fetch <url>` as the browser-family CLI
  subcommand.
- `skills/browser/SKILL.md`, `README.md`, `structure/commands.md`, and
  `structure/CAPABILITY_TRUTH_TABLE.md` document the boundary: search tools find
  candidate URLs; `agbrowse fetch` reads and validates one known URL.
- Unit and integration tests cover validators, trace redaction, endpoint
  candidates, transforms, reader adapters, scorer behavior, third-party reader
  opt-in, CLI help, and command-level browser-mode contracts.

The implementation intentionally stays native to this repository: ES modules,
no Python `curl_cffi` port, no dependency auto-install, and no automatic use of
existing cookies or profile state.

## Mirror Contract

cli-jaw should mirror the proven agbrowse shape rather than re-decide the
product boundary. Preserve these result keys when implementing or wrapping the
feature there:

```text
ok, verdict, source, finalUrl, title, content, summary, attempts, evidence,
metadata, warnings, safetyFlags, browserMode, browserSession, chromeUsed,
chromeRequired
```

The mirror should also preserve the same trigger rule:

```text
generic search -> native search first
known URL / search result URL / blocked fetch -> adaptive URL fetch
```

## Recommended Shape

Start with a safe v1 in agbrowse:

- `skills/browser/adaptive-fetch/` as ES module `.mjs` files inside the existing
  agbrowse browser capability family.
- `agbrowse fetch <url>` as the first user-facing CLI surface.
- `--browser auto|never|required` to separate non-Chrome reader behavior from
  Chrome/CDP escalation.
- `--browser-session none|isolated|existing` to separate Chrome rendering from
  persistent-profile/cookie use.
- A result schema with `ok`, `verdict`, `content`, `source`, `finalUrl`,
  `attempts`, `summary`, `browserMode`, `chromeUsed`, `chromeRequired`, and
  `safetyFlags`.
- Phase 0 public endpoint resolvers for GitHub, Reddit, Hacker News, arXiv,
  Wikipedia, npm/PyPI, Bluesky, Mastodon-compatible statuses, Stack Exchange,
  dev.to, DOI/CrossRef, OpenLibrary, Wayback CDX, YouTube oEmbed,
  X/Twitter oEmbed, HN Algolia, V2EX, Lobsters, generic oEmbed discovery,
  RSS/Atom, and media metadata when an installed tool exists.
- Phase 1 neutral fetch, metadata extraction, and opt-in third-party public
  readers such as Jina Reader.
- Phase 2 browser render and existing CDP network inspection.
- Borrowed patterns beyond insane-search:
  - intercept-mcp style fallback layering and URL-to-markdown normalization;
  - agent-fetch style multi-extractor scoring before declaring success;
  - Jina Reader style third-party reader as explicit opt-in, not default;
  - Scrapling/crawl4ai as browser-fallback design references, not direct
    dependencies.
- Build order is locked in `19_phased_diff_implementation_plan.md`; research
  notes alone are not sufficient for implementation.
- Browser skill frontmatter triggers that point agents to `agbrowse fetch` only
  for URL reading, blocked fetches, empty pages, weak search-result pages,
  403/402, and "search result URL analysis" cases. Do not trigger it for every
  generic "search" request.
- Search keyword consolidation: broad search words route to native search first;
  search-result/source/citation/reference URL words route to `agbrowse fetch`
  after a URL exists.
- No silent dependency installs.
- No early stop just because a CAPTCHA/login/paywall marker appears. Keep trying
  public endpoint, RSS, metadata, and non-browser reads first.
- No challenge solving, credential use, or stealth claims when the only
  remaining route requires crossing an access boundary.

## Current Recommendation

Do not port upstream's Python `curl_cffi` engine directly as the default
agbrowse path. agbrowse is a Node/ESM browser automation project with an existing
Chrome/CDP runtime, browser skill documentation, command contracts, and
source-of-truth structure docs. A native, traceable, safety-bounded `.mjs`
implementation under the existing browser command family fits the repo better
and avoids surprise Python/pip mutations.

cli-jaw should treat this as a mirror source once agbrowse proves the behavior:
wrap the command, reuse the skill guidance, and keep the same search-versus-URL
boundary.
