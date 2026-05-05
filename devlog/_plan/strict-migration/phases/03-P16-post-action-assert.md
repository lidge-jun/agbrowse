# P16 — post-action-assert.mjs (DOM, true leaf)

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/post-action-assert.mjs` (110 lines, true leaf — no internal imports) to `tsconfig.checkjs-dom.json` (uses `document.querySelector`/`document.activeElement` inside `page.evaluate`).

## Files
- `web-ai/post-action-assert.mjs` — `// @ts-check` + `/// <reference types="playwright-core" />`.
  - 8 typedefs: `ResolvedTarget`, `ScrubbedTarget`, `AssertOk`/`AssertFail`/`AssertResult` (discriminated union), `TraceRecord`, `TraceContext`, `AssertOptions`, `ClickOptions`.
  - JSDoc on every export. `Page`/`Locator` from `playwright-core`.
  - Caught-error `.name` access via inline cast: `/** @type {{name?: string}} */ (err)?.name`.
  - `page.locator(target.selector)` cast: `/** @type {string} */ (target.selector)` because `ResolvedTarget.selector` is optional in typedef but call sites always pass a real selector. **No runtime change** — original code passed `target.selector` directly (Playwright treats undefined as throw at runtime; we preserve that).
  - In `assertPostAction` the `el.textContent || el.value` accessed via `/** @type {HTMLInputElement} */ (el)` cast inside `page.evaluate` — runtime is unchanged, this is just type narrowing inside the closure.
  - `failure: AssertFail` annotated explicitly so the `error: failure` field of TraceRecord narrows correctly.
- `tsconfig.checkjs-dom.json` — add entry (3 → 4).

## Rationale
- DOM-aware (uses `document.*` inside `page.evaluate`), so it goes in checkjs-dom.json with DOM lib.
- Only callers are `browser-primitives.mjs` (which is not yet annotated). This phase doesn't touch callers.

## Gates
- `npm run typecheck` — 0 errors
- `npm run typecheck:checkjs` — 0 errors
- `npm run typecheck:checkjs-dom` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped
