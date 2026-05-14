---
created: 2026-05-14
status: planning
tags: [jawdev, agbrowse, adaptive-fetch, surface-design, chrome-boundary]
---

# Surface Design And Chrome Boundaries

## Core Split

Adaptive fetch has two different surfaces inside one command:

```text
non-Chrome reader core -> URL validation, native fetch, public endpoints, metadata, text extraction
Chrome escalation      -> render page, collect visible text, inspect network JSON candidates
```

That split must be visible in the CLI contract. Otherwise users will not know
whether a command is a cheap URL read or a browser session mutation.

## Recommended Command

Primary command:

```bash
agbrowse fetch "<url>"
```

Default behavior:

```text
--browser auto
```

Meaning:

1. run the non-Chrome reader core first;
2. classify the result;
3. use Chrome only when the previous layers are weak, blocked, or empty;
4. return a trace showing whether Chrome was used.

## Browser Mode Flag

Use one explicit flag instead of many ambiguous toggles:

```bash
agbrowse fetch "<url>" --browser auto
agbrowse fetch "<url>" --browser never
agbrowse fetch "<url>" --browser required
agbrowse fetch "<url>" --browser auto --browser-session isolated
```

Semantics:

| Mode | Chrome behavior | Use case |
| --- | --- | --- |
| `auto` | Use Chrome only after weak non-Chrome reads | Default search-tool helper |
| `never` | Never start or attach to Chrome | CI, fast source checks, no side effects |
| `required` | Go straight to Chrome render after URL validation | User explicitly wants rendered page truth |

Compatibility alias:

```bash
agbrowse fetch "<url>" --no-browser
```

maps to:

```text
--browser never
```

## Browser Session Flag

Chrome rendering and cookie/profile usage are separate decisions.

```bash
agbrowse fetch "<url>" --browser auto --browser-session none
agbrowse fetch "<url>" --browser auto --browser-session isolated
agbrowse fetch "<url>" --browser auto --browser-session existing
```

Semantics:

| Mode | Cookie/profile behavior | Default candidate |
| --- | --- | --- |
| `none` | Do not render with Chrome; return `browser_required` if rendering is needed | safest non-browser default |
| `isolated` | Use an isolated temporary browser context/profile | safest render default |
| `existing` | Use the current persistent agbrowse Chrome profile | explicit opt-in only |

`existing` can send user cookies and logged-in state to the target URL. It must
never be the silent default for adaptive fetch.

## Non-Chrome Responsibilities

These do not require a running browser:

- validate URL and reject search queries;
- enforce timeout and max bytes;
- fetch HTML, JSON, XML, and text;
- discover RSS/Atom and canonical/metadata links;
- resolve a small allowlisted set of public endpoints;
- strip unsafe/binary content;
- classify empty/weak/challenge-ish responses;
- emit trace attempts.

This layer can run in headless CI and should be the first implementation slice.

## Chrome Responsibilities

These require browser/CDP:

- render JavaScript-heavy pages;
- read visible DOM text after hydration;
- collect title, metadata, and selected DOM text;
- inspect network requests for same-page JSON candidates;
- identify login, CAPTCHA, paywall, or challenge boundaries;
- reuse existing agbrowse browser lifecycle where possible.

Chrome escalation should be observable:

```json
{
  "browserMode": "auto",
  "chromeUsed": true,
  "chromeReason": "native fetch produced an empty SPA shell"
}
```

## Command Surface Matrix

| Command | Requires Chrome? | Mutates browser tab? | Purpose |
| --- | --- | --- | --- |
| `agbrowse fetch <url>` | Sometimes (`--browser auto`) | Only when escalated | Read and validate one URL |
| `agbrowse fetch <url> --browser never` | No | No | Pure URL-reader mode |
| `agbrowse fetch <url> --browser required` | Yes | Yes | Rendered-page truth |
| `agbrowse network` | Yes | Reads current/reloaded page network | Inspect current browser page |
| `agbrowse text` | Yes | Reads current page | Extract current page text |
| `agbrowse get-dom` | Yes | Reads current page DOM | Inspect current DOM |
| `agbrowse snapshot` | Yes | Reads current page accessibility tree | Act on browser refs |
| `agbrowse web-ai ...` | Yes | Uses provider tabs | AI provider automation |

## Output Contract

JSON output should include the boundary explicitly:

```json
{
  "ok": true,
  "verdict": "strong_ok",
  "source": "browser",
  "finalUrl": "https://example.com/article",
  "browserMode": "auto",
  "browserSession": "isolated",
  "chromeUsed": true,
  "chromeRequired": false,
  "chromeReason": "native fetch produced weak content",
  "attempts": []
}
```

When Chrome is needed but unavailable:

```json
{
  "ok": false,
  "verdict": "browser_required",
  "source": "fetch",
  "browserMode": "auto",
  "chromeUsed": false,
  "chromeRequired": true,
  "summary": "The non-Chrome reader found an empty SPA shell; Chrome render is needed."
}
```

## Human Output

Default human output should be short:

```text
ok: true
verdict: strong_ok
source: browser
browser: auto, used
final_url: https://example.com/article
summary: Browser render produced readable text after native fetch was weak.
```

With `--trace`, print the ladder:

```text
attempts:
  1. fetch          weak_ok      empty SPA shell
  2. metadata       weak_ok      title only
  3. browser        strong_ok    readable visible text
```

## Help Text

Planned help line:

```text
fetch <url> [--json] [--trace] [--browser auto|never|required] [--max-bytes N] [--timeout-ms N]
  Read one URL with a bounded adaptive ladder. Not generic search.
```

Short warning under the command:

```text
Use search tools to find candidate URLs first. Use fetch to read candidate URLs.
Try public endpoint, RSS, metadata, non-browser, isolated browser, and network
candidate paths before returning a boundary verdict.
```

Boundary note:

```text
CAPTCHA/challenge markers are not an early stop. They trigger maximum safe
attempt coverage across public endpoint, RSS, metadata, non-browser fetch,
isolated browser render, and network candidates. Return a boundary verdict only
when the remaining route requires solving, clicking through, stealthing, or
using private credentials.
```

## Why This Surface Works

- Users can run a cheap URL check without Chrome using `--browser never`.
- Agents can use the default safely as a search-result helper.
- Browser mutation is not hidden because the result says whether Chrome was used.
- Cookie/profile risk is not hidden because the result says which browser
  session mode was used.
- Existing browser commands keep their current meaning.
- cli-jaw can mirror the same contract later as `cli-jaw browser fetch`.
