# 010 — WP1: Power tier selection must actually drive the tier

> AMENDED after audit round 1 (verdict: fail). The blocker was real: the slider had
> exactly ONE call site, behind a model-equality gate that thinking-effort requests
> never pass. That gate is now the primary fix. Audit-refuted claims are corrected
> inline and marked CORRECTED.

## Problem A (BLOCKER, audit round 1) — the slider is unreachable for effort requests

`selectChatGptPowerTierBySlider` has ONE call site: inside

```js
if (requested && currentModel !== requested) {      // <-- line ~470
    …
    if (!option) { if (await isChatGptPowerPickerOpen(page) && await selectChatGptPowerTierBySlider(...)) …
```

For `--model thinking --effort high` starting at Medium:
`readCheckedModelEvidence` reads slider index 1 → `byIndex[1] === 'thinking'` → so
`currentModel === requested === 'thinking'` → the whole retry block is SKIPPED → the
slider is never touched. Control falls to the `requestedEffort` branch (~line 507),
which contains ZERO slider calls: it either accepts the CURRENT tier label as the
answer, or calls `selectChatGptEffort` → `openEffortMenu` → throws → downgraded to a
warning. The tier never moves.

Live confirmation: `req=thinking/high before=Medium after=Medium verified=true`.

### MODIFY `web-ai/chatgpt-model.mjs` — drive the slider from the EFFORT branch

In the `else` arm of the `requestedEffort` block, BEFORE calling `selectChatGptEffort`:

BEFORE:

```js
if (simplifiedSelected === requestedEffort || powerSliderEffort === requestedEffort) {
    selectedEffort = { … };
    usedFallbacks.push(…);
} else {
    try {
        selectedEffort = await selectChatGptEffort(page, targetModel, requestedEffort, usedFallbacks);
        await openModelMenu(page, usedFallbacks);
    } catch (err) { … warning … }
}
```

AFTER:

```js
if (simplifiedSelected === requestedEffort || powerSliderEffort === requestedEffort) {
    selectedEffort = { … };                      // unchanged: already on the stop
    usedFallbacks.push(…);
} else {
    // Power shell: the 5-stop slider IS the effort control for thinking.
    // Must run independently of the model-equality gate above, because
    // Medium/High/Extra High all normalize to 'thinking'.
    let sliderApplied = false;
    if (targetModel === 'thinking') {
        await openModelMenu(page, usedFallbacks);            // re-open if a prior step closed it
        if (await isChatGptPowerPickerOpen(page)
            && await selectChatGptPowerTierBySlider(page, 'thinking', {
                effort: requestedEffort, usedFallbacks,
            })) {
            const stop = await readChatGptPowerSliderState(page);
            const observed = effortChoiceFromPowerTierLabel(stop.label, stop.index);
            if (observed === requestedEffort) {
                selectedEffort = { requested: requestedEffort, selected: requestedEffort, changed: true };
                sliderApplied = true;
            }
        }
    }
    if (!sliderApplied) {
        try { selectedEffort = await selectChatGptEffort(...); await openModelMenu(...); }
        catch (err) { if (!isSelectionUnavailable(err)) throw err; … warning … }
    }
}
```

## Problem B — `openPowerPickerSubmenu` lies about success

BEFORE:

```js
async function openPowerPickerSubmenu(page, heading) {
    const trigger = await findPowerPickerSubmenuTrigger(page, heading);
    if (!trigger) return false;
    await trigger.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(300).catch(() => undefined);
    return true;                       // true even when the click timed out
}
```

Live, that row is pointer-intercepted (`<div class="col-start-1 row-start-1"> …
intercepts pointer events`), so the click times out and the caller believes a portal
opened.

AFTER: ladder — `hover` → `focus`+`ArrowRight` → `click({force:true})`, asserting after
each step that a portal actually opened, and returning `false` when none did.

### CORRECTED (audit): reuse the existing portal predicate

`isPowerEffortPortalMenu` (used by `readCheckedModelEvidence`) already exists. Do NOT
fork a new `isPowerSubmenuPortalOpen`; add a thin `isPowerSubmenuPortalOpen(page, heading)`
that DELEGATES to it for `'Effort'` and to `findOpenFamilySubmenu` for `'Model'`.

### Work-picker false positive guard (audit finding, NEW)

`assertOpenMenuIsNotWorkPicker` exempts the shared
`composer-model-picker-slider-*` testids only while `isChatGptPowerPickerOpen` is true.
A forced click that tears the shell down would leave those markers visible and raise a
spurious `workSurfaceUnsupportedError` on a Chat surface. Guard: after any forced click,
if the shell is gone, re-open it with `openModelMenu` BEFORE any code path can reach
`assertOpenMenuIsNotWorkPicker`; never leave the picker half-torn-down.

## Problem C — `instant` dead-ends

`findModelOption` returns `null` in the Power branch, and if a failed
`openPowerPickerSubmenu` closed the shell, `isChatGptPowerPickerOpen` is then false, so
the slider fallback is skipped and the code throws `model option not found: instant`.
Fix: re-open the shell via `openModelMenu` before the slider attempt in that branch.

## Capability probe (audit finding, NEW — in scope)

`chatGptModelCapabilityProbe` calls `openEffortMenu` and marks `selectable` only when an
`effortOption` is found. Once the slider is authoritative, the probe must ALSO accept a
reachable slider stop, otherwise `chatgpt-model-alias-selectable` reports `fail` for a
combination the selector can now apply. MODIFY the probe to treat
"Power shell open AND slider exposes the target stop" as selectable.

## TESTS

`test/unit/web-ai-chatgpt-model.test.mjs`:

- `thinking/high` from a Medium page double with ONLY a slider (no portal) ⇒ slider is
  driven and effort is applied. (This is the audit blocker; it must fail before the fix.)
- `openPowerPickerSubmenu` returns `false` when no portal opens.
- `instant` from Medium does not throw when the portal fails to open.
- forced click that closes the shell does not surface `workSurfaceUnsupportedError`.

## Verification (C)

- `npx vitest run test/unit/web-ai-chatgpt-model.test.mjs` → exit 0
- live matrix: every requested stop equals the end pill, or `verified:false`.


## Portal fallback ladder must include the Advanced toggle (round-2 gap)

The round-1 probe recorded that hovering the `Effort` row succeeds ONLY after the
`Advanced` toggle (`[role="menuitem"][aria-label="Show advanced options"]`) is clicked
with `force: true`; before that, both hover and click are pointer-intercepted. The
portal fallback ladder is therefore:

1. if `[aria-label="Show advanced options"]` is present, `click({force:true})` it
   (it flips to `aria-label="Show compact options"`),
2. `hover` the `Effort` row,
3. `focus` + `ArrowRight`,
4. `click({force:true})` as the last resort,

asserting `isPowerSubmenuPortalOpen` after each step and returning `false` if none
opened. This is a FALLBACK only: after WP1 the slider is the primary effort control.

