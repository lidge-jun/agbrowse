# WP7 — G25: zh locale labels

Row: **G25**. Split out of the original WP6 bundle at the A gate (blocker 9): it
shares no module with G81b, so it gets its own cycle.

## 1. Decision: implement

Round 3 deferred this as "zh locale out of supported runtime scope". That framing
does not survive contact with the code: every selector matches by `data-testid`
FIRST and falls back to labels, so adding zh strings is additive and cannot break
en/ko. There is no runtime, config or contract change. "Out of scope" is not a
defensible permanent disposition when the alternative is a handful of table entries.

## 2. The real problem is duplication, not the tables (blocker 7)

The first draft changed two tables. The reviewer found FIVE more places where the
same locale strings are hardcoded, all of which would silently stay en/ko:

| Consumer | Path:line | Hardcoded today |
|----------|-----------|-----------------|
| model/pill text pattern | `chatgpt-model.mjs:47` | `즉시\|중간\|높음\|매우 높음\|Pro 확장\|프로 확장` |
| browser-context model matching | `chatgpt-model.mjs:1123-1126` | same, inside `matchesModelText` |
| checked-state decoding | `chatgpt-model.mjs:1376-1380` | `menuTextHasAnyExactLine([...])` x3 |
| menu-open detection | `chatgpt-model.mjs:1415-1417` | the `requiredLabels` default list |
| pill recognition | `chatgpt-model.mjs:1538` | `menuTextHasAnyExactLine([...])` |

Adding zh to two tables while five consumers keep their own copies is how a locale
"works" in selection and then fails at verification — the worst kind of half-fix.

## 3. Change map — one canonical table, all consumers derived

### 3.1 NEW canonical locale table (top of `chatgpt-model.mjs`)

```js
/**
 * Canonical per-choice labels in every supported locale. EVERY consumer —
 * selection, verification, menu-open detection and pill recognition — derives
 * from this table. Adding a locale must never mean editing five call sites.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const CHATGPT_LABELS = Object.freeze({
    instant:  Object.freeze(['Instant', 'Fast', '즉시', '即时']),
    medium:   Object.freeze(['Medium', '중간', '中等']),
    high:     Object.freeze(['High', '높음', '高']),
    xhigh:    Object.freeze(['Extra High', '매우 높음', '极高']),
    thinking: Object.freeze(['Thinking', 'Think', '思考']),
    pro:      Object.freeze(['Pro', 'Heavy', 'Pro 확장', '프로 확장', 'Pro 扩展']),
});

const labelsFor = (...keys) => keys.flatMap((key) => CHATGPT_LABELS[key] || []);
const THINKING_EFFORT_LABELS = labelsFor('medium', 'high', 'xhigh');
```

### 3.2 Derive every consumer

```diff
@@ :47 text-button pattern
-const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(?:ChatGPT|Instant(?:\s+5\.5)?|...|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)$/i;
+const LOCALE_ALTERNATION = [...new Set(Object.values(CHATGPT_LABELS).flat())]
+    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
+    .join('|');
+const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = new RegExp(
+    `^(?:ChatGPT|Instant(?:\\s+5\\.5)?|GPT[-\\s]?\\d(?:\\.\\d+)?(?:\\s+(?:Instant|Fast|Thinking|Pro)(?:\\s+(?:Light|Standard|Extended|Heavy))?)?|${LOCALE_ALTERNATION})$`, 'i');
@@ :1123 matchesModelText (browser context — pass labels IN, never close over them)
-            if (choice === 'instant') return /\b(Instant|Fast)\b|즉시/i.test(text);
-            if (choice === 'thinking') return /\b(Thinking|Think)\b|중간|높음|매우 높음/i.test(text);
-            if (choice === 'pro') return /\b(Pro|Heavy)\b|Pro 확장|프로 확장/i.test(text);
+            // localeLabels arrives through the evaluate options: this function is
+            // serialized, so it must not reference a module constant.
+            const forChoice = localeLabels[choice] || [];
+            if (forChoice.some((label) => text.includes(label))) return true;
@@ :1376 modelChoiceFromText
-    if (menuTextHasAnyExactLine(text, ['Instant', '즉시'])) return 'instant';
+    if (menuTextHasAnyExactLine(text, labelsFor('instant'))) return 'instant';
     if (isLegacyProModelLabel(text)) return null;
-    if (menuTextHasAnyExactLine(text, ['Medium', 'High', 'Extra High', '중간', '높음', '매우 높음'])) return 'thinking';
+    if (menuTextHasAnyExactLine(text, THINKING_EFFORT_LABELS)) return 'thinking';
-    if (menuTextHasAnyExactLine(text, ['Pro', 'Pro 확장', '프로 확장'])) return 'pro';
+    if (menuTextHasAnyExactLine(text, labelsFor('pro'))) return 'pro';
@@ :1415 isSimplifiedIntelligenceMenuOpen
-        : ['Instant', 'Medium', 'High', 'Extra High', 'Pro', '즉시', '중간', '높음', '매우 높음'];
+        : labelsFor('instant', 'medium', 'high', 'xhigh', 'pro');
@@ :1538 isModelPillText
-    return menuTextHasAnyExactLine(text, ['Instant', 'Medium', 'High', 'Extra High', 'Pro'])
+    return menuTextHasAnyExactLine(text, labelsFor('instant', 'medium', 'high', 'xhigh', 'pro'))
@@ CHATGPT_MODEL_OPTIONS / CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS
-        labels: ['Medium', 'High', 'Extra High', 'Thinking', '중간', '높음', '매우 높음'],
+        labels: labelsFor('medium', 'high', 'xhigh', 'thinking'),
     ...and likewise for instant/pro and the simplified effort map
```

**Serialization note (round-4 rule):** `matchesModelText` runs inside
`page.evaluate`, so the labels travel as an evaluate ARGUMENT (`localeLabels`), never
as a closed-over constant. This is the exact defect class that cost round 4 seven
audit rounds.

### 3.3 The ambiguity guard is NOT needed (blocker 7, accepted)

The first draft worried that `高` ⊂ `极高` would let a request for `high` match
`极高`. The reviewer established the matcher is normalized-line EQUALITY
(`chatgpt-model.mjs:1392`, `:1469`), not substring, so the collision cannot occur.
The guard is dropped.

One place DOES use substring semantics: `matchesModelText` above (`text.includes`).
There the choice granularity is instant/thinking/pro, and `高`/`极高` both map to
`thinking`, so a substring hit yields the same answer either way. Recorded so a
future reader does not re-derive the worry.

## 4. Accept criteria (activation-grounded)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | zh menu, request `thinking`+`high` | `高` row selected |
| 2 | zh menu containing `高` AND `极高`, request `high` | `高`, not `极高` (equality) |
| 3 | zh menu, request `xhigh` | `极高` |
| 4 | zh menu, request `instant` | `即时` |
| 5 | zh menu, request `pro` | `Pro 扩展` |
| 6 | **post-click verification** on a zh menu | `modelChoiceFromText` returns the right choice — the half-fix guard |
| 7 | **menu-open detection** on a zh menu | `isSimplifiedIntelligenceMenuOpen` true |
| 8 | **pill recognition** of a zh pill | `isModelPillText` true |
| 9 | en and ko menus | byte-identical behavior (regression) |
| 10 | testId present | testId still wins over labels |
| 11 | `CHATGPT_MODEL_TEXT_BUTTON_PATTERN` | matches every canonical label; regex-escaping holds |
| 12 | **serialization** — `matchesModelText` via real `page.evaluate` | labels arrive as an argument, no `ReferenceError` |

Rows 6-8 are the ones that would have been missed by the two-table version.

## 5. Scope boundary

IN: `chatgpt-model.mjs` canonical table + the five derived consumers + the two option
tables, `test/unit/web-ai-chatgpt-model.test.mjs`, transport case.
OUT: other locales (ja, es, …) — the table makes them a one-line addition, but adding
them is a separate decision; effort-trigger testIds; and the menu-open timing logic.

## 6. Audit amendments (A-gate round 2, blocker 5) — AUTHORITATIVE over §3

The single canonical table lost existing behavior. Measured:

```text
Standard Pro  old=true   proposed=false   <- REGRESSION
Extended Pro  old=true   proposed=false   <- REGRESSION
Fast          old=false  proposed=true    <- newly matched
Heavy         old=false  proposed=true    <- newly matched
```

Root cause: one flat table cannot serve four different vocabularies. `Pro Standard`
/`Pro Extended` are MENU-ROW labels; `Standard Pro`/`Extended Pro` are observed PILL
labels (`chatgpt-model.mjs:48`); `Fast`/`Heavy` are selection ALIASES that were never
valid standalone button text. Flattening them into one alternation both dropped and
invented matches.

### 6.1 Four canonical sets, not one

```js
/** Menu-row labels per model choice (selection + verification). */
const CHATGPT_MODEL_ROW_LABELS = Object.freeze({
    instant: Object.freeze(['Instant', '즉시', '即时']),
    thinking: Object.freeze(['Thinking', '思考']),
    pro: Object.freeze(['Pro', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장', 'Pro 扩展']),
});
/** Effort-row labels (thinking sub-menu). */
const CHATGPT_EFFORT_LABELS = Object.freeze({
    medium: Object.freeze(['Medium', '중간', '中等']),
    high: Object.freeze(['High', '높음', '高']),
    xhigh: Object.freeze(['Extra High', '매우 높음', '极高']),
});
/** Observed pill labels — NOT menu rows. Unchanged from chatgpt-model.mjs:48. */
export const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Pro', 'Standard Pro', 'Extended Pro'];
/** Selection-only aliases: accepted as user input, never matched as button text. */
const CHATGPT_SELECTION_ALIASES = Object.freeze({ instant: ['Fast'], pro: ['Heavy'] });
```

### 6.2 Each consumer derives from the RIGHT set

- `CHATGPT_MODEL_TEXT_BUTTON_PATTERN` (`:47`): built from model-row labels + effort
  labels + the observed pill labels — **never** from the aliases. An equivalence test
  asserts the derived regex matches exactly the same strings as today's literal for
  every en/ko token, plus the new zh ones.
- `matchesModelText` (`:1123`, browser context): receives a COMPOSED per-choice map as
  an evaluate argument — `{ instant: [...rows, ...aliases], thinking: [...rows,
  ...allEffortLabels], pro: [...rows, ...aliases] }` — so `thinking` keeps matching
  `Medium/High/Extra High` as it does today. That omission was blocker 5's third half.
- `modelChoiceFromText` (`:1376`), `isSimplifiedIntelligenceMenuOpen` (`:1415`),
  `isModelPillText` (`:1538`): model-row + effort sets, pills for the pill test.

### 6.3 Equivalence is the acceptance bar

| # | Scenario | Expected |
|---|----------|----------|
| 13 | every en/ko string accepted today by each of the five consumers | still accepted (table-driven old-vs-new equivalence test) |
| 14 | every string REJECTED today | still rejected — specifically `Fast` and `Heavy` as standalone button text |
| 15 | `Standard Pro` / `Extended Pro` pills | still recognized |
| 16 | `matchesModelText('Medium', 'thinking', …)` | true (composed map) |
| 17 | zh rows 1-12 from §4 | as recorded |

Row 13/14 are generated from the CURRENT literals captured before the change, so the
test fails if the refactor alters any existing verdict.
