---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, cli, schema, output]
---

# CLI Surface And Result Schema

## Command

```bash
agbrowse fetch <url> [flags]
```

Not generic search. Reads one URL using a bounded adaptive ladder.

## Flags

Existing v1 flags are preserved. v2 adds new flags alongside them.

| Flag | Values | Default | Status | Purpose |
|---|---|---|---|---|
| `--browser` | `auto\|never\|required` | `auto` | v1 | Whether to use Chrome |
| `--browser-session` | `none\|isolated\|existing\|user\|interactive` | `isolated` | v1+v2 | Cookie/session mode |
| `--identity` | `auto\|minimal\|chrome` | `auto` | NEW v2 | HTTP request identity |
| `--allow-third-party-reader` | flag | off | v1 | Third-party reader opt-in |
| `--allow-archive` | flag | off | v1 | Try cached versions |
| `--trace` | flag | off | v1 | Show attempt ladder |
| `--json` | flag | off | v1 | JSON output |
| `--selector` | CSS selector | auto | v1 | Content extraction target |
| `--max-bytes` | number | 5242880 | v1 | Max response size |
| `--timeout-ms` | number | 30000 | v1 | Per-attempt timeout |
| `--no-public-endpoints` | flag | off | v1 | Skip Phase 0 |
| `--no-browser` | alias | — | v1 | Same as `--browser never` |

### v2 Extensions to `--browser-session`

v1 values: `none`, `isolated`, `existing`
v2 adds: `user` (alias for `existing`), `interactive` (existing + human-loop)

```
--browser-session user          same as existing, reads user's cookies
--browser-session interactive   existing + pause at challenges for human
```

## Output — Human (default)

```
ok: true
verdict: strong_ok
source: browser_user
session: user
final_url: https://example.com/article
waf: cloudflare_managed_challenge
summary: Cloudflare challenge on HTTP. User's browser had clearance — read 4200 chars.
```

With `--trace`:

```
ok: true
verdict: strong_ok
source: browser_user

attempts:
  1. fetch           challenge    1.2KB  Cloudflare managed challenge
  2. public_endpoint no_match     —      no known endpoint
  3. mobile_url      challenge    1.1KB  same challenge on m.example.com
  4. browser_isolated challenge   —      CF interactive challenge
  5. browser_user    strong_ok    4.2KB  user had cf_clearance ✓

summary: Cloudflare challenge on HTTP. User's browser had clearance — read 4200 chars.
```

## Output — JSON (--json)

```json
{
  "ok": true,
  "verdict": "strong_ok",
  "source": "browser_user",
  "identity": "chrome",
  "session": "user",
  "finalUrl": "https://example.com/article",
  "title": "Article Title",
  "content": "Full readable text...",
  "contentScore": 0.91,
  "browserMode": "auto",
  "chromeUsed": true,
  "humanAction": false,
  "wafDetected": "cloudflare_managed_challenge",
  "humanActionNeeded": false,
  "summary": "...",
  "attempts": [],
  "safetyFlags": ["user_session_used", "waf_detected"]
}
```

## Verdicts

| Verdict | Meaning |
|---|---|
| `strong_ok` | Positive proof: good content, expected structure |
| `weak_ok` | Content exists but thin or uncertain |
| `challenge` | WAF/JS challenge page, no resolution available |
| `blocked` | HTTP block (403, 429, etc.) |
| `auth_required` | Login wall detected |
| `paywall` | Subscription gate detected |
| `human_resolved` | Human solved a challenge, content read |
| `browser_required` | Needs browser but browser unavailable |
| `unsupported` | Request type not supported |
| `error` | Transport or parser failure |

## Sources

| Source | Meaning |
|---|---|
| `public_endpoint` | Known API/RSS/JSON path |
| `fetch` | Standard HTTP fetch |
| `metadata` | OGP/JSON-LD/canonical only |
| `reader` | Third-party reader (Jina, etc.) |
| `archive` | Google Cache / Wayback |
| `browser_isolated` | Chrome in fresh context |
| `browser_user` | Chrome with user's session |
| `network_api` | Discovered JSON endpoint |
| `human_resolved` | Human solved challenge |

## Safety Flags

Appended to `safetyFlags` array when relevant:

```
user_session_used       user's cookies/login were part of the request
waf_detected            WAF challenge was encountered
human_action_taken      human solved a challenge
third_party_reader      content came from external reader service
archive_source          content from cached/archived version
cookie_warming_used     homepage was fetched first for cookie
network_api_discovered  API endpoint found via network inspection
```

## Help Text

```
fetch <url> [--json] [--trace] [--browser auto|never|required]
             [--browser-session fresh|isolated|user|interactive]
             [--identity auto|minimal|chrome]
             [--reader jina] [--archive]
             [--selector <css>] [--metadata-only]
             [--max-bytes N] [--timeout-ms N]

  Adaptive URL reading. Not generic web search.

  Tries public endpoints, browser-grade HTTP, reader services,
  browser render, and user session — in that order.
  Shows exactly what was tried via --trace.

  Use search tools to find URLs first. Use fetch to read them.
```
