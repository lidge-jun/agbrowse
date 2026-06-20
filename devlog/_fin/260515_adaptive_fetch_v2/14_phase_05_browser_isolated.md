---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-05, browser, isolated, network-api]
---

# Phase 05 — Isolated Browser Render, Network API Discovery

## Goal

Chrome render in isolated context using existing agbrowse CDP runtime. Network
API endpoint discovery from browser traffic. JS challenges that auto-resolve in
a real Chrome context.

## Modified Files (exist from v1)

```
skills/browser/adaptive-fetch/browser-escalation.mjs   add JS challenge wait, improve network discovery
skills/browser/adaptive-fetch/browser-runtime.mjs       add createIsolatedContext export
skills/browser/adaptive-fetch/index.mjs                 wire challenge-aware browser escalation
skills/browser/adaptive-fetch/reader-adapters.mjs       already has fromBrowserResult/fromNetworkCandidate
```

## Existing Tests (update)

```
test/integration/browser-fetch-command.test.mjs         add challenge-resolution tests
```

## Diff Shape

### browser-escalation.mjs

```js
// Uses existing v1 browser-runtime.mjs (NOT browser-session.mjs from Phase 06)
import { getFetchBrowserPage, closeFetchBrowserPage } from './browser-runtime.mjs';

export async function tryIsolatedBrowser(url, options, challengeInfo) {
  // Uses existing v1 getFetchBrowserPage with browserSession='isolated'
  const pageRef = await getFetchBrowserPage({
    browserDeps: options.browserDeps,
    browserSession: 'isolated',
  });

  try {
    const page = pageRef.page;
    // Navigate and capture status (same pattern as v1 browser-escalation.mjs)
    let navStatus = 200;
    let navOk = true;
    let navContentType = 'text/html';
    if (typeof page.goto === 'function') {
      const navResponse = await page.goto(url, {
        waitUntil: 'domcontentloaded', timeout: options.timeoutMs,
      });
      if (navResponse) {
        navStatus = Number(navResponse.status?.() || 0) || 0;
        navOk = navResponse.ok?.() !== false && navStatus > 0 && navStatus < 400;
        navContentType = navResponse.headers?.()?.['content-type'] || 'text/html';
      }
    }

    // Wait for potential JS challenge resolution
    if (challengeInfo?.primary?.behavior?.jsChallengeSolvable) {
      await waitForChallengeResolution(page, 10000);
    }

    // Extract content
    const content = await extractPageContent(page, options);

    // Discover network API candidates
    const networkApis = await discoverNetworkApis(page);

    // Return v1-compatible shape for fromBrowserResult(normalizeReaderCandidate())
    const finalUrl = typeof page.url === 'function' ? page.url() : url;
    return {
      browserResult: {
        source: 'browser',
        finalUrl,
        title: content.title,
        text: content.text,
        contentType: navContentType,
        status: navStatus,
        ok: navOk,
        evidence: ['browser-isolated-render'],
        warnings: [],
      },
      networkApis,
      chromeUsed: true,
    };
  } finally {
    await closeFetchBrowserPage(pageRef);
  }
}

async function extractPageContent(page, options) {
  const title = await page.title();
  const visibleText = await page.evaluate(() => document.body?.innerText ?? '');

  let selectedText = visibleText;
  if (options.selector) {
    selectedText = await page.evaluate(
      sel => document.querySelector(sel)?.innerText ?? '',
      options.selector
    );
  }

  const metadata = await page.evaluate(() => {
    // Extract OGP, JSON-LD, canonical from rendered DOM
  });

  return { title, text: selectedText, fullText: visibleText, metadata };
}

async function waitForChallengeResolution(page, timeoutMs) {
  // Poll for challenge markers disappearing
  // Some JS challenges (non-interactive) resolve in <5s in real Chrome
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hasChallenge = await page.evaluate(() => {
      return !!document.querySelector('[id*="challenge"]') ||
             document.title?.includes('Just a moment');
    });
    if (!hasChallenge) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// Network API discovery uses the same page.on('response') pattern
// already implemented in browser-escalation.mjs collectBrowserCandidate().
// v1 already collects JSON network candidates via response listener.
// v2 extends with tracking/auth endpoint filtering.
//
// Actual pattern (from existing browser-escalation.mjs):
//   page.on('response', async (response) => {
//     const contentType = response.headers?.()['content-type'] || '';
//     if (!/\bjson\b/i.test(contentType)) return;
//     const text = await response.text();
//     networkCandidates.push({ source: 'network_api', ... });
//   });
//
// v2 addition: filter out tracking/auth endpoints before pushing
function filterNetworkCandidate(candidate) {
  return !isTrackingEndpoint(candidate.finalUrl) &&
         !isAuthEndpoint(candidate.finalUrl);
}

function isTrackingEndpoint(url) {
  return /analytics|tracking|telemetry|beacon|pixel|log\b/i.test(url);
}

function isAuthEndpoint(url) {
  return /auth|login|token|session|oauth|signin/i.test(url);
}
```

### index.mjs (modify)

Wire Phase 3 into the scheduler:

```js
// Phase 3: isolated browser (if --browser auto or required)
if (options.browserMode !== 'never') {
  const shouldBrowser =
    options.browserMode === 'required' ||
    !hasBestCandidate(candidates, 'strong_ok');

  if (shouldBrowser) {
    const challengeInfo = getDetectedChallenge(candidates);
    const browserResult = await tryIsolatedBrowser(url, options, challengeInfo);

    candidates.push(fromBrowserResult(browserResult.browserResult));
    appendAttempt(trace, { phase: 3, method: 'browser_isolated', ... });

    // Score network API candidates too
    for (const api of browserResult.networkApis) {
      const apiResult = await fetchTextCandidate(api.url, {
        ...options, identity: 'minimal',
      });
      candidates.push(fromNetworkApiResult(apiResult, api));
      appendAttempt(trace, { phase: 3, method: 'network_api', url: api.url, ... });
    }
  }
}
```

### reader-adapters.mjs — already exists

`fromBrowserResult` and `fromNetworkCandidate` already exist in v1. They use
`normalizeReaderCandidate()` which expects the standard shape:

```js
// Actual v1 contract:
{ source, finalUrl, title, text, contentType, status, ok, evidence, warnings }
```

v2 change: add `fromHumanResolvedResult` adapter in Phase 06. No change needed
in Phase 05 — existing adapters already handle browser and network candidates.

## Tests

- isolated browser creates and destroys temporary context
- JS challenge page auto-resolves within timeout in real Chrome context
- interactive challenge (Turnstile) detected and not auto-solved
- page content extracted: title, visible text, metadata
- CSS selector extraction works when --selector provided
- network API discovery: filters out tracking/auth endpoints
- network API candidates scored alongside DOM content
- browser unavailable + --browser auto → verdict browser_required
- --browser never → no browser attempt at all
- --browser required → goes straight to browser after URL validation

## Acceptance

- SPA shells become strong_ok after browser render
- JS-only challenges resolve automatically
- Interactive challenges detected but not solved (wait for Phase 06)
- Network API candidates included in scoring
- Isolated context: no user cookies, no login state

## Verify

```bash
npm test -- browser-fetch-command
npm run typecheck
```
