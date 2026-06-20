---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, safety]
---

# Safety Model (Revised)

## The Line

```
Automated bypass   →  tool autonomously circumvents access control       →  No
Human assistance   →  tool helps human read pages they have access to    →  Yes
```

## What The Tool Does

Everything a human does in Chrome, automated for efficiency:

| Action | Why it's normal |
|---|---|
| Send browser-standard HTTP headers | Chrome sends the same headers |
| Follow redirects and handle cookies (fresh jar) | Every browser does this |
| Render JavaScript pages | Chrome does this |
| Use user's browser session (explicit opt-in) | User clicking the URL themselves |
| Present challenges to human for resolution | User would solve it manually anyway |
| Read page content after human acts | User would read it themselves |
| Inspect network requests | User opening DevTools Network tab |
| Try mobile URL variants | User switching to mobile view |
| Fetch homepage before article (cookie warming) | User navigating from homepage |

## What The Tool Does Not Do

Things that require third-party services or autonomous circumvention:

| Action | Why it's out of scope |
|---|---|
| Automated CAPTCHA solving (solver services, ML/OCR) | No human supervision |
| Credential brute force or stuffing | Malicious access |
| Stealth / anti-detection libraries | Deceptive intent |
| Silent dependency installation | Violates fail-fast policy |
| Site-specific engine branches (hostname checks) | Brittle, scraping-by-exception |
| Bulk scraping without rate limits | Abuse |
| Exporting/injecting cookies between contexts | Cookie theft |
| Sending user's cookies to third-party reader | Privacy violation |

## Session Safety

| Session mode | What it does | Risk | Mitigation |
|---|---|---|---|
| `fresh` | New cookie jar, discarded after | None | Default for HTTP phases |
| `isolated` | Fresh Chrome profile, no cookies | Minimal | Default for browser phases |
| `user` | User's existing Chrome session | User's cookies sent to target | Explicit opt-in only, visible in trace |
| `interactive` | User session + human resolution | Same as user + human time | Explicit opt-in, challenge messages |

`user` and `interactive` require explicit flags. Never silent default.

## SSRF Defense

v1 baseline (already implemented):

- Scheme allowlist: `http`, `https` only
- Reject credentials in URL (`user:pass@host`)
- Reject localhost, private ranges, link-local addresses by default
- Re-check redirect targets via `validateFetchUrl` (no redirect to private)

NEW in v2 (not yet implemented):

- DNS rebinding guard: resolve hostname, reject if resolved IP is private
- Re-check resolved IP after DNS before connecting
- Max redirect depth enforcement (currently unbounded in fetcher)

## Trace Redaction

- Query parameters with auth-like keys: redacted
- Cookie values: redacted (names shown, values masked)
- Authorization headers: redacted
- API keys in URLs: redacted
- User session details: session mode shown, cookie contents never logged

## Rate Limiting

- Max 4 URL transform variants per fetch
- Max 1 cookie warming request per fetch
- Reader service: 1 request per fetch (opt-in only)
- Network API candidates: read-only, no replay
- No bulk/pagination mode in v2 (deferred)

## Product Wording

Use in docs, help, and skill:

```
adaptive fetch
resilient URL reading
browser-assisted reading
human-supervised web research
traceable fetch attempts
```

Do not use:

```
unblock anything
bypass WAF
defeat CAPTCHA
scrape any site
stealth browser
anti-detection
```

## vs v1 Safety

| v1 said | v2 says | Why |
|---|---|---|
| "No TLS impersonation" | "Browser-grade headers are default" | Conformance, not impersonation |
| "Never use existing cookies" | "User session is explicit opt-in" | User owns their session |
| "Stop at CAPTCHA" | "Human solves, tool reads" | Human supervision |
| "Stop at login" | "User's authenticated session" | User has access |
| "No challenge response" | "Try all paths, then human acts" | Maximum legitimate coverage |
