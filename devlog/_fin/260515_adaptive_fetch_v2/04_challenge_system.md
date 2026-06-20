---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, v2, challenge, waf, captcha, human-loop]
---

# Challenge System

## WAF Product Profiles

Site-agnostic, product-based detection. No hostname branches.

### Profile Structure

```js
{
  id: 'cloudflare_managed_challenge',
  detect: {
    cookies:  ['cf_clearance', '__cf_bm'],
    headers:  { server: /cloudflare/i, 'cf-ray': /.+/ },
    body:     [/challenge-platform/i, /cdn-cgi\/challenge-platform/i,
               /Checking your browser/i, /Enable JavaScript and cookies/i],
    meta:     [/<meta.*cf-challenge/i],
    status:   [403, 503],
  },
  behavior: {
    jsChallengeSolvable: true,    // isolated browser may solve JS challenges
    interactiveCaptcha: true,     // may need human for turnstile
    cookieWarmingHelps: false,
    mobileVariantHelps: false,
    userSessionHelps: true,       // user may have cf_clearance already
  }
}
```

### Profiles

| Profile | Key signals | Notes |
|---|---|---|
| `cloudflare_managed_challenge` | cf_clearance, cf-ray, challenge-platform | JS challenge often auto-resolves in real Chrome |
| `cloudflare_turnstile` | turnstile widget in body | Interactive — needs human |
| `akamai_bot_manager` | _abck cookie, sensor data markers | Usually needs real browser |
| `datadome` | datadome cookie, dd.js script | Aggressive fingerprinting |
| `perimeterx` | _px* cookies, human challenge | Usually needs real browser |
| `incapsula` | visid_incap, incap_ses | Varies — some pass with browser headers |
| `aws_waf` | x-amzn-waf header, CAPTCHA page | Depends on configuration |
| `generic_challenge` | "enable JavaScript", empty shell, bot check | Catch-all |

### Detection Flow

```js
function detectChallenge(response) {
  const signals = {
    cookies:  parseCookies(response.headers),
    headers:  response.headers,
    body:     response.body?.substring(0, 50000),
    status:   response.status,
  };

  const matches = WAF_PROFILES
    .map(p => ({ profile: p, score: scoreProfile(p, signals) }))
    .filter(m => m.score > 0)
    .sort((a, b) => b.score - a.score);

  return matches.length > 0
    ? { detected: true, profiles: matches, primary: matches[0] }
    : { detected: false };
}
```

## Challenge Response Strategy

Detection triggers maximum path coverage, not early stop.

### Response Matrix

| Challenge type | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|---|---|---|---|---|---|---|
| JS challenge | try | try transforms | try reader | usually solves ✓ | — | — |
| Turnstile/CAPTCHA | try | try transforms | try reader | detect only | check clearance | human solves |
| Login wall | try | try transforms | try reader | detect only | user logged in ✓ | human logs in |
| Paywall | try | try | try | detect only | user subscribed ✓ | — |
| Rate limit (429) | try | wait + retry 1x | try reader | try | try | — |
| IP block (403) | try | — | try reader | try | try | report |

### Key: Challenge Does NOT Stop the Ladder

```
Old (v1): Challenge detected → return 'challenge' verdict → stop
New (v2): Challenge detected → note it → keep trying other phases

Example:
  Phase 1 HTTP → Cloudflare challenge (noted)
  Phase 0 public endpoint → no match (continue)
  Phase 1 mobile URL → same challenge (noted)
  Phase 2 Jina reader → clean article text! (strong_ok ✓)

Without v2: would have stopped at Phase 1.
With v2: found the content via reader service.
```

## Human-in-the-Loop Module

### Architecture

```js
// human-loop.mjs
export async function humanResolve(url, options, challengeInfo) {
  const message = formatChallengeMessage(challengeInfo);

  // Present to human via CLI or channel
  await presentChallenge(message, options);

  // Wait for human signal
  await waitForHumanAction(options);

  // Read the result from user's browser
  return await readUserBrowser(url, options);
}
```

### Challenge Messages

```
CAPTCHA:
  "⚠ CAPTCHA detected at https://example.com/page
   Cloudflare Turnstile requires human verification.
   → Open this URL in your browser and solve the challenge.
   → Press Enter when done."

Login:
  "🔒 Login required at https://example.com/dashboard
   This page requires authentication.
   → Log in via your browser.
   → Press Enter when done."

Paywall:
  "💰 Paywall detected at https://news-site.com/article
   Subscription required for full content.
   → If you have a subscription, ensure you're logged in.
   → Press Enter to read with your session, or Ctrl+C to skip."
```

### Non-Interactive Mode

When not running interactively (pipe mode, channel dispatch, heartbeat):

```
No human prompt. Instead:
  1. Try all automated phases (0-4)
  2. If user session available and --browser-session user: use it
  3. If still blocked: return verdict with actionable message

{
  "ok": false,
  "verdict": "challenge",
  "humanActionNeeded": true,
  "actionMessage": "CAPTCHA detected. Run with --browser-session interactive to resolve.",
  "wafDetected": "cloudflare_turnstile"
}
```

The agent or user can then decide to retry with `--browser-session interactive`.
