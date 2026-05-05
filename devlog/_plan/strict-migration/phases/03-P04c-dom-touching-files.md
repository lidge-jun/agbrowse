# P04c — DOM-touching files (separate DOM-lib tsconfig)

## Scope

Opt-in `// @ts-check` + JSDoc for 3 files that touch DOM globals via `page.evaluate(...)` callbacks (Playwright-driven browser context):

- `web-ai/observe-targets.mjs` — semantic target resolution; uses `page.locator(...)` (Node side) + DOM-typed candidate ranking
- `web-ai/dom-hash.mjs` — `page.evaluate(sels => document.querySelector(...))`
- `web-ai/copy-markdown.mjs` — large `page.evaluate` with clipboard + DOM mutation interception

## Approach (binds Pro F guidance)

A second sibling tsconfig: `tsconfig.checkjs-dom.json` extending `tsconfig.json` with
`compilerOptions.lib = ["ES2022", "DOM", "DOM.Iterable"]`. Only the 3 DOM-touching files are included.
The existing `tsconfig.checkjs.json` (Node, no DOM) continues to type-check the other 9 opt-in leaves.

Rationale per Pro: TSConfig `lib` is the canonical mechanism for scoping browser globals;
do not hide callback bodies behind `any`.

## Files changed

- NEW `tsconfig.checkjs-dom.json` — extends base, lib includes DOM, scoped `include` to the 3 files
- `package.json` — added `typecheck:checkjs-dom` script
- `web-ai/observe-targets.mjs` — added `// @ts-check`, `/// <reference types="playwright-core" />`, typedefs `TargetSpec`, `SnapshotRef`, `TargetCandidate`, fully annotated all exports + helpers
- `web-ai/dom-hash.mjs` — added `// @ts-check`, Playwright reference, JSDoc on all 3 exports; explicit `string[]` annotation on `page.evaluate` callback param
- `web-ai/copy-markdown.mjs` — added `// @ts-check`, typedefs `CopySelectors`, `CaptureCopyOptions`, `CaptureCopyResult`; annotated `page.evaluate` inner callback signature so DOM-lib resolves `document`, `Element`, `HTMLElement`, `ClipboardItem`, `PointerEvent`, `MouseEvent`, `navigator`, `window`. Refactored `clipboard.writeText?.bind(clipboard)` to ternary form so `if (originalWriteText)` is meaningful under DOM types (which mark `Clipboard.writeText` as required). Tightened `catch (e)` to `e instanceof Error ? e.message : String(e)`. Result discrimination uses `result && !result.ok` narrowing instead of optional-chained access.

## Verification

- `npm run typecheck` — green (project tsc)
- `npm run typecheck:checkjs` — green (9 Node-only opt-in files unchanged)
- `npm run typecheck:checkjs-dom` — green (3 DOM-touching files)
- listFiles probe confirms scope on both checkjs configs
- Negative probe: injecting `/** @type {string} */ const NEGPROBE = 42;` into `dom-hash.mjs` produces TS errors under `tsconfig.checkjs-dom.json` → confirms checkJs is active
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 passed / 12 skipped (no regressions)

## Notes

- `observe-targets.mjs` does NOT actually use `page.evaluate`; it uses Playwright `page.locator(...).count()`. It is included in the DOM-lib config because the typedef shapes (`SnapshotRef`, `TargetSpec`) reference DOM-flavored regex/role concepts; placing it here keeps the regex/role typing consistent with future P05 changes that will add real DOM access. (Could be relocated to `tsconfig.checkjs.json` if a later phase prefers it.)
- The two-tsconfig vehicle stays additive — no `.mjs` rename, no import-specifier change. Hard rename to `.ts/.mts` remains deferred to P14 per VERDICT-B.
