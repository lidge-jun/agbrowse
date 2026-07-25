# WP4 — G28: Deep Research tool-call wrapper placeholder recognition

Row: **G28** (upstream `e7526efa` and follow-ups).

## 1. Problem

`isIncompleteDeepResearchText` (`chatgpt-deep-research-report.mjs:41-45`) rejects a
read as incomplete on exactly two grounds:

1. shorter than `DR_MIN_REPORT_CHARS` (120), or
2. the FIRST LINE matches one of nine status markers (`DR_INCOMPLETE_MARKERS`,
   `:10-20`).

A tool-call wrapper placeholder passes both. ChatGPT's Deep Research surface can
leave a serialized tool-call envelope in the DOM — long enough to clear 120 chars,
and starting with the wrapper token rather than a status word. `chooseDeepResearchReportRead`
(`:66-67`) then treats it as `completed: true` and returns it as the final report.
The user gets a wrapper blob instead of research.

This is a correctness bug with a silent failure mode: the call "succeeds".

## 2. Change map — MODIFY `web-ai/chatgpt-deep-research-report.mjs`

### 2.1 Wrapper grammar

```js
// Tool-call / function-call envelopes that can be left in the DOM. These are
// long enough to clear the length floor and do not lead with a status word, so
// neither existing guard catches them.
const DR_WRAPPER_PATTERNS = [
    // JSON-ish envelope opening the text
    /^\s*\{\s*"(?:name|tool_name|function|tool_call_id|arguments|parameters)"\s*:/,
    // Channel/analysis markers
    /^\s*(?:<\|)?(?:tool|assistant|analysis|commentary)(?:\|>)?\s*to=/i,
    // XML-ish tool wrappers
    /^\s*<(?:tool_call|function_call|antml:invoke|invoke)\b/i,
    // Fenced json/tool block as the entire payload
    /^\s*```(?:json|tool|tool_call)\b/i,
];

/**
 * True when the text is a tool-call wrapper envelope rather than a report.
 * Checked against the whole normalized text, not just the first line: a wrapper
 * may open with a stray blank line or a fence.
 * @param {unknown} text
 * @returns {boolean}
 */
export function looksLikeDeepResearchWrapper(text) {
    const norm = normalizeDeepResearchReportText(text);
    if (!norm) return false;
    if (DR_WRAPPER_PATTERNS.some((re) => re.test(norm))) return true;
    // A payload that is overwhelmingly one JSON object with tool-ish keys.
    if (/^\s*[[{]/.test(norm) && /"(?:tool_call_id|function_call|arguments)"/.test(norm)) return true;
    return false;
}
```

### 2.2 Fold it into the incompleteness test

```diff
 export function isIncompleteDeepResearchText(text) {
     const norm = normalizeDeepResearchReportText(text);
     if (norm.length < DR_MIN_REPORT_CHARS) return true;
+    if (looksLikeDeepResearchWrapper(norm)) return true;
     const firstLine = norm.split('\n', 1)[0].trim();
     return DR_INCOMPLETE_MARKERS.some((re) => re.test(firstLine));
 }
```

That single insertion propagates correctly through `chooseDeepResearchReportRead`
(`:66-72`): a wrapper target no longer wins as `completed`, the frame read gets its
chance, and if both are wrappers the longer one is still returned but flagged
`completed: false` — so the caller keeps polling instead of declaring success.

**Why not drop wrapper candidates entirely?** Because `chooseDeepResearchReportRead`
returning `null` would lose the only text we have. Flagging `completed: false`
preserves today's "best-effort text plus keep waiting" contract, which is the
conservative change.

## 3. Accept criteria (activation-grounded)

| # | Input | Expected |
|---|-------|----------|
| 1 | 400-char JSON envelope starting `{"name": "web.search"` | `isIncomplete: true`; not selected as completed |
| 2 | `analysis to=web.run ...` long payload | incomplete |
| 3 | `<tool_call>` opening | incomplete |
| 4 | ```` ```json ```` fenced payload | incomplete |
| 5 | payload containing `"tool_call_id"` inside a leading array/object | incomplete |
| 6 | a genuine report that MENTIONS a JSON snippet mid-body | **complete** — the false-positive guard |
| 7 | a genuine report whose first line is a markdown heading | complete |
| 8 | wrapper target + complete frame | the FRAME is chosen, `completed: true` |
| 9 | wrapper target + wrapper frame | longer one returned, `completed: false` |
| 10 | short text | incomplete (unchanged) |
| 11 | existing status-marker cases | unchanged |

Case 6 is the one that decides whether this row helps or hurts: an anchored `^`
match on the whole normalized text means a mid-body JSON block cannot trigger it.

Tests: extend `test/unit/web-ai-deep-research-report-selection.test.mjs`.

## 4. Scope boundary

IN: `chatgpt-deep-research-report.mjs`, its test file.
OUT: `chatgpt-deep-research.mjs` polling/timeout logic, `DR_MIN_REPORT_CHARS`,
the existing status markers, and the resume path's own selection rules.
