# WP5 — G13c: provider-aware empty-shell verdict

Row: **G13c**, opened by the round-4 WP4 audit (`260725_oracle_chase3/030` §7).

## 1. Problem

`classifyInterstitial` (`interstitial.mjs:90-92`) gates the `empty-shell` verdict on
the ChatGPT host set:

```js
if (/chatgpt\.com|chat\.openai\.com/.test(url) && !hasComposer && !hasTurns && bodyText.length < 500) {
    return { kind: 'empty-shell', ... };
}
```

A Grok or Gemini page that hydrated into nothing — no composer, no turns, no
challenge copy, no login copy — returns `kind: 'none'`, so round 4's wiring leaves
the original `provider.composer-not-visible` / `re-snapshot` error in place. That
hint is wrong for a dead shell just as it was wrong for a challenge.

Round 4 deliberately did NOT widen this, for a reason that still stands: asserting
"no composer + short body = broken" for a provider whose loading behavior we have
not characterized risks converting a slow load into a hard error. That is a worse
failure than the imprecise hint. So this phase pays the characterization cost the
deferral named.

## 2. Characterization first (B-phase step 1, before any verdict change)

The existing Cloudflare path already models this problem: it re-probes for up to
`CLOUDFLARE_HYDRATION_GRACE_MS` (12s, `interstitial.mjs:50`) before committing to a
challenge verdict. The empty-shell path has no such grace — it is a single
snapshot judgment. Widening it to two more providers without grace is exactly the
false-positive risk.

**Deliverable:** a recorded probe of each provider's empty state, captured as
fixtures rather than prose:

- `test/fixtures/provider-dom/grok-empty-shell.html`
- `test/fixtures/provider-dom/gemini-empty-shell.html`

built from the shell selectors already declared for each provider
(`interstitial.mjs:38-46`), plus a "still loading" variant where the composer
appears after a delay. If a live probe is unavailable in this environment, the
fixtures are synthesized from those selector contracts and the doc says so — an
honest synthetic fixture beats an unproven production widening.

## 3. Change map — MODIFY `web-ai/interstitial.mjs`

### 3.1 Provider-aware host set

```diff
-const EMPTY_SHELL_HOSTS = /chatgpt\.com|chat\.openai\.com/;
+// Hosts whose empty hydrated shell is a recognized failure mode. Grok and
+// Gemini were added in round 5 behind a hydration grace (see 3.2) because a
+// single-snapshot judgment on a slow load would be a false positive.
+const EMPTY_SHELL_HOSTS = /chatgpt\.com|chat\.openai\.com|grok\.com|x\.com\/i\/grok|gemini\.google\.com/;
```

### 3.2 Grace before committing (the safety half)

`detectInterstitial` (`:101-127`) already owns a re-probe loop for the Cloudflare
`weak` verdict. `empty-shell` joins that loop with the same treatment:

```diff
     for (;;) {
         const signals = await gatherInterstitialSignals(...);
         const verdict = classifyCloudflareVerdict(signals);
         if (verdict.kind === 'strong') return cloudflareResult(url, verdict.evidence);
-        if (verdict.kind === 'shell-vetoed') return classifyInterstitial(signals);
-        if (verdict.kind === 'none') return classifyInterstitial(signals);
+        if (verdict.kind === 'shell-vetoed') return classifyInterstitial(signals);
+        if (verdict.kind === 'none') {
+            const result = classifyInterstitial(signals);
+            // An empty shell may simply be mid-hydration: keep re-probing until
+            // the grace expires before committing to that verdict. Any other
+            // verdict (login, challenge, none) is returned immediately.
+            if (result.kind !== 'empty-shell' || scheduler.now() >= deadline) return result;
+            await scheduler.sleep(...);
+            continue;
+        }
```

A composer or turn appearing at any point flips `hasComposer`/`hasTurns`, and the
next iteration returns `none` — so a slow load resolves as "not an interstitial",
which is the pre-existing behavior. Only a shell that is STILL empty after the full
grace is reported as `empty-shell`.

### 3.3 `retryHint`

`empty-shell` already carries `wait-and-retry` (`:91`), which is correct for all
three providers. No change.

## 4. Accept criteria (activation-grounded)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | grok.com, no composer/turns, short body, stays empty past grace | `empty-shell`, `wait-and-retry` |
| 2 | gemini.google.com, same | `empty-shell` |
| 3 | grok.com empty at t=0, composer appears before grace expires | `none` — no false positive (the row's whole risk) |
| 4 | gemini, turns appear before grace expires | `none` |
| 5 | chatgpt.com behavior | byte-identical to today |
| 6 | an unrelated host with an empty shell | `none` |
| 7 | grok challenge page (challenge copy present) | `cloudflare-challenge`, unchanged — challenge still wins over empty-shell |
| 8 | grok login wall | `login-required`, unchanged |
| 9 | grace timing | the loop sleeps and re-probes; a virtual scheduler proves it does not busy-spin |
| 10 | **behavioural**: `grokSendWebAi` against a persistently empty shell | throws `provider.interstitial` with `evidence.kind === 'empty-shell'` |

Case 3 is the deferral's stated fear, now a required test.

Tests: extend `test/unit/web-ai-interstitial.test.mjs` (it already injects a
`scheduler`, so grace timing is testable without real waiting).

## 5. Scope boundary

IN: `interstitial.mjs` host set + grace loop, its test file, the two fixtures.
OUT: `CLOUDFLARE_SHORT_BODY_LENGTH`, the challenge/login grammars, the provider
shell-selector tables, and `composer-interstitial.mjs` (its wiring is unchanged —
it simply starts receiving a verdict it previously never saw).

## 6. Audit amendments (A-gate round 1, blocker 5) — AUTHORITATIVE

§3.2 put ALL empty-shell verdicts into the grace loop, which silently changes
ChatGPT: today a ChatGPT empty shell is decided on the first snapshot
(`interstitial.mjs:113` returns immediately when the Cloudflare verdict is `none`),
and under the proposal a ChatGPT shell that hydrates during the 12s window would flip
from `empty-shell` to `none`. That directly contradicts this phase's own
"ChatGPT byte-identical" criterion.

**Corrected: the grace applies to the NEW hosts only.**

```diff
-const EMPTY_SHELL_HOSTS = /chatgpt\.com|chat\.openai\.com|grok\.com|x\.com\/i\/grok|gemini\.google\.com/;
+// ChatGPT keeps its historical single-snapshot judgment (byte-identical).
+const EMPTY_SHELL_HOSTS_IMMEDIATE = /chatgpt\.com|chat\.openai\.com/;
+// Providers added in round 5 are judged only after a hydration grace, because we
+// have not characterized their loading behavior and a slow load must not become a
+// hard error.
+const EMPTY_SHELL_HOSTS_GRACED = /grok\.com|x\.com\/i\/grok|gemini\.google\.com/;
```

`classifyInterstitial` reports which kind it found:

```diff
-    if (EMPTY_SHELL_HOSTS.test(url) && !hasComposer && !hasTurns && bodyText.length < 500) {
-        return { kind: 'empty-shell', ... };
-    }
+    if (!hasComposer && !hasTurns && bodyText.length < 500) {
+        if (EMPTY_SHELL_HOSTS_IMMEDIATE.test(url)) {
+            return { kind: 'empty-shell', evidence: 'no composer and no turns', url, retryHint: 'wait-and-retry' };
+        }
+        if (EMPTY_SHELL_HOSTS_GRACED.test(url)) {
+            return { kind: 'empty-shell', evidence: 'no composer and no turns', url, retryHint: 'wait-and-retry', graced: true };
+        }
+    }
```

and `detectInterstitial` re-probes only the graced flavor:

```diff
         if (verdict.kind === 'none') {
-            return classifyInterstitial(signals);
+            const result = classifyInterstitial(signals);
+            // Only the graced providers re-probe; ChatGPT returns immediately, so
+            // its behavior is unchanged in every case.
+            if (result.kind !== 'empty-shell' || !result.graced) return result;
+            if (scheduler.now() >= deadline) return { ...result, graced: undefined };
+            await scheduler.sleep(Math.min(boundedIntervalMs, Math.max(MIN_REPROBE_INTERVAL_MS, deadline - scheduler.now())));
+            continue;
         }
```

`graced` is stripped from the returned verdict so the public shape is unchanged; it
is a loop-internal flag only. The `deadline` is the one already computed at `:110`
from `graceMs`, so no new timing constant appears and the loop is bounded by the
same monotonic scheduler the tests already inject.

### 6.1 Corrected accept criteria (supersede §4 rows 1-6)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | grok.com, empty past the grace | `empty-shell`, no `graced` field on the returned object |
| 2 | gemini, empty past the grace | `empty-shell` |
| 3 | grok, composer appears mid-grace | `none` — re-probe saw it |
| 4 | gemini, turns appear mid-grace | `none` |
| 5 | **chatgpt.com empty shell** | `empty-shell` on the FIRST probe; scheduler.sleep called ZERO times (byte-identical, asserted by call count) |
| 6 | chatgpt.com that would hydrate later | still `empty-shell` immediately — unchanged, and the assertion proves we did not silently improve it |
| 7 | unrelated host, empty | `none` |
| 8 | grok challenge copy present | `cloudflare-challenge` — challenge still wins |
| 9 | grok login copy present | `login-required` |
| 10 | grace expiry | exactly one sleep per interval, loop terminates at the deadline |
| 11 | **behavioural** `grokSendWebAi` vs a persistently empty shell | throws `provider.interstitial`, `evidence.kind === 'empty-shell'` |

Row 5's zero-sleep assertion is the guard that keeps this phase honest about the
byte-identical claim.
