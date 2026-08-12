# 060 — Interstitial hardening (G13 + G14 + G15)

## Audit amendments (round 1, Sol reviewer Hilbert — GO-WITH-FIXES, 6 blockers, all folded)

Main-session decisions on the reviewer's findings:

1. **Minimal production wiring PULLED INTO scope** (Critical): hardening an unconsumed detector creates no runtime value. WP5 wires ONE consumer: the ChatGPT composer-readiness preflight failure path (`chatgpt.mjs:355-361`) — on readiness failure, probe the detector and convert a non-`none` verdict into the existing structured error surface (follow the repo's existing error taxonomy; reviewer suggested `WebAiError`-style stage `provider-interstitial`). Grok/Gemini wiring stays OUT (follow-up row G13b in 040). Integration/unit test proves the wired path fires.
2. **Shell veto is provider-scoped, not "unified"** (High): `hasComposer||hasTurns` with ChatGPT selectors is wrong for Grok (`.ProseMirror`, `[data-testid="assistant-message"]`) and Gemini (`model-response`, `[data-response-index]`). Design: caller supplies provider shell selectors (or a provider selector map); the shipped wiring passes the ChatGPT map; API/docs state ChatGPT-only scope. Grok/Gemini shell fixtures added as named tests for the map shape.
3. **Truly bounded grace window** (High): per-probe timeouts (title/innerText/locator counts), `intervalMs` clamped to a positive range, injectable `{now, sleep}` scheduler for tests. Named tests: hanging probe bounded; zero/negative interval clamped; probe-error policy.
4. **Activation matrix 1:1 named tests** (Medium): add strong-title immediate, 600+ content-rich quote page, weak-evidence disappearance, live shell-veto no-sleep; fix the false-positive fixtures (real article without artificial hasTurns; Work fixture with actual Work shell selector + challenge copy). Replace the ordering-brittle makePage with snapshot-scoped fixtures.
5. **Threshold policy + staged rollback** (Medium): `<600` stays a named constant scoped to the ChatGPT wiring; localized/long-challenge fixture added; rollback order defined: (1) unwire consumer, (2) disable grace polling, (3) revert copy threshold, (4) revert shell selectors — each independently revertible; full revert = the WP5 commit.
6. **Contract clarity** (Low): do not keep a synchronous API that silently promotes weak⇒challenge; expose the structured verdict as the primary API and keep any instantaneous helper clearly named; shell veto requires visible-element semantics (or an explicit presence-veto fixture documenting the choice).

Date: 2026-07-24  
Format: DIFFLEVEL-ROADMAP-01  
Work-phase: WP5  
Upstream evidence: Oracle `4bfe3c04`, `66588753`, `46512488`

## Objective

Make `web-ai/interstitial.mjs` distinguish a real Cloudflare interstitial from a healthy hydrated app page. Preserve the existing synchronous `classifyInterstitial(signals)` contract, add a pure structured Cloudflare verdict, and put the bounded weak-evidence re-probe in the live-page helper that can gather a new DOM snapshot. Strong title/widget evidence classifies immediately; an observed app shell vetoes all body-copy and script evidence; generic challenge copy and script-only evidence qualify only on a shell-less normalized body shorter than 600 characters.

This phase hardens the latent unified detector and its tests. Repository-wide searches on 2026-07-24 found no production import or call of `detectInterstitial` or `classifyInterstitial`; wiring a provider send path is out of scope until an owning call site and abort/retry policy are selected. Do not imply that this phase changes current send behavior.

## Gaps covered

| Gap | Current defect | Planned behavior |
| --- | --- | --- |
| G13 | `classifyInterstitial` checks body copy before the already-gathered composer/turn shell signals (`web-ai/interstitial.mjs:46-52`, signals gathered at `:78-81`). | Return a structured `{ strong, shell, weak, evidence }` verdict. Challenge title or structured widget is immediate strong evidence only when shell is absent. `hasComposer || hasTurns` is a veto before generic copy/script can classify. |
| G14 | `detectInterstitial` takes one snapshot (`web-ai/interstitial.mjs:75-84`). | Keep `classifyInterstitial` pure and single-shot. Let `detectInterstitial`, the live-page helper, re-gather signals every 500 ms for at most 12,000 ms only while the verdict remains weak. Strong, shell, and no-evidence outcomes return immediately. |
| G15 | Four generic substrings are unconditional (`web-ai/interstitial.mjs:14-19`, `:49-52`). | Normalize whitespace and adopt Oracle's strict `< 600` character threshold. Generic verification copy is strong only on a shell-less short page. A normal content-rich page quoting the copy remains `none`. |

The `< 600` threshold is adopted unchanged because this is a parity hardening phase, it has upstream regression coverage, and no agbrowse fixture justifies a fork-specific boundary. It is strict (`599` qualifies, `600` does not).

## Verified consumer inventory and anchor corrections

Searches run:

```sh
rg -n "interstitial" web-ai/ skills/
rg -n "detectInterstitial|classifyInterstitial|isPageDeathError|from ['\"].*interstitial|import\\(['\"].*interstitial" . --glob '!node_modules/**' --glob '!devlog/**'
```

True consumers of `web-ai/interstitial.mjs`:

- `test/unit/web-ai-interstitial.test.mjs:2` imports `classifyInterstitial` and `isPageDeathError`; tests call them at `:7,14,21,28,33,39,44,50-54`.
- No production file imports `web-ai/interstitial.mjs`. `detectInterstitial` has no caller. `classifyInterstitial` has no caller outside its unit test.
- `web-ai/chatgpt.mjs`, `web-ai/grok-live.mjs`, and `web-ai/gemini-live.mjs` import a different `isPageDeathError`, from `web-ai/tab-recovery.mjs`; they are not consumers of this module.
- `skills/browser/browser.mjs:1491` contains only an interstitial-related comment, and `web-ai/failure-diagnostics.mjs:91,114` contains the `provider-interstitial` stage string; neither imports or calls this detector.

Corrections to the research anchors:

- The research statement that composer/turn signals are gathered at `interstitial.mjs:75-81` is directionally correct; the exact current gather lines are `web-ai/interstitial.mjs:78-80`, with classification at `:81`.
- The current Cloudflare early return is exactly `web-ai/interstitial.mjs:49-52`; `:46-52` is the containing function/branch anchor.
- The single-shot live detector is `web-ai/interstitial.mjs:75-84`; selector presence (not visibility) is `:101-106`.
- The only current importer is `test/unit/web-ai-interstitial.test.mjs:2`, not a production consumer.

## File change map

| Action | Exact path | Functions / symbols | Verified current anchors | Purpose |
| --- | --- | --- | --- | --- |
| MODIFY | `web-ai/interstitial.mjs` | `CLOUDFLARE_PATTERNS` (replace), `classifyCloudflareVerdict` (new), `classifyInterstitial`, `detectInterstitial`, `gatherInterstitialSignals` (new), `delay` (new) | `web-ai/interstitial.mjs:9-19`, `:41-68`, `:70-85`, `:96-107` | Add structured strong/shell/weak classification, shell veto, `< 600` gate, challenge DOM signals, and bounded weak re-probe. |
| MODIFY | `test/unit/web-ai-interstitial.test.mjs` | `describe('web-ai interstitial detector', ...)` | `test/unit/web-ai-interstitial.test.mjs:1-56` | Add pure verdict, false-positive, boundary, and fake-timer hydration-grace coverage. |

No production consumer file is in this phase. If implementation discovers a production importer after this document, stop and update this roadmap before changing that caller.

## Proposed diffs

### 1. `web-ai/interstitial.mjs`

Before (`web-ai/interstitial.mjs:14-19`):

```js
const CLOUDFLARE_PATTERNS = [
    'just a moment',
    'checking if the site connection is secure',
    'enable javascript and cookies',
    'ray id',
];
```

After — replace those constants with:

```js
const GENERIC_CHALLENGE_PATTERNS = [
    /verify(ing)? you are human/,
    /checking your browser/,
    /needs to review the security of your connection/,
    /checking if the site connection is secure/,
    /enable javascript and cookies/,
    /just a moment/,
    /ray id/,
];

const CHALLENGE_WIDGET_SELECTORS = [
    '#challenge-form',
    '#challenge-running',
    '#cf-challenge-running',
    '[class*="cf-challenge"]',
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="/cdn-cgi/challenge-platform/"]',
];

const CHALLENGE_SCRIPT_SELECTORS = [
    'script[src*="/cdn-cgi/challenge-platform/"]',
];

const CLOUDFLARE_SHORT_BODY_LENGTH = 600;
const CLOUDFLARE_HYDRATION_GRACE_MS = 12_000;
const CLOUDFLARE_REPROBE_INTERVAL_MS = 500;
```

Before (`web-ai/interstitial.mjs:41-52`; login and empty-shell branches continue through `:68`):

```js
/**
 * Classify an interstitial from already-gathered page signals (pure).
 * @param {{ url?: string, bodyText?: string, hasComposer?: boolean, hasTurns?: boolean }} signals
 * @returns {InterstitialResult}
 */
export function classifyInterstitial({ url = '', bodyText = '', hasComposer = false, hasTurns = false } = {}) {
    const lower = bodyText.toLowerCase();

    if (CLOUDFLARE_PATTERNS.some((p) => lower.includes(p))) {
        const matched = CLOUDFLARE_PATTERNS.find((p) => lower.includes(p)) || 'cloudflare';
        return { kind: 'cloudflare-challenge', evidence: matched, url, retryHint: 'wait-and-retry' };
    }
```

After — extend the typedef block at current `:9-12` and replace the complete `classifyInterstitial` at current `:41-68` with:

```js
/**
 * @typedef {'cloudflare-challenge'|'login-required'|'empty-shell'|'loading'|'none'} InterstitialKind
 * @typedef {{ kind: InterstitialKind, evidence: string, url: string, retryHint: 'wait-and-retry'|'login'|'navigate'|'none' }} InterstitialResult
 * @typedef {'strong'|'shell'|'weak'|'none'} CloudflareEvidenceKind
 * @typedef {{ kind: CloudflareEvidenceKind, evidence: string }} CloudflareVerdict
 * @typedef {{ url: string, title: string, bodyText: string, hasComposer: boolean, hasTurns: boolean, hasChallengeWidget: boolean, hasChallengeScript: boolean }} InterstitialSignals
 */

/**
 * Classify Cloudflare evidence without reading a live page.
 * @param {Partial<InterstitialSignals>} signals
 * @returns {CloudflareVerdict}
 */
export function classifyCloudflareVerdict({
    title = '',
    bodyText = '',
    hasComposer = false,
    hasTurns = false,
    hasChallengeWidget = false,
    hasChallengeScript = false,
} = {}) {
    const normalizedTitle = title.toLowerCase();
    const normalizedBody = bodyText.toLowerCase().replace(/\s+/g, ' ').trim();
    const hasShell = hasComposer || hasTurns;
    const titleSaysChallenge = normalizedTitle.includes('just a moment')
        || (normalizedTitle.includes('attention required') && normalizedTitle.includes('cloudflare'));

    if (hasShell) return { kind: 'shell', evidence: hasComposer ? 'composer' : 'conversation turn' };
    if (titleSaysChallenge) return { kind: 'strong', evidence: 'challenge title' };
    if (hasChallengeWidget) return { kind: 'strong', evidence: 'challenge widget' };

    const isShortPage = normalizedBody.length < CLOUDFLARE_SHORT_BODY_LENGTH;
    const matchedCopy = isShortPage
        ? GENERIC_CHALLENGE_PATTERNS.find((pattern) => pattern.test(normalizedBody))
        : undefined;
    if (matchedCopy) return { kind: 'strong', evidence: `challenge copy: ${matchedCopy.source}` };
    if (isShortPage && hasChallengeScript) return { kind: 'weak', evidence: 'challenge script on short page' };
    return { kind: 'none', evidence: '' };
}

/**
 * Classify an interstitial from already-gathered page signals (pure, single-shot).
 * Weak evidence counts in this synchronous compatibility API; live callers use
 * detectInterstitial so weak evidence must survive the hydration grace window.
 * @param {Partial<InterstitialSignals>} signals
 * @returns {InterstitialResult}
 */
export function classifyInterstitial({ url = '', bodyText = '', hasComposer = false, hasTurns = false, ...rest } = {}) {
    const cloudflare = classifyCloudflareVerdict({ bodyText, hasComposer, hasTurns, ...rest });
    if (cloudflare.kind === 'strong' || cloudflare.kind === 'weak') {
        return { kind: 'cloudflare-challenge', evidence: cloudflare.evidence, url, retryHint: 'wait-and-retry' };
    }

    const lower = bodyText.toLowerCase();
    if (/^https:\/\/auth0?\.|\/auth\/|\/login/i.test(url)) {
        return { kind: 'login-required', evidence: `auth URL: ${url}`, url, retryHint: 'login' };
    }
    if (LOGIN_PATTERNS.some((pattern) => lower.includes(pattern)) && bodyText.length < 2000) {
        const matched = LOGIN_PATTERNS.find((pattern) => lower.includes(pattern)) || 'login';
        return { kind: 'login-required', evidence: matched, url, retryHint: 'login' };
    }

    const isChatGptUrl = /chatgpt\.com|chat\.openai\.com/.test(url);
    if (isChatGptUrl && !hasComposer && !hasTurns && bodyText.length < 500) {
        return { kind: 'empty-shell', evidence: 'no composer and no turns', url, retryHint: 'wait-and-retry' };
    }
    return { kind: 'none', evidence: '', url, retryHint: 'none' };
}
```

The shell verdict deliberately falls through to login/empty-shell/none classification rather than returning a final interstitial result itself. Because shell signals make the `empty-shell` condition false, normal app pages settle on `none`; auth URL precedence remains unchanged from the public classifier's perspective.

Before (`web-ai/interstitial.mjs:70-85`):

```js
export async function detectInterstitial(page) {
    const url = page?.url?.() || '';
    try {
        const bodyText = await page.innerText('body').catch(() => '');
        const hasComposer = await hasAnySelector(page, COMPOSER_SELECTORS);
        const hasTurns = await hasAnySelector(page, ASSISTANT_TURN_SELECTORS);
        return classifyInterstitial({ url, bodyText, hasComposer, hasTurns });
    } catch {
        return { kind: 'none', evidence: 'detection failed', url, retryHint: 'none' };
    }
}
```

After — replace that function and append the two helpers before `hasAnySelector` at current `:96`:

```js
/**
 * Detect an interstitial on a live page. Weak Cloudflare evidence must persist
 * through the bounded hydration grace window; all other evidence returns once.
 * @param {any} page
 * @param {{ graceMs?: number, intervalMs?: number }} [options]
 * @returns {Promise<InterstitialResult>}
 */
export async function detectInterstitial(page, {
    graceMs = CLOUDFLARE_HYDRATION_GRACE_MS,
    intervalMs = CLOUDFLARE_REPROBE_INTERVAL_MS,
} = {}) {
    const url = page?.url?.() || '';
    const deadline = Date.now() + Math.max(0, graceMs);
    try {
        for (;;) {
            const signals = await gatherInterstitialSignals(page, url);
            const verdict = classifyCloudflareVerdict(signals);
            if (verdict.kind === 'strong') {
                return { kind: 'cloudflare-challenge', evidence: verdict.evidence, url, retryHint: 'wait-and-retry' };
            }
            if (verdict.kind !== 'weak') return classifyInterstitial(signals);
            if (Date.now() >= deadline) return classifyInterstitial(signals);
            await delay(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
        }
    } catch {
        return { kind: 'none', evidence: 'detection failed', url, retryHint: 'none' };
    }
}

/**
 * @param {any} page
 * @param {string} url
 * @returns {Promise<InterstitialSignals>}
 */
async function gatherInterstitialSignals(page, url) {
    const [title, bodyText, hasComposer, hasTurns, hasChallengeWidget, hasChallengeScript] = await Promise.all([
        page.title().catch(() => ''),
        page.innerText('body').catch(() => ''),
        hasAnySelector(page, COMPOSER_SELECTORS),
        hasAnySelector(page, ASSISTANT_TURN_SELECTORS),
        hasAnySelector(page, CHALLENGE_WIDGET_SELECTORS),
        hasAnySelector(page, CHALLENGE_SCRIPT_SELECTORS),
    ]);
    return { url, title, bodyText, hasComposer, hasTurns, hasChallengeWidget, hasChallengeScript };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Why the loop belongs here: `classifyInterstitial` receives one immutable signal object and must remain deterministic for existing tests and compatibility. Only `detectInterstitial` owns a live `page` and can re-read hydration state. There is no higher production caller in the real tree to own this wait. Optional timing parameters are dependency seams for fast fake-timer tests, not production configuration.

### 2. `test/unit/web-ai-interstitial.test.mjs`

Before (`test/unit/web-ai-interstitial.test.mjs:1-2`):

```js
import { describe, expect, it } from 'vitest';
import { classifyInterstitial, isPageDeathError } from '../../web-ai/interstitial.mjs';
```

After — modify the import at current `:1-2`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    classifyCloudflareVerdict,
    classifyInterstitial,
    detectInterstitial,
    isPageDeathError,
} from '../../web-ai/interstitial.mjs';
```

Add these focused cases inside the existing describe block. The page stub is copy-paste executable with Vitest and models selector counts per snapshot:

```js
afterEach(() => {
    vi.useRealTimers();
});

it('shell vetoes generic challenge copy on a normal page', () => {
    const bodyText = 'A normal article quotes “checking your browser” for troubleshooting.';
    const verdict = classifyCloudflareVerdict({ bodyText, hasTurns: true });
    expect(verdict.kind).toBe('shell');
    expect(classifyInterstitial({ url: 'https://chatgpt.com/c/1', bodyText, hasTurns: true }).kind).toBe('none');
});

it('does not flag a hydrated Work UI carrying a challenge script', () => {
    const result = classifyInterstitial({
        url: 'https://chatgpt.com/',
        bodyText: 'Work',
        hasComposer: true,
        hasChallengeScript: true,
    });
    expect(result.kind).toBe('none');
});

it('generic challenge copy requires a body shorter than 600 normalized characters', () => {
    const short = `Checking your browser ${'x'.repeat(577)}`;
    const boundary = `Checking your browser ${'x'.repeat(578)}`;
    expect(short.length).toBe(599);
    expect(boundary.length).toBe(600);
    expect(classifyCloudflareVerdict({ bodyText: short }).kind).toBe('strong');
    expect(classifyCloudflareVerdict({ bodyText: boundary }).kind).toBe('none');
});

it('classifies a real shell-less structured challenge immediately', () => {
    const verdict = classifyCloudflareVerdict({ hasChallengeWidget: true, bodyText: 'Verify' });
    expect(verdict).toEqual({ kind: 'strong', evidence: 'challenge widget' });
});

it('clears weak evidence when the app shell hydrates during grace', async () => {
    vi.useFakeTimers();
    const page = makePage([
        { bodyText: '', hasChallengeScript: true },
        { bodyText: 'Work', hasChallengeScript: true, hasComposer: true },
    ]);
    const pending = detectInterstitial(page, { graceMs: 12_000, intervalMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toMatchObject({ kind: 'none' });
});

it('classifies persistent weak evidence only after grace expires', async () => {
    vi.useFakeTimers();
    const page = makePage([{ bodyText: '', hasChallengeScript: true }]);
    const pending = detectInterstitial(page, { graceMs: 12_000, intervalMs: 500 });
    await vi.advanceTimersByTimeAsync(11_999);
    let settled = false;
    pending.finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ kind: 'cloudflare-challenge' });
});

function makePage(snapshots) {
    let index = -1;
    let current = snapshots[0];
    return {
        url: () => 'https://chatgpt.com/',
        title: async () => {
            index = Math.min(index + 1, snapshots.length - 1);
            current = snapshots[index];
            return current.title || '';
        },
        innerText: async () => current.bodyText || '',
        locator: (selector) => ({
            count: async () => {
                if (selector.includes('prompt-textarea')) return current.hasComposer ? 1 : 0;
                if (selector.includes('challenge-platform')) return current.hasChallengeScript ? 1 : 0;
                if (selector.includes('challenge')) return current.hasChallengeWidget ? 1 : 0;
                return current.hasTurns ? 1 : 0;
            },
        }),
    };
}
```

Implementation audit note: if the concurrent `Promise.all` stub ordering makes snapshot advancement unclear, replace `makePage` with a selector-keyed fixture object per call; do not weaken the production concurrent gather merely to satisfy a brittle test double.

## Test plan

The repository convention is Vitest: `package.json:42` defines `test:unit` as `vitest run test/unit`; the focused file already imports Vitest at `test/unit/web-ai-interstitial.test.mjs:1`.

Run in this order:

```sh
npx vitest run test/unit/web-ai-interstitial.test.mjs
npm run test:unit
```

Focused required cases:

1. Strong title (`Just a moment`) on a shell-less page returns immediately.
2. Structured challenge widget on a shell-less page returns immediately.
3. Normal content page quoting “checking your browser” with body length at least 600 returns `none`.
4. Normal ChatGPT page quoting challenge copy with `hasTurns` returns `none` (shell veto).
5. GPT-5.6 Work UI fixture with composer plus challenge script returns `none` (shell veto).
6. Generic copy at normalized lengths 599 and 600 proves the strict `< 600` boundary.
7. Weak script-only snapshot followed by composer hydration at 500 ms clears to `none`.
8. Persistent weak script-only snapshots do not settle before 12,000 ms and classify at expiry.
9. Weak evidence disappearing before expiry returns immediately through ordinary classification (`empty-shell` on short ChatGPT body or `none` elsewhere, according to fixture URL/body).
10. Existing login, empty-shell, none, and `isPageDeathError` tests remain green.

## Accept criteria

- `classifyCloudflareVerdict` exposes explicit `strong | shell | weak | none` evidence without reading page state.
- Strong means shell absent plus challenge title or structured challenge widget, or shell absent plus generic copy on normalized body length `< 600`.
- Composer or assistant-turn presence vetoes every Cloudflare title/widget/copy/script branch. This intentionally follows the requested app-shell veto ordering even if challenge-like content is also present.
- Script-only evidence is `weak`, shell-less, and short-page-only.
- `classifyInterstitial` remains synchronous and preserves its exported name/result shape.
- `detectInterstitial` alone owns bounded re-probing: 12,000 ms maximum, 500 ms cadence, only while weak evidence persists.
- No production provider file is modified or claimed wired; consumer inventory remains explicit.
- Focused and complete unit suites pass.

### C-ACTIVATION-GROUNDING-01 scenarios

| Conditional | Activation fixture | Required observable result | Non-activation control |
| --- | --- | --- | --- |
| Shell-veto firing | `hasComposer: true` or `hasTurns: true` plus generic copy and/or challenge script (Work UI fixture included). | Pure verdict is `shell`; final classification is not `cloudflare-challenge`; live detector returns without sleeping. | Same shell-less short generic-copy fixture is `strong`; same shell-less short script-only fixture is `weak`. |
| Short-page gate firing | Shell absent, generic copy present, normalized body length 599. | Verdict is `strong`, immediate Cloudflare result. | Same content padded to normalized length 600 is `none`; no grace loop activates unless script-only weak evidence is independently present. |
| Grace-window expiry | Shell absent, challenge script present, normalized body `< 600` on every 500 ms sample through 12,000 ms. | Promise remains unsettled before deadline and returns Cloudflare at/after expiry. | Shell appearance or weak-evidence loss on any sample returns immediately and never waits to deadline. |

## Risks and rollback

- **Latency:** a genuine script-only challenge now costs up to 12 seconds. This is intentionally limited to ambiguous weak evidence; strong and shell/no-evidence paths do not wait.
- **Selector presence versus visibility:** existing `hasAnySelector` uses count, not visibility (`web-ai/interstitial.mjs:101-106`). This phase preserves that contract; hidden stale shell nodes could veto. Visibility semantics require provider-specific evidence and are out of scope.
- **Threshold brittleness:** content localization can move a real copy-only page above 600 chars. Structured title/widget remains strong. Roll back the copy gate independently only with a captured false-negative fixture; do not remove shell veto.
- **Unused production API:** tests can pass without changing runtime behavior because no production consumer exists. Wiring must be a separate roadmap update naming the exact caller, retry/abort semantics, and integration test.
- **Timer test brittleness:** use Vitest fake timers and injected timing options; avoid real 12-second tests.

Rollback is a two-file revert of this implementation phase: restore the prior classifier/live detector in `web-ai/interstitial.mjs` and remove only the new focused cases/imports in `test/unit/web-ai-interstitial.test.mjs`. No migration, persisted state, dependency, or public CLI contract is involved.
