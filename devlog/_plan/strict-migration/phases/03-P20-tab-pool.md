# P20 — web-ai/tab-pool.mjs

VERDICT-B per-file `// @ts-check` annotation. Pure compatibility shim over `tab-lease-store.mjs` (already P19-annotated). 56 lines, no internal dependencies other than tab-lease-store.

## Annotations
- `PoolTabOptions`, `GetPooledTabOptions`, `CleanupPoolTabsOptions` typedefs (loose Partial-style — every field optional, matching the existing runtime defaults).
- JSDoc on all 5 exported functions (`poolTab`, `getPooledTab`, `unpoolTab`, `cleanupPoolTabs`, `getPoolStats` — the last needs none).

## Runtime
Zero runtime changes. No `Boolean(...)`, `String(...)`, `Number(...)`, no `instanceof Error` narrowing, no `|| ''`/`|| []`/`|| {}` fallbacks added.

## Gates
- `npm run typecheck` ✓
- `npx tsc --noEmit -p tsconfig.checkjs.json` ✓ (49 entries)
- `npm run smoke:bins` ✓
- `npm test` ✓
