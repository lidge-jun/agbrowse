# P12 — eval-runner.mjs (web-ai eval orchestrator leaf)

VERDICT-B (per-file `// @ts-check` + JSDoc; no runtime change). Adds `web-ai/eval-runner.mjs` (178 lines) to `tsconfig.checkjs.json`. Runner is a leaf-of-leaves: all `eval/*` deps are already strict-annotated, so we let TS infer the `EvalResult` shape from `web-ai/eval/types.mjs` and `eval/metrics.mjs` rather than redeclaring it.

## Files
- `web-ai/eval-runner.mjs` — `// @ts-check` header; `EvalFixture` + `EvalRunOptions` typedefs; JSDoc on helpers (`inferVariant`, `htmlToText`, `estimateTokens`, `makeRunId`, `currentGitCommit`, `rejectNetworkFixtureHtml`, `runOneFixture`); `runBounded` annotated with `@template T,R`. Two JSDoc-only casts:
  - `vendor: /** @type {string|undefined} */ (vendor)` at the `discoverProviderFixtures` call (local `vendor` is `string|null` because of the `options.config ? null : ...` branch; this branch only runs when `config` is null, so vendor is always a string here — cast keeps the typedef-only fix).
  - `const status = /** @type {'pass'|'fail'} */ (errors.length === 0 ? 'pass' : 'fail')` so the literal narrows for `EvalResult.status: 'pass'|'fail'`.
- `tsconfig.checkjs.json` — add `web-ai/eval-runner.mjs` (43 → 44).

## Rationale
- Don't redeclare `EvalResult`/`EvalFixtureResult` locally: `eval/types.mjs` already exports the canonical typedef and `collectMetricRegressions` / `summarizeEvalResults` consume it. A local typedef would diverge.
- Casts are pure JSDoc — no `String(...)`/`Number(...)`/`|| ''` runtime fallbacks introduced.

## Gates
- `npm run typecheck` — 0 errors
- `npm run typecheck:checkjs` — 0 errors
- `npm run typecheck:checkjs-dom` — 0 errors
- `npm run smoke:bins` — both bins ok
- `npm test` — 473 pass / 12 skipped (no regression)
