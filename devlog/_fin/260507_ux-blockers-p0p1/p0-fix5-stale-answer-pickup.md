# Fix 5 — Stale Answer Pickup: Session/TargetId-Scoped Baseline

**Priority: P0** | **Status: implemented** | **Commit: ccb7051** | **Audit: Rounds 3-4 PASS + A-phase re-audit PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/chatgpt.mjs` | MODIFY |

## Problem

`pollWebAi` falls back to `getLatestBaseline(vendor)` (any vendor baseline), which can pick up a baseline from a completely different conversation. This causes stale answer pickup — returning an old answer from a previous conversation as if it were new.

## Diffs

### MODIFY `web-ai/chatgpt.mjs` — Baseline resolution (~lines 297-300)

```diff
     const baseline = (session && sessionToBaseline(session))
         || getBaseline(vendor, url)
-        || getLatestBaseline(vendor, { sameHostUrl: url })
-        || getLatestBaseline(vendor);
+        || getLatestBaseline(vendor, { sameHostUrl: url });
```

### MODIFY `web-ai/chatgpt.mjs` — Poll loop guard (~lines 315-318)

```diff
     while (Date.now() <= deadline) {
+        if (session?.targetId) {
+            const currentTargetId = await deps.getTargetId?.().catch(() => null);
+            if (currentTargetId && currentTargetId !== session.targetId) {
+                return {
+                    ok: false, vendor, status: 'target-mismatch',
+                    url: page.url(), ...(session ? { sessionId: session.sessionId } : {}),
+                    answerText: '', baseline, usedFallbacks: [],
+                    warnings: [`poll target changed: ${session.targetId} → ${currentTargetId}`],
+                    error: 'target changed during poll',
+                };
+            }
+        } else {
+            const currentUrl = page.url();
+            const baselineConvoId = extractConversationId(baseline.url);
+            const currentConvoId = extractConversationId(currentUrl);
+            if (baselineConvoId !== currentConvoId || (!baselineConvoId && !currentConvoId && baseline.url !== currentUrl)) {
+                return {
+                    ok: false, vendor, status: 'conversation-mismatch',
+                    url: currentUrl, answerText: '', baseline, usedFallbacks: [],
+                    warnings: [`conversation changed: ${baselineConvoId || 'none'} → ${currentConvoId || 'none'}`],
+                    error: 'conversation changed during poll',
+                };
+            }
+        }
         const answers = await readAssistantMessages(page);
```

### MODIFY `web-ai/chatgpt.mjs` — Helper function (near `isFinalAnswer`)

```diff
+function extractConversationId(url) {
+    if (!url) return null;
+    const match = url.match(/\/c\/([a-f0-9-]+)/);
+    return match ? match[1] : null;
+}
```

## A-phase re-audit fixes applied

1. **Null-null guard fail-closed**: added `|| (!baselineConvoId && !currentConvoId && baseline.url !== currentUrl)` — when both IDs are null, fail unless URLs match exactly.
2. **Return shape**: added `url` and `error` fields to both guard returns, matching existing timeout return shape at chatgpt.mjs:395-409.
