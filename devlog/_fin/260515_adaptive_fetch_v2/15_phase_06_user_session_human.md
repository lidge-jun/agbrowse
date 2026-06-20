---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-06, user-session, human-loop]
---

# Phase 06 — User Session, Human-in-the-Loop Resolution

## Goal

The "다 되도록" phase. User's authenticated browser session as an explicit
escalation path. Human-in-the-loop challenge resolution for interactive
challenges. This is what makes agbrowse v2 see more surfaces than insane-search.

## New Files

```
skills/browser/adaptive-fetch/browser-session.mjs       NEW — session mode management
skills/browser/adaptive-fetch/human-loop.mjs             NEW — human-in-the-loop resolution
test/unit/browser-adaptive-fetch-session.test.mjs        NEW
test/integration/browser-fetch-human-loop.test.mjs       NEW
```

## Modified Files (exist from v1)

```
skills/browser/adaptive-fetch/index.mjs                  add user/interactive session flow
skills/browser/adaptive-fetch/reader-adapters.mjs        add fromHumanResolvedResult
skills/browser/adaptive-fetch/browser-escalation.mjs     unchanged (stays on browser-runtime.mjs)
skills/browser/adaptive-fetch/browser-runtime.mjs        export helpers for browser-session.mjs
```

## CLI Flag Integration

v1 uses `--browser-session none|isolated|existing`. v2 extends with:

```
--browser-session user          alias for existing (reads user's cookies)
--browser-session interactive   existing + pause at challenges for human
```

In `index.mjs normalizeAdaptiveFetchOptions()`:
```js
const BROWSER_SESSIONS = new Set(['none', 'isolated', 'existing', 'user', 'interactive']);
// 'user' normalizes to 'existing' with userSessionExplicit=true
// 'interactive' normalizes to 'existing' with humanLoop=true
```

## Diff Shape

### browser-session.mjs

```js
export async function createIsolatedContext() {
  // Creates fresh Chrome context — no cookies, no history
  // Uses existing agbrowse browser lifecycle
  // Returns { page, close() }
}

export async function getUserBrowserPage() {
  // Connects to user's existing Chrome session via CDP
  // Returns existing page/context with user's cookies and login state
  // Throws if no Chrome session available
}

export function isUserSessionAvailable() {
  // Check if agbrowse has an active Chrome session
}

export function shouldTryUserSession(candidates, options) {
  // Returns true if:
  //   1. options.browserSession is 'user' or 'interactive', OR
  //   2. challenge detected AND user session available AND user approves
  const hasChallenge = candidates.some(c =>
    c.challenge?.type === 'challenge' ||
    c.challenge?.type === 'auth_required' ||
    c.challenge?.type === 'paywall'
  );

  if (options.browserSession === 'user' || options.browserSession === 'interactive') return true;
  if (hasChallenge && isUserSessionAvailable()) return 'prompt'; // ask user
  return false;
}

export async function navigateInUserSession(url, options) {
  const page = await getUserBrowserPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeoutMs });

  const content = await extractPageContent(page, options);

  return {
    ...content,
    source: 'browser_user',
    session: 'user',
    safetyFlags: ['user_session_used'],
  };
}
```

### human-loop.mjs

```js
export async function humanResolve(url, options, challengeInfo) {
  if (!options.interactive && options.browserSession !== 'interactive') {
    // Non-interactive mode: return actionable message
    return {
      ok: false,
      verdict: challengeInfo.type,
      humanActionNeeded: true,
      actionMessage: formatNonInteractiveMessage(challengeInfo, url),
    };
  }

  // Interactive mode: present challenge, wait for human
  const message = formatChallengeMessage(challengeInfo, url);
  await presentToUser(message);
  await waitForUserSignal();

  // After human acts, read the result from their browser
  const result = await navigateInUserSession(url, options);
  return {
    ...result,
    source: 'human_resolved',
    safetyFlags: ['user_session_used', 'human_action_taken'],
  };
}

function formatChallengeMessage(challengeInfo, url) {
  switch (challengeInfo.type) {
    case 'challenge':
      const waf = challengeInfo.primary?.profile?.id ?? 'unknown';
      return [
        `Challenge detected at ${url}`,
        `Type: ${waf}`,
        `Action: Open this URL in your browser and solve the challenge.`,
        `Press Enter when done.`,
      ].join('\n');

    case 'auth_required':
      return [
        `Login required at ${url}`,
        `Action: Log in via your browser.`,
        `Press Enter when done.`,
      ].join('\n');

    case 'paywall':
      return [
        `Paywall detected at ${url}`,
        `Action: If you have a subscription, ensure you're logged in.`,
        `Press Enter to read with your session, or Ctrl+C to skip.`,
      ].join('\n');
  }
}

function formatNonInteractiveMessage(challengeInfo, url) {
  const type = challengeInfo.type;
  return `${type} detected at ${url}. Run with --browser-session interactive to resolve.`;
}

async function presentToUser(message) {
  // Output via stderr (CLI) or channel message (channel mode)
  process.stderr.write('\n' + message + '\n');
}

async function waitForUserSignal() {
  // Wait for Enter key on stdin
  return new Promise(resolve => {
    process.stdin.once('data', () => resolve());
  });
}
```

### index.mjs (modify)

Wire Phase 4 and Phase 5 into the scheduler:

```js
// Phase 4: user's browser session
const sessionDecision = shouldTryUserSession(candidates, options);
if (sessionDecision === true) {
  const userResult = await navigateInUserSession(url, options);
  candidates.push(fromBrowserResult(userResult));
  appendAttempt(trace, { phase: 4, method: 'browser_user', ... });

  const best = chooseBestCandidate(candidates);
  if (verdictFromScore(best.score) === 'strong_ok') {
    return buildResult(best, trace);
  }
} else if (sessionDecision === 'prompt') {
  // Ask user: "Challenge detected. Use your browser session? [y/N]"
  const approved = await promptUserSession();
  if (approved) {
    const userResult = await navigateInUserSession(url, options);
    candidates.push(fromBrowserResult(userResult));
    appendAttempt(trace, { phase: 4, method: 'browser_user', ... });
  }
}

// Phase 5: human resolution (interactive only)
if (options.browserSession === 'interactive' && hasUnresolvedChallenge(candidates)) {
  const challengeInfo = getDetectedChallenge(candidates);
  const humanResult = await humanResolve(url, options, challengeInfo);
  if (humanResult.ok !== false) {
    candidates.push(fromHumanResolvedResult(humanResult));
    appendAttempt(trace, { phase: 5, method: 'human_resolved', ... });
  }
}

// Final: best of all candidates
const final = chooseBestCandidate(candidates);
return buildResult(final, trace);
```

### reader-adapters.mjs (modify)

Uses existing `normalizeReaderCandidate()` contract. v2 extends the contract
with an optional `safetyFlags` field.

```js
// v2 contract change: normalizeReaderCandidate() must preserve safetyFlags[]
// Add to normalizeReaderCandidate() in reader-adapters.mjs:
//   safetyFlags: Array.isArray(result.safetyFlags) ? result.safetyFlags : [],
//
// Also update buildResult() in index.mjs to propagate safetyFlags from
// the winning candidate to the final AdaptiveFetchResult.

export function fromHumanResolvedResult(result) {
  return normalizeReaderCandidate({
    source: 'human_resolved',
    finalUrl: result.finalUrl ?? result.url ?? '',
    title: result.title ?? '',
    text: result.text ?? '',
    contentType: result.contentType ?? 'text/html',
    status: result.status ?? 200,
    ok: true,
    evidence: ['human-resolved-challenge'],
    warnings: [],
    safetyFlags: ['user_session_used', 'human_action_taken'],
  });
}
```

### Contract Changes Required

1. `reader-adapters.mjs normalizeReaderCandidate()`: add `safetyFlags` passthrough
2. `index.mjs buildResult()`: propagate `safetyFlags` from winning candidate to final result (v1 hardcodes `safetyFlags: []`)

## Tests

### Unit (browser-adaptive-fetch-session.test.mjs)

- `shouldTryUserSession` returns false when no challenge and session is fresh
- `shouldTryUserSession` returns true when session is 'user'
- `shouldTryUserSession` returns 'prompt' when challenge detected and session available
- `isUserSessionAvailable` returns false when no Chrome session
- user session results include `user_session_used` safety flag

### Integration (browser-fetch-human-loop.test.mjs)

- non-interactive mode with challenge → returns actionable message, no stdin wait
- --browser-session user without challenge → uses user session directly
- --browser-session interactive with challenge → formats challenge message
- human_resolved source recorded in trace
- safety flags correctly propagated to final result

## Acceptance

- Cloudflare-protected page: user session with cf_clearance → strong_ok
- Login-walled page: user is logged in → reads their page
- Paywalled page: user has subscription → reads full article
- Interactive CAPTCHA: human solves → tool reads result
- Non-interactive mode: returns `humanActionNeeded: true` with instructions
- All results show session mode and safety flags

## Verify

```bash
npm test -- browser-adaptive-fetch-session browser-fetch-human-loop
npm run typecheck
```
