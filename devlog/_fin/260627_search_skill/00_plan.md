# agbrowse search — Standalone Search Skill

## Objective

Add a standalone `agbrowse search` command that any CLI agent can use as a deep
search layer alongside its own built-in web search. Zero server dependency,
zero cli-jaw dependency. Just `npm i -g agbrowse` and go.

## Architecture

```
agbrowse search "<query>" [--deep] [--verify <url>] [--json] [--browser auto|never]
         │
         ├─ Query Rewrite (search-strategy.mjs — already exists)
         │   → atomic queries, constraints, source hints
         │
         ├─ Candidate Discovery (endpoint-resolvers + optional external results stdin)
         │   → normalized search result URLs
         │
         ├─ Adaptive Fetch (adaptive-fetch/index.mjs — already exists)
         │   → page content, evidence, verdict per URL
         │
         ├─ Evidence Scoring (constraint-ledger.mjs — already exists)
         │   → supported/pending/weak matrix
         │
         ├─ [--deep] Web AI Escalation (web-ai/ — already exists)
         │   → GPT/Grok/Gemini deep research
         │
         └─ Output: JSON envelope or human-readable summary
```

## Work Phases (5 PABCD cycles)

### Cycle 1: Core `agbrowse search` command (P→A→B→C→D)

**NEW** `skills/browser/search.mjs` — the search orchestrator module
- Imports: search-strategy, normalizer, fetch-enrichment, browse-escalation, adaptive-fetch
- Pipeline: query → plan → (stdin results OR internal discovery) → fetch enrichment → score → output
- Accepts `--query`, `--json`, `--browser`, `--max-results`, `--stdin-results` flags

**MODIFY** `skills/browser/browser.mjs` — add `search` case to command router
- `case 'search': { await runSearchCli(process.argv.slice(3)); break; }`

### Cycle 2: `--verify <url>` mode

**MODIFY** `skills/browser/search.mjs`
- `--verify <url>` bypasses query rewrite; runs adaptive-fetch on the single URL
- Returns verdict + evidence + content excerpt

### Cycle 3: `--deep` Web AI escalation

**MODIFY** `skills/browser/search.mjs`
- When `--deep` flag is present AND constraint ledger is not ready:
  - Format remaining questions as a web-ai prompt
  - Call web-ai query (auto-start headed Chrome if needed)
  - Merge web-ai response into evidence

### Cycle 4: `skills/search/SKILL.md` — standalone skill document

**NEW** `skills/search/SKILL.md`
- Describes `agbrowse search` for any CLI agent (cursor, claude, codex, agy)
- Routing guidance: when to use built-in search vs agbrowse search
- Command reference with examples
- Evidence status definitions (sufficient, partial, browse-needed, insufficient)
- No cli-jaw dependency mentioned

### Cycle 5: Tests + Documentation

**NEW** `tests/search.test.mjs` — integration tests
- Query rewrite → fetch → verdict pipeline
- `--verify` mode
- `--deep` mode (mocked web-ai)
- `--stdin-results` piping

**MODIFY** `README.md` — add search section to feature list

## File Map Summary

| Action | Path | Cycle |
|--------|------|-------|
| NEW | `skills/browser/search.mjs` | 1 |
| MODIFY | `skills/browser/browser.mjs` | 1 |
| MODIFY | `skills/browser/search.mjs` | 2, 3 |
| NEW | `skills/search/SKILL.md` | 4 |
| NEW | `tests/search.test.mjs` | 5 |
| MODIFY | `README.md` | 5 |

## Key Design Decisions

1. **stdin-results pattern**: The agent's built-in web search produces results;
   pipe them into `agbrowse search --stdin-results` to skip internal discovery
   and jump straight to fetch-enrichment. This is the primary integration point.

2. **No server dependency**: Everything runs as a single Node.js process. Chrome
   is only started if `--browser auto` triggers browser escalation.

3. **Existing modules reused**: All core logic (search-strategy, normalizer,
   fetch-enrichment, browse-escalation, constraint-ledger, adaptive-fetch)
   already exists. The `search.mjs` is a thin orchestrator wiring them together.

4. **Evidence-first output**: The JSON output always includes evidence status per
   claim/constraint, making it easy for the calling agent to decide whether to
   trust the result or escalate further.
