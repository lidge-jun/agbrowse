# Fix 3 — Browser Crash Recovery in Poll Loops

**Priority: P1** | **Status: planned** | **Audit: Rounds 2-4 PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/tab-recovery.mjs` | MODIFY |
| `web-ai/chatgpt.mjs` | MODIFY |
| `web-ai/grok-live.mjs` | MODIFY |
| `web-ai/gemini-live.mjs` | MODIFY |

## Problem

When Chrome crashes mid-poll (exit 137, "Target closed", "browser has been closed"), all three provider poll loops hang until timeout instead of returning immediately. Session status is never updated to `crashed`, preventing recovery.

## Diffs

### MODIFY `web-ai/tab-recovery.mjs` — Export `isPageDeathError` (~line 140)

```diff
-function isPageDeathError(err) {
+export function isPageDeathError(err) {
     const e = /** @type {{ message?: unknown }} */ (err);
     const msg = String(e?.message || err || '').toLowerCase();
     return (
         msg.includes('target closed') ||
         msg.includes('page closed') ||
         msg.includes('browser has been closed') ||
         msg.includes('crash')
     );
 }
```

### MODIFY `web-ai/chatgpt.mjs` — Add import (after existing imports, ~line 38)

```diff
 import { appendTraceToSession } from './trace-persistence.mjs';
+import { isPageDeathError } from './tab-recovery.mjs';
```

Wrap `pollWebAi` poll loop body (~line 314-390) in try/catch:

```diff
     while (Date.now() <= deadline) {
+        try {
         if (session?.targetId) {
             const currentTargetId = await deps.getTargetId?.().catch(() => null);
             if (currentTargetId && currentTargetId !== session.targetId) {
                 return {
                     ok: false, vendor, status: 'target-mismatch',
                     url: page.url(), ...(session ? { sessionId: session.sessionId } : {}),
                     answerText: '', baseline, usedFallbacks: [],
                     warnings: [`poll target changed: ${session.targetId} → ${currentTargetId}`],
                     error: 'target changed during poll',
                 };
             }
         } else {
             const currentUrl = page.url();
             const baselineConvoId = extractConversationId(baseline.url);
             const currentConvoId = extractConversationId(currentUrl);
             if (baselineConvoId !== currentConvoId || (!baselineConvoId && !currentConvoId && baseline.url !== currentUrl)) {
                 return {
                     ok: false, vendor, status: 'conversation-mismatch',
                     url: currentUrl, answerText: '', baseline, usedFallbacks: [],
                     warnings: [`conversation changed: ${baselineConvoId || 'none'} → ${currentConvoId || 'none'}`],
                     error: 'conversation changed during poll',
                 };
             }
         }
         const answers = await readAssistantMessages(page);
         const newAnswers = answers.slice(baseline.assistantCount).filter(isFinalAnswer);
         const latest = newAnswers.at(-1) || '';
         const streaming = await isStreaming(page);
         if (latest && !streaming) {
             if (latest === stableText) {
                 if (Date.now() - stableSince >= 1500) {
                     const usedFallbacks = [];
                     const warnings = [];
                     let answerText = latest;
                     let traceSummary = null;
                     if (input.allowCopyMarkdownFallback === true) {
                         const copyResolution = await resolveOptionalChatGptCopyTarget(page, copyTraceCtx);
                         const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
                             copyTarget: /** @type {any} */ (copyResolution?.target || null),
                         });
                         traceSummary = persistResolverTraceForSession(session, copyTraceCtx);
                         const copiedText = preferCopiedText(latest, copied);
                         if (copiedText) {
                             answerText = cleanAssistantText(copiedText);
                             usedFallbacks.push('copy-markdown');
                         } else {
                             warnings.push(`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`);
                         }
                     }
                     if (session) {
                         await finalizeProviderTab(deps, { vendor, session: /** @type {any} */ (session), page, answerText, warnings });
                     }
                     return withAnswerArtifact({
                         ok: true,
                         vendor,
                         status: 'complete',
                         url: page.url(),
                         ...(session ? { sessionId: session.sessionId } : {}),
                         answerText,
                         baseline,
                         usedFallbacks,
                         warnings,
                         ...(traceSummary ? { traceSummary } : {}),
                         responseStableMs: Date.now() - stableSince,
                     });
                 }
             } else {
                 stableText = latest;
                 stableSince = Date.now();
             }
         } else {
             stableText = '';
             stableSince = 0;
         }
         await page.waitForTimeout(500);
+        } catch (pollErr) {
+            if (isPageDeathError(pollErr)) {
+                if (session) updateSession(session.sessionId, { status: 'crashed' });
+                return {
+                    ok: false, vendor, status: 'tab-crashed',
+                    url: baseline.url || '', ...(session ? { sessionId: session.sessionId } : {}),
+                    answerText: '', baseline, usedFallbacks: [],
+                    warnings: ['tab-crashed-during-poll'],
+                    error: String(pollErr?.message || pollErr),
+                    recoverable: true,
+                };
+            }
+            throw pollErr;
+        }
     }
```

### MODIFY `web-ai/grok-live.mjs` — Add import (after existing imports, ~line 31)

```diff
 import { selectGrokModel, grokModelCapabilityProbe } from './grok-model.mjs';
+import { isPageDeathError } from './tab-recovery.mjs';
```

Wrap `grokPollWebAi` poll loop body (~line 268-313) in try/catch:

```diff
     while (Date.now() < deadline) {
+        try {
         const answers = await readResponses(page);
         const latest = answers.slice(baseline.assistantCount).at(-1) || '';
         const streaming = await isStreaming(page);
         if (latest && !streaming) {
             if (latest === stableText) {
                 if (Date.now() - stableSince >= 1500) {
                     let answerText = latest;
                     const usedFallbacks = [];
                     const warnings = [];
                     if (input.allowCopyMarkdownFallback === true) {
                         const copied = await captureCopiedResponseText(page, GROK_COPY_SELECTORS);
                         const copiedText = preferCopiedText(latest, copied);
                         if (copiedText) {
                             answerText = cleanGrokResponseText(copiedText);
                             usedFallbacks.push('copy-markdown');
                         } else {
                             warnings.push(`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`);
                         }
                     }
                     if (session) {
                         await finalizeProviderTab(deps, { vendor: 'grok', session: /** @type {any} */ (session), page, answerText, warnings });
                     }
                     return withAnswerArtifact({
                         ok: true,
                         vendor: 'grok',
                         status: 'complete',
                         url: page.url(),
                         ...(session ? { sessionId: session.sessionId } : {}),
                         answerText,
                         baseline,
                         usedFallbacks,
                         warnings,
                         responseStableMs: Date.now() - stableSince,
                     });
                 }
             } else {
                 stableText = latest;
                 stableSince = Date.now();
             }
         } else {
             stableText = '';
             stableSince = 0;
         }
         await page.waitForTimeout(500).catch(() => undefined);
+        } catch (pollErr) {
+            if (isPageDeathError(pollErr)) {
+                if (session) updateSession(session.sessionId, { status: 'crashed' });
+                return {
+                    ok: false, vendor: 'grok', status: 'tab-crashed',
+                    url: baseline.url || '', ...(session ? { sessionId: session.sessionId } : {}),
+                    answerText: '', baseline, usedFallbacks: [],
+                    warnings: ['tab-crashed-during-poll'],
+                    error: String(pollErr?.message || pollErr),
+                    recoverable: true,
+                };
+            }
+            throw pollErr;
+        }
     }
```

### MODIFY `web-ai/gemini-live.mjs` — Add import (after existing imports, ~line 31)

```diff
 import { defineCapability, probeFirstVisibleSelector, probeHostMatches, runCapabilities, worstCapabilityState } from './capability.mjs';
+import { isPageDeathError } from './tab-recovery.mjs';
```

Wrap `geminiPollWebAi` poll loop body (~line 421-459) in try/catch:

```diff
     while (Date.now() < deadline) {
+        try {
         const responses = await readResponses(page);
         const next = responses.slice(baseline.assistantCount).at(-1);
         if (next && await hasCompletionSignal(page)) {
             if (isPendingDeepThinkText(next)) {
                 await page.waitForTimeout(5_000).catch(() => undefined);
                 continue;
             }
             let answerText = next;
             /** @type {any[]} */
             const usedFallbacks = [];
             const warnings = [];
             if (input.allowCopyMarkdownFallback === true) {
                 const copied = await captureCopiedResponseText(page, GEMINI_COPY_SELECTORS);
                 const copiedText = preferCopiedText(next, copied);
                 if (copiedText) {
                     answerText = normalizeGeminiResponseText(copiedText);
                     usedFallbacks.push('copy-markdown');
                 } else {
                     warnings.push(`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`);
                 }
             }
             if (session) {
                 await finalizeProviderTab(deps, { vendor: 'gemini', session: /** @type {any} */ (session), page, answerText, warnings });
             }
             return withAnswerArtifact({
                 ok: true,
                 vendor: 'gemini',
                 status: 'complete',
                 url: page.url(),
                 ...(session ? { sessionId: session.sessionId } : {}),
                 answerText,
                 baseline,
                 usedFallbacks,
                 warnings,
             });
         }
         await page.waitForTimeout(2_000).catch(() => undefined);
+        } catch (pollErr) {
+            if (isPageDeathError(pollErr)) {
+                if (session) updateSession(session.sessionId, { status: 'crashed' });
+                return {
+                    ok: false, vendor: 'gemini', status: 'tab-crashed',
+                    url: baseline.url || '', ...(session ? { sessionId: session.sessionId } : {}),
+                    answerText: '', baseline, usedFallbacks: [],
+                    warnings: ['tab-crashed-during-poll'],
+                    error: String(pollErr?.message || pollErr),
+                    recoverable: true,
+                };
+            }
+            throw pollErr;
+        }
     }
```

## Design notes

- Each catch uses `baseline.url` for the url field since `page.url()` may throw on a dead page.
- `recoverable: true` signals that session recovery can attempt to re-attach.
- Non-page-death errors are re-thrown to preserve existing error paths.
