---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-01, core]
---

# Phase 01 — Core Contracts, URL Safety, Trace

## Goal

Command-independent result model, URL validation, SSRF defense, trace recording,
and verdict types. No network work, no browser work.

## Modified Files (all exist from v1)

```
skills/browser/adaptive-fetch/index.mjs       add v2 session/identity options
skills/browser/adaptive-fetch/validators.mjs   wire challenge-detector integration
skills/browser/adaptive-fetch/safety.mjs       add DNS rebinding guard (NEW in v2)
skills/browser/adaptive-fetch/trace.mjs        add session/identity fields to trace
skills/browser/browser.mjs                     already wired — no change needed
```

## Existing Tests (update)

```
test/unit/browser-adaptive-fetch-validators.test.mjs   add DNS rebinding cases
test/unit/browser-adaptive-fetch-trace.test.mjs         add session field cases
```

## Diff Shape

### index.mjs

```js
export async function runAdaptiveFetch(input, deps = {}) {
  // Phase scheduler stub — returns unsupported until Phase 02
}

export function normalizeAdaptiveFetchOptions(raw = {}) {
  return {
    browserMode: raw.browser ?? 'auto',
    session: raw.session ?? 'fresh',
    identity: raw.identity ?? 'auto',
    reader: raw.reader ?? 'none',
    archive: !!raw.archive,
    trace: !!raw.trace,
    json: !!raw.json,
    selector: raw.selector ?? null,
    metadataOnly: !!raw.metadataOnly,
    maxBytes: raw.maxBytes ?? 5242880,
    timeoutMs: raw.timeoutMs ?? 30000,
    noPublicEndpoints: !!raw.noPublicEndpoints,
    noTransforms: !!raw.noTransforms,
  };
}

export async function runAdaptiveFetchCli(args) {
  // parse CLI args → normalizeAdaptiveFetchOptions → runAdaptiveFetch
  // format output (human or JSON)
}
```

### validators.mjs

```js
export function classifyHtmlStrength({ html, text, title, positiveProof = [] }) {
  // Returns: 'strong_ok' | 'weak_ok' | 'empty' | 'challenge_likely'
}

export function classifyBoundarySignals({ status, headers, text, url }) {
  // Returns: null | 'auth_required' | 'paywall' | 'challenge' | 'blocked'
}

export function isEmptySpaShell(html) {
  // Returns boolean: tiny body, no text, SPA bootstrap markers
}
```

### safety.mjs

```js
export function validateFetchUrl(rawUrl, options = {}) {
  // Returns: { valid: true, url } | { valid: false, reason }
  // Checks: scheme allowlist, credential-in-URL, private/local/link-local,
  //         DNS rebinding guard, redirect target re-check hook
}

export function redactTraceValue(value) {}
export function redactHeaders(headers = {}) {}
export function redactUrl(url) {}

export function isPrivateIp(ip) {}
export function isLocalhost(hostname) {}
```

### trace.mjs

```js
export function createTrace() {
  return { attempts: [], startedAt: Date.now() };
}

export function appendAttempt(trace, attempt) {
  // attempt: { phase, method, url, status, bytes, verdict, reason, elapsed }
  trace.attempts.push({ ...attempt, index: trace.attempts.length + 1 });
}

export function summarizeTrace(trace) {
  // Returns human-readable attempt ladder string
}

export function traceToJson(trace) {
  // Returns trace with redacted URLs and headers
}
```

### browser.mjs (modify)

```js
case 'fetch':
  return runAdaptiveFetchCli(args.slice(1));
```

## Tests

- invalid scheme (ftp, file, data) rejected before network
- credential-in-URL rejected
- localhost / 127.0.0.1 / 10.x / 192.168.x / 172.16-31.x rejected
- link-local (169.254.x) rejected
- challenge-like tiny HTML → not strong_ok
- readable 5000-char article with title → strong_ok
- SPA shell with <div id="root"></div> only → empty
- trace redacts Authorization, Cookie values, API keys in query params
- trace records phase, method, verdict, elapsed for each attempt

## Acceptance

- `agbrowse fetch <url> --json` returns structured validation result
- No browser launch
- No network request
- DNS rebinding guard added (resolve hostname, reject private IPs)
- Command surface already exists from v1 — v2 extends options

## Verify

```bash
npm test -- browser-adaptive-fetch-validators browser-adaptive-fetch-trace
npm run typecheck
```
