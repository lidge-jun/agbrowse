# 16. Search Research Patch Sequence

## Objective

Move from prompt-only search improvement to an agbrowse-owned research loop
that can explain search failures and choose fetch or browse deliberately.

## Patch Sequence

This sequence must be read together with doc 17. `agbrowse research plan` is
not enough by itself; cli-jaw's `browser`/`browse` command surface and
agbrowse's standalone command surface need to stay mirrored for the agent
workflow to remain teachable.

### P0a. cli-jaw Browser Command Mirror

Before or alongside the research CLI, close the agent-visible browser parity
gap:

```text
agbrowse new-tab <url> [--no-activate] [--json]
agbrowse tab-close <targetId> [--json]
agbrowse active-tab --json
agbrowse vision-click <target> [--provider codex] [--double]
```

These commands matter for Korean search because dynamic pages, portals,
iframes, and table/list pages often require controlled tab isolation, explicit
target handoff, and no-ref coordinate fallback.

### P0b. Offline Planning Core

Implemented first:

```text
problem text
  -> source/date/structure hints
  -> constraints
  -> 1-3 focused Korean queries
  -> route URLs
  -> fetch/browse follow-up policy
  -> constraint ledger readiness
```

This covers the part that failed across providers: broad natural-language
queries, snippet finalization, dropped date/source/table constraints, and
unclear browser escalation.

### P1. Research CLI + Search Backend Normalizer

Expose the planning core first:

```bash
agbrowse research plan --query "<problem>" --json
```

Then add a pure normalizer before adding API clients:


```json
{
  "backend": "perplexity|exa|tavily|brave|browser-serp",
  "query": "...",
  "results": [{ "url": "...", "title": "...", "snippet": "...", "date": null, "raw": {} }]
}
```

The normalizer should keep raw backend fields for diagnostics but expose a
single URL-candidate shape to the fetch loop.

### P2. cli-jaw Skill/Prompt Wiring

After the agbrowse command exists, update cli-jaw source templates and browser
skills so employees know the shared flow:

```text
Korean external/current/source-sensitive search
  -> agbrowse research plan
  -> provider search with atomicQueries
  -> agbrowse fetch for URL candidates
  -> agbrowse browser commands when browseRequired or fetch is weak
```

This is the point where the earlier cli-jaw prompt patch becomes operationally
connected to agbrowse instead of remaining a general instruction.

### P3. Fetch Enrichment Loop

For each normalized search result:

1. Deduplicate URLs.
2. Run `agbrowse fetch`.
3. Extract title, readable text, metadata, tables/lists when available.
4. Update the constraint ledger.
5. Return pending constraints and weak-source reasons.

This turns snippets into ranking hints, not evidence.

### P4. Browse Escalation Controller

Escalate only with a reason:

| Reason | Trigger |
|--------|---------|
| `naver-shell-or-iframe-risk` | Naver Blog/Cafe/PostView body is not visible to fetch |
| `dynamic-page-state` | JS-rendered tabs, filters, pagination, dashboards |
| `table-list-ordinal-requires-dom` | Structured table/list/ordinal evidence missing |
| `official-page-fetch-empty` | Official/public site fetch returns empty/truncated/timeout |

The output should name the next browser action instead of silently switching
tools.

### P5. Full CLI Surface

Expose after the module contract is stable:

```bash
agbrowse research plan --query "<problem>" --json
agbrowse research normalize-results --backend tavily --file results.json --json
agbrowse research verify --plan plan.json --results results.json --json
```

Keep `research run` experimental until the fixture runner records query budget,
URLs, fetch results, browser actions, and failure categories.

## Verification Policy

Do not claim K-BrowseComp score improvement from P0/P1 alone. The measurable
claim at this stage is trajectory quality:

- focused query generated
- URL candidate retained
- original page fetch attempted or explicitly required
- constraint support/pending state visible
- browse escalation reason visible

Accuracy claims require live benchmark harness evidence and no gold-answer
leakage.
