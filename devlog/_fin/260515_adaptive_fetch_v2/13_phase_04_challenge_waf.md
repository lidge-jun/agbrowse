---
created: 2026-05-15
status: implemented
tags: [jawdev, adaptive-fetch, v2, phase-04, challenge, waf]
---

# Phase 04 — Challenge Detection, WAF Profiles

## Goal

Product-based WAF detection. Challenge classification. Integration with the
scheduler so challenges trigger maximum path coverage instead of early stop.

## New Files

```
skills/browser/adaptive-fetch/waf-profiles.mjs          NEW — extracted from challenge-detector
test/unit/browser-adaptive-fetch-waf-profiles.test.mjs   NEW
```

## Modified Files (exist from v1)

```
skills/browser/adaptive-fetch/challenge-detector.mjs   import profiles from waf-profiles.mjs
skills/browser/adaptive-fetch/index.mjs                wire challenge info into trace
skills/browser/adaptive-fetch/validators.mjs           delegate to challenge-detector
```

## Existing Tests (update)

```
test/unit/browser-adaptive-fetch-challenge.test.mjs     add WAF profile scoring tests
```

## Diff Shape

### waf-profiles.mjs

```js
export const WAF_PROFILES = [
  {
    id: 'cloudflare_managed_challenge',
    detect: {
      cookies:  [/^cf_clearance$/i, /^__cf_bm$/i],
      headers:  { server: /cloudflare/i, 'cf-ray': /.+/ },
      body:     [/challenge-platform/i, /cdn-cgi\/challenge-platform/i,
                 /Checking your browser/i, /Verifying you are human/i],
      status:   [403, 503],
    },
    behavior: {
      jsChallengeSolvable: true,
      interactiveCaptcha: true,
      cookieWarmingHelps: false,
      mobileVariantHelps: false,
      userSessionHelps: true,
    },
  },
  {
    id: 'cloudflare_turnstile',
    detect: {
      body: [/challenges\.cloudflare\.com\/turnstile/i,
             /cf-turnstile/i],
    },
    behavior: {
      jsChallengeSolvable: false,
      interactiveCaptcha: true,
      userSessionHelps: true,
    },
  },
  {
    id: 'akamai_bot_manager',
    detect: {
      cookies: [/^_abck$/i, /^bm_sz$/i, /^ak_bmsc$/i],
      body:    [/akamai/i, /sensor_data/i],
    },
    behavior: {
      jsChallengeSolvable: false,
      interactiveCaptcha: false,
      userSessionHelps: true,
    },
  },
  // datadome, perimeterx, incapsula, aws_waf, generic_challenge...
];

export function getProfileById(id) {}
```

### challenge-detector.mjs

```js
export function detectChallenge(response) {
  const signals = {
    cookies: parseCookieNames(response.headers),
    headers: response.headers,
    body: response.body?.substring(0, 50000) ?? '',
    status: response.status,
  };

  const matches = WAF_PROFILES
    .map(p => ({ profile: p, score: scoreProfile(p, signals) }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    detected: matches.length > 0,
    profiles: matches,
    primary: matches[0] ?? null,
    signals: summarizeSignals(signals),
  };
}

export function detectLoginWall(response) {
  // login form markers, OAuth redirects, "sign in" CTAs
}

export function detectPaywall(response) {
  // subscription CTAs, "premium content", "subscribe to read"
}

export function classifyChallengeType(response) {
  const waf = detectChallenge(response);
  const login = detectLoginWall(response);
  const paywall = detectPaywall(response);

  if (waf.detected) return { type: 'challenge', ...waf };
  if (login.detected) return { type: 'auth_required', ...login };
  if (paywall.detected) return { type: 'paywall', ...paywall };
  return { type: null };
}
```

### index.mjs (modify)

Integrate challenge detection into Phase 1 results:

```js
// After each fetch attempt:
const challenge = classifyChallengeType(result);
if (challenge.type) {
  appendAttempt(trace, {
    phase: 1, method: 'fetch', verdict: challenge.type,
    waf: challenge.primary?.profile?.id,
    reason: challenge.signals,
  });
  // Do NOT return early — continue to next phase
}
```

### validators.mjs (modify)

Use challenge detector for boundary classification:

```js
// Replace inline challenge heuristics with challenge-detector calls
export function classifyBoundarySignals({ status, headers, text, url }) {
  return classifyChallengeType({ status, headers, body: text }).type;
}
```

## Tests

- Cloudflare challenge detected from cf-ray header + challenge-platform body
- Cloudflare Turnstile detected from turnstile script URL
- Akamai detected from _abck cookie
- Login wall detected from login form + OAuth redirect markers
- Paywall detected from subscription CTA markers
- Challenge detection does NOT cause early return from scheduler
- Profile scoring: multiple signal matches → higher confidence
- Unknown/clean pages → no detection
- Large body (>50KB) does not cause OOM — body truncated for detection

## Acceptance

- WAF profiles are product-based, no hostname/site branches
- Challenge detection integrates with existing Phase 0/1 without breaking them
- Detection result available for Phase 3-5 behavior hints
- Profile behavior hints guide browser escalation decisions

## Verify

```bash
npm test -- browser-adaptive-fetch-challenge browser-adaptive-fetch-waf-profiles
npm run typecheck
```
