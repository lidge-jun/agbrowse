# 21. P1 Research CLI + Search Backend Normalizer Plan

## Objective

Expose the already-tested offline Korean research planning core as an
agent-visible CLI:

```bash
agbrowse research plan --query "<Korean problem>" --json
```

Add a pure search-result normalizer so Exa, Tavily, Perplexity, Brave, or a
browser SERP scrape can all become the same URL-candidate envelope before any
fetch or browse work begins.

This phase does not call live search APIs, fetch URLs, or browse pages. It
creates the standalone CLI contract that P2-P4 can wire into cli-jaw prompts,
fetch enrichment, and browse escalation.

## Current State

Implemented before this phase:

- `skills/browser/search-research/search-strategy.mjs`
  - `planKoreanResearch(problem, { maxQueries })`
  - source/date/structure hints
  - mandatory constraints
  - 1-3 focused atomic queries
  - route URLs
  - fetch/browse follow-up policy
- `skills/browser/search-research/korean-routes.mjs`
- `skills/browser/search-research/constraint-ledger.mjs`
- `test/unit/kbrowsecomp-search-research.test.mjs`

Missing:

- root CLI command dispatch for `agbrowse research ...`
- JSON output envelope for the plan command
- reusable search-result normalizer
- tests for CLI output and provider-shaped result normalization
- command/skill/structure docs for the new surface

## Scope

### Add

`skills/browser/search-research/normalizer.mjs`

- Export `normalizeSearchResults(input, options)`.
- Accept provider-shaped input:
  - top-level `{ backend, query, results }`
  - bare array of result rows
  - common row fields from Exa/Tavily/Brave/Perplexity/browser SERP:
    `url`, `link`, `href`, `title`, `name`, `snippet`, `text`,
    `content`, `date`, `publishedDate`, `raw`.
- Output:

```json
{
  "schemaVersion": "search-results-v1",
  "backend": "tavily",
  "query": "검색어",
  "results": [
    {
      "url": "https://example.com",
      "title": "Example",
      "snippet": "short evidence hint",
      "date": null,
      "rank": 1,
      "raw": {}
    }
  ],
  "dropped": []
}
```

- Drop rows without valid http/https URLs.
- Deduplicate by normalized URL without fragments.
- Preserve `raw` for diagnostics.
- Never treat snippets as final evidence.

### Modify

`skills/browser/search-research/search-strategy.mjs`

- Add a stable `schemaVersion: "research-plan-v1"` to `planKoreanResearch`.
- Add `generatedAt` only if deterministic tests do not depend on wall-clock
  time; otherwise omit it for offline stability.
- Keep current query/constraint behavior unchanged.

`skills/browser/browser.mjs`

- Add header/help text for:

```text
research plan --query <problem> [--max-queries N] [--json]
research normalize-results --backend <name> [--query <query>] --file <json> [--json]
```

- Add `case "research"` dispatch that calls a small local
  `runResearchCli(argv)` helper.
- `plan`:
  - require `--query`.
  - support `--max-queries`.
  - print JSON when `--json`, human summary otherwise.
- `normalize-results`:
  - require `--file`.
  - read JSON file.
  - apply backend/query CLI overrides when present.
  - print JSON when `--json`, human summary otherwise.

`skills/browser/SKILL.md`

- Add a “Research Planning” workflow:
  - run `agbrowse research plan --query ... --json`
  - run provider/native search with `atomicQueries`
  - treat results as URL candidates
  - normalize provider rows before fetch/browse
  - do not answer from snippets.

`structure/commands.md`

- Add root command group row for `research`.
- Add a small section documenting the research subcommands.

`structure/str_func.md`

- Update counts after implementation.

`devlog/_plan/260608_kbrowsecomp_search_gap/00_index.md`

- Add this P1 plan row.

### Tests

`test/unit/kbrowsecomp-search-research.test.mjs`

- Assert `planKoreanResearch` emits `schemaVersion: "research-plan-v1"`.
- Add normalizer tests:
  - normalizes Tavily/Exa-like fields into URL candidates.
  - drops invalid URLs and deduplicates fragments.
  - preserves raw diagnostic data.

`test/integration/cli-help.test.mjs`

- Assert browser help lists `research`, `research plan`, and
  `research normalize-results`.

New integration test:

`test/integration/research-cli.test.mjs`

- `agbrowse research plan --query "..."`
  - does not require Chrome/CDP.
  - returns JSON envelope with `schemaVersion`, `atomicQueries`, `constraints`,
    and `followUp.fetchOriginalPages`.
- `agbrowse research normalize-results --backend tavily --file fixture --json`
  - does not require network.
  - returns `search-results-v1` URL candidates.
- Missing `--query` / missing `--file` fails before browser mutation.

## Acceptance Criteria

1. `agbrowse research plan --query "<problem>" --json` returns a parseable
   `research-plan-v1` envelope without starting or touching Chrome.
2. The plan output includes constraints, source hints, 1-3 atomic queries,
   route URLs, and fetch/browse follow-up policy.
3. `agbrowse research normalize-results --backend <name> --file <json> --json`
   returns a parseable `search-results-v1` envelope with deduplicated URL
   candidates.
4. Invalid/non-URL rows are surfaced in `dropped` rather than silently treated
   as evidence.
5. Help, skill docs, command docs, structure counts, and tests all match.

## Verification

Run:

```bash
npx vitest run test/unit/kbrowsecomp-search-research.test.mjs test/integration/cli-help.test.mjs test/integration/research-cli.test.mjs --reporter=verbose
npm run typecheck:checkjs
npm run test:release-gates
git diff --check
```

Run full `npm test` before the P1 commit if the implementation touches shared
CLI dispatch in a way that can affect existing browser commands.

## Non-Goals

- No live Exa/Tavily/Perplexity/Brave API clients.
- No `fetch` enrichment loop yet.
- No browser escalation controller yet.
- No K-BrowseComp score claim.
