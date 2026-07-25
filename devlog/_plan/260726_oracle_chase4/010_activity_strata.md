# WP2 — G8: strong vs weak activity strata (+ G9 test debt)

Rows: **G8** (upstream `ded58d44`), plus the **G9** residue identified in `000` §3.1.

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
