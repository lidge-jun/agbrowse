# Fix 7 — Thinking Placeholder: Prevent "Stopped thinking" as Answer

**Priority: P1** | **Status: planned** | **Audit: R8-R10 PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/chatgpt.mjs` | MODIFY |

## Problem

When ChatGPT Pro's extended thinking is interrupted, the assistant turn text becomes `"Stopped thinking"`, `"Thought for 3m 2s"`, or `"Reasoning"`. `PLACEHOLDER_PATTERNS` doesn't cover these variants, so `isFinalAnswer()` passes them through as real answers.

## Diffs

### MODIFY `web-ai/chatgpt.mjs` — Expand `cleanAssistantText` (~line 689-692)

```diff
 function cleanAssistantText(text) {
     return String(text || '')
-        .replace(/^Thought for\s+\d+s\s*/i, '')
+        .replace(/^Thought for\s+[\dm\s]+s(?:econds?)?\s*/i, '')
         .trim();
 }
```

Handles `"Thought for 3s"`, `"Thought for 3m 2s"`, `"Thought for 12 seconds"`, and `"Thought for 1m 30s Some actual answer"`. Answer content after the header is preserved.

### MODIFY `web-ai/chatgpt.mjs` — Add whole-string-only placeholders (~lines 46-57)

```diff
 const PLACEHOLDER_PATTERNS = [
     /^answer now$/i,
     /^pro thinking/i,
     /^finalizing answer$/i,
     /^instant$/i,
     /^thinking$/i,
     /^pro$/i,
     /^configure\.{0,3}$/i,
     /^reading documents?$/i,
     /^analyzing files?$/i,
+    /^stopped thinking$/i,
+    /^reasoning$/i,
+    /^deep thinking$/i,
+    /^searching\.{0,3}$/i,
+    /^browsing\.{0,3}$/i,
     /^\s*$/,
 ];
```

## Safety analysis

- All new patterns are anchored with `^` and `$` — no false positives on real content.
- `"Searching..."` and `"Browsing..."` use `\.{0,3}$` — `"Searching the web for relevant results"` is NOT matched.
- `"Thought for Xm Ys"` is handled by `cleanAssistantText` (stripped to empty → filtered by `filter(Boolean)`), so no placeholder pattern needed.
