# WP2 — G7/G9/G12 grammar + G8 strata

Rows: **G7** (`1e2f71a0`), **G9** (`86d1fb2b`), **G12** (`57d4a7af`), **G8** (`ded58d44`).

> Sections 1-4 below were written when the triage still believed G7/G12 were
> Covered. Section 5 (audit amendments) is authoritative where they differ.

## 1. Problem

`readChatGptStreamingState` (`chatgpt-response-dom.mjs:60`) returns a single
`boolean`. Four very different signals all produce the same `true`:

| Signal | Source | Strength |
|--------|--------|----------|
| visible stop button | `:90-99` | **strong** — the model is generating right now |
| live progress bar in the latest turn | `:178-180` | **strong** |
| live progress bar in a verified thinking panel | `:206` | **strong** |
| panel whose visible text merely contains "thinking"/"reasoning" | `:209-211` | **weak** — a mounted sidecar can say this long after work stopped |

Upstream `ded58d44` splits exactly this: strong activity vetoes a completion
proof; weak activity may itself be overridden by stable, debounced completion
evidence. With one boolean, a stale mounted reasoning sidecar hangs the poll loop
forever — the failure this row exists to prevent.

Callers today: `chatgpt.mjs:645`, `:825` (`readStreaming` adapter) and `:877`,
all through the private `isStreaming(page)` at `:983`.

## 2. Change map

### 2.1 MODIFY `web-ai/chatgpt-response-dom.mjs` — return a structured verdict

```diff
 /**
- * @returns {boolean}
+ * @typedef {'strong'|'weak'|'none'} ChatGptActivityStrength
+ * @typedef {{ strength: ChatGptActivityStrength, evidence: string }} ChatGptActivityState
+ * @returns {ChatGptActivityState}
  */
 export function readChatGptStreamingState({ assistantSelectors, stopSelectors, resolverSource }) {
@@ stop-button branch
-        if (Array.from(nodes).some(isVisible)) return true;
+        if (Array.from(nodes).some(isVisible)) return { strength: 'strong', evidence: 'stop-button' };
@@ latest-turn progress
-        if (hasLiveProgress(latestAssistant)) return true;
+        if (hasLiveProgress(latestAssistant)) return { strength: 'strong', evidence: 'turn-progress' };
@@ panel progress
-        if (hasLiveProgress(panel)) return true;
+        if (hasLiveProgress(panel)) return { strength: 'strong', evidence: 'panel-progress' };
@@ panel text
-        if (visibleText.includes('thinking') || ...) return true;
+        if (visibleText.includes('thinking')
+            || visibleText.includes('reasoning')
+            || visibleText.includes('pro thinking')) return { strength: 'weak', evidence: 'panel-text' };
@@ end
-    return false;
+    return { strength: 'none', evidence: '' };
 }
```

The anchored completed-summary `continue` at `:208` is unchanged — that is the
G7/G12 grammar, already correct.

**Ordering matters and is deliberate:** the loop must not return `weak` from the
first panel while a later panel has live progress. So panel iteration collects the
weak hit and keeps scanning; only after the loop ends is a recorded weak verdict
returned.

```diff
+    let weakVerdict = null;
     for (const panel of Array.from(panels)) {
         ...
-        if (visibleText.includes('thinking') || ...) return { strength: 'weak', ... };
+        if (visibleText.includes('thinking') || ...) { weakVerdict ||= { strength: 'weak', evidence: 'panel-text' }; }
     }
+    if (weakVerdict) return weakVerdict;
     return { strength: 'none', evidence: '' };
```

### 2.2 NEW compatibility helper (same module)

```js
/**
 * Back-compatible boolean view of an activity verdict.
 * @param {ChatGptActivityState|boolean|null|undefined} state
 * @returns {boolean}
 */
export function isActiveState(state) {
    if (typeof state === 'boolean') return state;
    return Boolean(state && state.strength !== 'none');
}
```

### 2.3 MODIFY `web-ai/chatgpt.mjs` — keep callers working, expose strength

`isStreaming(page)` keeps its boolean contract (three call sites depend on it) and
gains a sibling that returns the verdict:

```diff
+/**
+ * @param {any} page
+ * @returns {Promise<ChatGptActivityState>}
+ */
+async function readActivityState(page) {
+    try {
+        const state = await page.evaluate(readChatGptStreamingState, {
+            assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
+            stopSelectors: CHATGPT_STOP_SELECTORS,
+            resolverSource: resolveTopLevelAssistantTurns.toString(),
+        });
+        if (state && typeof state === 'object') return state;
+    } catch { /* page may be navigating or lack a complete DOM context */ }
+    // Navigation/test-harness fallback: the shared selector contract only.
+    try {
+        if (await anyStopButtonVisible(page)) return { strength: 'strong', evidence: 'stop-button' };
+    } catch { /* fail closed to none */ }
+    return { strength: 'none', evidence: '' };
+}
+
 async function isStreaming(page) {
-    ...existing body...
+    return isActiveState(await readActivityState(page));
 }
```

Note the fallback also collapses onto `anyStopButtonVisible` from WP2 of round 4,
removing the duplicated selector walk currently inlined at `chatgpt.mjs:996-1003`.

### 2.4 MODIFY the completion path — weak activity no longer blocks stable proof

The behavioral payoff. At `chatgpt.mjs:877` the poll loop treats any activity as a
reason to keep waiting. It becomes:

```diff
-        const streaming = await isStreaming(page);
+        const activity = await readActivityState(page);
+        // Strong activity always wins. Weak activity (a mounted sidecar that still
+        // says "Thinking") is overridden once the answer text has been stable for
+        // the debounce window — that is the stale-sidecar hang this row fixes.
+        const streaming = activity.strength === 'strong'
+            || (activity.strength === 'weak' && !stableForDebounce);
```

where `stableForDebounce` is the existing stability computation already present in
that loop (`responseStableMs >= STABLE_MS`). No new timing constant is introduced.

## 3. Accept criteria (activation-grounded)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | visible stop button | `{strength:'strong', evidence:'stop-button'}` |
| 2 | live `<progress>` inside the latest assistant turn | `strong`, `turn-progress` |
| 3 | right-side verified panel with a live progressbar | `strong`, `panel-progress` |
| 4 | right-side panel whose text is "Thinking" only | `weak`, `panel-text` |
| 5 | panel text exactly `Thought for 12s` | `none` (G7 pinned) |
| 6 | panel text exactly `Thought for 12s Edit` | `none` (G12 pinned) |
| 7 | panel text `Thought for 2s: Searching…` | `weak` — a growing live trace is NOT a completed summary (G9 pinned) |
| 8 | weak panel AND a live progressbar in a later panel | `strong` — ordering guard |
| 9 | nothing | `none` |
| 10 | `isActiveState` over `true`/`false`/verdicts/null | boolean view is correct |
| 11 | **transport**: `page.evaluate(readChatGptStreamingState, arg)` in real Chromium | returns the verdict object, no `ReferenceError` |
| 12 | poll loop: weak activity + text stable past debounce | completes instead of hanging |
| 13 | poll loop: strong activity + text stable past debounce | keeps waiting |

Tests: extend `test/unit/web-ai-chatgpt-response-fragments.test.mjs` (it already
has the jsdom rect-stubbing harness this needs) and add the transport case to
`test/integration/composer-menu-transport.test.mjs`'s sibling — a new
`test/integration/activity-state-transport.test.mjs`.

## 4. Scope boundary

IN: `chatgpt-response-dom.mjs`, `chatgpt.mjs` activity/poll paths, the two test
files, `structure/str_func.md` counts.
OUT: the anchored completed-summary grammar itself (Covered — only pinned by
tests here), busy/`aria-busy` signals (never adopted; adding them is a new row,
not this one), `chatgpt-response-observer.mjs` (reads the same helper but its
own gate is out of scope), and any change to `STABLE_MS`.

## 5. Audit amendments (A-gate round 1, reviewer Gauss) — AUTHORITATIVE

### 5.1 Blocker 1 accepted — the grammar is real work, not covered

`000` §3.1 records the measurement. Two changes to `chatgpt-response-dom.mjs`:

**(a) Port upstream's full completed-summary grammar** (`86d1fb2b:537-538`), as a
module-local constant inside the serialized function (serialization rule):

```diff
-        if (/^thought for \d+[a-z]*( seconds?| minutes?)?( edit)?$/i.test(visibleText)) continue;
+        if (isCompletedReasoningSummary(visibleText)) { continue; }
+        // A GROWING trace still mentioning "thought for" is LIVE — this is the
+        // re-entry rule the first port dropped, and without it
+        // "Thought for 2s: Searching…" reads as no activity at all.
+        if (visibleText.includes('thought for ')) { weakVerdict ||= { strength: 'weak', evidence: 'panel-trace' }; continue; }
```

with, declared INSIDE `readChatGptStreamingState`:

```js
const UNIT = '(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)';
const NUMERIC = `\\d+(?:\\.\\d+)?\\s*${UNIT}`;
const COMPLETED_SUMMARY = new RegExp(
    `^(?:(?:reasoning|pro thinking)\\s*)?thought for `
    + `(?:${NUMERIC}(?:\\s+${NUMERIC})*|(?:a|an) [a-z]+(?: [a-z]+){0,2})`
    + `(?: edit)?$`,
);
const isCompletedReasoningSummary = (text) => COMPLETED_SUMMARY.test(text);
```

Deltas from upstream, both deliberate: the trailing `(?: edit)?` folds in `57d4a7af`
(G12), and matching runs on the already-normalized lowercase `norm()` output so no
`i` flag is needed.

**(b) Judge on VISIBLE text only.** Upstream `:614-616` is explicit that
`data-testid` values like `reasoning-panel` must not taint the completed check. The
current code already reads `visibleText` for the summary test but builds `metadata`
from testid/class for panel VERIFICATION — that split is correct and stays.

### 5.2 Blocker 2 accepted — the debounce variable does not exist

§2.4 invented `stableForDebounce` and pointed at `chatgpt.mjs:877`, which is the
post-loop copy-markdown timeout fallback. The real loop is `:641-800`, and stability
only accumulates inside `if (latest && !streaming)` (`:677`), resetting when
streaming (`:787`). So today weak activity cannot be overridden by definition —
`streaming` gates the whole stability block.

**Corrected change:** track stability independently of activity, then let strength
decide completion.

```diff
@@ chatgpt.mjs poll loop (~:645)
-        const streaming = await isStreaming(page);
+        const activity = await readActivityState(page);
+        const streaming = activity.strength === 'strong';
+        // Weak activity (a mounted sidecar still reading "Thinking") no longer
+        // freezes the stability window; it only blocks completion until the
+        // window is satisfied.
+        const weakActive = activity.strength === 'weak';
@@ stability block (~:677)
-        if (latest && !streaming) {
+        if (latest && !streaming) {
             if (latest === stableText) {
                 const elapsedStable = Date.now() - stableSince;
-                const minStableMs = 1000;
-                if (finished && elapsedStable >= minStableMs) {
+                // A weak signal demands a longer quiet window before we call it
+                // stale, so a genuinely slow reasoning phase is not cut short.
+                const minStableMs = weakActive ? 5_000 : 1_000;
+                if (finished && elapsedStable >= minStableMs) {
```

`streaming` now means STRONG only, so the `!streaming` guard admits weak-active
iterations into the stability block — that single change is what unblocks the
stale-sidecar hang. `finished` (terminal-action evidence) is still required, so a
weak signal alone can never complete a response that has no completion proof.

The heartbeat at `:646-650` keeps using `streaming` and now reports strong-only,
which is more accurate; its text gains `weakActive ? 'settling' : 'stabilizing'`.

### 5.3 Revised accept criteria (supersedes §3)

Grammar cases, driven through `readChatGptStreamingState`:

| # | Panel visible text | Expected |
|---|--------------------|----------|
| 1 | `Thought for 12s` | `none` |
| 2 | `Reasoning Thought for 12s` | `none` (heading prefix — blocker-1 case) |
| 3 | `Pro thinking Thought for 1.5 minutes` | `none` |
| 4 | `Thought for 1m 5s` | `none` (compound) |
| 5 | `Thought for a moment` / `Thought for a few seconds` | `none` (worded) |
| 6 | `Thought for 12s Edit` | `none` (G12) |
| 7 | `Thought for 2s: Searching…` | **`weak`/`panel-trace`** (live re-entry rule) |
| 8 | `Thinking` | `weak`/`panel-text` |
| 9 | visible stop button | `strong`/`stop-button` |
| 10 | live progress in latest turn | `strong`/`turn-progress` |
| 11 | live progress in a verified panel | `strong`/`panel-progress` |
| 12 | weak panel + later panel with live progress | `strong` (ordering guard) |
| 13 | nothing | `none` |
| 14 | a 200-char panel containing "thought for" mid-sentence | `weak` — not a completed summary |
| 15 | `isActiveState` over boolean/verdict/null | correct boolean view |
| 16 | **transport** real Chromium `page.evaluate` | verdict object, no `ReferenceError` |

Poll-loop cases (driven through the existing poll harness):

| # | Scenario | Expected |
|---|----------|----------|
| 17 | strong activity, text stable 3s, terminal evidence present | keeps polling |
| 18 | weak activity, text stable 6s, terminal evidence present | **completes** (the hang fixed) |
| 19 | weak activity, text stable 2s, terminal evidence present | still polling (5s window not met) |
| 20 | weak activity, text stable 6s, NO terminal evidence | still polling — `finished` is still required |
| 21 | no activity, text stable 1.5s, terminal evidence | completes (unchanged baseline) |

### 5.4 Corrected scope

IN: the grammar and strata in `chatgpt-response-dom.mjs`, the poll-loop strength
handling in `chatgpt.mjs`, `test/unit/web-ai-chatgpt-response-fragments.test.mjs`,
NEW `test/integration/activity-state-transport.test.mjs`, `structure/str_func.md`.
OUT: busy/`aria-busy` signals, `chatgpt-response-observer.mjs`'s own gate, and the
1s baseline stability window for the no-activity path.
