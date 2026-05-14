---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, safety, risk]
---

# Safety And Risk

## Risk Matrix

| Risk | Why It Matters | Mitigation |
| --- | --- | --- |
| Overclaiming "bypass anything" | Creates unsafe expectations and support burden. | Describe as adaptive fetch/research with maximum public/non-browser attempt coverage. |
| Silent dependency installs | Mutates user machines and conflicts with fail-fast policy. | Use doctor output and explicit install instructions only. |
| CAPTCHA or anti-abuse circumvention | Crosses a hard action boundary for responsible tool behavior. | Do not solve/click-through/stealth/use private credentials; still try every public endpoint/RSS/metadata/non-browser/isolated-browser/network-candidate path first. |
| Paywall/login-wall extraction | Can violate access controls or terms. | Stop unless the user explicitly owns an authenticated browser session and asks for visible-page summarization. |
| Site-specific hardcoding | Becomes brittle and encourages scraping-by-exception. | Port upstream's no-site-name lint idea. |
| High-volume probing | Can look abusive and degrade target services. | Bound attempts, jitter if needed, and require user confirmation for repeated collection. |
| Python sidecar complexity | Adds packaging, pip, venv, and cross-platform failure modes. | Prefer TypeScript v1; optional sidecar only after review. |
| Browser profile leakage | Browser escalation may use user cookies. | Make browser use explicit; show source as `browser`; redact traces; avoid dumping cookies/headers. |
| Network trace leakage | Network requests can contain tokens or signed URLs. | Redact query params and headers in trace output. |
| Archive/cache staleness | Archived pages may be old or wrong. | Mark archive results as low-trust with timestamp. |
| Legal/ToS ambiguity | Some sites prohibit automated access. | Favor official APIs/RSS/metadata, limit bulk behavior, and expose warnings. |

## Default Safety Policy

Allowed by default:

- official/public APIs;
- RSS/Atom;
- normal HTTP fetch;
- Jina Reader for readable public pages;
- OGP/JSON-LD metadata extraction;
- existing CDP browser render for pages the user can normally view;
- network inspection for discovering public JSON endpoints, with redaction.

Ask or require explicit opt-in:

- archive/cache fallback;
- repeated pagination/collection;
- optional external tools such as `yt-dlp`;
- authenticated browser-session reading.

Out of scope actions:

- challenge solving;
- crossing login/paywall access;
- credential harvesting;
- stealth or hosted browser claims;
- unrestricted scraping.

Allowed boundary-safe attempts:

- public endpoint reads;
- RSS/Atom reads;
- metadata/canonical reads;
- non-browser fetches that do not use private credentials;
- isolated browser reads that do not use private credentials;
- trace-only network candidate reporting without repeated collection.

## Product Wording

Use:

- "adaptive fetch"
- "resilient web research"
- "public endpoint routing"
- "browser-assisted read"
- "traceable fetch attempts"

Avoid:

- "unblock everything"
- "bypass WAF"
- "defeat CAPTCHA"
- "scrape any site"
- "stealth browser"

## Fail-Fast Alignment

The project rules say failed tools must not silently fall back. The adaptive
fetch scheduler can still have phases, but each phase must be part of the
declared algorithm and visible in the trace. That means:

- no hidden retry chains;
- no invisible dependency install;
- no unreported switch from public fetch to browser cookies;
- no "success" without a verdict and reasons.
