---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, principles]
---

# Principles

## 1. Human-Supervised = Assistance, Not Bypass

Every capability in this design is something the human already does in Chrome.
The tool automates the mechanical parts. The human handles judgment and access.

```
Bypass:      tool autonomously circumvents access control
Assistance:  tool helps human read pages they already have access to
```

insane-search operates autonomously. agbrowse v2 operates under human
supervision: every escalation is visible, the human controls session use, and
the human solves challenges.

## 2. Browser-Grade HTTP Is Not Impersonation

When Chrome sends a request, it sends specific headers (User-Agent, Accept,
Accept-Language, Sec-Fetch-*). When a tool sends Node.js default headers, WAFs
block it — not because it's malicious, but because it doesn't look like a
browser.

Sending browser-standard headers is conformance, not impersonation. The user
opening Chrome sends the same thing.

## 3. The User's Session Is the User's

When a human is logged into a site and asks the tool to read a page, using their
browser session is the same as them clicking the link. The tool reads what the
human can already see. This requires explicit opt-in and is visible in the trace.

## 4. CAPTCHA Is a Human Problem

The tool does not solve CAPTCHAs. The human does. The tool:
1. Detects the CAPTCHA
2. Tries every non-CAPTCHA path first
3. Asks the human to solve it
4. Reads the result

This is what happens when someone encounters a CAPTCHA while browsing — they
solve it themselves.

## 5. Exhaust All Paths Before Returning a Boundary

CAPTCHA/login/paywall detection is not a stop signal. It triggers maximum path
coverage: public endpoints, RSS, metadata, URL transforms, reader services,
isolated browser, user session, network API discovery. Return a boundary verdict
only when no path remains that doesn't require automated challenge solving or
credential injection.

## 6. Trace Everything

Every phase, every attempt, every escalation decision is recorded and available
via `--trace`. The human can always see exactly what the tool tried and why.

## 7. v1 Principles That Still Apply

From v1 `11_principles.md` — unchanged:

- HTTP 200 is not success (validate content, not status)
- Prefer public endpoints before browser work
- Escalate by evidence
- Keep engine logic site-agnostic (no hostname branches)
- Do not mutate user environments silently
