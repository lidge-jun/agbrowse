# P3 Fetch Enrichment Plan

Date: 2026-06-09
Phase: P3
Scope: Search result -> fetch enrichment

## Goal

Turn normalized search results into original-page evidence candidates.

P1 made search backends usable as URL candidate generators. P3 adds the next
offline-testable step: read candidate URLs through adaptive fetch, attach the
read result to each candidate, and update the constraint ledger with evidence
from the original page text instead of snippets.

## Non-Goals

- Do not implement the final browser escalation controller in P3.
- Do not make snippets count as final evidence.
- Do not require live network access for unit tests.
- Do not replace provider search APIs; this layer consumes their normalized
  URL candidates.

## Current Inputs

- `research-plan-v1` from `agbrowse research plan --query ... --json`
- `search-results-v1` from `agbrowse research normalize-results --file ...`
- Adaptive fetch result from `runAdaptiveFetch`
- Constraint ledger helpers in `search-research/constraint-ledger.mjs`

## Output Contract

Add a new `research-fetch-enrichment-v1` envelope:

```json
{
  "schemaVersion": "research-fetch-enrichment-v1",
  "planSchemaVersion": "research-plan-v1",
  "resultSchemaVersion": "search-results-v1",
  "fetchPolicy": {
    "browser": "never",
    "maxResults": 5
  },
  "query": "provider query",
  "candidates": [
    {
      "rank": 1,
      "url": "https://example.com/page",
      "title": "search title",
      "snippet": "search snippet",
      "fetch": {
        "ok": true,
        "verdict": "strong_ok",
        "source": "fetch",
        "finalUrl": "https://example.com/page",
        "title": "page title",
        "textExcerpt": "original page excerpt",
        "warnings": []
      },
      "constraintIds": ["c1"]
    }
  ],
  "ledger": {},
  "summary": {
    "status": "insufficient-evidence",
    "ready": false,
    "supported": ["c1"],
    "pending": ["c2"]
  },
  "nextStep": {
    "type": "browse-candidates",
    "reason": "fetch-insufficient-or-plan-requires-browse"
  }
}
```

The `nextStep` field is only a handoff signal. P4 owns the controller that
decides which URL to browse and why.

## Implementation

1. Add `skills/browser/search-research/fetch-enrichment.mjs`.
   - Export `enrichSearchResultsWithFetch(plan, normalizedResults, options, deps)`.
   - Limit candidates with `maxResults`.
   - Call injected `deps.runAdaptiveFetch` when present; otherwise use
     `runAdaptiveFetch`.
   - Default browser mode to `never` so the enrichment step is fetch-only unless
     the caller opts into `auto`.
   - Update the constraint ledger with fetched page title/content.
   - Do not pass search query `constraintIds` directly into
     `updateLedgerWithEvidence`. Those IDs describe why the URL was discovered,
     not what the original page proves. Let the ledger derive support from
     fetched title/content, or pass IDs only after a separate fetched-text
     verifier proves the page supports those constraints.
   - Preserve search title/snippet as diagnostics only.
2. Add `agbrowse research enrich-fetch --plan <json> --results <json> --json`.
   - The CLI reads local JSON files.
   - The command outputs the enrichment envelope.
   - Missing required flags fail before browser mutation.
   - Convert the research CLI dispatcher to async and await it from the root
     `research` command branch, because adaptive fetch is async. Keep
     missing-argument validation before any fetch call.
3. Update browser skill docs and command structure.
4. Add offline unit tests with an injected fetch runner.
5. Add CLI argument/contract tests that do not require Chrome or network.

## Success Criteria

- Unit tests prove snippets do not satisfy constraints by themselves.
- Unit tests prove fetched original text updates the ledger.
- Unit tests prove query-associated constraint IDs do not mark ledger entries
  supported unless fetched text supports them.
- CLI tests prove `research enrich-fetch` awaits the async enrichment path and
  reports errors through the existing command result flow.
- CLI help and missing-argument tests include `research enrich-fetch`.
- Typecheck and release gates pass.
- Full test suite passes before commit.
