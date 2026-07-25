# WP4 — G13b: consume interstitial verdicts on the Grok and Gemini submit paths

Row: **G13b** (Round 3 `040_gap_matrix.md` follow-up; Grok/Gemini wiring deferred when
`fe52ea5` landed the ChatGPT half).

## 1. Problem

`web-ai/interstitial.mjs` already ships per-provider shell selectors for all three
vendors (`interstitial.mjs:34-47`: `chatgpt`, `grok`, `gemini`), but only ChatGPT
consumes the detector. `rg -n "interstitial" web-ai/*.mjs` returns hits in exactly two
production files: `chatgpt.mjs` (import at `:26`, use at `:490-508`) and the error/stage
vocabulary (`errors.mjs:14`, `failure-diagnostics.mjs:91,114`).

So when Cloudflare interposes a challenge on grok.com or a Gemini page returns an empty
shell, the user gets:

- Grok: `provider.composer-not-visible` / `composer-prereq` / retryHint `re-snapshot`
  (`grok-live.mjs:155-162`, and again at `:398-405` for the new-chat control).
- Gemini: the same code from `gemini-live.mjs:201-208` and `:840-848`.

`re-snapshot` is the wrong instruction for a challenge page — the composer will never
appear by re-snapshotting — and the failure record loses the challenge evidence that the
detector could have supplied.

ChatGPT's landed pattern (`chatgpt.mjs:490-508`) is the template: run the vendor's
readiness step, and only on failure run a bounded provider-scoped probe; when the verdict
is not `none`, rethrow as `provider.interstitial` / stage `provider-interstitial` with
the detector's own `retryHint` and the verdict as `evidence`, chaining the original error
as `cause`. When the verdict is `none`, the original error is preserved untouched.

## 2. Change map

### 2.1 NEW `web-ai/composer-interstitial.mjs`

One shared wrapper instead of two copies of the ChatGPT block:

```js
// @ts-check
import { detectInterstitial, INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER } from './interstitial.mjs';
import { WebAiError } from './errors.mjs';

/**
 * Re-classify a composer-readiness failure as a provider interstitial when a
 * bounded, provider-scoped probe finds one. Returns the interstitial error to
 * throw, or null when the original failure should stand.
 * @param {any} page
 * @param {'chatgpt'|'grok'|'gemini'} vendor
 * @param {unknown} cause
 * @param {{ detect?: typeof detectInterstitial }} [options]
 * @returns {Promise<WebAiError|null>}
 */
export async function classifyComposerInterstitial(page, vendor, cause, { detect = detectInterstitial } = {}) {
    const shellSelectors = INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER[vendor];
    if (!shellSelectors) return null;
    const verdict = await detect(page, { shellSelectors }).catch(() => null);
    if (!verdict || verdict.kind === 'none') return null;
    return new WebAiError({
        errorCode: 'provider.interstitial',
        stage: 'provider-interstitial',
        vendor,
        retryHint: verdict.retryHint,
        message: `${vendor} interstitial blocked composer readiness: ${verdict.kind}`,
        evidence: verdict,
        cause,
    });
}
```

The `.catch(() => null)` is deliberate: a detector failure must never replace the real
composer error with a probe error.

### 2.2 MODIFY `web-ai/grok-live.mjs`

```diff
+import { classifyComposerInterstitial } from './composer-interstitial.mjs';
@@ grokSendWebAi — composer probe (~:154-162)
     const composerSel = await findFirstSelector(page, COMPOSER_SELECTORS, 10_000);
-    if (!composerSel) throw new WebAiError({ ...composer-not-visible... });
+    if (!composerSel) {
+        const notVisible = new WebAiError({
+            errorCode: 'provider.composer-not-visible',
+            stage: 'composer-prereq',
+            vendor: 'grok',
+            retryHint: 're-snapshot',
+            message: 'grok composer not visible',
+            selectorsTried: COMPOSER_SELECTORS,
+        });
+        throw (await classifyComposerInterstitial(page, 'grok', notVisible)) || notVisible;
+    }
```

The `openFreshGrokChat` new-chat-control failure (`:398-405`) gets the same treatment:
a challenge page has no new-chat control either.

### 2.3 MODIFY `web-ai/gemini-live.mjs`

Identical shape at the two composer-not-visible sites (`:201-208` in `geminiSendWebAi`,
`:840-848` in `openFreshGeminiChat`), with `vendor: 'gemini'`.

## 3. Accept criteria (activation-grounded)

| Scenario | Activation | Observable effect |
|----------|-----------|-------------------|
| Grok behind a challenge | injected `detect` returning `{ kind: 'cloudflare-challenge', retryHint: 'wait-and-retry', ... }` | thrown error has `errorCode: 'provider.interstitial'`, `stage: 'provider-interstitial'`, `vendor: 'grok'`, `retryHint: 'wait-and-retry'`, `evidence.kind === 'cloudflare-challenge'`, and `cause.errorCode === 'provider.composer-not-visible'` |
| Gemini login wall | injected `detect` returning `{ kind: 'login-required', retryHint: 'login' }` | same shape with `vendor: 'gemini'`, `retryHint: 'login'` |
| Plain composer miss | `detect` returns `{ kind: 'none' }` | original `provider.composer-not-visible` is thrown unchanged (no rewrap) |
| Detector throws | `detect` rejects | original error still thrown; no probe error leaks |

Test file: `test/unit/web-ai-composer-interstitial.test.mjs` (NEW), testing
`classifyComposerInterstitial` directly with an injected detector — the same
dependency-injection style as `test/unit/web-ai-chatgpt-interstitial.test.mjs:3-33`,
which avoids standing up a full Grok/Gemini page fake.

A source-shape assertion additionally proves the wiring is reached from both providers
(`grok-live.mjs` and `gemini-live.mjs` each contain `classifyComposerInterstitial`), so
the test cannot pass against an unconsumed helper — the exact failure mode Round 3's WP5
audit caught for `interstitial.mjs` itself.

## 4. Scope boundary

IN: the new shared module, the two provider modules, the new test file.
OUT: refactoring `chatgpt.mjs:490-508` onto the shared helper (its behavior is already
correct and covered; a rewrite would add regression risk for zero user-visible gain —
recorded here as a deliberate rebuttal, not an oversight), poll-path interstitial
detection, and any change to `interstitial.mjs` classification logic.
