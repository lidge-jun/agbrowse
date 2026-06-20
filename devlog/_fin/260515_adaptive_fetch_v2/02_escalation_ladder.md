---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, architecture, escalation]
---

# Escalation Ladder

## Overview

Six phases, ordered by cost and intrusiveness. Each phase produces candidates
that feed into the content scorer. The scheduler moves forward only when prior
phases are weak, empty, or blocked.

```
Phase 0  Public Endpoints       free, no browser, API/RSS/JSON
Phase 1  Browser-Grade HTTP     cheap, no browser, real headers
Phase 2  Reader Services        opt-in, third-party public readers
Phase 3  Isolated Browser       Chrome in fresh context, no cookies
Phase 4  User's Browser         user's session, explicit opt-in
Phase 5  Human Resolution       human solves challenge, tool reads
```

## Phase 0 — Public Endpoints

Route known platforms to official/public APIs first.

```
GitHub      → REST API, raw file content
Reddit      → .json suffix
Hacker News → Firebase/Algolia API
arXiv       → export API, Atom feed
Wikipedia   → REST page summary
npm         → registry JSON
PyPI        → JSON API
RSS/Atom    → autodiscovery from HTML or known feed paths
```

Cost: one HTTP request to a known stable endpoint.
No browser, no cookies, no side effects.

## Phase 1 — Browser-Grade HTTP

Standard HTTP fetch with browser-conformant headers:

```
User-Agent:      Chrome/latest on matching OS
Accept:          text/html,application/xhtml+xml,...
Accept-Language: en-US,en;q=0.9 (or user locale)
Accept-Encoding: gzip, deflate, br
Sec-Fetch-Dest:  document
Sec-Fetch-Mode:  navigate
Sec-Fetch-Site:  none
Sec-Fetch-User:  ?1
```

Fresh cookie jar per fetch (not the user's cookies).
URL transforms: mobile subdomain, drop-www, canonical.
Max 4 URL variants. All visible in trace.

Validates response body, not just status code.

## Phase 2 — Reader Services (opt-in only)

Third-party public readers behind explicit flags:

```
--reader jina       Jina Reader for clean markdown
--archive           Google Cache, Wayback Machine
```

Never default. Never sent private/credential/local URLs.
Source labeled `reader` or `archive` in trace.

## Phase 3 — Isolated Browser Render

Headless Chrome via existing CDP runtime. Fresh context — no cookies, no
history, no login state.

```
1. Create isolated browser context
2. Navigate to URL
3. Wait for hydration/JS execution
4. Extract: visible text, title, metadata, selected DOM
5. Inspect network: XHR/fetch requests → public JSON candidates
6. Score candidates against non-browser results
7. Destroy context
```

Handles SPA shells, JavaScript-rendered content, lazy-loaded pages.
Some WAF JS challenges resolve automatically in a real browser context.

## Phase 4 — User's Browser Session

Uses the browser the human already has open. Explicit opt-in only.

```
Trigger: --browser-session user, or interactive prompt after Phase 3 challenge
Action:  connect to user's CDP browser, navigate in user's context
Result:  reads what the user would see (their cookies, their logins)
Trace:   source=browser_user, session=user, safetyFlags=[user_session_used]
```

This is NOT:
- Exporting cookies to a different client
- Injecting credentials
- Sending cookies to a third party

It is: reading the page in the user's own browser — identical to the user
clicking the URL themselves.

## Phase 5 — Human-in-the-Loop Resolution

When Phases 0-4 all hit a challenge that requires human action:

```
1. Detect challenge type (CAPTCHA, login, paywall, interactive verification)
2. Present to human:
   "CAPTCHA detected at [url]. Solve it in your browser, then press Enter."
   "Login required at [url]. Log in, then press Enter."
3. Wait for human action
4. Read the resulting page from user's browser
5. Record source=human_resolved in trace
```

The tool never:
- Sends to a CAPTCHA-solving service
- Uses ML/OCR to solve challenges
- Clicks through verification flows
- Auto-submits credentials

The human does exactly what they'd do manually. The tool reads the result.

## Example Flow

```
agbrowse fetch "https://protected-site.com/article"

Phase 0: no public endpoint match                    [skip]
Phase 1: fetch → 200, 1.2KB Cloudflare challenge     [challenge]
Phase 1: mobile URL → same challenge                  [challenge]
Phase 3: isolated browser → CF interactive challenge  [challenge]
Phase 4: user's browser → user has cf_clearance       [strong_ok ✓]

Result: ok=true, verdict=strong_ok, source=browser_user
Summary: "Cloudflare challenge on all non-user paths.
          User's browser had clearance — read 4200 chars."
```

## Scheduler Logic

```js
async function runAdaptiveFetch(url, options) {
  const candidates = [];

  // Phase 0
  candidates.push(...await tryPublicEndpoints(url));
  if (hasBestCandidate(candidates, 'strong_ok')) return best(candidates);

  // Phase 1
  candidates.push(...await tryBrowserGradeHttp(url, options));
  if (hasBestCandidate(candidates, 'strong_ok')) return best(candidates);

  // Phase 2 (opt-in)
  if (options.reader || options.archive) {
    candidates.push(...await tryReaderServices(url, options));
    if (hasBestCandidate(candidates, 'strong_ok')) return best(candidates);
  }

  // Phase 3 (if --browser auto or required)
  if (options.browserMode !== 'never') {
    candidates.push(...await tryIsolatedBrowser(url, options));
    if (hasBestCandidate(candidates, 'strong_ok')) return best(candidates);
  }

  // Phase 4 (explicit opt-in or interactive prompt)
  if (shouldTryUserSession(candidates, options)) {
    candidates.push(...await tryUserSession(url, options));
    if (hasBestCandidate(candidates, 'strong_ok')) return best(candidates);
  }

  // Phase 5 (interactive only)
  if (options.browserSession === 'interactive' && hasChallenge(candidates)) {
    candidates.push(...await humanResolve(url, options));
  }

  return best(candidates);
}
```
