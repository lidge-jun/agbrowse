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

## 5. Audit amendments (A-gate round 1, blocker 4) — AUTHORITATIVE

The reviewer built three false positives against §2.1's grammar, all legitimate
reports classified as wrappers:

```text
{"name":"2026 Market Report","summary":"..."}              -> wrapper (WRONG)
```json {"revenue":10} ``` followed by real analysis        -> wrapper (WRONG)
{"title":"API Research","sections":[{"arguments":"..."}]}   -> wrapper (WRONG)
```

`"name"` and `"arguments"` are ordinary words; a report may legitimately open with a
data block. Key-presence is not envelope evidence.

### 5.1 Parse, then require envelope SHAPE

```js
// A tool-call envelope is a JSON object whose TOP LEVEL is essentially the call
// itself: a callable identifier plus its arguments, and little else. Key presence
// alone is not evidence — a report may legitimately contain any of these words.
const ENVELOPE_NAME_KEYS = ['name', 'tool_name', 'function', 'recipient'];
const ENVELOPE_ARG_KEYS = ['arguments', 'parameters', 'args', 'input'];
const ENVELOPE_ID_KEYS = ['tool_call_id', 'call_id', 'function_call'];

function isToolEnvelopeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (!keys.length || keys.length > 6) return false;          // envelopes are small
    const has = (list) => keys.some((k) => list.includes(k));
    if (has(ENVELOPE_ID_KEYS)) return true;                      // unambiguous
    // name + arguments together, and nothing that looks like report prose
    if (has(ENVELOPE_NAME_KEYS) && has(ENVELOPE_ARG_KEYS)) {
        const name = value.name ?? value.tool_name ?? value.function ?? value.recipient;
        // A tool identifier is a token, not a title: no spaces, dotted or snake.
        return typeof name === 'string' && /^[\w.:-]+$/.test(name);
    }
    return false;
}
```

`{"name":"2026 Market Report", "summary":...}` now fails twice: no argument key, and
the name contains spaces. `{"title":"API Research","sections":[...]}` fails: no name
key at top level, and `arguments` is nested, not top-level.

### 5.2 Whole-payload requirement for fences and channels

```js
export function looksLikeDeepResearchWrapper(text) {
    const norm = normalizeDeepResearchReportText(text);
    if (!norm) return false;

    // 1. The ENTIRE payload is one JSON value that is a tool envelope.
    if (/^[[{]/.test(norm)) {
        try {
            const parsed = JSON.parse(norm);
            if (isToolEnvelopeObject(parsed)) return true;
            if (Array.isArray(parsed) && parsed.length && parsed.every(isToolEnvelopeObject)) return true;
        } catch { /* not whole-payload JSON — fall through, a report may open with a snippet */ }
    }

    // 2. The ENTIRE payload is one fenced block whose body is a tool envelope.
    const fence = /^```(?:json|tool|tool_call)?\s*\n([\s\S]*?)\n```$/.exec(norm);
    if (fence) {
        try {
            const parsed = JSON.parse(fence[1].trim());
            if (isToolEnvelopeObject(parsed)) return true;
        } catch { /* a fenced non-envelope is just a code block */ }
    }

    // 3. Channel/recipient marker as the whole first line, nothing else before it.
    if (/^(?:<\|)?(?:tool|assistant|analysis|commentary)(?:\|>)?\s*to=\S+/i.test(norm)) return true;
    // 4. XML-ish tool wrapper opening the payload AND closing it.
    if (/^<(tool_call|function_call|invoke)\b[\s\S]*<\/\1>\s*$/i.test(norm)) return true;

    return false;
}
```

The `$` anchors are what fix the fence case: a fenced snippet followed by analysis no
longer matches, because the payload does not END at the fence.

### 5.3 Added accept criteria (supersede §3 rows 1-5)

| # | Input | Expected |
|---|-------|----------|
| 1 | `{"name":"web.search","arguments":{...}}` (whole payload) | wrapper |
| 2 | `{"tool_call_id":"call_1", ...}` | wrapper |
| 3 | `[{"name":"web.run","arguments":{}}, {...}]` | wrapper |
| 4 | fenced json envelope as the ENTIRE payload | wrapper |
| 5 | `assistant to=web.run` first line | wrapper |
| 6 | `<tool_call>...</tool_call>` whole payload | wrapper |
| 7 | **`{"name":"2026 Market Report","summary":"..."}`** | NOT a wrapper (blocker-4 case 1) |
| 8 | **fenced json snippet followed by real analysis** | NOT a wrapper (case 2) |
| 9 | **`{"title":"API Research","sections":[{"arguments":"..."}]}`** | NOT a wrapper (case 3) |
| 10 | a report whose body quotes `tool_call_id` mid-paragraph | NOT a wrapper |
| 11 | malformed JSON opening the payload | NOT a wrapper (parse failure falls through) |
| 12 | a 5000-key JSON object with `name` + `arguments` | NOT a wrapper (key-count ceiling) |
| 13-16 | the original selection cases (wrapper target + complete frame, etc.) | as in §3 rows 8-11 |

## 6. Audit amendments (A-gate round 2, blocker 3) — AUTHORITATIVE over §5

Measured escapes and false positives:

```text
{"type":"function","function":{"name":"web.run","arguments":"..."}}  detected=false  <- escapes
{"tool_call_id":"call_1","title":"Incident report", ...}             detected=true   <- false positive
"Analysis to=web.run is the literal syntax used by ..."              detected=true   <- false positive
seven-key envelope with name+arguments                                detected=false  <- escapes
```

### 6.1 Envelope allowlist instead of a key ceiling

```js
const ENVELOPE_KEYS = new Set([
    'name', 'tool_name', 'function', 'recipient', 'type', 'role', 'channel',
    'arguments', 'parameters', 'args', 'input',
    'tool_call_id', 'call_id', 'function_call', 'id', 'index',
]);
const TOOL_NAME = /^[\w.:-]+$/;

/** @param {any} value @returns {boolean} */
function isToolEnvelopeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value);
    if (!keys.length) return false;
    // EVERY top-level key must belong to the envelope vocabulary. A report object
    // carrying `title`/`sections`/`summary` therefore never qualifies, no matter
    // which envelope-ish key it also happens to contain.
    if (!keys.every((key) => ENVELOPE_KEYS.has(key))) return false;

    // Nested OpenAI shape: {type:'function', function:{name, arguments}}
    const nested = value.function;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return typeof nested.name === 'string' && TOOL_NAME.test(nested.name);
    }
    const name = value.name ?? value.tool_name ?? value.recipient
        ?? (typeof value.function === 'string' ? value.function : undefined);
    const hasArgs = ['arguments', 'parameters', 'args', 'input'].some((k) => k in value);
    const hasId = ['tool_call_id', 'call_id', 'function_call'].some((k) => k in value);
    if (hasId && (hasArgs || typeof name === 'string')) return true;   // id alone is not enough
    return typeof name === 'string' && TOOL_NAME.test(name) && hasArgs;
}
```

The allowlist replaces the arbitrary six-key ceiling (which let a seven-key envelope
escape and would have grown stale), and an ID key now needs a structural companion,
so `{"tool_call_id":..., "title":"Incident report"}` fails on the allowlist anyway.

### 6.2 Channel marker must be line-bounded AND envelope-followed

```diff
-    if (/^(?:<\|)?(?:tool|assistant|analysis|commentary)(?:\|>)?\s*to=\S+/i.test(norm)) return true;
+    // Line-bounded, and the remainder must look like an envelope payload — prose
+    // that merely QUOTES "analysis to=web.run" is a report, not a wrapper.
+    const channel = /^(?:<\|)?(?:tool|assistant|analysis|commentary)(?:\|>)?\s+to=(\S+)[ \t]*\n?([\s\S]*)$/i.exec(norm);
+    if (channel) {
+        const rest = channel[2].trim();
+        if (!rest) return true;
+        if (/^[[{]/.test(rest)) { try { return isToolEnvelopeObject(JSON.parse(rest)); } catch { return false; } }
+        return /^```/.test(rest);
+    }
```

### 6.3 Added criteria

| # | Input | Expected |
|---|-------|----------|
| 17 | `{"type":"function","function":{"name":"web.run","arguments":"…"}}` | wrapper (escape closed) |
| 18 | seven-key envelope, all keys in the vocabulary | wrapper |
| 19 | `{"tool_call_id":"call_1","title":"Incident report", …}` | NOT a wrapper (allowlist) |
| 20 | prose quoting `Analysis to=web.run is the literal syntax…` | NOT a wrapper |
| 21 | `assistant to=web.run` followed by a JSON envelope | wrapper |
| 22 | `assistant to=web.run` alone on its line | wrapper |

## 7. Audit amendments (A-gate round 3, blocker 2) — AUTHORITATIVE

The vocabulary allowlist was still too generous. Reproduced false positive:

```json
{"type":"report","role":"assistant","id":"report-2026","index":1,
 "name":"market.summary","input":{"findings":["Demand rose"],"sources":["Q2 filing"]}}
```

Every key is in the vocabulary and `name` is token-shaped, so a legitimate
whole-payload JSON report classified as a tool envelope — reachable any time Deep
Research is asked to answer in JSON. The nested branch was worse: it accepted any
object with a `function.name`, without requiring `type: 'function'` or arguments.

### 7.1 Explicit schemas, not a vocabulary

A payload is an envelope only if it matches ONE of three named shapes:

```js
const ARG_KEYS = ['arguments', 'parameters', 'args', 'input'];
const ID_KEYS = ['tool_call_id', 'call_id'];
const TOOL_NAME = /^[\w.:-]+$/;
const TOOL_ROLES = new Set(['tool', 'function', 'assistant']);

const hasArgs = (o) => ARG_KEYS.some((k) => k in o);
const tokenName = (v) => typeof v === 'string' && TOOL_NAME.test(v);

/** @param {any} v @returns {boolean} */
function isToolEnvelopeObject(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const keys = new Set(Object.keys(v));

    // Schema A — OpenAI nested function call.
    if (v.type === 'function' && v.function && typeof v.function === 'object') {
        const f = v.function;
        const inner = Object.keys(f);
        return tokenName(f.name)
            && hasArgs(f)
            && inner.every((k) => ['name', 'arguments', 'parameters', 'description'].includes(k));
    }

    // Schema B — flat call with an explicit tool-call id.
    if (ID_KEYS.some((k) => keys.has(k))) {
        return (tokenName(v.name ?? v.tool_name ?? v.recipient) || v.type === 'function')
            && hasArgs(v);
    }

    // Schema C — channel/recipient form: a TOOL ROLE plus a token name plus args.
    if (typeof v.role === 'string' && TOOL_ROLES.has(v.role) && (v.recipient || v.tool_name)) {
        return tokenName(v.recipient ?? v.tool_name) && hasArgs(v);
    }

    return false;
}
```

The reviewer's report fails all three: no `type:'function'`, no id key, and `role`
alone without `recipient`/`tool_name` is not schema C. A bare `{name, input}` object
is no longer an envelope at all — a discriminant is mandatory.

### 7.2 Added criteria

| # | Input | Expected |
|---|-------|----------|
| 23 | the reviewer's `{"type":"report","role":"assistant","id":…,"name":"market.summary","input":{…}}` | NOT a wrapper |
| 24 | `{"name":"web.run","input":{…}}` with no discriminant | NOT a wrapper (a discriminant is required) |
| 25 | `{"type":"function","function":{"name":"web.run","arguments":"{}"}}` | wrapper (schema A) |
| 26 | `{"type":"function","function":{"name":"web.run"}}` — no args | NOT a wrapper |
| 27 | `{"function":{"name":"x","arguments":{},"notes":"…"}}` — stray nested key | NOT a wrapper (nested allowlist) |
| 28 | `{"tool_call_id":"c1","name":"web.run","arguments":"{}"}` | wrapper (schema B) |
| 29 | `{"role":"tool","recipient":"web.run","arguments":{}}` | wrapper (schema C) |
| 30 | `{"role":"assistant","name":"Quarterly Review","input":{…}}` | NOT a wrapper (name not token-shaped, no recipient) |
