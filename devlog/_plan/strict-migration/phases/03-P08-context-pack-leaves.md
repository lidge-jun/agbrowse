# P08 — Context-Pack Leaf Helpers (JSDoc opt-in, 4 files)

## Scope

Extend `tsconfig.checkjs.json` to cover the leaf modules of the `web-ai/context-pack/*` namespace. No new deps, no behavior change, no rename. Pure annotation + sibling tsconfig include.

## Files (4)

| File | Lines | Notes |
|------|-------|-------|
| `web-ai/context-pack/constants.mjs` | 39 | constant exports only; trivial `// @ts-check` |
| `web-ai/context-pack/token-estimator.mjs` | 42 | `BudgetInput`/`BudgetReport` typedefs; `Record<string, Record<string, number>>` cast on `DEFAULT_MODEL_INPUT_BUDGETS` to allow vendor/model lookups |
| `web-ai/context-pack/report.mjs` | 70 | `ContextDryRunResult`/`ContextFileRow`/`ContextAttachment`/`ReportOptions` typedefs; renderer return type `string` (with `|| ''` fallback when transport text undefined) |
| `web-ai/context-pack/renderer.mjs` | 79 | `ContextRenderInput`/`ContextFile` typedefs; existing imports of `WebAiError`/`buildBudgetReport` already type-checked |

Total checked .mjs files in tsconfig.checkjs.json: 30 → **34** (verified by `--listFiles`).

## Pro-honored patterns

- No runtime-changing JS. `renderContextDryRunReport` returns `string|undefined` (instead of forcing `string`) so the original `result.composerText`/`result.attachmentText` value — including `undefined` in edge cases — is returned exactly as before.
- `BudgetInput` typedef with optional `inlineCharLimit` matches all call sites; `Number(input.inlineCharLimit || DEFAULT_BROWSER_INLINE_CHAR_BUDGET)` preserved.
- `DEFAULT_MODEL_INPUT_BUDGETS` is locally re-narrowed via `/** @type {Record<string, Record<string, number>>} */` to allow vendor/model dynamic lookup without widening the constants module's literal type.
- `ContextDryRunResult.budget.status` typed as `string` (not the `'ok'|'warning'|'over-budget'` literal union from token-estimator), because the report-renderer is consumer-side and shouldn't constrain producer literals.
- File-row `language?: string` is optional and falls back to `languageFromPath()` at render time — preserved.

## Gates (all green)

- `npx tsc --noEmit -p tsconfig.checkjs.json --listFiles` → 34 .mjs entries
- `npm run typecheck` ✓
- `npm run typecheck:checkjs-dom` ✓ (3 entries unchanged)
- `npm run smoke:bins` ✓
- `npm test` → 473 passed, 12 skipped (no regression)

## Out of scope

- `context-pack/index.mjs` re-exports from `file-selector.mjs` and `builder.mjs` which aren't yet annotated; deferred to P09.
- `context-pack/builder.mjs`, `context-pack/file-selector.mjs` — pull in `node:fs`, `node:os`, `node:path` and complex types; later batch.
- DOM-touching modules like `post-action-assert.mjs`, `dom-hash.mjs` already in `tsconfig.checkjs-dom.json` track.
- Larger session/cli orchestration (P10+).
