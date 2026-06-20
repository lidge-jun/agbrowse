---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, file-map]
---

# File Map

## Existing v1 Files (MODIFY)

These 14 modules already exist in `skills/browser/adaptive-fetch/`:

```
  index.mjs                 phase scheduler, orchestrator
  validators.mjs            content strength classification
  safety.mjs                URL validation, SSRF defense, redaction
  trace.mjs                 attempt recording and trace output
  endpoint-resolvers.mjs    public API/RSS/JSON endpoint matching
  fetcher.mjs               browser-grade HTTP client
  metadata.mjs              OGP/JSON-LD/canonical extraction
  transforms.mjs            URL transforms, HTML-to-text
  reader-adapters.mjs       normalize all sources to ReaderCandidate
  content-scorer.mjs        multi-signal content quality scoring
  third-party-readers.mjs   Jina Reader, archive (opt-in)
  challenge-detector.mjs    WAF/CAPTCHA/login/paywall detection
  browser-escalation.mjs    isolated Chrome render + network discovery
  browser-runtime.mjs       CDP page lifecycle helpers
```

## New Files (v2 only)

```
  waf-profiles.mjs          extracted WAF profiles from challenge-detector.mjs
  browser-session.mjs       session mode management (fresh/isolated/user/interactive)
  human-loop.mjs            interactive challenge resolution
```

## Modified Files

```
skills/browser/browser.mjs           wire fetch subcommand
skills/browser/SKILL.md              add fetch docs, update triggers
README.md                            add fetch to command list
structure/commands.md                 add fetch command entry
structure/CAPABILITY_TRUTH_TABLE.md   add fetch capability row
structure/str_func.md                 add fetch function entry
```

## Test Files

```
test/unit/
  browser-adaptive-fetch-validators.test.mjs
  browser-adaptive-fetch-endpoints.test.mjs
  browser-adaptive-fetch-reader-adapters.test.mjs
  browser-adaptive-fetch-content-scorer.test.mjs
  browser-adaptive-fetch-third-party-readers.test.mjs
  browser-adaptive-fetch-transforms.test.mjs
  browser-adaptive-fetch-trace.test.mjs
  browser-adaptive-fetch-challenge.test.mjs         NEW in v2
  browser-adaptive-fetch-waf-profiles.test.mjs      NEW in v2
  browser-adaptive-fetch-session.test.mjs            NEW in v2

test/integration/
  browser-fetch-command.test.mjs
  browser-fetch-human-loop.test.mjs                  NEW in v2
```

## Module Dependency Graph

Actual v1 pattern: `browser.mjs` builds `browserDeps` and passes it into
`runAdaptiveFetch()`. Modules never import `browser.mjs` directly.

```
browser.mjs  (CLI dispatch, builds browserDeps)
  └── runAdaptiveFetch(input, { browserDeps })
        └── index.mjs (orchestrator)
              ├── safety.mjs
              ├── trace.mjs
              ├── validators.mjs
              ├── endpoint-resolvers.mjs
              ├── fetcher.mjs
              ├── metadata.mjs
              ├── transforms.mjs
              ├── reader-adapters.mjs
              │     └── content-scorer.mjs
              ├── third-party-readers.mjs
              ├── challenge-detector.mjs
              │     └── waf-profiles.mjs (NEW v2)
              ├── browser-escalation.mjs
              │     └── browser-runtime.mjs (consumes browserDeps)
              └── browser-session.mjs (NEW v2, wraps browser-runtime.mjs)
                    └── human-loop.mjs (NEW v2, uses browser-session.mjs)
```

Key: `browser-runtime.mjs` receives `browserDeps` via `options`, never imports
`browser.mjs`. `browser-session.mjs` wraps `browser-runtime.mjs` to add
user/interactive session modes. `human-loop.mjs` uses `browser-session.mjs`.
