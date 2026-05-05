# P19 — web-ai/tab-lease-store.mjs

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/tab-lease-store.mjs` (382 lines). Deps: `closeTab`/`isTabAlive` (P18 ✓) + `activeCommandTargetIds` (P14 ✓). Both annotated.

## Files
- `web-ai/tab-lease-store.mjs`:
  - `// @ts-check` (no playwright reference — port is `number`, all types are POJOs).
  - 4 typedefs: `Lease` (full record shape), `LeaseInput` (partial input), `ListLeasesFilter`, `StoreFile`.
  - JSDoc on all 9 exports + 9 internal helpers including `withLeaseLock<T>(fn: () => Promise<T>): Promise<T>` generic.
  - Local-state widening: `Lease[]`, `Set<string>`, `Map<string, Lease[]>`, `Lease|null`.
  - `LeaseInput.url` typed as `string|null|undefined` so `Lease`-shaped objects (which carry `url: string|null`) can be re-passed to `buildLeaseKey`/`originFromUrl` without runtime coercion.
  - `originFromUrl` arg widened to `string|null|undefined`; cast `(url)` at the `new URL` site (the catch already handles non-string input — no runtime change).
  - `normalizeLease`: explicit `Lease` type annotation. `targetId` cast `(input.targetId)` since the typedef requires it; existing runtime contract assumes callers always supply `targetId`. Initialized `leaseKey: ''` then assigned on next line so the literal type satisfies `Lease`.
  - All caught errors narrowed via inline cast `/** @type {{ code?: string }} */ (error)`.
  - `JSON.parse` results cast at boundary; `parsed?.leases.filter` lambda annotated.
  - Sorted/sliced expressions kept exactly as-is — no new `String()` / `Number()` / `?? null` etc.
- `tsconfig.checkjs.json` — add entry (46 → 47).

## Rationale
- Last large remaining leaf in the lease/tab subsystem. Both deps already annotated.
- Sets up the `Lease`/`LeaseInput` types for downstream consumers (mcp-server.mjs uses `recordActiveLease`/`releaseCompletedLease`).

## Gates
- `npm run typecheck` — 0 errors
- `npx tsc --noEmit -p tsconfig.checkjs.json` — 0 errors
- `npx tsc --noEmit -p tsconfig.checkjs-dom.json` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped
