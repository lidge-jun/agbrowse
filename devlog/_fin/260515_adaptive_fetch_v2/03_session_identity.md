---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, session, identity]
---

# Session And Identity

## Session Modes

```
--browser-session fresh         fresh cookie jar, no user data (default for HTTP phases)
--browser-session isolated      fresh Chrome profile, no cookies (default for browser phases)
--browser-session user          user's existing Chrome profile and cookies
--browser-session interactive   like user, but pause at challenges for human action
```

### Default Behavior

```
Phase 0-2: always fresh (no browser involved)
Phase 3:   isolated (fresh Chrome context)
Phase 4:   user (explicit opt-in)
Phase 5:   interactive (human acts)
```

When `--browser-session` is not specified, the scheduler uses `fresh` for HTTP and
`isolated` for browser. It never silently uses the user's session.

### Session Escalation (--browser-session auto behavior within --browser auto)

When Phase 3 isolated browser hits a challenge:

```
if options.browserSession === 'user':
  → use user session directly
elif options.browserSession === 'interactive':
  → use user session, pause at challenges for human
elif challenge detected and user session available:
  → prompt: "Challenge detected. Use your browser session? [y/N]"
  → if yes: Phase 4
  → if no: return challenge verdict
```

The prompt is the key UX boundary. The tool asks, the human decides.

### Session Visibility

Every result shows which session was used:

```json
{
  "session": "user",
  "safetyFlags": ["user_session_used"]
}
```

This is never hidden. Agents and humans always know when the user's
cookies/login state were part of the request.

## Request Identity

### The Problem

Node.js `fetch()` sends headers that look like a bot:

```
User-Agent: node-fetch/1.0
Accept: */*
(no Sec-Fetch-*, no Accept-Language, no Accept-Encoding)
```

WAFs block this. Not because the request is malicious — because it doesn't
conform to browser standards.

### Solution: Browser-Grade Headers (Default)

```
--identity auto      browser-standard headers (default)
--identity minimal   bare HTTP, no browser signals
--identity chrome    match Chrome's exact header set
```

`auto` sends what Chrome would send:

```
User-Agent:      Mozilla/5.0 (Macintosh; ...) Chrome/13x.0.0.0 Safari/537.36
Accept:          text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language: en-US,en;q=0.9
Accept-Encoding: gzip, deflate, br
Sec-Fetch-Dest:  document
Sec-Fetch-Mode:  navigate
Sec-Fetch-Site:  none
Sec-Fetch-User:  ?1
```

This is what the user's Chrome sends when they click a link.

### Why curl_cffi Is Not Needed

insane-search uses `curl_cffi` to fake Chrome's TLS fingerprint because it
doesn't have a real Chrome browser.

agbrowse has a real Chrome browser via CDP. When Phase 3+ uses Chrome, the TLS
fingerprint IS Chrome's — because it IS Chrome.

For Phase 1 HTTP-only, browser-standard headers are sufficient for most sites.
For sites that fingerprint TLS specifically, the natural escalation is Phase 3
(real Chrome) — not a TLS spoofing library.

```
insane-search:  Python fetch → curl_cffi (fake TLS) → Playwright MCP
agbrowse v2:    Node fetch (browser headers) → Real Chrome via CDP

We skip the fake because we have the real thing.
```

### Cookie Warming

One borrowed insane-search pattern: for sites where the article page checks for
a prior homepage visit cookie, fetch the homepage first.

```
1. GET homepage → receive Set-Cookie
2. GET article with that cookie

Bounded to exactly 1 warmup request. Visible in trace.
Not the user's cookies — a fresh session cookie from the homepage.
```

This is what happens when a human navigates from the homepage to an article.
