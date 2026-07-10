# C-gate R2 Canon 10 - 03 Repair Evidence

- Verified at: 2026-07-10 13:50:37 KST
- Target: `devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md`
- Scope: C-gate R2 additional canon 10 (`chatGptLegacyMenuRootOpenedByComposer`)

## Commands And Results

### Scoped contract assertions and stale-path scan

Checked the repaired section for:

- `surface.ui !== 'legacy' || surface.surface !== null`
- composer form-scoped trigger lookup
- trigger `aria-controls` lookup
- `isModelMenuOpen()` consuming the scoped legacy root
- absence of `unknown`, page-wide trigger lookup, page-wide open-menu enumeration, and stale boolean helper consumers

Result: **PASS**.

### Verbatim Before preservation

Command shape:

```bash
diff -u \
  <(sed -n '928,945p' web-ai/chatgpt-model.mjs) \
  <(awk '/`web-ai\/chatgpt-model\.mjs:928-945`:/ { found=1; next } found && /^```js$/ { code=1; next } code && /^```$/ { exit } code { print }' \
    devlog/_plan/260710_gpt56_update/03_chat_picker_selector_patch.md)
```

Result: **PASS**, no diff.

### Markdown and whitespace

- Markdown fence count: `52`, balanced.
- `git diff --no-index --check /dev/null <target>`: **PASS**, no whitespace errors.

## Required References

```text
878:+    if (surface.ui !== 'legacy' || surface.surface !== null) return null;
881:+    const composer = page.locator('form').filter({
888:+    const menuId = await trigger.getAttribute('aria-controls').catch(() => null);
1223:15. **menu-open scope**: closed/global/Work stray «GPT-5.5», `Medium`, `High`만으로
1281:- [ ] `work|ambiguous`는 fail-closed이고 `surface=null`(toggle 부재)만 legacy 경로로 진행함.
```

## Judgement

**PASS.** The specification now permits the legacy path only for detector `surface=null`
(toggle absent), fails closed for `work|ambiguous`, scopes the trigger to the composer form,
and scopes the legacy menu to the open root identified by that trigger's `aria-controls`.
The verified verbatim Before block remains unchanged.
