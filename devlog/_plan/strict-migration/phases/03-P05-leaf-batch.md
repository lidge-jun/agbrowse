# P05 — Leaf batch (7 files JSDoc opt-in)

## Scope

Add `// @ts-check` + JSDoc annotations to 7 leaf `.mjs` files whose imports are
already covered by prior P04 batches. Pull each annotated file into
`tsconfig.checkjs.json#include`. **No `.mjs` rename, no behavior change, no
runtime code edits.** Pure type-only opt-in per VERDICT-B.

## Files annotated

| File | LOC | Notes |
| --- | --- | --- |
| `web-ai/trace/report.mjs` | 35 | JSDoc on `redactTraceRecords` + `summarizeTraceRecords`; cast result of `redactTraceValue` to `TraceRecord[]` |
| `web-ai/eval/scrub-dom.mjs` | 67 | JSDoc on `scrubProviderDom` + `assertScrubbedSafe`; explicit `string[]` typed `issues` |
| `web-ai/eval/provider-targets.mjs` | 95 | New typedefs `EvalTargetIntent` / `EvalTargetProbeResult`; JSDoc on 3 exports + `escapeRegExp`; default `intent = ''` to satisfy required field while runtime list check still rejects empty |
| `web-ai/eval/metrics.mjs` | 88 | New typedefs `EvalMetric` / `EvalResult` / `EvalRegression` / `EvalRun`; JSDoc on 3 exports; narrowed `metric.value` `typeof` check |
| `web-ai/eval/fixtures.mjs` | 89 | New typedefs `ProviderFixture` / `FixtureConfigEntry` / `FixtureConfig`; JSDoc on `sha256File`, `resolveFixturePath`, `readFixtureHtml`, `discoverProviderFixtures`, `loadFixtureConfig`; explicit `ProviderFixture[]` annotation on `fixtures` accumulator |
| `web-ai/policy/content-boundary.mjs` | 21 | JSDoc on 3 exports (`renderTrustedSection`, `renderUntrustedPageSection`, `containsPromptInjection`); pure string helpers |
| `web-ai/browser-tool-schema.mjs` | 60 | JSDoc on `objectSchema` arrow factory + `isKnownBrowserTool`; `Record<string, { description: string, inputSchema: ReturnType<typeof objectSchema> }>` annotation on `BROWSER_TOOLS` to make string indexing safe |

## Files deferred

These were initially scoped for P05 but pull untyped transitive dependencies
(`errors.mjs`, `session.mjs`, `session-store.mjs`, `ax-snapshot.mjs`,
`vendor-editor-contract.mjs`, etc.) into the checkjs world, which would
explode the batch. Deferred to P06+ where those dependencies are also
annotated:

- `web-ai/policy/schema.mjs` — depends on `errors.mjs`
- `web-ai/trace-persistence.mjs` — depends on `session.mjs` → `session-store.mjs`
- `web-ai/contract-audit.mjs` — depends on `ax-snapshot.mjs` + `vendor-editor-contract.mjs` (huge transitive fan-out)

## tsconfig change

`tsconfig.checkjs.json#include` grows from 11 → 18 files (added 7 above).
DOM tsconfig untouched.

## Gates (all green at HEAD)

- `npm run typecheck` (root strict tsc): 0 errors
- `npm run typecheck:checkjs`: 0 errors
- `npm run typecheck:checkjs-dom`: 0 errors
- `npm run smoke:bins`: both bin scripts `--help` ok
- `npm test`: 473 passed, 12 skipped

## Negative probe

Manual: temporarily inserted `const x: number = 'string';` into
`web-ai/eval/metrics.mjs`. `npm run typecheck:checkjs` reported the expected
TS2322 error. Reverted.

## Pro round expectations

- Confirm typedef shapes match runtime usage (esp. `FixtureConfigEntry` which
  permits arbitrary extra keys).
- Confirm `Record<string, { description, inputSchema }>` for `BROWSER_TOOLS`
  is the right style (alternative: `keyof typeof` with literal map — heavier).
- Confirm that the `intent = ''` default in `provider-targets.mjs` does not
  weaken validation (runtime list check still excludes empty string).
- Confirm `JSDoc` cast `/** @type {TraceRecord[]} */ (redactTraceValue(...))`
  is acceptable for unknown→typed boundary.
