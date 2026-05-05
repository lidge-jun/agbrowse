# P17 — browser-primitives.mjs (DOM)

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/browser-primitives.mjs` (167 lines). Imports post-action-assert (annotated in P16). DOM-aware via `document.querySelectorAll` and `globalThis.getComputedStyle` inside `page.evaluate`.

## Files
- `web-ai/browser-primitives.mjs`:
  - `// @ts-check` + `/// <reference types="playwright-core" />`.
  - 7 typedefs: `BrowserCapabilityErrorInput`, `VisibleCandidate`, `FindVisibleOptions`, `TextBaseline`, `StableTextOptions`, `StableTextResult`. Plus reuse of `ResolvedTarget` and `TraceContext` via `import('./post-action-assert.mjs')`.
  - `BrowserCapabilityError` class — JSDoc on constructor + class-field type annotations for `capabilityId`/`stage`.
  - `ActionTranscript` class — `string[]` annotations on `warnings` and `usedFallbacks` class fields.
  - `string[]`/`string|undefined`/`number|null` widening on local vars.
  - Inside `locator.evaluate(node => ...)` and `page.evaluate(innerSelectors => ...)` closures: `Element`/`HTMLElement` casts on `node`/`el` so `getBoundingClientRect`/`innerText` typecheck. NO runtime change.
- `tsconfig.checkjs-dom.json` — add entry (4 → 5).

## Rationale
- Post-action-assert was the only internal dep; now annotated. Pulls in `ResolvedTarget`/`TraceContext` typedefs.
- DOM-aware closures inside `page.evaluate` need DOM lib for `document`/`globalThis.getComputedStyle`.

## Gates
- `npm run typecheck` — 0 errors
- `npm run typecheck:checkjs` — 0 errors
- `npm run typecheck:checkjs-dom` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped
