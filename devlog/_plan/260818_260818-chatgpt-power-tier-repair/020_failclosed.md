# 020 — WP2: verification must cover the effort axis (fail-closed)

> AMENDED twice. Round 1 fixed the "no named source element" gap. Round 2 fixed a
> SEQUENCING defect the reviewer caught: the effort observation must be captured while
> the Power shell is still OPEN, i.e. next to `afterEvidence` (line ~557), NOT in the
> `verified` block (line ~586) which runs AFTER `closeModelMenu` (line 564).

## Problem

```js
const verified = after === targetModel && (!requestedFamily || finalFamilyEvidence?.verified === true);
```

`after` is `instant|thinking|pro`, and `readChatGptPowerSliderState` maps slider stops
with `byIndex = ['instant','thinking','thinking','thinking','pro']`, so
Medium/High/Extra High all collapse to `thinking`. A request for `xhigh` that lands on
Medium reports `verified:true`. That misreport is the user-visible bug.

## The tier string's carrier (live-probed 2026-08-18)

```
[data-testid="composer-model-picker-slider-simple-view"]
  exists: true  visible: true  contains [role="slider"]: true
  innerText: "Pro, 5 of 5.\nUse Left and Right arrow keys to adjust power."
[data-testid="composer-model-picker-slider-advanced-view"]
  innerText: "Model\nGPT-5.6 Sol\nEffort\nPro"
```

This element lives INSIDE the open Power shell — the same root `closeModelMenu`
dismisses. That is precisely why the read must not be deferred (see §2).

## MODIFY `web-ai/chatgpt-model.mjs`

### 1. NEW pure helper `effortChoiceFromPowerTierLabel(label, index)`

Browser-free, unit-testable. Label first: strip `/,\s*\d+\s+of\s+\d+\.?$/i` from the
first line, then map `Medium|High|Extra High` (+ ko/zh) → `medium|high|xhigh`.
`index` is the 0-based `aria-valuenow` cross-check.

Full index table (round-2 gap: 0 and 4 were previously undefined):

| index | tier label | effort |
|---|---|---|
| 0 | Instant | `null` (not a thinking stop) |
| 1 | Medium | `medium` |
| 2 | High | `high` |
| 3 | Extra High | `xhigh` |
| 4 | Pro | `null` (not a thinking stop) |

Rules: if label and index disagree ⇒ return `null` (fail closed). If only one is
available, use it. A bare `--model thinking` with NO requested effort never consults
this helper (see §2's `!requestedEffort` short-circuit), so index 2's `high` cannot
spuriously trip verification.

### 2. Capture the effort observation WHILE THE SHELL IS OPEN (round-2 fix)

BEFORE (what the code does today, line ~557 onward):

```js
const afterEvidence = await readCheckedModelEvidence(page, targetModel);
const after = afterEvidence?.choice || null;
…
await closeModelMenu(page);                       // line 564 — shell unmounts here
…
const verified = after === targetModel && (!requestedFamily || finalFamilyEvidence?.verified === true);
```

AFTER:

```js
const afterEvidence = await readCheckedModelEvidence(page, targetModel);
const after = afterEvidence?.choice || null;
// Effort observation MUST be captured here: the tier string lives in the Power
// shell that closeModelMenu() unmounts a few lines below. Carry a plain value
// forward; never re-read the page after the close.
let observedEffort = null;
if (requestedEffort && targetModel === 'thinking') {
    const stop = await readChatGptPowerSliderState(page);
    observedEffort = effortChoiceFromPowerTierLabel(stop.label, stop.index);
}
…
await closeModelMenu(page);
…
const effortVerified = !requestedEffort
    || targetModel !== 'thinking'
    || observedEffort === requestedEffort;
const verified = after === targetModel
    && effortVerified
    && (!requestedFamily || finalFamilyEvidence?.verified === true);
```

Invariant to enforce in review: `observedEffort` is a VALUE computed before
`closeModelMenu`; no `page` read for effort may appear after line 564.

### 3. Effort fields on the returned envelope (round-2 gap)

The return block currently derives two fields from `selectedEffort`:

```js
alreadySelected: !modelChanged && !selectedEffort?.changed,
effort: selectedEffort?.selected || null,
```

Both must respect `effortVerified`. Explicit:

```js
const effortReportable = effortVerified ? selectedEffort : null;
…
alreadySelected: !modelChanged && !effortReportable?.changed && effortVerified,
effort: effortReportable?.selected || null,
status: verified
    ? (modelChanged ? 'switched' : 'already-selected')
    : 'switched-best-effort',
```

and when `requestedEffort && !effortVerified`, push `effort-selection-unverified` plus
`effort <requested> was not applied; observed <observedEffort ?? 'unknown'>`.

### 4. Classify ALL of `isSelectionUnavailable`'s producers

| throw site | meaning | class |
|---|---|---|
| `openModelMenu` "selector not found" | control absent | unavailable → warn |
| `openEffortMenu` "submenu did not expose" | failed to DRIVE the control | unavailable → warn, effort stays unverified ⇒ `verified:false` |
| `selectChatGptEffort` "not available for \${model}" | unsupported combo | HARD error |
| `selectChatGptEffort` "option not found" | control open, option missing | HARD error |
| `selectChatGptEffort` "verification failed" | applied but wrong | HARD error |

Implementation: tag unavailability throws with `evidence.unavailable = true` and make
`isSelectionUnavailable` REQUIRE that tag instead of matching every
`provider.model-mismatch`/`provider-select-mode` pair.

### 5. Dead constant

`CHATGPT_POWER_TIER_INDEX` has zero references; `powerTierIndexForChoice` hardcodes the
same numbers. Make `powerTierIndexForChoice` READ the constant.

## TESTS

- **Sequencing regression (round-2 blocker):** `thinking/high` that IS applied ⇒
  `verified === true` and `effort === 'high'`. A page double whose shell returns empty
  text after `closeModelMenu` must still verify, proving the read happens pre-close.
- `thinking/xhigh` landing on Medium ⇒ `verified === false`, `effort === null`,
  `status === 'switched-best-effort'`, warning present.
- `pro` landing on Pro ⇒ `verified === true`, no effort warning.
- bare `--model thinking` (no effort) ⇒ `verified === true` (helper not consulted).
- `effortChoiceFromPowerTierLabel` table test incl. index 0/4 ⇒ `null`, and
  label/index disagreement ⇒ `null`.

## Verification (C)

- `npx vitest run test/unit/web-ai-chatgpt-model.test.mjs` → exit 0
- live: `thinking/medium|high|xhigh` each land on the matching stop with
  `verified:true`; a forced mismatch yields `verified:false`.

