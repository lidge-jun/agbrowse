# 030 — WP3: tests + provider-DOM fixtures for the live Power contract

> CORRECTED after audit round 1: the earlier claim that the simple view is EMPTY was
> wrong. Live re-probe shows it carries `"Pro, 5 of 5.\nUse Left and Right arrow keys…"`
> and contains the `[role="slider"]`.

## NEW fixture `test/fixtures/provider-dom/chatgpt-power-shell-260818.html`

Captured live 2026-08-18:

- `[role="menu"][data-state="open"]` shell containing `[role="menuitem"][aria-label="Power"]`
- `[data-testid="composer-model-picker-slider-simple-view"]` with text
  `"<Tier>, N of 5.\nUse Left and Right arrow keys to adjust power."` and the
  `[role="slider"][aria-valuenow][aria-valuemin="0"][aria-valuemax="4"]` inside it
- `[data-testid="composer-model-picker-slider-advanced-view"]` with
  `"Model\nGPT-5.6 Sol\nEffort\n<Tier>"`
- two `[role="menuitem"][data-has-submenu]` rows: `Model\nGPT-5.6 Sol`, `Effort\n<Tier>`
- `Advanced` toggle: `aria-label="Show advanced options"` ⇄ `"Show compact options"`
- an overlay `<div class="col-start-1 row-start-1">` reproducing pointer interception
- the detached Effort portal as a SECOND `[role="menu"][data-state="open"]` whose
  `[role="menuitemradio"]` rows are `Instant / Medium / High / Extra High / Pro`

## MODIFY `test/unit/web-ai-chatgpt-model.test.mjs`

`describe('live Power shell 260818')` covering WP1 + WP2 cases, including the audit
blocker: thinking-effort selection must work with the portal ABSENT.

## MODIFY `test/unit/web-ai-provider-dom-contract.test.mjs`

Fixture must satisfy `isChatGptPowerPickerOpen`; tier parser handles `", N of 5."` in
en/ko/zh.

## Verification (C)

- `npm test` → exit 0
- typecheck (`tsconfig.checkjs.json`) → exit 0

