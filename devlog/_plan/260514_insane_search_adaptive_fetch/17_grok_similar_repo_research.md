---
created: 2026-05-15
status: review
tags: [jawdev, agbrowse, adaptive-fetch, grok, repo-research]
---

# Grok Similar Repo Research

## Input

Grok Expert received:

- repo A: `https://github.com/lidge-jun/agbrowse`
- repo B: `https://github.com/fivetaku/insane-search`
- task: find similar open-source tools for adaptive URL reading, browser-assisted
  URL reading, search-result extraction, public endpoint fallback,
  browser/network inspection for agents, and traceable readability extraction.

Session:

```text
01KRKY43TB7YHEHD7CGNRTZX23
```

## Main Candidates

Grok returned this shortlist:

| Repo/tool | Link | Why it matters |
| --- | --- | --- |
| insane-search | `https://github.com/fivetaku/insane-search` | Closest phased adaptive scheduler match. |
| intercept-mcp | `https://github.com/bighippoman/intercept-mcp` | Multi-fallback URL-to-markdown strategy. |
| agent-fetch | `https://github.com/teng-lin/agent-fetch` | Multi-extractor/readability-style fetch selection. |
| Jina Reader | `https://github.com/jina-ai/reader` | Public non-browser URL-to-markdown reader. |
| Scrapling | `https://github.com/D4Vinci/Scrapling` | Adaptive HTTP/browser fetcher framework. |
| crawl4ai | `https://github.com/unclecode/crawl4ai` | Crawler with browser fallback and LLM-friendly extraction. |
| nab | `https://github.com/MikkoParkkola/nab` | Public/API-first browsing/research helper candidate. |
| trajectorykit | `https://github.com/KabakaWilliam/trajectorykit` | Multi-tier URL/research fallback candidate. |

## Ideas To Borrow

- Keep insane-search's phased scheduler shape:

  ```text
  public endpoint/RSS/metadata -> native fetch -> reader/extractor -> browser/network
  ```

- Record trigger reasons in trace:

  ```text
  empty body
  JS-heavy shell
  metadata-only result
  blocked/challenge marker
  browser escalation reason
  ```

- Consider multi-extractor scoring:

  ```text
  readability length
  metadata completeness
  text density
  JSON-LD availability
  source trust
  ```

- Treat Jina Reader as a possible opt-in reader, not as the same category as an
  official/public endpoint.

- Use browser network inspection to discover JSON candidates, but do not turn it
  into repeated collection by default.

## Risks And Non-Goals

Grok's risk list matches the GPT Pro review:

- public reader rate limits;
- increased browser resource use;
- scraping/ToS ambiguity;
- browser fingerprinting risk;
- no CAPTCHA solving;
- no private credential use;
- no default full-browser execution.

## Planning Impact

The plan should use these repos as reference material, not as direct
dependencies.

Recommended borrow list:

1. insane-search for scheduler/verdict/trace discipline;
2. intercept-mcp for URL-to-markdown fallback layering;
3. agent-fetch for extractor scoring ideas;
4. Jina Reader as optional third-party reader reference;
5. Scrapling/crawl4ai as broader browser fallback design references.

Do not copy upstream stealth, impersonation, auto-install, or CAPTCHA-related
positioning into agbrowse.

## Integration Status

Status after plan update:

| Repo/tool | Reflected in plan? | Where |
| --- | --- | --- |
| insane-search | Yes | Scheduler, verdict, trace, endpoint-first order. |
| intercept-mcp | Yes | `reader-adapters.mjs` and fallback-to-markdown normalization. |
| agent-fetch | Yes | `content-scorer.mjs` and multi-candidate scoring. |
| Jina Reader | Yes | `third-party-readers.mjs`, opt-in only. |
| Scrapling | Partly | Browser escalation design reference, no dependency. |
| crawl4ai | Partly | Browser fallback and LLM-friendly extraction reference. |
| nab | Backlog/reference | API-first resolver ideas, no v1 dependency. |
| trajectorykit | Backlog/reference | Multi-tier fallback ideas, no v1 dependency. |

The important correction is that non-insane-search findings are no longer just a
research appendix. They now map to concrete planned modules and tests in
`01_agbrowse_first_mirror_plan.md`, `05_diff_level_browser_fetch_plan.md`, and
`08_test_strategy.md`.
