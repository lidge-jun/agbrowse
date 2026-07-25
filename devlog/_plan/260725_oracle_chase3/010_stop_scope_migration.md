# WP2 — G1b: migrate remaining stop/streaming probes onto the scoped contract

Row: **G1b** (Round 3 `040_gap_matrix.md`, follow-up recorded during the WP2 audit).
Depends on: `5e59a9f` (landed) which introduced the shared scoped contract in
`web-ai/chatgpt-response-dom.mjs`.

## 1. Problem

`5e59a9f` replaced the page-wide "is a Stop button anywhere?" heuristic in
`web-ai/chatgpt.mjs` with two shared primitives:

- `CHATGPT_STOP_SELECTORS` (`chatgpt-response-dom.mjs:9-12`) — composer-scoped:
  `button[data-testid="stop-button"]` plus a `form`-scoped `aria-label*="Stop"` variant
  that excludes dictation/voice/read-aloud buttons.
- `readChatGptStreamingState(...)` (`chatgpt-response-dom.mjs:60`) — turn-scoped live
  progress plus sidecar reasoning evidence, resolved through
  `resolveTopLevelAssistantTurns`.

Three callers were left on the old page-wide shape and still match any `aria-label`
containing "Stop" anywhere in the document — including the dictation button and any
sidebar/history element — which is exactly the false-positive class `5e59a9f` closed
for the main path:

| # | Path:line (current tree) | Current predicate |
|---|--------------------------|-------------------|
| 1 | `web-ai/chatgpt-deep-research.mjs:49-52`, used at `:79-83` | local `STOP_SELECTORS = ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]']` |
| 2 | `web-ai/chatgpt-multi-turn.mjs:54-57` | `page.locator('[data-testid="stop-button"], button[aria-label="Stop generating"]').count() > 0` |
| 3 | `web-ai/chatgpt-work-picker.mjs:690-691` | `page.locator('button[aria-label*="Stop" i]').first().isVisible()` — page-wide, no `main` scope |

`chatgpt-work-picker.mjs:950` (`readWorkTaskState`) already scopes to `main`
(`:944-950`) after the 2026-07-10 sidebar-poisoning fix, so it needs only the shared
selector constant, not a scope change.

## 2. Change map

### 2.1 MODIFY `web-ai/chatgpt-deep-research.mjs`

Delete the local constant and import the shared one.

```diff
@@ imports
 import { chooseDeepResearchReportRead } from './chatgpt-deep-research-report.mjs';
+import { CHATGPT_STOP_SELECTORS } from './chatgpt-response-dom.mjs';
@@ -46,11 +46,6 @@
 const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
-const STOP_SELECTORS = [
-    'button[data-testid="stop-button"]',
-    'button[aria-label*="Stop" i]',
-];
@@ async function isStreaming(page)
-    for (const sel of STOP_SELECTORS) {
+    for (const sel of CHATGPT_STOP_SELECTORS) {
         if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
     }
     return false;
```

Deep Research keeps its own `hasProgressIndicator` probe (`:91-97`); that stays, since
the DR progress selectors are surface-specific and not part of the shared contract.

### 2.2 MODIFY `web-ai/chatgpt-multi-turn.mjs`

```diff
@@ imports
+import { CHATGPT_STOP_SELECTORS } from './chatgpt-response-dom.mjs';
@@ async function isStreaming(page)
-async function isStreaming(page) {
-    const stop = await page.locator('[data-testid="stop-button"], button[aria-label="Stop generating"]').count();
-    return stop > 0;
-}
+async function isStreaming(page) {
+    for (const selector of CHATGPT_STOP_SELECTORS) {
+        const first = page.locator?.(selector)?.first?.();
+        if (typeof first?.isVisible === 'function'
+            && await first.isVisible().catch(() => false)) return true;
+    }
+    return false;
+}
```

Note the semantic upgrade: `count() > 0` counted hidden nodes as streaming; the scoped
form requires visibility, matching `chatgpt.mjs:996-1003`.

### 2.3 MODIFY `web-ai/chatgpt-work-picker.mjs`

Two call sites, one shared helper:

```diff
@@ imports
+import { CHATGPT_STOP_SELECTORS } from './chatgpt-response-dom.mjs';
+
+/** @param {any} scope */
+async function anyStopButtonVisible(scope) {
+    for (const selector of CHATGPT_STOP_SELECTORS) {
+        const first = scope.locator?.(selector)?.first?.();
+        if (typeof first?.isVisible === 'function'
+            && await first.isVisible().catch(() => false)) return true;
+    }
+    return false;
+}
@@ -690,8 +690,8 @@ (running-evidence probe)
-        const stopVisible = await page.locator('button[aria-label*="Stop" i]').first()
-            .isVisible().catch(() => false);
+        const mainScope = scopeToMain(page);
+        const stopVisible = await anyStopButtonVisible(mainScope);
@@ -950,8 +950,7 @@ readWorkTaskState
-    const stopBtn = mainRegion.locator('button[aria-label*="Stop" i]').first();
-    const stopVisible = await stopBtn.isVisible().catch(() => false);
+    const stopVisible = await anyStopButtonVisible(mainRegion);
```

`scopeToMain(page)` is the extraction of the existing inline pattern at `:944-949`
(`page.locator('main')` when it exposes `.locator`, else `page`), so both call sites
share one definition instead of one scoping correctly and one not scoping at all.

## 3. Accept criteria (activation-grounded)

| Scenario | Activation | Observable effect |
|----------|-----------|-------------------|
| Dictation button present, no generation | fake page whose only `aria-label*="Stop"` node is `aria-label="Stop dictation"` outside a `form` | all three `isStreaming` probes return `false` (today: `true` for DR and work-picker) |
| Real generation | fake page with a visible `button[data-testid="stop-button"]` | all three return `true` |
| Hidden stop node | node present but `isVisible()` false | multi-turn returns `false` (today: `true` via `count()`) |
| Sidebar poisoning | stop button rendered outside `main` | work-picker running-evidence probe returns `false` |

Test file: `test/unit/web-ai-chatgpt-stop-scope.test.mjs` (NEW) using the fake-page
shape already used by `test/unit/web-ai-chatgpt-work-picker.test.mjs`.

## 4. Scope boundary

IN: the three modules above, the new test file.
OUT: `chatgpt.mjs` (already migrated), the DR progress-indicator probe, any change to
`CHATGPT_STOP_SELECTORS` itself, capability-registry probes at `chatgpt.mjs:126-134`
(already on the shared constant).

## 5. Audit amendments (A-gate round 1, reviewer Schrodinger)

**Blocker 8 [Medium] accepted — no testable seam.** The three `isStreaming` functions are
module-private (`chatgpt-deep-research.mjs:79`, `chatgpt-multi-turn.mjs:54`, and the
proposed work-picker helper), so the planned test could not drive them. Amendment: the
shared helper is **exported from `web-ai/chatgpt-response-dom.mjs`** and all three callers
delegate to it. The test drives the exported helper plus a source-shape assertion that
each caller uses it.

```diff
*** web-ai/chatgpt-response-dom.mjs (append after CHATGPT_STOP_SELECTORS)
+/**
+ * Visible-stop-button probe against the shared composer-scoped selector set.
+ * `scope` is any Playwright-like locator root (page, or a `main` region locator).
+ * Visibility is required: a present-but-hidden stop node is not generation
+ * evidence (this is the semantic the main ChatGPT path uses at chatgpt.mjs:996-1003).
+ * @param {any} scope
+ * @returns {Promise<boolean>}
+ */
+export async function anyStopButtonVisible(scope) {
+    if (!scope || typeof scope.locator !== 'function') return false;
+    for (const selector of CHATGPT_STOP_SELECTORS) {
+        const first = scope.locator(selector)?.first?.();
+        if (typeof first?.isVisible === 'function'
+            && await first.isVisible().catch(() => false)) return true;
+    }
+    return false;
+}
+
+/**
+ * Narrow a page to its main conversation region when it exposes one.
+ * Extraction of the inline pattern at chatgpt-work-picker.mjs:944-949, whose
+ * rationale is the 2026-07-10 sidebar-title poisoning incident.
+ * @param {any} page
+ * @returns {any}
+ */
+export function scopeToMainRegion(page) {
+    const main = page?.locator?.('main');
+    return (main && typeof main.locator === 'function') ? main : page;
+}
```

**Blocker 9 [Medium] accepted — helper diffs were prose.** The two helpers above are now
given in full (implementation, input/output contract, and the fallback behavior when the
scope lacks `.locator`). §2.3's `scopeToMain` is replaced by the exported
`scopeToMainRegion`; §2.1/§2.2/§2.3 call sites all become `await anyStopButtonVisible(...)`:

| Call site | Replacement |
|-----------|-------------|
| `chatgpt-deep-research.mjs:79-84` | `return anyStopButtonVisible(page);` |
| `chatgpt-multi-turn.mjs:54-57` | `return anyStopButtonVisible(page);` |
| `chatgpt-work-picker.mjs:690-691` | `const stopVisible = await anyStopButtonVisible(scopeToMainRegion(page));` |
| `chatgpt-work-picker.mjs:950-951` | `const stopVisible = await anyStopButtonVisible(mainRegion);` (mainRegion already computed at `:944-949`, now via `scopeToMainRegion`) |

**Revised accept criteria.** Test file `test/unit/web-ai-chatgpt-stop-scope.test.mjs` (NEW):

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | dictation-only page (`aria-label="Stop dictation"`, outside `form`) | `anyStopButtonVisible(page) === false` |
| 2 | visible `button[data-testid="stop-button"]` | `true` |
| 3 | stop node present but `isVisible()` false | `false` (the `count()>0` regression class) |
| 4 | stop button outside `main` | `anyStopButtonVisible(scopeToMainRegion(page)) === false` while page-wide is `true` |
| 5 | scope without `.locator` | `false`, no throw |
| 6 | source shape | each of the three modules imports and calls `anyStopButtonVisible` |

Case 3 is the behavioral change the reviewer flagged as untested in the multi-turn poll
loop: it is now asserted directly on the shared helper, which is the only predicate that
loop consults after this phase.

## 6. Implementation audit amendments (WP2 A-gate, reviewer Mill)

The implementation audit returned GO-WITH-FIXES with 2 blockers, both accepted:

### 6.1 Blocker 1 [High] — `.first()` only was a real regression

The helper as first written inspected `locator(selector).first()`, so a hidden stop node
rendered ahead of the live one reported idle. The reviewer's reproduction:

```json
{"helper":false,"oldMultiTurnCount":true,"firstVisible":false,"secondVisible":true}
```

The old `count() > 0` in `chatgpt-multi-turn.mjs` accepted that DOM, so this would have been
an unintended regression — and multi-turn is the most exposed caller because, unlike Deep
Research (`chatgpt-deep-research.mjs:288`), it has no positive completion proof: it would
return a still-growing partial answer after 1.5s of stable text.

Fix: `anyStopButtonVisible` now walks **every** match via `all()`, with a `count()`/`nth()`
path and a `.first()` path as fallbacks for locator shapes that lack `all()`. New test case:
"finds a visible stop node even when a hidden one precedes it".

### 6.2 Blocker 2 [Medium] — the first test file was largely vacuous

The original fake mapped whole selector strings to node arrays, so the dictation case tested
an empty page, the form-scoped case keyed on the constant rather than a real form, the
`main` fallback tested a shape real Playwright never produces (it returns a Locator matching
zero elements, not `null`), and the source assertion passed on a bare import.

The test file was rewritten around a **DOM-backed locator adapter** (jsdom + real
`querySelectorAll`), so CSS semantics are genuinely exercised: the `:not()` dictation/voice/
read-aloud exclusions, the `form`-scoping of the aria variant, and multiplicity. Visibility
is modelled with a `data-hidden` attribute since jsdom has no layout. The source assertion
now requires the exact call expressions at all four sites. 11 cases, all green.

`scopeToMainRegion`'s doc comment now states that a real page always returns the `main`
locator (matching zero elements when absent, so scoped probes fail closed) and that the page
fallback exists only for locator-less test doubles.
