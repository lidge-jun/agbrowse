# WP6 — G81b: triggering-row `aria-controls`

> **Split notice (A-gate round 1, blocker 9):** this doc originally bundled G25 (zh
> locale) into the same cycle on a size argument. Size is not a dependency, so G25
> moved to its own phase and its own document, `060_zh_locale.md`. Part B below is
> superseded by that file and retained only for its measured findings.

## Part A — G81b: read `aria-controls` from the triggering row

Row opened by the round-4 WP3 audit (`260725_oracle_chase3/020` §13.1).

### A.1 Problem

`resolveComposerMenuItem` (`chatgpt-menu-resolver.mjs`) collects `aria-controls`
ownership only from composer PLUS-button selectors:

```js
for (const selector of plusSelectors) {
    ... const id = button.getAttribute('aria-controls'); ...
}
```

So a `More` row that owns its submenu via `aria-controls` grants that submenu
nothing. Round 4 measured the consequence in Chromium: a hover-opened portaled
submenu with `aria-controls` on the `More` row only, and no composer-menu text,
resolved as `no-owned-menu` — the connector was unreachable.

That gap is only reachable through the hover path, because a CONFIRMED click mints
a causal epoch that covers the submenu anyway. It is nonetheless a real hole with a
cheap, safe fix.

### A.2 Change map

```diff
 export function resolveComposerMenuItem({
-    containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, token, isVisible,
+    containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, token, isVisible, triggerSelector,
 }) {
@@ ownedByPlus collection
     const ownedByPlus = new Set();
-    for (const selector of plusSelectors) {
+    // Any visible control that OWNS a container via aria-controls confers
+    // ownership on it: the composer plus button, and — for submenus — the row
+    // that opened them. This is still positive evidence, not an assumption.
+    const ownerSelectors = plusSelectors.concat(triggerSelector ? [triggerSelector] : []);
+    for (const selector of ownerSelectors) {
         for (const button of Array.from(document.querySelectorAll(selector))) {
             if (!visible(button)) continue;
             const id = button.getAttribute('aria-controls');
             const target = id && document.getElementById(id);
             if (target && visible(target)) ownedByPlus.add(target);
         }
     }
```

`chatgpt-tools.mjs` passes `triggerSelector: MENU_ITEM_SELECTOR` ONLY on the
post-`More` resolutions in `selectMoreComposerMenuItem`. It is not passed on the
initial lookup, so an arbitrary page control with `aria-controls` can never confer
ownership on the first pass.

### A.3 Accept criteria

| # | Scenario | Expected |
|---|----------|----------|
| 1 | hover-opened portaled submenu, `aria-controls` on the `More` row, no menu text, no token | resolved, `ownership: 'aria-controls'` |
| 2 | same DOM but the `aria-controls` target is hidden | not owned |
| 3 | an unrelated page control with `aria-controls` pointing at a GitHub popover, initial (non-submenu) lookup | NOT owned — `triggerSelector` absent on that call |
| 4 | round-4 regressions (unrelated-only, nested, hidden-preceding, cloneNode replacement, stale token) | all unchanged |
| 5 | confirmed-click submenu path | still works via the causal epoch |

Tests: extend `test/unit/web-ai-chatgpt-menu-resolver.test.mjs` and the public-path
`web-ai-chatgpt-composer-menu-flow.test.mjs`.

## Part B — G25: zh locale labels

### B.1 Decision: implement

Round 3 deferred this as "zh locale out of supported runtime scope". Re-reading the
code, that framing overstated the cost: the label tables are plain arrays
(`chatgpt-model.mjs:60-107`), and every selector already matches by testId FIRST
with labels as the fallback. Adding zh strings is additive, cannot break en/ko
matching, and removes a whole class of "works for me, not for you" reports.

There is no runtime, config, or contract change — so "out of scope" is not a
defensible permanent disposition when the alternative is four array entries.

### B.2 Change map — MODIFY `web-ai/chatgpt-model.mjs`

```diff
 export const CHATGPT_MODEL_OPTIONS = {
-    instant: { testIds: [...], labels: ['Instant', '즉시'] },
+    instant: { testIds: [...], labels: ['Instant', '즉시', '即时'] },
     thinking: {
         testIds: [...],
-        labels: ['Medium', 'High', 'Extra High', 'Thinking', '중간', '높음', '매우 높음'],
+        labels: ['Medium', 'High', 'Extra High', 'Thinking', '중간', '높음', '매우 높음',
+                 '中等', '高', '极高', '思考'],
     },
     pro: {
         testIds: [...],
-        labels: ['Pro', 'Heavy', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장'],
+        labels: ['Pro', 'Heavy', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장', 'Pro 扩展'],
     },
 };

 const CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS = {
-    instant: { defaultLabels: ['Instant', '즉시'], efforts: {} },
+    instant: { defaultLabels: ['Instant', '즉시', '即时'], efforts: {} },
     thinking: {
-        defaultLabels: ['Medium', '중간'],
+        defaultLabels: ['Medium', '중간', '中等'],
         efforts: {
-            medium: ['Medium', '중간'],
-            high: ['High', '높음'],
-            xhigh: ['Extra High', '매우 높음'],
+            medium: ['Medium', '중간', '中等'],
+            high: ['High', '높음', '高'],
+            xhigh: ['Extra High', '매우 높음', '极高'],
         },
     },
 };
```

**Ambiguity guard.** `高` is a substring of `极高`, so a naive `includes` match
would let "极高" satisfy a request for "高". The label matcher must therefore
prefer the LONGEST matching label, or match on normalized equality for CJK labels.
The B phase verifies which semantics the existing matcher uses and adds the guard
if it is substring-based — this is the one real risk in an otherwise additive
change, and it gets its own test.

### B.3 Accept criteria

| # | Scenario | Expected |
|---|----------|----------|
| 6 | zh menu, request `thinking`/`high` | `高` selected |
| 7 | zh menu containing both `高` and `极高`, request `high` | `高`, NOT `极高` (ambiguity guard) |
| 8 | zh menu, request `xhigh` | `极高` |
| 9 | en and ko menus | byte-identical behavior |
| 10 | testId present | testId still wins over labels |

## Scope boundary

IN: `chatgpt-menu-resolver.mjs` owner selectors, `chatgpt-tools.mjs` trigger
pass-through, `chatgpt-model.mjs` label tables (+ matcher guard if needed), the
three test files.
OUT: other locales, the effort-menu trigger testIds, and any change to how testId
matching is ordered.

## Audit amendments (A-gate round 1, blocker 6) — AUTHORITATIVE

### A.4 The proposed change granted ownership far too widely

`plusSelectors.concat(triggerSelector)` with `triggerSelector: MENU_ITEM_SELECTOR`
iterates EVERY menu row on the page and honors any `aria-controls` it finds. After a
`More` expansion, an unrelated row pointing at an unrelated popover would hand that
popover the STRONGEST ownership tier — re-opening precisely the wrong-click hole
round 4 spent five audit rounds closing.

**Corrected: pass the resolved control id, not a selector.**

```diff
 export function resolveComposerMenuItem({
-    containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, token, isVisible, triggerSelector,
+    containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, token, isVisible, ownedContainerId,
 }) {
@@
     const ownedByPlus = new Set();
     for (const selector of plusSelectors) {
         ...unchanged plus-button collection...
     }
+    // Exactly one extra container may be conferred ownership: the one the caller
+    // OBSERVED the triggering row control (its aria-controls target). A selector
+    // would admit every row on the page; an id admits the one we actually clicked.
+    if (ownedContainerId) {
+        const target = document.getElementById(ownedContainerId);
+        if (target && visible(target)) ownedByPlus.add(target);
+    }
```

`chatgpt-tools.mjs` reads the attribute from the specific `more.locator` it already
holds and passes the value through only on the post-`More` resolutions:

```diff
     const more = await resolveMenuItemLocator(page, ['더 보기', 'More'], token);
     if (!more) return false;
+    // Read aria-controls from THIS row, not from a selector class.
+    const moreControls = await more.locator.getAttribute('aria-controls').catch(() => null);
     await more.locator.hover({ timeout: 1_000 }).catch(() => undefined);
     await page.waitForTimeout(250).catch(() => undefined);
-    let item = await resolveMenuItemLocator(page, labels, null);
+    let item = await resolveMenuItemLocator(page, labels, null, moreControls);
```

with `resolveMenuItemLocator(page, labels, token, ownedContainerId)` forwarding it
into the evaluate options. The initial (pre-`More`) lookup passes nothing, so an
arbitrary control can never confer ownership on the first pass.

### A.5 Revised accept criteria (supersede A.3)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | hover-opened portaled submenu, `aria-controls` on the `More` row, no menu text, no token | resolved, `ownership: 'aria-controls'` |
| 2 | same but the target is hidden | not owned |
| 3 | **an UNRELATED row carries `aria-controls` pointing at a GitHub popover; the `More` row does not** | NOT owned — only the observed id is honored (blocker-6 case) |
| 4 | `ownedContainerId` absent (initial lookup) | behaves exactly as round 4 |
| 5 | `ownedContainerId` names a nonexistent id | ignored, no throw |
| 6 | round-4 regressions (unrelated-only, nested, hidden-preceding, cloneNode replacement, stale token, ambiguity) | all unchanged |
| 7 | confirmed-click submenu path | still works via the causal epoch |

### A.6 Corrected scope

IN: `chatgpt-menu-resolver.mjs` (`ownedContainerId` option), `chatgpt-tools.mjs`
(read + forward), `test/unit/web-ai-chatgpt-menu-resolver.test.mjs`,
`test/unit/web-ai-chatgpt-composer-menu-flow.test.mjs`.
OUT: everything in `chatgpt-model.mjs` (moved to `060_zh_locale.md`).
