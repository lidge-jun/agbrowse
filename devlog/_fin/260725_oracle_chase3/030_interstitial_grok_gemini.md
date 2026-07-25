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

## 5. Audit amendments (A-gate round 1, reviewer Schrodinger)

**Blocker 5 [Medium] accepted — two of the four wiring sites are dead for the stated
scenario.** Verified in source:

- `grok-live.mjs:396-397`: `openFreshGrokChat` returns early when `countResponses(page)`
  is 0, so a challenge page (zero turns) never reaches the new-chat error at `:398-405`.
- `gemini-live.mjs:839-840`: same shape — `if ((await countResponses(page)) === 0) return;`
  guards the new-chat error at `:841-848`.
- And if turns *do* exist, `classifyCloudflareVerdict` vetoes at `interstitial.mjs:62`
  (`if (hasComposer || hasTurns) return { kind: 'shell-vetoed' }`), so the detector would
  return `none` anyway.

**Amendment: drop the new-chat-control wiring entirely.** §2.2's second site and §2.3's
`:840-848` site are removed from the change map. Only the two post-`openFresh*`
composer-miss sites remain — `grok-live.mjs:155-162` and `gemini-live.mjs:201-208` — and
those are reachable exactly as the plan describes: on a challenge page `findFirstSelector`
times out with no composer, the detector sees `hasComposer:false, hasTurns:false`, and
`classifyCloudflareVerdict` can return `strong`.

**Blocker 5b [Medium] accepted — a source-string assertion proves nothing.** The planned
"contains `classifyComposerInterstitial`" check passes on an unused import, which is the
same unconsumed-detector failure Round 3's WP5 audit caught. Amendment: the wiring is
proven behaviorally. `grokSendWebAi` / `geminiSendWebAi` accept an injectable detector
through their existing deps/options object, and the test drives the real send path with a
page fake whose composer selectors never resolve.

```diff
*** web-ai/grok-live.mjs (composer miss site)
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
+        throw (await classifyComposerInterstitial(page, 'grok', notVisible, {
+            detect: input.__detectInterstitial,   // undefined in production -> real detector
+        })) || notVisible;
+    }
```

The injection seam is the same one `waitForChatGptComposerReady` already uses
(`chatgpt.mjs:490`, `{ detect = detectInterstitial } = {}`), and
`test/unit/web-ai-chatgpt-interstitial.test.mjs:13-32` is the precedent for driving it.

**Blocker 10 [Low] accepted — §1's `rg` claim.** The command names three files, not two:
`chatgpt.mjs` (the one runtime consumer) plus `errors.mjs` and `failure-diagnostics.mjs`
(error-code and stage vocabulary). §1 should read "one runtime consumer plus two
vocabulary files."

**Revised accept criteria.** Test file `test/unit/web-ai-composer-interstitial.test.mjs`:

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | `classifyComposerInterstitial(page,'grok',cause,{detect:()=>challenge})` | returns `WebAiError` with `errorCode:'provider.interstitial'`, `stage:'provider-interstitial'`, `vendor:'grok'`, `retryHint:'wait-and-retry'`, `evidence.kind:'cloudflare-challenge'`, `cause` preserved |
| 2 | gemini + `{ kind:'login-required', retryHint:'login' }` | same shape, `vendor:'gemini'`, `retryHint:'login'` |
| 3 | detector returns `{ kind:'none' }` | returns `null` (caller throws the original error unchanged) |
| 4 | detector rejects | returns `null`; no probe error escapes |
| 5 | unknown vendor | returns `null` |
| 6 | **behavioral**: `grokSendWebAi` against a page fake with no composer + injected challenge detector | the thrown error is `provider.interstitial`, not `provider.composer-not-visible` |
| 7 | **behavioral**: same for `geminiSendWebAi` | same |

Cases 6-7 replace the rejected string-presence assertion: they fail if the helper is
imported but not called.

## 6. Audit amendments (A-gate round 2, same reviewer)

### 6.1 Blocker 4 [Medium] accepted — the seam was both unsafe and untestable as written

Two real defects:

1. `detect(page, ...).catch(...)` assumes the injected detector returns a promise. §5's own
   test case 1 injects `() => challenge` (a plain object), so `.catch` would throw
   `TypeError` — the test could not pass. A synchronous throw would likewise escape,
   violating the helper's "never replace the real error with a probe error" contract.
2. Threading the seam through `input.__detectInterstitial` puts a test hook on the public
   caller-supplied input object: any truthy non-function value from an unvalidated caller
   turns a composer error into a `TypeError`.

**Amendment: validate the injection and normalize the call.**

```diff
 export async function classifyComposerInterstitial(page, vendor, cause, { detect = detectInterstitial } = {}) {
     const shellSelectors = INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER[vendor];
     if (!shellSelectors) return null;
-    const verdict = await detect(page, { shellSelectors }).catch(() => null);
+    const probe = typeof detect === 'function' ? detect : detectInterstitial;
+    const verdict = await Promise.resolve()
+        .then(() => probe(page, { shellSelectors }))
+        .catch(() => null);
     if (!verdict || verdict.kind === 'none') return null;
```

`Promise.resolve().then(...)` accepts a sync-returning detector, a promise-returning one, a
rejected promise, and a synchronous throw — all four collapse to `null` or a verdict, never
to an escaping `TypeError`.

**Seam relocation.** The provider wiring no longer reads `input`. `grokSendWebAi` /
`geminiSendWebAi` take the override from their existing internal deps object:

```diff
-        throw (await classifyComposerInterstitial(page, 'grok', notVisible, {
-            detect: input.__detectInterstitial,
-        })) || notVisible;
+        throw (await classifyComposerInterstitial(page, 'grok', notVisible, {
+            detect: deps?.detectInterstitial,   // internal test seam; undefined in production
+        })) || notVisible;
```

`deps` is the module-internal dependency bag the send paths already receive, which is not
user-facing input. A non-function value there is neutralized by the `typeof` guard above.

### 6.2 Revised test matrix (supersedes §5)

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | detector returns a plain object (sync) | verdict honored; no `TypeError` |
| 2 | detector returns a promise | verdict honored |
| 3 | detector returns a rejected promise | `null` returned; original error preserved |
| 4 | detector throws synchronously | `null` returned; original error preserved |
| 5 | `detect` injected as a non-function (e.g. `true`) | falls back to the real detector; no throw |
| 6 | `{ kind: 'none' }` | `null` |
| 7 | unknown vendor | `null`; detector never called |
| 8 | grok challenge verdict | `provider.interstitial` / `provider-interstitial` / `vendor:'grok'` / `retryHint:'wait-and-retry'` / `cause` preserved |
| 9 | gemini login verdict | same with `vendor:'gemini'`, `retryHint:'login'` |
| 10 | **behavioral** `grokSendWebAi`, composer never resolves, deps-injected challenge detector | thrown error is `provider.interstitial`, not `provider.composer-not-visible` |
| 11 | **behavioral** `geminiSendWebAi`, same | same |

## 7. Scope correction (audit round 4, reviewer Mill)

**Blocker 7 [Medium] accepted.** §1 named "a Gemini page returns an empty shell" as a
motivating case, but `interstitial.mjs:90-92` gates the `empty-shell` verdict on the host:

```js
if (/chatgpt\.com|chat\.openai\.com/.test(url) && !hasComposer && !hasTurns && bodyText.length < 500) {
    return { kind: 'empty-shell', ... };
}
```

So a hydrated-but-empty Grok or Gemini page returns `kind: 'none'` and this phase changes
nothing for it. Two options were available: widen `empty-shell` to be provider-aware, or
narrow the phase's claim.

**Decision: narrow the claim.** Widening `empty-shell` to Grok/Gemini means asserting "no
composer + short body = broken" for two providers whose loading behavior we have not
characterized, on a detector whose Cloudflare path already carries a 12-second hydration
grace (`interstitial.mjs:50`) precisely because that judgment is delicate. A false
`empty-shell` would convert a slow load into a hard error — a worse failure than the
`re-snapshot` hint we are replacing. That work needs its own characterization pass and is
recorded as a follow-up row, not smuggled into this phase.

**Corrected §1 claim:** this phase makes Grok and Gemini surface **Cloudflare challenges and
login walls** (the two verdicts their shell selectors can already produce) as
`provider.interstitial` instead of `provider.composer-not-visible`. Empty-shell handling for
non-ChatGPT hosts is **G13c — deferred**, tracked for a future unit.

The §6.2 test matrix is unchanged: cases 8 and 9 already exercise exactly the challenge and
login verdicts this corrected scope claims, and no case asserted empty-shell behavior.
