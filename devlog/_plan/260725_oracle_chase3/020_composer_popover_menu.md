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
