# 000 — ChatGPT Chat Power tier repair: Plan

## Objective

`agbrowse web-ai` requests a ChatGPT Chat tier (`--model pro`, `--model thinking --effort high`)
and the live picker frequently does NOT end on the requested stop, while the returned
evidence still says `verified: true`. The user-visible symptom: asking for Pro and
getting an Extra High / thinking-tier run.

Live evidence base (2026-08-18, real chatgpt.com, GPT-5.6 Sol, Pro account):

| request | start pill | end pill | reported | truth |
|---------|-----------|----------|----------|-------|
| `thinking/high` | Medium | **Medium** | `selected=thinking, effort=null, verified=true` | NOT applied |
| `thinking/xhigh` | Medium | **Medium** | `selected=thinking, effort=null, verified=true` | NOT applied |
| `instant` | Medium | Medium | throws `model option not found: instant` | hard fail |
| `pro/high`,`pro/xhigh`,`pro/heavy` | Medium | Medium | throws `not supported for Pro` | hard fail |
| `pro` (from 0..4) | any | Pro | verified=true | OK |
| `thinking/medium` | Pro | Medium | verified=true | OK |

## Root cause

The current Chat picker is a Power shell:

- root: `[role="menu"][data-state="open"]` containing `[role="menuitem"][aria-label="Power"]`
- a single `[role="slider"]` with `aria-valuemin=0 aria-valuemax=4`, `aria-valuenow` 0..4
- shell text carries the tier: `"Pro, 5 of 5."`, `"Medium, 2 of 5."`, `"Extra High, 4 of 5."`
- two `[role="menuitem"][data-has-submenu]` rows: `Model\nGPT-5.6 Sol` and `Effort\nPro`
- `Advanced` toggle (`aria-label="Show advanced options"` ⇄ `"Show compact options"`)

Two independent defects:

1. **The Effort submenu trigger cannot be clicked.** `openPowerPickerSubmenu()` calls
   `trigger.click()`. Live, that element is pointer-intercepted
   (`<div class="col-start-1 row-start-1"> … intercepts pointer events`), so Playwright's
   click times out — and the swallowed `.catch(() => undefined)` still returns `true`.
   `openEffortMenu` then throws `Power effort submenu did not expose <model>/<effort>`,
   which `selectChatGptModel` treats as `isSelectionUnavailable` and downgrades to a
   warning. The effort silently does not change, and the function still reports
   `verified: true` because model-axis verification only checks `thinking`, which a
   Medium pill already satisfies.

2. **Verification cannot see effort at all.** `verified` is computed as
   `after === targetModel` — a pure model-axis check. Medium, High, and Extra High all
   map to `thinking`, so requesting `xhigh` and landing on Medium is "verified". This is
   the direct cause of the "I asked for X and silently got Y" class.

Secondary: `findModelOption()` returns `null` for the Power shell after
`openPowerPickerSubmenu('Effort')` fails, and the `instant` path then throws instead of
falling through to the working slider path.

## Loop-spec

- Loop archetype: verifier-defined (the live picker defines done).
- Write scope: `web-ai/chatgpt-model.mjs`, its unit tests + DOM fixtures, docs/SOT, release.
- Out of scope: Gemini/Grok, Runway, Work picker semantics, browser lifecycle.
- Bounds: local Chrome + one logged-in ChatGPT Pro account; no destructive repo ops.

## Work-phase map (one phase = one full PABCD cycle)

| WP | Doc | Slice | Depends on |
|----|-----|-------|------------|
| wp1-slider | 010 | Effort submenu open must be hover/keyboard-based and honest about failure; slider becomes the primary tier driver | — |
| wp2-failclosed | 020 | `verified` must cover the EFFORT axis, not just the model axis | wp1 |
| wp3-tests | 030 | Unit tests + provider-DOM fixtures for the live Power contract | wp1, wp2 |
| wp4-docs | 040 | SKILL/docs/SOT sync | wp3 |
| wp5-release | 050 | version bump, commit, push, npm publish | wp4 |

## Accept criteria

Mirrors goalplan `criteria[]` c1..c8.

