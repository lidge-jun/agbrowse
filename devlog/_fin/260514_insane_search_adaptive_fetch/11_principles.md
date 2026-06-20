---
created: 2026-05-14
status: planning
tags: [jawdev, adaptive-fetch, principles]
---

# Principles

## 1. HTTP 200 Is Not Success

The upstream engine treats status 200 as the start of validation, not the end.
That is the correct mental model. Many blocked pages return 200 with:

- tiny HTML shells;
- bot challenge markers;
- "enable JavaScript" prompts;
- SPA bootstrap pages without content;
- unresolved sensor cookies;
- login/paywall walls;
- placeholder metadata.

cli-jaw should expose a verdict:

| Verdict | Meaning |
| --- | --- |
| `strong_ok` | Positive proof matched, such as a caller selector or expected schema. |
| `weak_ok` | No negative proof found, but no strong proof was available. |
| `challenge` | WAF/challenge/empty-shell indicators found. |
| `blocked` | HTTP status or network-level block. |
| `auth_required` | Login/paywall/credential boundary detected. |
| `unsupported` | The request asks for behavior cli-jaw intentionally will not perform. |
| `unknown` | Transport or parser failure. |

## 2. Prefer Public Endpoints Before Browser Work

If a platform has a public JSON/Atom/RSS/API path, use that first. It is faster,
more stable, less invasive, and easier to test.

Examples that fit cli-jaw v1:

- GitHub via `gh` or REST.
- Reddit `.json`.
- Hacker News Firebase/Algolia.
- arXiv Atom.
- Wikipedia REST.
- npm/PyPI registry JSON.
- RSS/Atom feeds.
- Wayback CDX for historical snapshots.

## 3. Escalate By Evidence

The scheduler should not jump directly to browser control. It should escalate
only when the prior layer produced evidence:

- WAF product marker.
- challenge cookie/header/body.
- tiny or empty body.
- missing expected selector/schema.
- SPA shell with no extractable text.
- repeated fetch outcomes that are internally consistent but not useful.

## 4. Keep Engine Logic Site-Agnostic

The upstream "No-Site-Name Rule" is important. The core engine should not contain
`if hostname includes coupang`-style branches. Site-specific knowledge belongs
in:

- explicit platform resolvers for public APIs;
- documentation/reference notes;
- runtime hints supplied by the caller;
- append-only observation logs that do not affect behavior automatically.

## 5. Trace Every Attempt

Agents need to explain what happened. Every attempt should record:

- phase;
- method;
- URL after transform;
- status;
- byte count;
- verdict;
- reasons;
- elapsed time;
- error if any;
- whether content was returned from network, reader, cache/archive, browser, or
  public API.

This is also how we avoid repeated guesswork when a site fails.

## 6. Do Not Mutate User Environments Silently

Upstream auto-installs missing dependencies. That is convenient for a Claude
plugin, but it is not a good default for cli-jaw.

cli-jaw should:

- detect missing optional tools;
- report exact install commands;
- expose `doctor` checks;
- require explicit user approval before installing or enabling optional sidecars.

## 7. Respect Hard Boundaries

The feature should stop cleanly at:

- authentication requirements;
- paywalls;
- CAPTCHA solving;
- anti-abuse flows requiring human proof;
- robots/ToS-sensitive bulk collection;
- private or credentialed data unless the user explicitly owns the session and
  asks for browser-assisted reading.

This still leaves a useful product: "try safer public paths, validate content,
render ordinary JS pages, and explain failures."

