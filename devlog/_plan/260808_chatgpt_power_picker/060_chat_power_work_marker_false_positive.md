# WP6 — Chat Power work-marker false positive

## Observation

After the owned profile was authenticated, the composer still showed the Chat surface radio as checked and the open picker shell was the current Power menu with `Power`, `Model`, and `Effort`. Live selection still failed closed with:

`Chat commands are not supported on the Work surface (detected: work)`

and evidence `workMarkerVisible: true`.

The open menu contained both:

- `[data-testid="composer-model-picker-slider-simple-view"]`
- `[data-testid="composer-model-picker-slider-advanced-view"]`

Those markers are no longer Work-only. On the current Chat Power shell they appear together with the Power menuitem and Model/Effort submenu triggers while the Chat radio remains active.

## Diff-level plan

1. Keep the Chat surface radio / conversation probe as the primary surface gate.
2. Change `assertOpenMenuIsNotWorkPicker` so visible `composer-model-picker-slider-*` markers alone do not mean Work when the open menu is the Chat Power shell or the Chat radio is active.
3. Add a regression that opens a Chat Power menu containing those markers and still allows model selection.
4. Re-run the authenticated owned-profile selection smoke through the symlink CLI/runtime and capture before, selected, and restored browser-visible states.
5. Split commits for the production fix, tests, docs, and generated counts; push `dev` only after gates pass.

## Done rule

c5 closes only after the authenticated owned runtime performs a non-content picker selection with correlated endpoint identity and browser-visible before/selected/restored proof. Status-only or send-only evidence does not count.
