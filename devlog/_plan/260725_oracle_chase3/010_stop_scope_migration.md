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
