---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-07, cli, docs, gates]
---

# Phase 07 — CLI Wiring, Docs, Structure, Release Gates

## Goal

Full CLI integration, help text, skill documentation, structure doc updates,
and release gate verification.

## Modified Files

```
skills/browser/browser.mjs
skills/browser/SKILL.md
README.md
structure/commands.md
structure/CAPABILITY_TRUTH_TABLE.md
structure/str_func.md
```

## Diff Shape

### browser.mjs (finalize)

Finalize the `fetch` subcommand wiring:

```js
case 'fetch': {
  const { runAdaptiveFetchCli } = await import('./adaptive-fetch/index.mjs');
  return runAdaptiveFetchCli(args.slice(1));
}
```

Help text addition:

```js
'fetch <url> [--json] [--trace] [--browser auto|never|required]',
'            [--browser-session fresh|isolated|user|interactive]',
'            [--identity auto|minimal|chrome]',
'            [--reader jina] [--archive]',
'            [--selector <css>] [--metadata-only]',
'  Adaptive URL reading with 6-phase escalation ladder.',
'  Not generic web search — use search tools to find URLs first.',
```

### SKILL.md

Add to browser skill documentation:

```markdown
## fetch — Adaptive URL Reading

Read one URL using a bounded adaptive ladder. Not generic search.

### When To Use
- Reading a search result URL that returned empty/weak content
- Reading a page behind a JS framework (SPA)
- Reading a page that returned a challenge/block on direct fetch
- Extracting clean text from a complex page
- Discovering API endpoints behind a web page

### When NOT To Use
- Searching for information (use search tools first)
- Bulk scraping multiple pages
- Automated CAPTCHA solving

### Escalation Ladder
1. Public endpoints (GitHub API, Reddit JSON, RSS, etc.)
2. Browser-grade HTTP with URL transforms
3. Reader services (Jina, archive — opt-in)
4. Isolated Chrome render + network API discovery
5. User's authenticated browser session (explicit opt-in)
6. Human-in-the-loop challenge resolution (interactive mode)

### Key Flags
- `--browser never` — no Chrome, HTTP only
- `--browser-session user` — use your logged-in browser session
- `--browser-session interactive` — human-in-the-loop for challenges
- `--trace` — show all attempts and scoring
```

### README.md

Add to command list:

```markdown
| `fetch <url>` | Adaptive URL reading | HTTP + browser | One URL, bounded ladder |
```

### structure/commands.md

Add entry for `fetch`:

```markdown
## fetch

Adaptive URL reading with 6-phase escalation.
Not generic search — reads one URL.

Flags: --browser, --browser-session, --identity, --allow-third-party-reader,
       --allow-archive, --trace, --json, --selector, --max-bytes, --timeout-ms

Phases: public endpoints → browser-grade HTTP → readers → isolated browser →
        user session → human resolution
```

### structure/CAPABILITY_TRUTH_TABLE.md

Add row:

```markdown
| fetch | read URL | auto/never/required | fresh/isolated/user/interactive | Phase 0-5 ladder |
```

### structure/str_func.md

Add function entries for all new modules under `skills/browser/adaptive-fetch/`.

## Skill Routing Updates

Trigger patterns that should route to `agbrowse fetch`:

```
URL reading, blocked fetch, empty page, weak content, 403, 402,
"this URL returned nothing", "can't read this page",
"SPA shell", "JavaScript required", search result URL analysis
```

Trigger patterns that should NOT route to `agbrowse fetch`:

```
generic "search for X", "find information about X",
"look up X", broad research questions without a URL
```

### Search Keyword Consolidation

```
Broad search words → native search tool first
URL/result/source/citation → agbrowse fetch after URL exists
Blocked/empty/403/challenge → agbrowse fetch with --trace
```

## Tests

- help text includes all flags
- help text describes the ladder
- `agbrowse fetch --help` exits cleanly
- structure doc drift checks pass
- doc count checks pass

## Release Gates

```bash
npm run typecheck
npm test
bash structure/check-doc-drift.sh
bash structure/verify-counts.sh
git diff --check HEAD
```

## Mirror Readiness

After all phases pass, cli-jaw can mirror as:

```bash
cli-jaw browser fetch <url>
```

Mirror options:
1. Wrap `agbrowse fetch` via subprocess (fastest)
2. Port `.mjs` modules into cli-jaw browser package (full ownership)

Recommended: option 1 first, option 2 when cli-jaw needs independent evolution.
