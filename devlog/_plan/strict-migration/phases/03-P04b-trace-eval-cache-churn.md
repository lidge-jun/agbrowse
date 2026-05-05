# P04b — Trace / eval / cache / churn JSDoc batch (VERDICT-B continuation)

## Decision binding

Same as P04 batch A: Pro VERDICT B (recorded in `_gpt-pro-arbitration-p04-meta.md`).
No `.mjs` rename. Type-check via JSDoc + per-file `// @ts-check` + sibling
`tsconfig.checkjs.json`. Hard rename deferred to P14.

## What this phase does

Add JSDoc `@param`/`@returns`/`@typedef` annotations to 5 leaves with implicit-any
errors (per the P03 12-file candidate table) and add them to
`tsconfig.checkjs.json#include`.

## Files

| # | File | Errors before (checkJs:true) | After |
|---|------|------------------------------|-------|
| 1 | `web-ai/trace/redact.mjs` | 4 | 0 |
| 2 | `web-ai/trace/types.mjs` | 5 | 0 |
| 3 | `web-ai/eval/types.mjs` | 13 | 0 |
| 4 | `web-ai/cache-metrics.mjs` | 9 | 0 |
| 5 | `web-ai/churn-log.mjs` | 6 | 0 |

Total cleared: 37 implicit-any errors via JSDoc + light JSDoc casts.

## Annotation patterns used

- Public functions: `@param` + `@returns` JSDoc.
- Pseudo-classes / augmented `Error` (eval `WebAiEvalError`): one `@typedef` at
  the top of the file + a JSDoc cast `/** @type {WebAiEvalError} */ (new Error(...))`.
- Mutable shape with optional fields added later (cache `report.cacheHitRate`,
  `report.selfHealRate`): `@typedef` declares those as optional from the start.
- Unknown payloads / records (`Object.entries(value)`, parsed JSONL records,
  cache events): `@typedef` for the record shape + `@type` casts at boundaries
  rather than relaxing function signatures to `any`.
- Default parameters keep their existing runtime defaults; JSDoc documents them
  with `[name]` optional syntax.

## Hard invariants preserved

- No `.mjs` filename change.
- No import specifier change.
- No `bin/*` change.
- No `package.json#bin` / `package.json#files` change.
- No new dependencies.
- Main `tsconfig.json` unchanged.

## Gates

- `npm run typecheck` → OK
- `npm run typecheck:checkjs` → OK (0 errors across 9 files now opted in)
- `npm run smoke:bins` → OK
- `npm test` → 473 passed, 12 skipped
- `tsc --listFiles -p tsconfig.checkjs.json` confirms all 5 new files are in
  the program (negative-probe pattern recommended by Pro in P04 batch A
  verification).

## Out of scope

- DOM-touching files (`observe-targets`, `copy-markdown`, `dom-hash`) — P04c.
- All other `.mjs` files in the repo — later phases per the strategy table.
