Part of the agbrowse search skill — loaded from SKILL.md routing.

# CLI Reference

## `agbrowse search`

```bash
agbrowse search "<query>" [options]
```

The command plans focused queries, obtains URL candidates, adaptive-fetches the
original pages, updates a constraint ledger, and returns an evidence decision.

| Flag | Value | Default | Behavior |
|---|---|---|---|
| `--json` | boolean | off | Emit the `agbrowse-search-v1` JSON envelope |
| `--deep` | boolean | off | Run web-ai escalation only when the enrichment ledger is not ready |
| `--verify` | URL | none | Switch to single-URL verification mode; the positional query is ignored |
| `--stdin-results` | boolean | off | Read candidate-result JSON from stdin |
| `--browser` | `auto`, `never`, `required` | `auto` | Select adaptive-fetch browser mode; invalid search values silently become `auto` |
| `--max-results` | integer-like string | `5` | Fetch at least one candidate; invalid input falls back to `5` |
| `--vendor` | `grok`, `chatgpt`, `gemini`, `perplexity` | `grok` | Vendor passed to web-ai when `--deep` runs; other values are rejected downstream by `web-ai query` |
| `--help` | boolean | off | Print search help |

Without `--stdin-results`, search builds internal candidates from the planned
atomic queries. Each candidate is a Google search URL; this is candidate
discovery, not a promise of a separate search-provider API.

## `search --verify`

```bash
agbrowse search --verify "https://example.com/page" --json
```

Verification uses `--json`, `--browser`, and `--help`; the other parsed search
flags do not affect its single-URL execution. Browser mode defaults to `auto`,
and invalid values silently normalize to `auto`.

```json
{
  "schemaVersion": "agbrowse-search-verify-v1",
  "url": "https://example.com/page",
  "finalUrl": "https://example.com/page",
  "verdict": "strong_ok",
  "ok": true,
  "source": "fetch",
  "title": "Page title",
  "textExcerpt": "First 1200 characters of normalized content...",
  "warnings": [],
  "chromeUsed": false
}
```

`finalUrl` falls back to the input URL; `verdict` and `source` fall back to
`unknown`; `title` falls back to `null`; `warnings` falls back to `[]`.

## stdin Mode

```bash
printf '%s\n' '[{"url":"https://example.com","title":"Example","snippet":"..."}]' \
  | agbrowse search "question" --stdin-results --json
```

stdin mode accepts the same flags as normal search. Empty input, invalid JSON,
or an unsupported envelope becomes an empty normalized result set; invalid JSON
also emits a warning to stderr.

Accepted row keys:

| Field | Accepted keys |
|---|---|
| URL | `url`, `link`, `href`, `sourceUrl`, `source_url` |
| Title | `title`, `name` |
| Snippet | `snippet`, `text`, `content`, `description`, `summary` |
| Date | `date`, `publishedDate`, `published_date`, `publishedAt`, `published_at` |

Rows may be a top-level array or an array under `results`, `data`, `items`,
`web.results`, or `organic`. Only HTTP(S) URLs survive normalization; fragments
are removed, duplicates and invalid/missing URLs are recorded as dropped rows,
and snippets remain candidate diagnostics rather than final evidence.

## Deep Mode

```bash
agbrowse search "time-sensitive question" --deep --vendor grok --json
```

`--deep` does not always run. It escalates only when the enrichment summary is
not ready, and sends the unresolved constraints plus readable candidate context
to `agbrowse web-ai query --inline-only`. The search parser forwards the vendor
string without validating it, but the invoked `web-ai query` accepts only
`grok`, `chatgpt`, or `gemini` — anything else fails there.

## Search JSON Envelope

```json
{
  "schemaVersion": "agbrowse-search-v1",
  "query": "user question",
  "plan": {
    "problem": "normalized problem",
    "atomicQueries": [{ "query": "focused query" }],
    "sourceHints": ["official"],
    "constraints": [{ "id": "c1", "text": "required fact" }]
  },
  "enrichment": {
    "candidates": [{
      "rank": 1,
      "url": "https://example.com",
      "title": "Example",
      "verdict": "strong_ok",
      "ok": true,
      "source": "fetch",
      "textExcerpt": "..."
    }],
    "ledger": {
      "ready": true,
      "supported": ["c1"],
      "pending": [],
      "status": "complete"
    }
  },
  "escalation": { "needed": false },
  "deep": null,
  "evidenceStatus": "sufficient"
}
```

When browse escalation is needed, `escalation` also contains up to three
`actions`. When deep mode ran, `deep` contains `vendor`, `text`, and `error`.
Missing candidate verdict/source fields use the wrapper fallback `unknown`.

## Evidence Decisions

| `evidenceStatus` | Exact condition | Agent action |
|---|---|---|
| `sufficient` | `enrichment.summary.ready` is true | Answer from fetched evidence |
| `partial` | The ledger is not ready, but deep escalation returned non-empty text | Use deep text with explicit caveats; constraints are still not fully proven |
| `browse-needed` | The ledger is not ready, deep returned no text, and browse planning says browser work is needed | Execute or hand off the proposed browser actions |
| `insufficient` | None of the preceding conditions holds | Find better candidates or use justified deep escalation |

The ledger summary status vocabulary is exactly `complete` or
`insufficient-evidence`; `ready` is true only when no mandatory constraints are
pending.

## Agent Integration

```text
agent native search
        |
        v
URL candidates + snippets
        |
        v
agbrowse search "<query>" --stdin-results --json
        |
        v
evidenceStatus
  sufficient     -> answer from original-page evidence
  partial        -> answer only with unresolved constraints disclosed
  browse-needed  -> run the browser actions / verify dynamic pages
  insufficient   -> improve candidates or invoke justified --deep
```

## Research Subcommands

| Command | Purpose |
|---|---|
| `agbrowse research plan --query <problem>` | Rewrite a research problem into constraints, focused queries, and fetch/browse policy |
| `agbrowse research normalize-results --file <json>` | Normalize external result rows into URL candidates; optional `--backend` labels provenance only |
| `agbrowse research enrich-fetch --plan <json> --results <json>` | Fetch original pages and update the constraint ledger; browser default is `never` |
| `agbrowse research browse-plan --plan <json> --enrichment <json>` | Produce explicit browser actions for candidates fetch could not fully verify |

## Routing: `agbrowse extract`

When the user wants structured data pulled from a known URL -- pricing tables,
spec lists, JSON-LD, or other embedded structures -- use `agbrowse extract`
instead of `agbrowse search` or `agbrowse fetch`.

| User intent | Route |
|---|---|
| "extract the pricing table from this page" | `agbrowse extract <url> --schema pricing.json` |
| "표로 뽑아줘", "데이터 추출해줘" | `agbrowse extract <url> --schema <file.json>` |
| "get structured JSON from this page" | `agbrowse extract <url> --schema <file.json> --json` |
| General question or fact lookup | `agbrowse search` |
| Single-URL readability check | `agbrowse search --verify <url>` |

```bash
# Tier 1: LLM-free and fail-closed
agbrowse extract "https://example.com/pricing" --schema ./pricing-schema.json --json

# From local HTML
agbrowse extract --from-file ./page.html --schema ./schema.json --json

# Tier 2: opt-in web-ai fallback after Tier 1 failure
agbrowse extract "https://example.com/pricing" --schema ./pricing-schema.json \
  --escalate-web-ai --vendor grok --json
```

Tier 1 fetches HTML, considers tables and JSON-LD, maps candidates to the caller's
schema, and fails closed when required properties cannot be satisfied.
`--escalate-web-ai` opts into a logged-in web-ai session only after Tier 1 fails.
