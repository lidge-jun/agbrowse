# P18 — skills/browser/tab-manager.mjs

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `skills/browser/tab-manager.mjs` (370 lines). True leaf — only Node built-ins (`node:fs/path/os`) + dynamic `import('playwright-core')`. No internal `.mjs` deps.

## Files
- `skills/browser/tab-manager.mjs`:
  - `// @ts-check` + `/// <reference types="playwright-core" />`.
  - 11 typedefs: `Browser`, `Page`, `CDPSession` (re-exported via `import('playwright-core')`), `CdpConnectionEntry`, `RawTab`, `CdpSessionLike`, `CreateTabResult`, `CloseTabResult`, `SwitchTabResult`, `ManagedTabRow`, `TabInfo`, `TabOpts`.
  - `Map<number, CdpConnectionEntry>` and `Map<string, number>` widening on module-scope state.
  - JSDoc on all 9 exports + 7 internal helpers.
  - Inline `/** @type {T} */ (...)` casts on:
    - `JSON.parse` results (tab-activity store, CDP responses).
    - `await fetch(...).json()` results (CDP /json/version, /json/list).
    - `event.data` access on `MessageEvent` listener (raw WebSocket).
    - Caught `unknown` → `{ message?: string, code?: string }` for property access.
    - `tab.id`/`tab.url`/`tab.title`/`tab.type` from `RawTab` are typed as optional; cast at the boundary that returns the public `ManagedTabRow`/`TabInfo` (matches existing runtime contract — `listTabs` filter already excluded non-page entries).
  - `addEventListener('open', resolve, ...)` adapter: original passed `resolve` directly (resolves with the `Event` parameter, ignored by callers). With `Promise<unknown>` typing the listener signature mismatched, so wrapped as `() => resolve(undefined)`. Equivalent runtime semantics — promise is awaited but the resolved value is never read.
- `tsconfig.checkjs.json` — add entry (45 → 46).

## Rationale
- `tab-manager.mjs` is a pre-req for the next big leaf: `web-ai/tab-lease-store.mjs` (P19) which imports `closeTab`/`isTabAlive` from this file.
- Self-contained module: only Node built-ins + dynamic playwright import. Safe to land before annotating `tab-lease-store.mjs`.

## Gates
- `npm run typecheck` — 0 errors
- `npx tsc --noEmit -p tsconfig.checkjs.json` — 0 errors
- `npx tsc --noEmit -p tsconfig.checkjs-dom.json` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped
