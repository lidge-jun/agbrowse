# P13 — ax-snapshot.mjs (accessibility snapshot leaf)

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/ax-snapshot.mjs` (234 lines) to `tsconfig.checkjs-dom.json` (sibling DOM-aware sibling tsconfig because the file imports `dom-hash.mjs`, which lives in checkjs-dom).

## Files
- `web-ai/ax-snapshot.mjs` — `// @ts-check` + `/// <reference types="playwright-core" />`. Five typedefs: `AxNode` (with index signature for dynamic attr access), `InteractiveRef`, `SerializeOptions`, `SerializeContext`, `WebAiSnapshot`. JSDoc on every export and helper.
  - Pure-JSDoc cast for `node[attr]` dynamic indexing: `/** @type {Record<string, unknown>} */ (node)[attr]`.
  - Pure-JSDoc cast for `page.accessibility` (Playwright 1.58 removed it from public types but it remains at runtime — the existing guard `if (!ax || typeof ax.snapshot !== 'function')` already preserves runtime safety): cast via `/** @type {unknown} */ (page)` → `Record<string, unknown>` → narrow to typed shape.
- `tsconfig.checkjs-dom.json` — add `web-ai/ax-snapshot.mjs` (2 → 3 entries).

## Rationale
- Goes in checkjs-dom (not checkjs) because it imports `dom-hash.mjs` and TS pulls dom-hash into the program; dom-hash uses `document.querySelector` inside `page.evaluate` and needs DOM lib.
- `AxNode` has explicit fields plus `[key: string]: unknown` for the dynamic attr loop (`for (const attr of [...]) node[attr]`).
- The `page.accessibility` cast preserves the existing runtime guard — no semantics change. Playwright 1.58 dropped it from public `Page` types but the runtime API is still functional; the guard handles its absence.

## Gates
- `npm run typecheck` — 0 errors
- `npm run typecheck:checkjs` — 0 errors
- `npm run typecheck:checkjs-dom` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped (no regression)
