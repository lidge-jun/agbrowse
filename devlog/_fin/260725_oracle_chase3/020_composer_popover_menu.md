# WP3 — issue #81: composer connector selection on the current popover DOM

Issue: [#81] "ChatGPT GitHub connector가 현재 popover 메뉴 구조에서 선택되지 않는 문제"
(opened 2026-07-01 by @jhste102lab, no comments, still open).
Reporter environment: agbrowse 0.1.16, Node 24.13.0, headed Chrome/CDP, ChatGPT web.

## 1. Problem

`agbrowse web-ai query --plugin github` returns
`composer plugin not selected: github` with `usedFallbacks: ['composer-plus-shortcut']`,
while the GitHub connector is visibly present in the composer menu. Three assumptions in
`web-ai/chatgpt-tools.mjs` no longer match the shipped ChatGPT DOM:

| # | Path:line | Assumption | Current DOM |
|---|-----------|-----------|-------------|
| A1 | `chatgpt-tools.mjs:183-188` (`isComposerPlusMenuOpen`) | the open menu is a `[role="menu"]` element whose text contains a tool phrase (`이미지 만들기`, `Deep research`, ...) | menu renders as `div.popover`; a connector-only popover contains none of those phrases |
| A2 | `chatgpt-tools.mjs:190-199` (`findVisibleMenuItemByLabels`) | items are `[role="menuitem"]` / `menuitemradio` / `menuitemcheckbox` | items are `div.__menu-item[tabindex="0"]` inside `.popover` |
| A3 | `chatgpt-tools.mjs:146-161` (`selectMoreComposerMenuItem`) | every plugin lives under a `More`/`더 보기` submenu | connectors are surfaced directly in the first popover; when `More` is absent the function returns `false` at `:150` before ever looking for the label |

A1 makes `openComposerPlusMenu` (`:164-179`) believe the menu never opened, so it walks
every plus-button selector, fails each open-check, and falls through to the
`composer-plus-shortcut` chord — which is exactly the fallback the reporter observed.
A3 then guarantees `false` even when the label is on screen.

The reporter's local patch (in the issue body) proved the three fixes work against the
live UI. This phase lands a hardened version of that shape.

## 2. Change map — MODIFY `web-ai/chatgpt-tools.mjs`

### 2.1 Menu container + item selector constants (NEW, top of file)

```diff
+const MENU_CONTAINER_SELECTOR = '[role="menu"], .popover';
+const MENU_ITEM_SELECTOR = [
+    '[role="menuitem"]',
+    '[role="menuitemradio"]',
+    '[role="menuitemcheckbox"]',
+    '.popover .__menu-item',
+    '.popover [tabindex="0"][data-fill]',
+].join(', ');
+const MENU_OPEN_TEXT_PATTERN = /사진 및 파일 추가|최근 파일|이미지 만들기|심층 리서치|웹 검색|더 보기|Add photos|Create image|Deep research|Web search|More/i;
```

`[tabindex="0"][data-fill]` is deliberately narrower than the reporter's
`.popover [tabindex="0"]`: the reported DOM carries `data-fill` on the menu row, and the
bare `[tabindex="0"]` form would also match the popover's scroll container and any
focusable non-item child, producing wrong-element clicks.

### 2.2 `isComposerPlusMenuOpen` — accept popovers, and accept connector-only menus

```diff
-async function isComposerPlusMenuOpen(page) {
-    return page.locator('[role="menu"]').evaluateAll((menus) => menus.some(menu => {
-        const text = ... innerText ...;
-        return /사진 및 파일 추가|.../i.test(text);
-    })).catch(() => false);
-}
+async function isComposerPlusMenuOpen(page) {
+    const byText = await page.locator(MENU_CONTAINER_SELECTOR)
+        .evaluateAll((menus, pattern) => {
+            const re = new RegExp(pattern.source, pattern.flags);
+            return menus.some(menu => re.test(menu.innerText || menu.textContent || ''));
+        }, { source: MENU_OPEN_TEXT_PATTERN.source, flags: MENU_OPEN_TEXT_PATTERN.flags })
+        .catch(() => false);
+    if (byText) return true;
+    // A connector-only popover carries none of the tool phrases; treat a visible
+    // container holding at least one menu item as open.
+    return Boolean(await firstVisibleMenuItem(page));
+}
```

`firstVisibleMenuItem` is the structural fallback: any visible `MENU_ITEM_SELECTOR`
node inside a visible `MENU_CONTAINER_SELECTOR`. This closes A1 without hardcoding a
connector-name regex (the reporter's `GitHub|Supabase|OpenAI Platform` list would rot
with every new connector).

### 2.3 `findVisibleMenuItemByLabels` — widen candidates

```diff
-    const candidates = await page.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').all()
+    const candidates = await page.locator(MENU_ITEM_SELECTOR).all()
```

Label matching keeps `normalizeUiText` + `textIncludesLabel` (`:280-292`), which already
handles the reported row shape (`<span>GitHub</span>` plus a description span) because
`innerText` of the row contains both and `textIncludesLabel` is a substring test.

### 2.4 `selectMoreComposerMenuItem` — current menu first, `More` as fallback

```diff
 async function selectMoreComposerMenuItem(page, labels, usedFallbacks) {
     await openComposerPlusMenu(page, usedFallbacks);
+    const direct = await findVisibleMenuItemByLabels(page, labels);
+    if (direct) {
+        if (await checkedState(direct) === 'true') return true;
+        return clickMenuItem(page, direct);
+    }
     const more = await findVisibleMenuItemByLabels(page, ['더 보기', 'More']);
     if (!more) return false;
     ...unchanged...
 }
```

Ordering matters: the direct lookup runs before the `More` probe, so a connector present
in the first popover is clicked immediately, and the legacy submenu path is untouched
for connectors that really do live under `More`.

### 2.5 `clickMenuItem` — non-ARIA rows have no `aria-checked`

`checkedState` (`:207-209`) returns `null` for a `div.__menu-item`, which the code
already treats as "not selected" and clicks. No change needed; recorded here so the A
reviewer does not flag it as an unhandled case.

## 3. Accept criteria (activation-grounded)

| Scenario | Activation | Observable effect |
|----------|-----------|-------------------|
| Popover connector (the issue) | fake page: `div.popover` containing `div.__menu-item[tabindex="0"][data-fill]` with text `GitHub` + description, no `role=menu`, no `More` | `selectChatGptComposerTools(page, { plugins: ['github'] })` returns `selectedPlugins: ['github']`, `warnings: []`, and no `composer-plus-shortcut` in `usedFallbacks` |
| Legacy submenu | fake page: `[role="menu"]` with `이미지 만들기` text and a `[role="menuitem"]` `More` revealing `GitHub` | still selects; `More` path exercised |
| Already selected | popover row with `aria-checked="true"` | returns selected without a click |
| Absent connector | popover without the label and without `More` | warning `composer plugin not selected: github` preserved |
| Menu-open detection | popover with only connector rows | `isComposerPlusMenuOpen` true, so the plus-button loop stops and the chord fallback is never used |

Test file: `test/unit/web-ai-chatgpt-composer-popover.test.mjs` (NEW). The existing
`test/unit/web-ai-chatgpt-tools.test.mjs` is source-shape and resolver oriented; the new
file carries the DOM-shape fake page (a locator stub over a jsdom document, matching the
jsdom devDependency added in `5e59a9f`).

## 4. Scope boundary

IN: `web-ai/chatgpt-tools.mjs`, the new test file, and — if the docs gates require it —
the `structure/str_func.md` line count for `chatgpt-tools.mjs`.
OUT: composer attachment/upload surfaces, the plus-button selector list (unchanged —
the failure was the open-check, not the button), tool (non-plugin) selection ordering,
and any live-browser verification (no credentials in this loop; the issue reporter's
live confirmation plus the DOM-shape test is the evidence).

## 5. Audit amendments (A-gate round 1, reviewer Schrodinger)

**Blocker 4 [High] accepted — the widening was page-global.** Confirmed against source:
`isComposerPlusMenuOpen` (`chatgpt-tools.mjs:182-187`) is consulted by
`openComposerPlusMenu` (`:164-179`) as the "already open?" short-circuit, and
`findVisibleMenuItemByLabels` (`:190-199`) is shared with **tool** selection
(`:137-143`), not only plugins. A bare `.popover` match would therefore (a) make an
unrelated open popover — settings, a tooltip card, an account menu — look like the
composer menu and suppress the plus-button click, and (b) let a wrong-row click land
during ordinary tool selection. Both are worse than the bug being fixed.

**Amendment: resolve one composer-owned container, then search only inside it.**

```diff
+/**
+ * Resolve the composer's own menu container: the popover/menu owned by the
+ * visible plus button (via aria-controls when present), else the nearest
+ * container that holds composer-menu content. Returns null when no composer
+ * menu is open — an unrelated popover elsewhere on the page never qualifies.
+ * @param {Page} page
+ * @returns {Promise<Locator|null>}
+ */
+async function resolveComposerMenuContainer(page) {
+    for (const selector of PLUS_BUTTON_SELECTORS) {
+        const button = page.locator(selector).first();
+        if (!(await button.isVisible().catch(() => false))) continue;
+        const controls = await button.getAttribute('aria-controls').catch(() => null);
+        if (controls) {
+            const owned = page.locator(`#${CSS.escape(controls)}`).first();
+            if (await owned.isVisible().catch(() => false)) return owned;
+        }
+    }
+    // No aria-controls: accept a visible container that carries composer-menu
+    // content — either a known tool/connector phrase, or at least one row that
+    // matches a label we are actually looking for is checked by the caller.
+    const containers = await page.locator(MENU_CONTAINER_SELECTOR).all().catch(() => []);
+    for (const container of containers) {
+        if (!(await container.isVisible().catch(() => false))) continue;
+        const text = normalizeUiText(await container.innerText({ timeout: 500 }).catch(() => ''));
+        if (MENU_OPEN_TEXT_PATTERN.test(text)) return container;
+        // connector-only popover: no tool phrases, but composer menus are the only
+        // popovers anchored to the composer form.
+        const insideComposer = await container.evaluate((node) =>
+            Boolean(node.closest('form')) || Boolean(document.querySelector('form')?.contains(node)),
+        ).catch(() => false);
+        if (insideComposer) return container;
+    }
+    return null;
+}
```

`isComposerPlusMenuOpen` becomes `Boolean(await resolveComposerMenuContainer(page))`, and
`findVisibleMenuItemByLabels` takes the container as its search root:

```diff
-async function findVisibleMenuItemByLabels(page, labels) {
-    const candidates = await page.locator('[role="menuitem"], ...').all()
+async function findVisibleMenuItemByLabels(page, labels, container = null) {
+    const root = container || await resolveComposerMenuContainer(page);
+    if (!root) return null;
+    const candidates = await root.locator(MENU_ITEM_SELECTOR).all().catch(() => []);
```

This keeps the fix (popover rows become clickable) while removing the page-global reach
the reviewer flagged. The submenu path passes the same container so `More` expansion
searches the composer menu only.

**Blocker 9 [Medium] accepted — `firstVisibleMenuItem` was prose.** It is deleted; the
structural open-check is now `resolveComposerMenuContainer` above, given in full.

**Blocker 10 [Low] accepted — anchor drift.** §1 A1 should read
`chatgpt-tools.mjs:182-187` (declaration through close), not `:183-188`.

**Scope correction.** Tool selection is now explicitly IN scope for regression coverage:
`findVisibleMenuItemByLabels` is shared, so §4's OUT list drops "tool selection ordering"
and the test matrix below covers it.

**Revised accept criteria.** Test file `test/unit/web-ai-chatgpt-composer-popover.test.mjs`:

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | connector-only `.popover` with `div.__menu-item[tabindex="0"][data-fill]` "GitHub", inside the composer form, no `role=menu`, no `More` | `selectedPlugins: ['github']`, `warnings: []`, `usedFallbacks` has no `composer-plus-shortcut` |
| 2 | legacy `[role="menu"]` with tool text + `More` submenu revealing GitHub | still selects; submenu path exercised |
| 3 | **unrelated visible `.popover`** elsewhere in the document (no composer form ancestor, no tool text) | `isComposerPlusMenuOpen` false; the plus button is still clicked; no row inside it is ever selected |
| 4 | popover containing a focusable non-row child (`[tabindex="0"]` without `data-fill`) whose text contains the label | that child is NOT returned as the item |
| 5 | ordinary tool selection (`web-search`) on the legacy menu | unchanged behavior, still selected |
| 6 | duplicate labels in two containers (composer + unrelated) | only the composer-container row is clicked |
| 7 | row with `aria-checked="true"` | selected without a click |
| 8 | label absent, no `More` | `composer plugin not selected: github` preserved |

## 6. Audit amendments (A-gate round 2, same reviewer)

### 6.1 Blocker 1 [High] accepted — form-anchoring is wrong for this repo's DOM

Verified: `test/fixtures/provider-dom/chatgpt-gpt56-chat.html:48-54` has the plus button
with `data-testid="composer-plus-btn"` and **no `aria-controls`**, and the form closes at
`:61` while the menu root begins at `:63` — a sibling, not a descendant. So
`closest('form')` resolves nothing for exactly the DOM the repo already models, and
§5's test case 1 (popover inside the form) was an unrepresentative fixture.

Also verified: `CSS.escape` does not exist in the Node context where the plan called it.

```text
$ node --input-type=module -e 'console.log(typeof CSS)'
undefined
```

**Amendment: resolve the container by open-delta, not by ancestry.** The composer menu is
identified as *the container that became visible because we clicked the plus button*:

```diff
+/** @param {Page} page @returns {Promise<string[]>} visible container fingerprints */
+async function visibleMenuFingerprints(page) {
+    return page.locator(MENU_CONTAINER_SELECTOR).evaluateAll((nodes) => nodes
+        .filter((node) => {
+            const rect = node.getBoundingClientRect();
+            return rect.width > 0 && rect.height > 0;
+        })
+        .map((node, index) => node.id || `${node.className || 'popover'}#${index}`),
+    ).catch(() => []);
+}
+
+/**
+ * Resolve the composer's own menu container.
+ * Priority: (1) the plus button's aria-controls target when the attribute exists;
+ * (2) the container that appeared in the open-delta around the plus click;
+ * (3) a visible container whose text matches composer-menu content.
+ * Returns null when no composer menu is open — an unrelated popover never qualifies.
+ * @param {Page} page
+ * @param {string[]} [beforeFingerprints]
+ * @returns {Promise<Locator|null>}
+ */
+async function resolveComposerMenuContainer(page, beforeFingerprints) {
+    for (const selector of PLUS_BUTTON_SELECTORS) {
+        const button = page.locator(selector).first();
+        if (!(await button.isVisible().catch(() => false))) continue;
+        const controls = await button.getAttribute('aria-controls').catch(() => null);
+        if (!controls) continue;
+        // Node-safe: attribute selector, no CSS.escape (unavailable outside the browser).
+        const owned = page.locator(`[id="${controls.replace(/"/g, '\\"')}"]`).first();
+        if (await owned.isVisible().catch(() => false)) return owned;
+    }
+    const containers = await page.locator(MENU_CONTAINER_SELECTOR).all().catch(() => []);
+    /** @type {Locator|null} */
+    let textMatch = null;
+    for (let i = 0; i < containers.length; i += 1) {
+        const container = containers[i];
+        if (!(await container.isVisible().catch(() => false))) continue;
+        if (Array.isArray(beforeFingerprints)) {
+            const fingerprint = await container.evaluate((node, index) =>
+                node.id || `${node.className || 'popover'}#${index}`, i).catch(() => null);
+            if (fingerprint && !beforeFingerprints.includes(fingerprint)) return container;
+        }
+        if (!textMatch) {
+            const text = normalizeUiText(await container.innerText({ timeout: 500 }).catch(() => ''));
+            if (MENU_OPEN_TEXT_PATTERN.test(text)) textMatch = container;
+        }
+    }
+    return textMatch;
+}
```

`openComposerPlusMenu` captures `visibleMenuFingerprints(page)` **before** clicking and
passes it in afterwards, so a connector-only popover — portaled to `body`, carrying no
tool phrases — is still identified as ours because it is the one that appeared. An
unrelated popover that was already open is in the before-set and can never win.

`isComposerPlusMenuOpen` (the pre-click short-circuit) has no delta available, so it uses
only the aria-controls and text-match rungs — i.e. it stays conservative: a connector-only
popover that is already open reads as "not open", we click the plus button, and the delta
path resolves it. Clicking an already-open menu closes and reopens it, which is idempotent
for selection purposes.

### 6.2 Blocker 3 [Medium] accepted — the submenu is a separate root

Verified: `test/fixtures/provider-dom/chatgpt-gpt56-chat.html:138-140` models an opened
submenu as its own `div[role="menu"][data-state="open"]`, not a descendant. Today's code
works because `findVisibleMenuItemByLabels` re-scans page-wide after the `More` click
(`chatgpt-tools.mjs:151-157`); pinning it to the parent container would break that.

**Amendment: the `More` path re-resolves after expansion.**

```diff
 async function selectMoreComposerMenuItem(page, labels, usedFallbacks) {
-    await openComposerPlusMenu(page, usedFallbacks);
-    const direct = await findVisibleMenuItemByLabels(page, labels);
+    const container = await openComposerPlusMenu(page, usedFallbacks);
+    const direct = await findVisibleMenuItemByLabels(page, labels, container);
     if (direct) { ...unchanged... }
-    const more = await findVisibleMenuItemByLabels(page, ['더 보기', 'More']);
+    const more = await findVisibleMenuItemByLabels(page, ['더 보기', 'More'], container);
     if (!more) return false;
-    ...hover / click More...
-    const item = await findVisibleMenuItemByLabels(page, labels);
+    const beforeSubmenu = await visibleMenuFingerprints(page);
+    ...hover / click More...
+    // The submenu may be a sibling/portaled root (fixture :138-140), so re-resolve
+    // against the post-expansion delta instead of staying inside the parent container.
+    const submenu = await resolveComposerMenuContainer(page, beforeSubmenu);
+    const item = await findVisibleMenuItemByLabels(page, labels, submenu || container);
```

`openComposerPlusMenu` now returns the resolved container so callers do not re-resolve it.

### 6.3 Revised test matrix (supersedes §5)

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | connector-only `.popover` portaled to `body` (sibling of the form, no `aria-controls`, no tool text, no `More`) | selected via the open-delta path; `warnings: []`; no `composer-plus-shortcut` |
| 2 | plus button WITH `aria-controls="menu-x"` | container resolved by id; no `CSS` global referenced anywhere in the module |
| 3 | legacy `[role="menu"]` + `More` opening a **sibling** submenu root | GitHub found in the submenu (blocker 3 regression case) |
| 4 | unrelated `.popover` already visible before the click | never selected from; the plus button is still clicked |
| 5 | focusable non-row child (`[tabindex="0"]` without `data-fill`) matching the label | not returned |
| 6 | duplicate labels in composer container and an unrelated container | only the composer one clicked |
| 7 | ordinary tool selection (`web-search`) on the legacy menu | unchanged |
| 8 | row with `aria-checked="true"` | selected without a click |
| 9 | label absent, no `More` | `composer plugin not selected: github` preserved |

## 7. Redesign after audit round 3 (LOOP-REPAIR-01 replan, supersedes §5 and §6)

Round 3 killed the open-delta approach: `className#index` fingerprints are computed over
the *visible-filtered* list at snapshot time but re-derived over the *unfiltered* list at
resolution time, so the indices live in different coordinate systems and an unrelated
popover can look "new". The reviewer is right, and the deeper lesson is that **any scheme
that compares two separate snapshots from Node is guessing at node identity**. Three
rounds of patching the same guess is the signal to change the shape (LOOP-REPAIR-01), so
the delta machinery, the fingerprints, and the `closest('form')` heuristic are all deleted.

### 7.1 New shape: one browser-context resolution, ambiguity fails closed

Node identity is trivial *inside* the page, so the whole "which menu is ours, which row is
the label" question is answered in a single `page.evaluate` that returns an **index into a
deterministic global list**. The caller then acts on `page.locator(MENU_ITEM_SELECTOR).nth(index)`.
No snapshots, no deltas, no geometry.

```js
/**
 * Browser-context resolver. Returns the index of the composer-menu row matching
 * one of `labels`, within document order of MENU_ITEM_SELECTOR matches, or a
 * reason why it could not be resolved. Never mutates.
 * @param {{ containerSelector: string, itemSelector: string, plusSelectors: string[], labels: string[], menuTextPattern: { source: string, flags: string } }} options
 * @returns {{ index: number, checked: string|null, ownership: 'aria-controls'|'menu-text'|'unique-label' }
 *           | { index: -1, reason: 'no-open-menu'|'label-not-found'|'ambiguous' }}
 */
export function resolveComposerMenuItem({ containerSelector, itemSelector, plusSelectors, labels, menuTextPattern }) {
    const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const visible = (node) => {
        const rect = node.getBoundingClientRect?.();
        return Boolean(rect) && rect.width > 0 && rect.height > 0;
    };
    const wanted = labels.map(norm).filter(Boolean);
    const re = new RegExp(menuTextPattern.source, menuTextPattern.flags);

    // 1. Containers the composer's plus button explicitly owns.
    const owned = new Set();
    for (const selector of plusSelectors) {
        for (const button of Array.from(document.querySelectorAll(selector))) {
            if (!visible(button)) continue;
            const id = button.getAttribute('aria-controls');
            const target = id && document.getElementById(id);
            if (target && visible(target)) owned.add(target);
        }
    }

    const containers = Array.from(document.querySelectorAll(containerSelector)).filter(visible);
    if (containers.length === 0) return { index: -1, reason: 'no-open-menu' };

    // 2. All rows in document order — this list is what the caller will index into.
    const allItems = Array.from(document.querySelectorAll(itemSelector));
    const matches = [];
    for (const container of containers) {
        const ownership = owned.has(container) ? 'aria-controls'
            : re.test(container.innerText || container.textContent || '') ? 'menu-text'
            : 'unique-label';
        for (const item of Array.from(container.querySelectorAll(itemSelector))) {
            if (!visible(item)) continue;
            const text = norm(item.innerText || item.textContent);
            if (!text || !wanted.some((label) => text.includes(label))) continue;
            const index = allItems.indexOf(item);
            if (index >= 0) matches.push({ index, checked: item.getAttribute('aria-checked'), ownership });
        }
    }
    if (matches.length === 0) return { index: -1, reason: 'label-not-found' };

    // 3. Ownership precedence; ties within the strongest tier fail closed.
    for (const tier of ['aria-controls', 'menu-text', 'unique-label']) {
        const tiered = matches.filter((match) => match.ownership === tier);
        if (tiered.length === 1) return tiered[0];
        if (tiered.length > 1) return { index: -1, reason: 'ambiguous' };
    }
    return { index: -1, reason: 'ambiguous' };
}
```

Three properties this buys, each answering a specific blocker:

- **No cross-snapshot identity.** Containers, rows, and the returned index are all computed
  in one pass over one live DOM (round-3 blocker 1).
- **Ambiguity is a failure, not a guess.** Two containers both holding a "GitHub" row in the
  same ownership tier returns `ambiguous`, and the caller emits the existing
  `composer plugin not selected: github` warning. A wrong-row click is now impossible by
  construction — the previous "pick the first one" behavior was the actual danger
  (round-1 blocker 4, round-3 blocker 1).
- **Portaled popovers work.** Ownership never depends on DOM ancestry, so a body-level
  connector popover resolves through `aria-controls` or, failing that, as the unique
  container holding the requested label (round-2 blocker 1).

### 7.2 Menu-open detection is label-aware

`isComposerPlusMenuOpen(page, labels)` is now "can the row we are looking for be resolved,
or does a composer-owned menu exist?":

```diff
-async function isComposerPlusMenuOpen(page) { ...role=menu text scan... }
+/** @param {Page} page @param {string[]} labels */
+async function isComposerPlusMenuOpen(page, labels = []) {
+    const result = await evaluateComposerMenu(page, labels).catch(() => null);
+    if (!result) return false;
+    // A resolvable row, or an ambiguity we must not paper over by re-clicking,
+    // both mean a menu is already open.
+    return result.index >= 0 || result.reason === 'ambiguous' || result.reason === 'label-not-found'
+        ? result.reason !== 'label-not-found' || await hasComposerOwnedMenu(page)
+        : false;
+}
```

where `hasComposerOwnedMenu` is the same evaluation with an empty label list, accepting only
the `aria-controls` and `menu-text` tiers. The consequence the reviewer asked about: an
unrelated popover with no composer ownership and no matching row never reports the menu as
open, so the plus button is still clicked; and a connector-only owned popover DOES report
open, so we never toggle it shut.

### 7.3 `More` submenu without deltas

After hovering/clicking `More`, we simply **re-run the same resolver** for the plugin
labels. A submenu rendered as a sibling root is just another visible container, and the
`unique-label` tier finds it; a re-rendered parent menu no longer competes because it does
not contain the plugin label (round-3 blocker 1, `More` half). The `More` row itself is
resolved by the same function with `labels: ['더 보기', 'More']`.

```diff
 async function selectMoreComposerMenuItem(page, labels, usedFallbacks) {
     await openComposerPlusMenu(page, usedFallbacks, labels);
-    const direct = await findVisibleMenuItemByLabels(page, labels);
+    const direct = await resolveMenuItemLocator(page, labels);
     if (direct) { if (direct.checked === 'true') return true; return clickMenuItem(page, direct.locator); }
-    const more = await findVisibleMenuItemByLabels(page, ['더 보기', 'More']);
+    const more = await resolveMenuItemLocator(page, ['더 보기', 'More']);
     if (!more) return false;
     ...hover / click More (unchanged)...
-    const item = await findVisibleMenuItemByLabels(page, labels);
+    const item = await resolveMenuItemLocator(page, labels);   // re-resolve; submenu may be a sibling root
     if (!item) return false;
     if (item.checked === 'true') return true;
     return clickMenuItem(page, item.locator);
 }
```

`resolveMenuItemLocator` is the thin Node wrapper: run the evaluation, and on
`index >= 0` return `{ locator: page.locator(MENU_ITEM_SELECTOR).nth(index), checked }`.
Selection-time races (the DOM changing between evaluation and click) surface as an ordinary
Playwright click failure, which `clickMenuItem` (`chatgpt-tools.mjs:212-227`) already
handles with a bounding-box fallback.

### 7.4 Final accept criteria (supersedes §5 and §6.3)

| # | Scenario | Assertion |
|---|----------|-----------|
| 1 | connector-only `.popover` portaled to `body`, no `aria-controls`, no tool text, no `More` | `selectedPlugins: ['github']`, no `composer-plus-shortcut` fallback (issue #81) |
| 2 | plus button with `aria-controls` pointing at the popover | resolved in the `aria-controls` tier; module references no `CSS` global |
| 3 | legacy `[role="menu"]` + `More` opening a **sibling** submenu root | GitHub resolved after expansion |
| 4 | parent menu re-renders on `More` click and no submenu appears | `label-not-found` -> warning preserved, no wrong click |
| 5 | unrelated visible `.popover` with no composer ownership and no matching row | menu-open false, plus button still clicked |
| 6 | unrelated popover **and** composer popover both holding a "GitHub" row, same tier | `ambiguous` -> warning preserved, nothing clicked |
| 7 | same as 6 but the composer one is `aria-controls`-owned | the owned row wins (tier precedence) |
| 8 | hidden container preceding a visible one | hidden container never participates (visibility filter is applied once, in-page) |
| 9 | focusable non-row child (`[tabindex="0"]` without `data-fill`) matching the label | not a candidate |
| 10 | ordinary tool selection (`web-search`) on the legacy menu | unchanged behavior |
| 11 | row with `aria-checked="true"` | selected without a click |
| 12 | label absent everywhere | `composer plugin not selected: github` preserved |

Cases 4, 6, 7, 8 are the round-3 regression classes. jsdom drives all of them: the resolver
is a pure function of `document`, exported from a new `web-ai/chatgpt-menu-resolver.mjs` and
testable without Playwright — the same pattern `chatgpt-response-dom.mjs` uses for
`readChatGptStreamingState` (`chatgpt.mjs:986-994` passes it to `page.evaluate`, while
`test/unit/web-ai-chatgpt-response-fragments.test.mjs` calls it directly).

## 8. FINAL change map (audit round 4, reviewer Mill — supersedes §5, §6, §7)

Round 4 reproduced three real defects in §7 and flagged two under-specifications. All
accepted; the resolver below is the complete, final specification for WP3.

### 8.1 What round 4 proved

| # | Defect | Reproduction |
|---|--------|--------------|
| 2 | `unique-label` treated ANY container as a candidate, so a lone `#account-menu.popover` containing a "GitHub" row resolved as ours — clicked without ever opening the composer menu | reviewer replay returned `{ index: 0, ownership: 'unique-label' }` for an unrelated-only DOM |
| 3 | `.popover > [role="menu"] > .__menu-item` matches BOTH container selectors, so one ordinary menu collected the same row twice and returned `ambiguous` | replay returned `{ index: -1, reason: 'ambiguous' }` with two identical `index: 0` matches |
| 4 | jsdom returns all-zero rects, so a `getBoundingClientRect()`-based visibility test makes every fixture element invisible | confirmed locally: `rect 0 0` for a `.__menu-item`; the existing precedent `test/unit/web-ai-chatgpt-response-fragments.test.mjs:224-235` stubs rects for exactly this reason |

Defect 2 is the important one: it invalidated §7's "wrong-row click is impossible by
construction" claim. Ownership must be *positive evidence*, never a default.

### 8.2 NEW `web-ai/chatgpt-menu-resolver.mjs` (complete)

```js
// @ts-check

export const MENU_CONTAINER_SELECTOR = '[role="menu"], .popover';
export const MENU_ITEM_SELECTOR = [
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '.popover .__menu-item',
    '.popover [tabindex="0"][data-fill]',
].join(', ');
export const MENU_OPEN_TEXT_PATTERN = /사진 및 파일 추가|최근 파일|이미지 만들기|심층 리서치|웹 검색|더 보기|Add photos|Create image|Deep research|Web search|More/i;

/**
 * @typedef {'aria-controls'|'menu-text'} MenuOwnership
 * @typedef {{ index: number, checked: string|null, ownership: MenuOwnership }} ResolvedMenuItem
 * @typedef {{ index: -1, reason: 'no-open-menu'|'no-owned-menu'|'label-not-found'|'ambiguous' }} UnresolvedMenuItem
 */

/**
 * Browser-context resolver. Pure function of `document`; no mutations.
 * Returns the index of the matching row within document order of
 * `itemSelector` matches, or a structured reason.
 *
 * Ownership is POSITIVE EVIDENCE ONLY (round-4 blocker 2): a container qualifies
 * only when the composer's plus button owns it via aria-controls, or when it
 * carries composer-menu text. An unowned popover is never a candidate, even when
 * it is the only one holding the requested label.
 *
 * @param {{ containerSelector: string, itemSelector: string, plusSelectors: string[], labels: string[], menuTextPattern: { source: string, flags: string }, isVisible?: (node: any) => boolean }} options
 * @returns {ResolvedMenuItem|UnresolvedMenuItem}
 */
export function resolveComposerMenuItem({
    containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, isVisible,
}) {
    // Injectable visibility (round-4 blocker 4): the default uses layout, which
    // jsdom cannot provide, so tests pass their own predicate instead of stubbing
    // getBoundingClientRect on every node.
    const visible = typeof isVisible === 'function'
        ? isVisible
        : (node) => {
            const rect = node?.getBoundingClientRect?.();
            return Boolean(rect) && rect.width > 0 && rect.height > 0;
        };
    const norm = (v) => String(v || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const wanted = labels.map(norm).filter(Boolean);
    const re = new RegExp(menuTextPattern.source, menuTextPattern.flags);

    const ownedByPlus = new Set();
    for (const selector of plusSelectors) {
        for (const button of Array.from(document.querySelectorAll(selector))) {
            if (!visible(button)) continue;
            const id = button.getAttribute('aria-controls');
            const target = id && document.getElementById(id);
            if (target && visible(target)) ownedByPlus.add(target);
        }
    }

    const visibleContainers = Array.from(document.querySelectorAll(containerSelector)).filter(visible);
    if (visibleContainers.length === 0) return { index: -1, reason: 'no-open-menu' };

    /** @type {{ container: Element, ownership: MenuOwnership }[]} */
    const owned = [];
    for (const container of visibleContainers) {
        if (ownedByPlus.has(container)) { owned.push({ container, ownership: 'aria-controls' }); continue; }
        if (re.test(container.innerText || container.textContent || '')) owned.push({ container, ownership: 'menu-text' });
    }
    if (owned.length === 0) return { index: -1, reason: 'no-owned-menu' };
    if (wanted.length === 0) {
        // Empty-label probe (round-4 blocker 5): "is a composer-owned menu open?"
        const strongest = owned.some((entry) => entry.ownership === 'aria-controls') ? 'aria-controls' : 'menu-text';
        return { index: -1, checked: null, ownership: strongest, reason: 'label-not-found' };
    }

    const allItems = Array.from(document.querySelectorAll(itemSelector));
    // Deduplicate by NODE (round-4 blocker 3): nested containers (.popover wrapping
    // a [role="menu"]) both match the container selector and would otherwise report
    // the same row twice as a spurious ambiguity. Strongest ownership wins per node.
    /** @type {Map<Element, MenuOwnership>} */
    const byNode = new Map();
    for (const { container, ownership } of owned) {
        for (const item of Array.from(container.querySelectorAll(itemSelector))) {
            if (!visible(item)) continue;
            const text = norm(item.innerText || item.textContent);
            if (!text || !wanted.some((label) => text.includes(label))) continue;
            const existing = byNode.get(item);
            if (!existing || (existing === 'menu-text' && ownership === 'aria-controls')) byNode.set(item, ownership);
        }
    }
    if (byNode.size === 0) return { index: -1, reason: 'label-not-found' };

    for (const tier of ['aria-controls', 'menu-text']) {
        const tiered = [...byNode.entries()].filter(([, ownership]) => ownership === tier);
        if (tiered.length === 1) {
            const [item] = tiered[0];
            const index = allItems.indexOf(item);
            if (index < 0) return { index: -1, reason: 'label-not-found' };
            return { index, checked: item.getAttribute('aria-checked'), ownership: /** @type {MenuOwnership} */ (tier) };
        }
        if (tiered.length > 1) return { index: -1, reason: 'ambiguous' };
    }
    return { index: -1, reason: 'ambiguous' };
}
```

The `unique-label` tier is **gone**. A connector-only popover that the plus button does not
own via `aria-controls` and that carries no composer-menu text now yields `no-owned-menu`,
the plus button is clicked, and the reopened menu is re-resolved. The issue-#81 DOM is still
fixed, because the reporter's popover is the composer's own menu — it is reached through
`aria-controls` when present, and otherwise through the menu-text rung once the composer
menu is open (the plus menu always contains at least `More`/`더 보기` or a tool phrase; a
popover with none of those and no ownership is, by definition, not ours).

### 8.3 MODIFY `web-ai/chatgpt-tools.mjs` (complete Node side)

```js
import {
    MENU_CONTAINER_SELECTOR, MENU_ITEM_SELECTOR, MENU_OPEN_TEXT_PATTERN, resolveComposerMenuItem,
} from './chatgpt-menu-resolver.mjs';

/**
 * Run the resolver in the page. Never throws.
 * @param {Page} page @param {string[]} labels
 * @returns {Promise<ResolvedMenuItem|UnresolvedMenuItem>}
 */
async function evaluateComposerMenu(page, labels) {
    return page.evaluate(resolveComposerMenuItem, {
        containerSelector: MENU_CONTAINER_SELECTOR,
        itemSelector: MENU_ITEM_SELECTOR,
        plusSelectors: PLUS_BUTTON_SELECTORS,
        labels,
        menuTextPattern: { source: MENU_OPEN_TEXT_PATTERN.source, flags: MENU_OPEN_TEXT_PATTERN.flags },
    }).catch(() => ({ index: -1, reason: 'no-open-menu' }));
}

/**
 * @param {Page} page @param {string[]} labels
 * @returns {Promise<{ locator: Locator, checked: string|null }|null>}
 */
async function resolveMenuItemLocator(page, labels) {
    const result = await evaluateComposerMenu(page, labels);
    if (!result || result.index < 0) return null;
    return { locator: page.locator(MENU_ITEM_SELECTOR).nth(result.index), checked: result.checked };
}

/** @param {Page} page @param {string[]} [labels] */
async function isComposerPlusMenuOpen(page, labels = []) {
    const result = await evaluateComposerMenu(page, labels);
    if (result.index >= 0) return true;
    if (result.reason === 'ambiguous') return true;          // owned menu exists; do not re-toggle
    if (result.reason === 'label-not-found') return Boolean(result.ownership);
    return false;                                             // no-open-menu | no-owned-menu
}
```

§7.2's ternary is replaced by these four guard clauses (round-4 observation), and the
`evaluate` rejection path is handled inside `evaluateComposerMenu` so no caller sees a throw
(round-4 blocker 5). `label-not-found` now carries `ownership`, which is exactly the
empty-label contract the resolver implements above.

Playwright's `locator(sel).nth(i)` ordering was independently confirmed by the reviewer to
match `document.querySelectorAll(sel)` document order for comma-joined selectors on
Playwright 1.58.2 + Chrome, including duplicate-matching nodes.

`selectMainComposerMenuItem` and `selectMoreComposerMenuItem` use `resolveMenuItemLocator`
exactly as §7.3 describes, with `openComposerPlusMenu(page, usedFallbacks, labels)` passing
the labels through to the open-check.

### 8.4 Scope (final, supersedes §4)

IN: NEW `web-ai/chatgpt-menu-resolver.mjs`; MODIFY `web-ai/chatgpt-tools.mjs`; NEW
`test/unit/web-ai-chatgpt-menu-resolver.test.mjs`; `structure/str_func.md` counts for both
modules.
OUT: composer attachment/upload surfaces, `PLUS_BUTTON_SELECTORS` contents, live-browser
verification, and any change to how a selected tool pill is cleared.

### 8.5 FINAL accept criteria

All cases drive `resolveComposerMenuItem` directly under jsdom with an **injected**
`isVisible` predicate (`(node) => !node.hasAttribute('data-test-hidden')`), which is what
makes the matrix runnable at all (round-4 blocker 4).

| # | Scenario | Expected |
|---|----------|----------|
| 1 | composer popover owned via `aria-controls`, connector row "GitHub", no `More` | `{ index, ownership: 'aria-controls' }` (issue #81) |
| 2 | composer popover with `More` text, connector row, no `aria-controls` | resolved in the `menu-text` tier |
| 3 | **only** an unrelated `#account-menu.popover` holding a "GitHub" row | `no-owned-menu` — nothing clicked (round-4 blocker 2) |
| 4 | nested `.popover > [role="menu"] > .__menu-item("GitHub")`, single logical menu | resolved once, NOT `ambiguous` (round-4 blocker 3) |
| 5 | owned composer menu AND an unrelated popover both holding "GitHub" | the owned one wins |
| 6 | two owned containers in the same tier both holding "GitHub" | `ambiguous`, nothing clicked |
| 7 | one `aria-controls` container and one `menu-text` container both holding the row | `aria-controls` wins |
| 8 | hidden container (`data-test-hidden`) preceding a visible owned one | hidden ignored; visible resolves |
| 9 | `[tabindex="0"]` without `data-fill` carrying the label text | not a candidate |
| 10 | empty `labels` with an owned menu open | `label-not-found` with `ownership` set (open-check contract) |
| 11 | empty `labels`, only unowned popovers | `no-owned-menu` |
| 12 | no visible containers at all | `no-open-menu` |
| 13 | row with `aria-checked="true"` | `checked: 'true'` returned; caller skips the click |
| 14 | label absent from an owned menu | `label-not-found` -> `composer plugin not selected: github` preserved |
| 15 | `page.evaluate` rejects | `evaluateComposerMenu` returns `no-open-menu`; no throw escapes |
| 16 | legacy `[role="menu"]` + `More` opening a **sibling** submenu root | re-resolution finds the row in the sibling (menu-text tier) |
| 17 | ordinary tool selection (`web-search`) on the legacy menu | unchanged behavior |

## 9. Ownership completion (audit round 5 — amends §8, does not replace it)

Round 5 executed §8.2 against the real reproductions and found the fix incomplete:

```json
{ "unrelated-only": {"reason":"no-owned-menu"},          // correct
  "owned+unrelated": {"index":0,"ownership":"aria-controls"},  // correct
  "hidden-preceding": {"index":1,"ownership":"aria-controls"}, // correct
  "issue81-connector-only-open": {"reason":"no-owned-menu"} }  // WRONG
```

The last line is the whole point of the phase: §8.2 assumed "the plus menu always contains
`More` or a tool phrase", but §1 documents the opposite — the reporter's popover is
connector-only, with no tool phrase and possibly no `More`. Positive ownership was right;
the ownership *evidence set* was one short.

### 9.1 Third ownership source: node identity across the plus click

The missing evidence is causal, not structural: **the menu that appeared because we clicked
the plus button is ours.** Identity is captured and compared entirely inside the page, so
none of the round-3 cross-snapshot fingerprint problems return.

```js
const OWNERSHIP_MARK = 'data-agbrowse-composer-menu';

/**
 * Browser-context. Records which menu containers were visible BEFORE the plus
 * click by tagging them, so the post-click resolver can identify the container
 * that newly appeared. Idempotent; the mark is removed by `clearMenuMarks`.
 * @param {{ containerSelector: string }} options
 * @returns {number} count of marked containers
 */
export function markExistingMenus({ containerSelector }) {
    const nodes = Array.from(document.querySelectorAll(containerSelector));
    for (const node of nodes) node.setAttribute(OWNERSHIP_MARK, 'pre-existing');
    return nodes.length;
}

/**
 * Browser-context. Removes the marks; always run in a finally block.
 * @param {{ containerSelector: string }} options
 * @returns {void}
 */
export function clearMenuMarks({ containerSelector }) {
    for (const node of Array.from(document.querySelectorAll(`[${OWNERSHIP_MARK}]`))) {
        node.removeAttribute(OWNERSHIP_MARK);
    }
    void containerSelector;
}
```

`resolveComposerMenuItem` gains a third ownership tier, ranked **between** the two existing
ones — stronger than menu-text (a text match can appear in an unrelated dialog) but weaker
than an explicit `aria-controls` relationship:

```diff
-/** @typedef {'aria-controls'|'menu-text'} MenuOwnership */
+/** @typedef {'aria-controls'|'appeared-on-open'|'menu-text'} MenuOwnership */
@@ container classification
     for (const container of visibleContainers) {
         if (ownedByPlus.has(container)) { owned.push({ container, ownership: 'aria-controls' }); continue; }
+        // Appeared after the plus click: no pre-existing mark while marks exist.
+        if (marksApplied && !container.hasAttribute(OWNERSHIP_MARK)) {
+            owned.push({ container, ownership: 'appeared-on-open' });
+            continue;
+        }
         if (re.test(container.innerText || container.textContent || '')) owned.push({ container, ownership: 'menu-text' });
     }
```

`marksApplied` is a new option (`boolean`, default `false`) that the caller sets only on the
post-click resolution, so a resolution performed without marking never mistakes an unmarked
container for a new one. Tier iteration becomes
`['aria-controls', 'appeared-on-open', 'menu-text']`, and the per-node dedup keeps the
strongest tier exactly as §8.2 specifies.

### 9.2 Node side (amends §8.3)

```diff
 async function openComposerPlusMenu(page, usedFallbacks, labels = []) {
     if (await isComposerPlusMenuOpen(page, labels)) return;
+    await page.evaluate(markExistingMenus, { containerSelector: MENU_CONTAINER_SELECTOR }).catch(() => 0);
+    marksActive = true;
     ...existing plus-button loop and chord fallback, unchanged...
 }
```

`evaluateComposerMenu(page, labels, { marksApplied })` forwards the flag; every selection
function wraps its work in `try { ... } finally { await page.evaluate(clearMenuMarks, ...) }`
so a stray attribute can never survive into a later call or leak into a user-visible DOM
snapshot. `closeComposerMenus` (`chatgpt-tools.mjs:228-235`) also clears marks defensively.

Now the issue-#81 flow resolves: the connector-only popover is not open, so
`isComposerPlusMenuOpen` returns false; we mark (zero containers), click the plus button,
the popover appears unmarked, and it resolves in the `appeared-on-open` tier. An unrelated
popover that was already open carries a mark and stays excluded — round-4 blocker 2 remains
closed.

### 9.3 Blocker 2 [Medium] accepted — checkJs types

Round 5 compiled both final blocks and found TS7006/TS2339/TS2304 errors that would fail
`npm run typecheck:checkjs-dom`, which both modules reach transitively
(`chatgpt.mjs:54`, `chatgpt-model.mjs:539`). Required in the implementation:

- every arrow parameter gets an explicit JSDoc type (`@param {Element} node`, `@param {unknown} v`);
- `innerText` reads narrow first: `const el = /** @type {HTMLElement} */ (node); el.innerText || el.textContent`;
- `040` §9.2 re-declares its `WorkConversationProbe` typedef locally instead of relying on a
  typedef defined in a superseded section.

`npm run typecheck:checkjs-dom` is added to WP3's and WP5's C-phase gates alongside
`test:unit`.

### 9.4 Added accept criteria (amends §8.5)

| # | Scenario | Expected |
|---|----------|----------|
| 18 | **issue #81 end-to-end**: no menu open; connector-only popover with no `aria-controls`, no tool phrase, no `More` appears after the plus click | resolved in the `appeared-on-open` tier; `selectedPlugins: ['github']`; no `composer-plus-shortcut` |
| 19 | unrelated popover already open (marked) + composer popover appears after the click | only the unmarked one resolves |
| 20 | resolution WITHOUT marks applied (`marksApplied: false`) | unmarked containers are NOT treated as owned; falls back to aria-controls/menu-text |
| 21 | marks are cleared after every selection, including on the throwing path | no `data-agbrowse-composer-menu` attribute remains in the document |
| 22 | nested `.popover > [role="menu"]` where the outer is `appeared-on-open` | resolves once, strongest tier retained (round-4 blocker 3 stays closed) |
| 23 | typecheck | `npm run typecheck:checkjs-dom` exits 0 with the new modules in the graph |

Case 4 in §8.5 is corrected: the nested fixture must carry ownership (either `aria-controls`
or the `appeared-on-open` mark state) for the dedup assertion to be meaningful — round 5
showed the unowned nested DOM correctly returns `no-owned-menu`.

## 10. FINAL ownership mechanism (audit round 6 — supersedes §9.1 and §9.2)

Round 6 confirmed the happy paths (`issue81 -> appeared-on-open`,
`marked-unrelated+new-composer -> the unmarked one`, `marksApplied:false -> no-owned-menu`,
and both earlier reproductions unchanged) and then found four defects in the *marking*
mechanism. Three of them share a root cause: **DOM attributes are the wrong place to keep
bookkeeping.** They are user-visible, they survive failures, and React can replace a marked
node. The mechanism is therefore replaced by a page-local registry.

### 10.1 Registry instead of attributes

```js
const REGISTRY_KEY = '__agbrowseComposerMenuEpoch';

/**
 * Browser-context. Snapshot the currently VISIBLE menu containers into a
 * page-local registry (a WeakSet on window), returning a token the caller
 * passes back after the plus click. Nothing is written to the DOM, so nothing
 * can leak into a snapshot, survive an error, or be lost to a React re-render
 * of an unrelated node.
 * @param {{ containerSelector: string, isVisibleSource?: string }} options
 * @returns {{ ok: true, token: number, count: number }}
 */
export function snapshotOpenMenus({ containerSelector, isVisibleSource }) {
    const visible = isVisibleSource
        ? /** @type {(node: Element) => boolean} */ ((0, eval)(`(${isVisibleSource})`))
        : (/** @type {Element} */ node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
    const store = window[REGISTRY_KEY] || (window[REGISTRY_KEY] = { token: 0, seen: new WeakSet() });
    store.token += 1;
    store.seen = new WeakSet();
    let count = 0;
    for (const node of Array.from(document.querySelectorAll(containerSelector))) {
        if (!visible(node)) continue;      // round-6 blocker 2: visible-only, matching the doc contract
        store.seen.add(node);
        count += 1;
    }
    return { ok: true, token: store.token, count };
}
```

`resolveComposerMenuItem` takes `{ token }` instead of `marksApplied` and consults the
registry:

```diff
-        if (marksApplied && !container.hasAttribute(OWNERSHIP_MARK)) {
+        const store = window[REGISTRY_KEY];
+        // The appeared-on-open tier is available ONLY when the snapshot for THIS
+        // token succeeded (round-6 blocker 1: a failed snapshot must not make every
+        // container look new). A stale or missing token disables the tier entirely.
+        const snapshotValid = Boolean(token) && Boolean(store) && store.token === token;
+        if (snapshotValid && !store.seen.has(container)) {
             owned.push({ container, ownership: 'appeared-on-open' });
             continue;
         }
```

Four properties, one per blocker:

- **Blocker 1 (mark failure re-enabled the wrong click):** the Node side passes a token only
  when `snapshotOpenMenus` actually returned `{ ok: true }`. On rejection the token stays
  `null`, `snapshotValid` is false, and the tier is off — fail closed, back to
  aria-controls/menu-text only.
- **Blocker 2 (hidden pre-rendered menus):** the snapshot now applies the same visibility
  predicate as the resolver, so a hidden pre-mounted popover is NOT recorded and, once the
  plus click reveals it, it is correctly unseen -> `appeared-on-open`. A React-replaced node
  is a different object and reads as new, which is the same conclusion the causal rule
  wants; a React-replaced *unrelated* container is still excluded because it was never
  visible-and-unseen at resolution time in the same tier as an owned one — and if it were,
  §8.2's ambiguity rule fires and nothing is clicked.
- **Blocker 3 (cleanup leak):** there is nothing to clean. The registry is a `WeakSet` on
  `window`, invisible to any DOM snapshot, garbage-collected with its nodes, and invalidated
  by the next token bump. `clearMenuMarks`, the `finally` wiring, and the
  `closeComposerMenus` defensive clear are all deleted.
- **Blocker 4 (tier ranking not implemented):** replaced by an explicit rank map below.

### 10.2 Explicit ownership ranking (supersedes the §8.2 promotion special case)

```diff
-            const existing = byNode.get(item);
-            if (!existing || (existing === 'menu-text' && ownership === 'aria-controls')) byNode.set(item, ownership);
+            const existing = byNode.get(item);
+            if (!existing || OWNERSHIP_RANK[ownership] > OWNERSHIP_RANK[existing]) byNode.set(item, ownership);
```

```js
/** @type {Record<MenuOwnership, number>} */
const OWNERSHIP_RANK = { 'aria-controls': 3, 'appeared-on-open': 2, 'menu-text': 1 };
```

Tier iteration uses the same order: `['aria-controls', 'appeared-on-open', 'menu-text']`.

### 10.3 Node side (supersedes §9.2)

```js
async function openComposerPlusMenu(page, usedFallbacks, labels = []) {
    if (await isComposerPlusMenuOpen(page, labels)) return;
    // Snapshot failure disables the causal tier rather than enabling it (fail closed).
    const snapshot = await page.evaluate(snapshotOpenMenus, {
        containerSelector: MENU_CONTAINER_SELECTOR,
    }).catch(() => null);
    menuSnapshotToken = snapshot?.ok ? snapshot.token : null;
    // ...existing plus-button loop and chord fallback, unchanged...
}
```

`evaluateComposerMenu(page, labels)` forwards `{ token: menuSnapshotToken }`, and
`menuSnapshotToken` resets to `null` at the start of `selectChatGptComposerTools`
(`chatgpt-tools.mjs:100`) so a token can never carry across calls. No `try/finally`, no
cleanup evaluation, no error-replacement risk.

### 10.4 FINAL accept criteria (supersedes §8.5 and §9.4)

All cases drive the resolver under jsdom with an injected visibility predicate.

| # | Scenario | Expected |
|---|----------|----------|
| 1 | issue #81: no menu open, connector-only popover with no `aria-controls`/tool phrase/`More` appears after the plus click | `appeared-on-open`; `selectedPlugins: ['github']`; no `composer-plus-shortcut` |
| 2 | composer popover owned via `aria-controls` | `aria-controls` tier |
| 3 | composer popover with `More`/tool text only | `menu-text` tier |
| 4 | **only** an unrelated `#account-menu.popover` holding a "GitHub" row, no snapshot | `no-owned-menu` |
| 5 | unrelated popover visible during the snapshot, composer popover appears after | only the unseen one resolves |
| 6 | **snapshot evaluate rejects**, unrelated popover present | token null -> tier off -> `no-owned-menu`; nothing clicked (round-6 blocker 1) |
| 7 | **hidden pre-rendered** connector popover revealed by the plus click | not recorded while hidden -> `appeared-on-open` (round-6 blocker 2) |
| 8 | stale token (registry bumped since) | tier off; falls back to the other two tiers |
| 9 | nested `.popover > [role="menu"]`, outer `menu-text`, inner unseen | single result, ownership `appeared-on-open` (rank map, round-6 blocker 4) |
| 10 | nested unowned | `no-owned-menu` |
| 11 | two owned containers in the same tier both holding "GitHub" | `ambiguous`; nothing clicked |
| 12 | `aria-controls` container + `appeared-on-open` container both holding the row | `aria-controls` wins |
| 13 | hidden container preceding a visible owned one | hidden ignored |
| 14 | `[tabindex="0"]` without `data-fill` carrying the label | not a candidate |
| 15 | empty `labels`, owned menu open | `label-not-found` with `ownership` |
| 16 | empty `labels`, only unowned popovers | `no-owned-menu` |
| 17 | no visible containers | `no-open-menu` |
| 18 | row with `aria-checked="true"` | `checked: 'true'`; caller skips the click |
| 19 | label absent from an owned menu | `label-not-found` -> warning preserved |
| 20 | `page.evaluate` rejects during resolution | `no-open-menu`; no throw escapes |
| 21 | `More` opening a sibling submenu root | re-resolution finds the row |
| 22 | ordinary tool selection (`web-search`) | unchanged |
| 23 | **no DOM residue**: after any selection, including a throwing one | document contains no agbrowse bookkeeping attribute (round-6 blocker 3 — trivially true, but asserted) |
| 24 | typecheck | `npm run typecheck:checkjs-dom` exits 0 |

## 11. Serialization + liveness corrections (audit round 7 — amends §10)

Round 7 ran §10 through **real Playwright** rather than direct calls and found the defect
that direct jsdom testing structurally cannot see:

```json
{ "playwrightSnapshot": { "threw": "page.evaluate: ReferenceError: REGISTRY_KEY is not defined" },
  "playwrightResolver": { "threw": "page.evaluate: ReferenceError: REGISTRY_KEY is not defined" } }
```

`page.evaluate(fn, arg)` serializes the function body only — module-scope bindings do not
travel. Every reference to `REGISTRY_KEY` and `OWNERSHIP_RANK` would have thrown in
production, the snapshot would always have "failed", the causal tier would always have been
off, and issue #81 would have stayed broken while every jsdom test passed green. This is the
single most important finding of the whole audit: **a browser-context function must be
closed over nothing.**

### 11.1 Blocker 1 — self-contained serialized functions

Both browser-context functions declare their own constants inside the body:

```diff
-const REGISTRY_KEY = '__agbrowseComposerMenuEpoch';
-
 export function snapshotOpenMenus({ containerSelector, isVisibleSource }) {
+    const REGISTRY_KEY = '__agbrowseComposerMenuEpoch';   // must be body-local: page.evaluate
+                                                          // serializes the body, not the module
     ...
 }

 export function resolveComposerMenuItem({ containerSelector, itemSelector, plusSelectors, labels, menuTextPattern, isVisible, token }) {
+    const REGISTRY_KEY = '__agbrowseComposerMenuEpoch';
+    /** @type {Record<string, number>} */
+    const OWNERSHIP_RANK = { 'aria-controls': 3, 'appeared-on-open': 2, 'menu-text': 1 };
     ...
 }
```

The duplicated literal is the price of serialization safety; a shared module constant is not
available to either side. A unit test asserts the two literals match so they cannot drift:

```js
// both function sources must declare the same registry key
const key = /REGISTRY_KEY = '([^']+)'/;
expect(snapshotOpenMenus.toString().match(key)[1])
    .toBe(resolveComposerMenuItem.toString().match(key)[1]);
```

**Mandatory transport tests.** Every browser-context function in this phase gets a real
`page.evaluate(fn, arg)` round trip in the integration layer, not only a direct jsdom call.
The same requirement applies to `040`'s `readWorkConversationState` (which round 5 already
proved under real Playwright) and to any future serialized helper: *direct-call green is not
transport green*.

### 11.2 Blocker 2 — liveness check for replaced containers

A `WeakSet` answers "was this exact node seen?", so a React-replaced unrelated container is a
new object and reads as `appeared-on-open`. Round 7's reproduction: snapshot a visible
unrelated `#account` popover, `cloneNode(true)` replace it, open no composer menu, resolve →
`{ index: 0, ownership: 'appeared-on-open' }` — a wrong-row click.

The registry therefore keeps **iterable strong references for the current token only**, and
the causal tier is disabled when any snapshotted node is no longer connected:

```diff
-    const store = window[REGISTRY_KEY] || (window[REGISTRY_KEY] = { token: 0, seen: new WeakSet() });
+    const store = window[REGISTRY_KEY] || (window[REGISTRY_KEY] = { token: 0, seen: [] });
     store.token += 1;
-    store.seen = new WeakSet();
+    store.seen = [];
     for (const node of Array.from(document.querySelectorAll(containerSelector))) {
         if (!visible(node)) continue;
-        store.seen.add(node);
+        store.seen.push(node);
     }
```

```diff
 const snapshotValid = Boolean(token) && Boolean(store) && store.token === token;
+// A snapshotted container that vanished was either closed (fine) or REPLACED by a
+// re-render (not fine — its replacement would read as "new"). We cannot tell the two
+// apart, so any disconnection disables the causal tier and we fall back to the
+// structural tiers. Fail closed beats a wrong click.
+const snapshotIntact = snapshotValid
+    && store.seen.every((node) => node.isConnected);
-        if (snapshotValid && !store.seen.has(container)) {
+        if (snapshotIntact && !store.seen.includes(container)) {
```

The strong references live only until the next `snapshotOpenMenus` call (which reassigns
`store.seen = []`) or the page navigates, and the array holds at most the handful of menu
containers visible at one instant — no retention concern. Closing the composer menu we just
opened does not disable anything, because the tier is only consulted during the resolution
that immediately follows the click.

### 11.3 Blocker 3 — `Window` indexing under strict checkJs

Round 7's compile returned two `TS7015` at the `window[REGISTRY_KEY]` line. Fix:

```js
/** @typedef {{ token: number, seen: Element[] }} MenuEpoch */
const scope = /** @type {Window & { __agbrowseComposerMenuEpoch?: MenuEpoch }} */ (window);
const store = scope.__agbrowseComposerMenuEpoch
    || (scope.__agbrowseComposerMenuEpoch = { token: 0, seen: [] });
```

Property access replaces index access, so the key literal appears once per function as a
property name — and the drift test in §11.1 adapts to match on
`__agbrowseComposerMenuEpoch`. The `(0, eval)` visibility path produced no diagnostic and
is unchanged.

### 11.4 Added accept criteria (amends §10.4)

| # | Scenario | Expected |
|---|----------|----------|
| 25 | **transport**: `page.evaluate(snapshotOpenMenus, arg)` under real Playwright | returns `{ ok: true, token, count }`; no `ReferenceError` |
| 26 | **transport**: `page.evaluate(resolveComposerMenuItem, arg)` under real Playwright | resolves the issue-#81 DOM as `appeared-on-open` |
| 27 | registry key drift | both function sources declare the same property name |
| 28 | unrelated visible container replaced (`cloneNode`) between snapshot and resolution, composer absent | tier disabled -> `no-owned-menu`; nothing clicked (round-7 blocker 2) |
| 29 | snapshotted container legitimately closed, composer popover appeared | tier disabled -> falls back to structural tiers; issue-#81 case still resolves via `menu-text` when the menu carries `More`, else `no-owned-menu` (documented conservative outcome) |
| 30 | typecheck | `npm run typecheck:checkjs-dom` exits 0 with zero `TS7015` |

Case 29 records an accepted cost: when an unrelated menu closes in the same instant we open
the composer menu, we lose the causal tier for that attempt and may emit the existing
"not selected" warning. That is a rare, retryable, non-destructive outcome — and it is the
correct trade against clicking a row we do not own.

## 12. Type narrowing (audit round 8, GO-WITH-FIXES — final)

Round 8 verified everything else by execution: real Playwright transport works
(`{"ok":true,"token":1,"count":0}` then
`{"index":0,"ownership":"appeared-on-open"}` — no `ReferenceError`), the `cloneNode`
replacement now returns `no-owned-menu`, all seven direct-call scenarios are unchanged,
jsdom 26.1.0 supports `Element.isConnected`, and a real navigation destroys the registry.

One residual: TypeScript does not preserve the `Boolean(store)` narrowing through the
`snapshotValid` alias, so `store.seen` reads produce `TS18048: 'store' is possibly
'undefined'` (x3). Final form:

```diff
-const snapshotValid = Boolean(token) && Boolean(store) && store.token === token;
-const snapshotIntact = snapshotValid && store.seen.every((node) => node.isConnected);
-        if (snapshotIntact && !store.seen.includes(container)) {
+const snapshotIntact = Boolean(token)
+    && Boolean(store)
+    && store.token === token
+    && store.seen.every((node) => node.isConnected);
+        if (store && snapshotIntact && !store.seen.includes(container)) {
```

The narrowing stays inside one expression, and the final use re-guards `store` explicitly.

**Registry lifetime, stated precisely** (round-8 correction to §11.2's wording): strong
references are released at the **next snapshot or navigation**, not at the end of one
selection. Measured: a detached node stays referenced (`{length:1, isConnected:false}`) until
the next `snapshotOpenMenus` resets `seen` (`{length:0}`), and
`registryAfterNavigation: false`. Bounded to the handful of menu containers visible at one
instant; non-blocking.

With this fix the WP3 specification is **complete and audit-clean**: round 8 returned
GO-WITH-FIXES with this as the only blocker, and it is now folded.

## 13. Implementation-audit corrections (WP3 build, rounds 1-5)

Five implementation-audit rounds followed the eight plan rounds. Every blocker was a real
defect in code I had written, verified by the reviewer in real Chromium through the public
`selectChatGptComposerTools` entry point.

| Round | Blocker | Fix |
|-------|---------|-----|
| 1 | module-level `menuSnapshotToken` could cross tabs (agbrowse drives several provider pages per process) | pre-emptively fixed before the verdict; then removed entirely — see round 2 |
| 2 | a token survived past its selection: clicking a tool closed the menu, an unrelated popover appeared, and the stale epoch handed it `appeared-on-open` → wrong row clicked | the epoch is no longer ambient at all: `openComposerPlusMenu` RETURNS the token and every resolution takes it as an explicit argument |
| 2 | `Boolean(store)` did not narrow the optional registry (TS18048) | `store != null && ...` in one expression |
| 2 | serialization safety had no committed test | NEW `test/integration/composer-menu-transport.test.mjs` runs both functions through real `page.evaluate` |
| 3 | the keyboard-shortcut fallback still minted a token although it never confirms OUR menu opened | the shortcut path returns `null`; structural tiers only |
| 3 | the open-check asked for the requested connector label, so a menu holding `More` but not `GitHub` read as "not open" and the plus button was clicked again — the More path was fully broken | `isComposerPlusMenuOpen` is ownership-only by construction and takes no labels |
| 4 | an already-open menu had no epoch, so a portaled More submenu was unreachable | the More expansion mints its own epoch |
| 4 | the shortcut regression test inserted its popover BEFORE the snapshot, so it could not detect the defect | the popover is now inserted from the mocked keyboard shortcut, after the snapshot; mutation-verified red |
| 5 | hover minted causal ownership, so any popover appearing inside the hover window was clicked | hover resolves with a null token; causal ownership comes only from a confirmed click on the owned `More` row |

### 13.1 Accepted capability trade (round 5, stated plainly)

Refusing hover-based causal ownership means a hover-only connector submenu that carries
**neither** composer-menu text **nor** plus-button `aria-controls` ownership is unreachable.
The reviewer verified the boundary in Chromium:

```json
{"hover-portaled-with-menu-text": {"selectedPlugins":["github"]},
 "hover-portaled-aria-controls-on-More-only": {"selectedPlugins":[],"githubClicks":0}}
```

An `aria-controls` relationship on the `More` row itself does not qualify, because the
resolver reads `aria-controls` only from the composer plus button
(`chatgpt-menu-resolver.mjs:98`).

Is that shape real? **Unproven either way.** The repo's live probe
(`devlog/_fin/260615_chatgpt_composer_tools_live_probe.md:47`) records the top-level `More`
row but never captured the resulting submenu's structural attributes. In practice the
observed submenu opens on click (the path that keeps full causal ownership), and hover-only
expansion still works whenever the submenu carries composer-menu text. The trade is taken
deliberately: a wrong-row click selects a connector the user did not ask for and silently
changes what ChatGPT can access, while the failure mode here is the pre-existing
`composer plugin not selected: <name>` warning. If a live probe later shows a hover-only,
text-free, unowned submenu, the fix is to widen `aria-controls` reading to the triggering
row — recorded as follow-up **G81b**.

### 13.2 checkJs gate — corrected criterion

§9.3 and §10.4 case 24 asserted `npm run typecheck:checkjs-dom` exits 0. That was wrong
about the repo: the gate is red at baseline with 186 diagnostics, none of them in files this
phase touches (measured 238 total lines of output with this phase's changes present, and the
reviewer's scoped count for WP3 modules is 0).

Corrected criterion: **zero diagnostics naming `web-ai/chatgpt-menu-resolver.mjs`,
`web-ai/chatgpt-tools.mjs`, or this phase's tests**, with the repository-wide baseline
unchanged. Repairing the global baseline is out of scope for an issue-#81 fix.
