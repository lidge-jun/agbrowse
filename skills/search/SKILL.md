---
name: search
description: >-
  Standalone deep search for any CLI agent. Fetches and verifies original pages,
  scores evidence against constraints, and optionally escalates to web-ai deep
  research. Zero server dependency — just Node.js + Chrome.
  Triggers: search, 검색, web search, deep search, verify URL, evidence check,
  agbrowse search, 웹검색, 딥서치, URL 검증
---

# Search

Use `agbrowse search` as a deep search layer alongside your CLI's built-in web
search. It fetches original pages, scores evidence quality, and tells you
whether to trust the results or dig deeper.

## When to Use

| Your built-in search… | Use agbrowse search |
|---|---|
| Returns snippets only | `--stdin-results` → fetches original pages |
| Can't reach a URL (403/JS/WAF) | `--verify <url>` → adaptive-fetch ladder |
| Results are thin or uncertain | `--deep` → escalates to web-ai |
| Korean source needs DOM/Naver | auto browser escalation |

## Prerequisites

- Node.js 18+
- `npm i -g agbrowse` (or local install)
- Chrome installed (only needed when `--browser auto` triggers escalation)

## Quick Start

```bash
# Direct search — query rewrite + fetch + evidence score
agbrowse search "Next.js 15 app router migration" --json

# Verify a single URL
agbrowse search --verify "https://nextjs.org/docs/app" --json

# Pipe your built-in search results for deep verification
echo '[{"url":"https://...","title":"...","snippet":"..."}]' \
  | agbrowse search "query" --stdin-results --json

# Deep research escalation (uses web-ai when evidence is insufficient)
agbrowse search "서울시 2026 청년 지원금 공고" --deep --vendor grok --json
```

## Integration Pattern

The primary integration point for any CLI agent:

```
┌─────────────────────────────────────┐
│  Your CLI Agent                      │
│  (cursor, claude, codex, agy, etc.) │
│                                      │
│  1. Built-in web search (fast/free)  │
│     → URL candidates + snippets      │
│                                      │
│  2. Need verification?               │
│     pipe results to agbrowse:        │
│                                      │
│     agbrowse search "<query>"        │
│       --stdin-results --json         │
│                                      │
│  3. Read evidenceStatus:             │
│     sufficient → trust it            │
│     partial → usable with caveats    │
│     browse-needed → open in browser  │
│     insufficient → try --deep        │
└─────────────────────────────────────┘
```

## Commands

### `agbrowse search "<query>" [options]`

Full pipeline: query rewrite → candidate discovery → adaptive-fetch → evidence
scoring → output.

**Options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Machine-readable JSON output | text |
| `--deep` | Escalate to web-ai if evidence insufficient | off |
| `--stdin-results` | Read results from stdin instead of internal discovery | off |
| `--browser <mode>` | `auto` / `never` / `required` | `auto` |
| `--max-results <n>` | Max URLs to fetch-enrich | 5 |
| `--vendor <name>` | Web-ai vendor for `--deep` (`grok`/`chatgpt`/`gemini`) | `grok` |

### `agbrowse search --verify <url> [options]`

Skip query rewrite; run the full adaptive-fetch ladder on one URL and return
a verdict.

**Output (JSON):**
```json
{
  "schemaVersion": "agbrowse-search-verify-v1",
  "url": "https://...",
  "finalUrl": "https://...",
  "verdict": "strong_ok",
  "ok": true,
  "source": "fetch",
  "title": "Page Title",
  "textExcerpt": "First 1200 chars of page content...",
  "chromeUsed": false
}
```

## Evidence Status

Every search result includes an `evidenceStatus` field:

| Status | Meaning | Agent action |
|--------|---------|--------------|
| `sufficient` | Original page fetched and supports all constraints | Trust the answer |
| `partial` | Some constraints confirmed, others still pending | Use with caveats |
| `browse-needed` | URL exists but needs browser render (JS/WAF/Naver) | Run `agbrowse` in browser mode or open manually |
| `insufficient` | No credible evidence obtained | Try `--deep` or different query |

## JSON Output Schema

```json
{
  "schemaVersion": "agbrowse-search-v1",
  "query": "user's question",
  "plan": {
    "problem": "normalized query",
    "atomicQueries": [{ "query": "focused keywords" }],
    "sourceHints": ["official", "date"],
    "constraints": [{ "id": "c1", "text": "constraint description" }]
  },
  "enrichment": {
    "candidates": [{
      "rank": 1,
      "url": "https://...",
      "title": "Page Title",
      "verdict": "strong_ok",
      "ok": true,
      "textExcerpt": "..."
    }],
    "ledger": { "ready": true, "supported": ["c1"], "pending": [] }
  },
  "escalation": { "needed": false },
  "deep": null,
  "evidenceStatus": "sufficient"
}
```

## stdin-results Format

Pipe any JSON that has result objects with `url` fields. The normalizer handles
many common shapes:

```json
[
  { "url": "https://...", "title": "...", "snippet": "..." },
  { "link": "https://...", "name": "...", "text": "..." }
]
```

Or wrapped objects: `{ "results": [...] }`, `{ "data": [...] }`,
`{ "web": { "results": [...] } }`.

## Rules for Agents Using This Skill

1. **Built-in search first.** Always try your native web search before
   agbrowse. Agbrowse verifies and deepens — it doesn't replace fast lookups.

2. **Snippets are not evidence.** If your built-in search only returns
   snippets, pipe them through `--stdin-results` to fetch originals.

3. **Trust evidenceStatus.** Don't claim "verified" unless the status says
   `sufficient`.

4. **`--deep` is slow and costly.** Only use when `evidenceStatus` is
   `insufficient` and the question genuinely needs synthesis.

5. **`--verify` for single URLs.** When you already have a candidate URL from
   your search results but need to confirm it's readable and relevant.

6. **No server dependency.** This runs as a single process. Chrome auto-starts
   only when adaptive-fetch decides it needs browser rendering.
