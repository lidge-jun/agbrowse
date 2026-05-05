# agbrowse TypeScript-Strict Migration Plan (READ-ONLY)

No files modified. Repository analyzed: `/Users/jun/Developer/new/700_projects/agbrowse`.

## 1. Inventory

### 1.1 File counts

#### Top-level directories

| Directory | `.mjs` | `.js` | `.ts` | Test files | Total JS/TS |
|---|---:|---:|---:|---:|---:|
| `.` | 1 | 0 | 0 | 0 | 1 |
| `benchmarks/` | 2 | 0 | 0 | 0 | 2 |
| `bin/` | 2 | 0 | 0 | 0 | 2 |
| `scripts/` | 2 | 0 | 0 | 0 | 2 |
| `skills/` | 9 | 0 | 0 | 0 | 9 |
| `test/` | 77 | 0 | 0 | 77 | 77 |
| `web-ai/` | 69 | 0 | 0 | 0 | 69 |
| **Total** | **162** | **0** | **0** | **77** | **162** |

`*.test.mjs` count: **70**. The remaining 7 test-side files are helpers / servers under `test/`.

#### Important subdirectories

| Directory | `.mjs` | Test files | LOC |
|---|---:|---:|---:|
| `skills/browser/` | 7 | 0 | 3,208 |
| `skills/vision-click/` | 2 | 0 | 566 |
| `web-ai/` root files | 48 | 0 | 9,583 |
| `web-ai/context-pack/` | 8 | 0 | 575 |
| `web-ai/eval/` | 5 | 0 | 357 |
| `web-ai/policy/` | 4 | 0 | 117 |
| `web-ai/trace/` | 4 | 0 | 198 |
| `test/unit/` | 54 | 54 | 5,627 |
| `test/integration/` | 14 | 14 | 1,471 |
| `test/e2e/` | 1 | 1 | 49 |
| `test/helpers/` | 6 | 6-ish helper files | 152 |
| `test/spec/` | 2 | 2 | 33 |

### 1.2 Top 20 largest `.mjs` files

| LOC | File |
|---:|---|
| 2,087 | `skills/browser/browser.mjs` |
| 1,007 | `web-ai/cli.mjs` |
| 751 | `test/unit/web-ai-chatgpt-model.test.mjs` |
| 619 | `web-ai/gemini-live.mjs` |
| 617 | `web-ai/chatgpt.mjs` |
| 603 | `web-ai/chatgpt-model.mjs` |
| 486 | `web-ai/grok-live.mjs` |
| 476 | `web-ai/watcher.mjs` |
| 383 | `web-ai/self-heal.mjs` |
| 382 | `web-ai/tab-lease-store.mjs` |
| 370 | `skills/browser/tab-manager.mjs` |
| 363 | `web-ai/chatgpt-composer.mjs` |
| 313 | `skills/vision-click/vision-click.mjs` |
| 309 | `test/unit/tab-lifecycle.test.mjs` |
| 309 | `test/integration/web-ai-policy-mcp.test.mjs` |
| 279 | `skills/browser/skill-install.mjs` |
| 265 | `test/unit/web-ai-self-heal.test.mjs` |
| 254 | `web-ai/mcp-server.mjs` |
| 253 | `skills/vision-click/vision-core.mjs` |
| 240 | `web-ai/session.mjs` |

### 1.3 External packages

From `package.json`:

#### Runtime dependencies

| Package | Version |
|---|---|
| `fast-glob` | `^3.3.3` |
| `playwright-core` | `^1.58.2` |

#### Dev dependencies

| Package | Version |
|---|---|
| `vitest` | `^3.2.4` |

Detected non-Node imports match declared packages:

- `fast-glob`
- `playwright-core`
- `vitest`

Migration will need new dev-only packages:

- `typescript`
- `@types/node`

### 1.4 Entry points and bin layout

`package.json`:

```json
"bin": {
  "agbrowse": "bin/agbrowse.mjs",
  "agbrowse-vision-click": "bin/agbrowse-vision-click.mjs"
}
```

Actual bin files are minimal shebang wrappers:

| Bin | File | Content shape |
|---|---|---|
| `agbrowse` | `bin/agbrowse.mjs` | `#!/usr/bin/env node` then side-effect imports `../skills/browser/browser.mjs` |
| `agbrowse-vision-click` | `bin/agbrowse-vision-click.mjs` | `#!/usr/bin/env node` then side-effect imports `../skills/vision-click/vision-click.mjs` |

Important implication: published CLI behavior is currently tied directly to source `.mjs` paths. A build-to-`dist/` migration would change the package’s executable topology.

### 1.5 CLI surface

`./bin/agbrowse.mjs --help` exposes:

- Skill installation:
  - `skills list`
  - `skills get core --full`
  - `skills get <browser|web-ai|vision-click>`
  - `skills path`
  - `skills install --target <dir>`
  - legacy `install-skills`
- Browser lifecycle:
  - `start`, `stop`, `status`, `reset`
- Observe:
  - `snapshot`, `screenshot`, `text`, `get-dom`
- Interact:
  - `click`, `type`, `press`, `hover`, `select`, `check`, `uncheck`, `drag`
  - mouse primitives
- Navigation:
  - `navigate`, `reload`, `resize`, `tabs`, `tab-switch`, `select-tab`, `tab-cleanup`, `scroll`
- Wait:
  - `wait`, `wait-for-selector`, `wait-for-text`, deprecated `wait-for`
- Diagnostics:
  - `console`, `network`, `evaluate --unsafe-allow`
- Web AI:
  - `web-ai render/status/send/poll/query/stop/context-dry-run/context-render`
  - provider flags for ChatGPT, Gemini, Grok
- Vision click:
  - `agbrowse-vision-click`

### 1.6 Vitest config

`vitest.config.mjs`:

```js
export default defineConfig({
    test: {
        include: ['test/**/*.test.mjs'],
        testTimeout: 30000,
        hookTimeout: 30000,
        fileParallelism: false,
        reporters: 'verbose',
    },
});
```

Test pattern: **`test/**/*.test.mjs`**

Existing scripts:

- `npm test` → `vitest run --reporter=verbose`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- `npm run test:smoke` → `vitest run test/integration/self-heal-smoke.test.mjs`

---

## 2. Migration Strategy Choice

### Recommendation: **B) Hybrid JSDoc + `checkJs` strict**

Keep `.mjs`, add a strict TypeScript checking project with:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "strict": true,
    "noEmit": true
  }
}
```

Then annotate file-by-file using JSDoc:

- `@param`
- `@returns`
- `@typedef`
- `@template`
- `@type`
- imported typedef aliases via `import('./x.mjs').TypeName`

### Why B is the right choice for agbrowse

agbrowse is a published npm CLI where the shipped package currently includes:

```json
"files": [
  "README.md",
  "bin/",
  "skills/",
  "web-ai/",
  "benchmarks/",
  "docs/",
  "structure/",
  "devlog/",
  "vitest.config.mjs"
]
```

and `bin/` points directly to `.mjs` source files.

Option B minimizes publish risk because it avoids:

- changing `bin` targets;
- adding a `dist/` layout;
- rewriting 329 relative imports from `.mjs` to emitted `.js`;
- losing shebang behavior in compiled output;
- changing package `files`;
- requiring consumers to receive generated artifacts.

It still hits strictness because TypeScript can type-check `.mjs` under `allowJs + checkJs + strict`. The cost shifts from mechanical conversion to careful JSDoc boundary annotation.

### Why not A: full `.mjs` → `.ts`

A is cleaner long-term, but too risky for this package now:

- 162 files would be rewritten.
- `bin` would need to point to `dist/bin/*.js`.
- package `files` must include `dist/` and probably exclude raw source or ship dual.
- every relative import path and side-effect CLI import becomes migration-sensitive.
- npm release could break even if tests pass locally.

### Why not C: gradual TS overlay

C sounds moderate but creates dual-runtime complexity:

- `.mjs` entry points importing compiled `.ts` output means partial `dist/` and partial source shipping.
- It creates two module roots.
- It invites “works in repo, fails after npm pack” bugs.
- It is harder to reason about than either pure build or pure source-check.

Use C only if GPT Pro insists on generated `.d.ts` artifacts for consumers. I do not think agbrowse needs that yet.

---

## 3. Phase Plan: P00.5 → P20

Universal exit gates for every implementation phase:

```bash
npx tsc --noEmit -p tsconfig.strict.json
npm test
npm run test:smoke
npm run check:strict-baseline
```

During early phases, `tsconfig.strict.json` should include only completed scopes. Do **not** enable all 162 files on day one and then baseline thousands of errors. Keep the baseline meaningful.

### P00.5 — Diagnostic and strict debt inventory

| Field | Plan |
|---|---|
| Scope | Read-only inventory over all 162 `.mjs` files. Count files, LOC, imports, JSDoc markers, suppressions, explicit `any`, implicit-any diagnostics from trial `checkJs`. |
| Files | No source changes. Produce `docs/migration/strict-baseline.md` in implementation phase. |
| tsconfig flags | None. |
| Exit gates | Diagnostic script reproducible; no source modified. |
| Diff size | Small. |

Opinion: agbrowse’s current explicit `any` count is deceptively low: only one regex hit was found in `web-ai/tab-recovery.mjs`. The real strict debt will be implicit JS parameters, dynamic JSON/object shapes, Playwright page/locator shapes, `process.env`, and provider DOM evaluation callbacks.

### P00 — Add strict checking harness, baseline gate, and dependencies

| Field | Plan |
|---|---|
| Scope | `package.json`, new `tsconfig.strict.json`, new `scripts/check-strict-baseline.mjs`, new `docs/migration/strict-baseline.md`. |
| Files | `package.json`; `tsconfig.strict.json`; `scripts/check-strict-baseline.mjs`; `docs/migration/strict-baseline.md`. |
| tsconfig flags | Add `allowJs:true`, `checkJs:true`, `strict:true`, `noEmit:true`, `module:"NodeNext"`, `moduleResolution:"NodeNext"`, `target:"ES2022"`, `lib:["ES2022","DOM"]`, `types:["node","vitest"]`, `skipLibCheck:true`. Initial `include` should be empty or tiny, e.g. only `web-ai/types.mjs`. |
| Exit gates | `tsc` PASS for initial include, `vitest` PASS, `test:smoke` PASS, `check:strict-baseline` PASS. |
| Diff size | Medium. |

Add dev dependencies:

```json
"typescript": "...",
"@types/node": "..."
```

No build step. No `dist/`.

### P01 — Type kernel: constants and pure exported taxonomies

| Field | Plan |
|---|---|
| Scope | Type-like modules with little runtime IO. |
| Files | `web-ai/types.mjs`; `web-ai/constants.mjs`; `web-ai/context-pack/types.mjs`; `web-ai/trace/types.mjs`; `web-ai/eval/types.mjs`. |
| tsconfig flags | No new flags. Expand `include`. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS. |
| Diff size | Small. |

Goal: create canonical JSDoc typedefs for:

- `WebAiVendor`
- `WebAiStatus`
- `AttachmentPolicy`
- session IDs / trace IDs
- trace record shapes
- eval fixture/result shapes

### P02 — Pure parsing and utility modules

| Field | Plan |
|---|---|
| Scope | Leaf utilities with deterministic inputs/outputs. |
| Files | `skills/browser/browser-core.mjs`; `skills/vision-click/vision-core.mjs`; `web-ai/action-intent.mjs`; `web-ai/dom-hash.mjs`; `web-ai/cache-metrics.mjs`; `web-ai/question.mjs`; `web-ai/vendor-editor-contract.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS. |
| Diff size | Medium. |

This is where `unknown` + narrow guards should become house style.

### P03 — Skill install and browser tab lifecycle support

| Field | Plan |
|---|---|
| Scope | Browser skill support modules, excluding the giant CLI file. |
| Files | `skills/browser/profile-lock.mjs`; `skills/browser/skill-install.mjs`; `skills/browser/tab-lifecycle.mjs`; `skills/browser/tab-manager.mjs`; `skills/browser/tab-monitor.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, plus `npm run test:integration -- cli-install-skills` if kept as a focused manual gate. |
| Diff size | Medium. |

Use JSDoc records for tab activity, cleanup policy, provider tab classification, and lock records.

### P04 — Vision click executable path

| Field | Plan |
|---|---|
| Scope | Vision CLI and its core. |
| Files | `bin/agbrowse-vision-click.mjs`; `skills/vision-click/vision-click.mjs`; `skills/vision-click/vision-core.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, `test/unit/vision-core.test.mjs` PASS. |
| Diff size | Small–Medium. |

Keep bin wrapper `.mjs` unchanged structurally. Annotate CLI args and subprocess error handling.

### P05 — Web-AI policy, tool schema, source audit, contracts

| Field | Plan |
|---|---|
| Scope | Policy / schema / contract files before provider implementation. |
| Files | `web-ai/policy/*.mjs`; `web-ai/tool-schema.mjs`; `web-ai/browser-tool-schema.mjs`; `web-ai/contract-audit.mjs`; `web-ai/source-audit.mjs`; `web-ai/capability.mjs`; `web-ai/observe-targets.mjs`; `web-ai/post-action-assert.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, contract/source-audit unit tests PASS. |
| Diff size | Medium. |

Define strict JSON-envelope typedefs instead of letting policy objects become `{[key:string]: any}`.

### P06 — Context-pack and eval utilities

| Field | Plan |
|---|---|
| Scope | Context package builder/render/report and eval runner support. |
| Files | `web-ai/context-pack/*.mjs`; `web-ai/eval/*.mjs`; `web-ai/eval-runner.mjs`; `scripts/run-web-ai-eval.mjs`; `scripts/render-trace-report.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, `npm run test:eval` PASS. |
| Diff size | Medium. |

Expect `fast-glob` result typing, file selection objects, token estimates, fixture records.

### P07 — Session store, baseline store, trace persistence

| Field | Plan |
|---|---|
| Scope | Persistent JSON state and trace IO. |
| Files | `web-ai/session.mjs`; `web-ai/session-store.mjs`; `web-ai/session-baseline` logic if embedded; `web-ai/trace-persistence.mjs`; `web-ai/trace/redact.mjs`; `web-ai/trace/report.mjs`; `web-ai/trace/writer.mjs`; `web-ai/answer-artifact.mjs`; `web-ai/action-trace.mjs`; `web-ai/action-cache.mjs`; `web-ai/active-command-store.mjs`; `web-ai/churn-log.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, session/trace unit tests PASS. |
| Diff size | Large. |

This phase should introduce reusable JSON guards:

- `isRecord(value)`
- `readJsonObject(path)`
- `normalizeError(error: unknown)`
- `stripUndefinedObject`

### P08 — Browser primitives and Playwright-like shapes

| Field | Plan |
|---|---|
| Scope | Shared browser DOM/page/locator interfaces. |
| Files | `web-ai/browser-primitives.mjs`; `web-ai/ax-snapshot.mjs`; `web-ai/ref-registry.mjs`; `web-ai/target-resolver.mjs`; `web-ai/tab-finalizer.mjs`; `web-ai/tab-lease-store.mjs`; `web-ai/tab-pool.mjs`; `web-ai/tab-recovery.mjs`; `web-ai/mcp-state.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, tab/session/browser primitive tests PASS. |
| Diff size | Large. |

This is the phase most likely to need a local `PageLike` / `LocatorLike` JSDoc typedef instead of importing full Playwright types everywhere.

### P09 — ChatGPT model/composer support files

| Field | Plan |
|---|---|
| Scope | ChatGPT supporting logic excluding top-level provider orchestration. |
| Files | `web-ai/chatgpt-model.mjs`; `web-ai/chatgpt-composer.mjs`; `web-ai/chatgpt-attachments.mjs`; `web-ai/copy-markdown.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, ChatGPT model/composer unit tests PASS. |
| Diff size | Large. |

`chatgpt-model.mjs` is 603 LOC and already has a large test file. Treat as its own reviewable chunk.

### P10 — Provider core: ChatGPT

| Field | Plan |
|---|---|
| Scope | ChatGPT live provider and provider-facing DTOs. |
| Files | `web-ai/chatgpt.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, fake ChatGPT integration PASS. |
| Diff size | Large. |

Do not merge this with P09. `chatgpt.mjs` has provider session behavior and command envelopes; rollback should be isolated.

### P11 — Provider core: Gemini and Grok

| Field | Plan |
|---|---|
| Scope | Non-ChatGPT providers. |
| Files | `web-ai/gemini-live.mjs`; `web-ai/gemini-model.mjs`; `web-ai/grok-live.mjs`; `web-ai/grok-model.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, Gemini/Grok contract tests PASS. |
| Diff size | Large. |

Split into P11a Gemini and P11b Grok if GPT Pro predicts >400-line diff.

### P12 — Web-AI CLI, MCP server, watcher, self-heal

| Field | Plan |
|---|---|
| Scope | Public web-ai command dispatcher and long-running command behavior. |
| Files | `web-ai/cli.mjs`; `web-ai/cli-sessions.mjs`; `web-ai/mcp-server.mjs`; `web-ai/watcher.mjs`; `web-ai/self-heal.mjs`; `web-ai/errors.mjs`; `web-ai/doctor.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, `test:mcp` PASS, web-ai CLI contract tests PASS. |
| Diff size | Very large. |

This is a “boss” phase. `web-ai/cli.mjs` is 1,007 LOC and handles user input, JSON error envelopes, auto-start, and sessions.

### P13 — Browser CLI monolith

| Field | Plan |
|---|---|
| Scope | Main browser CLI implementation and bin wrapper. |
| Files | `skills/browser/browser.mjs`; `bin/agbrowse.mjs`. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, CLI help/lifecycle/dom/network tests PASS. |
| Diff size | Very large. |

This should land after web-ai types are stable because `browser.mjs` imports the web-ai CLI surface.

Do not change the bin wrapper structure unless GPT Pro explicitly approves.

### P14 — Benchmarks and release-adjacent scripts

| Field | Plan |
|---|---|
| Scope | Non-runtime but package-shipped utility code. |
| Files | `benchmarks/agbrowse/run-task.mjs`; `benchmarks/agbrowse/trajectory.mjs`; release scripts only if JS exists. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, benchmark trajectory unit test PASS. |
| Diff size | Small. |

### P15 — Tests under checkJs

| Field | Plan |
|---|---|
| Scope | Test files and helpers. |
| Files | `test/helpers/*.mjs`; `test/unit/**/*.test.mjs`; `test/integration/**/*.test.mjs`; `test/e2e/**/*.test.mjs`; `test/spec/**/*.test.mjs`; `test/integration/smoke-server.mjs`. |
| tsconfig flags | Expand include to all tests. No stricter flags yet. |
| Exit gates | `tsc` PASS, full `vitest` PASS, `test:smoke` PASS. |
| Diff size | Very large. |

Tests should be last among annotation phases because test helpers import almost every public shape.

### P16 — Flip control-flow strictness

| Field | Plan |
|---|---|
| Scope | Whole strict project. |
| Files | `tsconfig.strict.json`; source fixes where TypeScript reports missing returns / switch fallthrough. |
| tsconfig flags | Add `noImplicitReturns:true`, `noFallthroughCasesInSwitch:true`. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS. |
| Diff size | Medium. |

Likely hotspots:

- command switch/if ladders in `skills/browser/browser.mjs`
- `web-ai/cli.mjs`
- provider status/query paths
- JSON error envelope builders

### P17 — Flip index-signature and unchecked-index strictness

| Field | Plan |
|---|---|
| Scope | Whole strict project. |
| Files | `tsconfig.strict.json`; fix indexed access across env, args, JSON objects, maps. |
| tsconfig flags | Add `noPropertyAccessFromIndexSignature:true`, `noUncheckedIndexedAccess:true`. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS. |
| Diff size | Large. |

Likely hotspots:

- `process.env.X`
- `argv[i]`
- `headers.foo`
- provider selector arrays
- session store lookup by ID
- tab maps and lease maps

### P18 — Flip `exactOptionalPropertyTypes`

| Field | Plan |
|---|---|
| Scope | Whole strict project, split if needed. |
| Files | `tsconfig.strict.json`; config/session/policy/provider DTO construction. |
| tsconfig flags | Add `exactOptionalPropertyTypes:true`. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS. |
| Diff size | Large. |

Expected fix pattern:

```js
const out = { ok: true };
if (value !== undefined) out.value = value;
return out;
```

instead of:

```js
return { ok: true, value };
```

when `value` can be `undefined`.

Recommended split:

- P18a: session/store/trace/context package
- P18b: providers and web-ai CLI
- P18c: browser CLI and tests

### P19 — Final include and package-publish smoke

| Field | Plan |
|---|---|
| Scope | Confirm all 162 `.mjs` files are included in `tsconfig.strict.json`; run pack/install smoke. |
| Files | `tsconfig.strict.json`; `package.json` scripts if needed; no runtime code unless fallout appears. |
| tsconfig flags | No new flags; lock final include. Optional `forceConsistentCasingInFileNames:true`. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, `npm pack --dry-run` shows expected package layout. |
| Diff size | Small–Medium. |

Important: because strategy B has no build output, `npm pack --dry-run` should still show raw `bin/`, `skills/`, and `web-ai/` files.

### P20 — Cleanup, strict-debt removal, and permanent CI gate

| Field | Plan |
|---|---|
| Scope | Remove temporary `@strict-debt` markers; freeze baseline; make strict check required. |
| Files | `scripts/check-strict-baseline.mjs`; `docs/migration/strict-baseline.md`; `package.json`; CI workflow if present. |
| tsconfig flags | None. |
| Exit gates | `tsc` PASS, `vitest` PASS, `test:smoke` PASS, `check:strict-baseline` PASS and fails on intentional local regression. |
| Diff size | Medium. |

Final acceptance:

- zero `@strict-debt`;
- zero `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` unless explicitly grandfathered;
- no increase in explicit or implicit `any` counts;
- strict TypeScript check required before release.

---

## 4. Tooling Plan

### 4.1 `scripts/check-strict-baseline.mjs` equivalent

For agbrowse, the checker should do four jobs.

#### A. Run TypeScript in strict checkJs mode

```bash
npx tsc --noEmit -p tsconfig.strict.json --pretty false
```

Capture diagnostics and bucket by directory.

Important diagnostic classes to track as strict debt:

| Diagnostic family | Meaning |
|---|---|
| TS7006 | parameter implicitly has `any` |
| TS7031 | binding element implicitly has `any` |
| TS7005 | variable implicitly has `any` |
| TS7053 | unsafe indexed access / implicit any via index |
| TS18046 | value is `unknown` |
| TS2322 / TS2345 | assignment/call incompatibility after annotations |
| TS4111 | property from index signature must use bracket access |
| TS2532 / TS18048 | possibly undefined |
| TS2375 | exact optional property mismatch |

The script should not merely count textual `any`; checkJs strict debt is mostly diagnostics.

#### B. Count explicit-any-like markers in `.mjs`

Search all package JS files, excluding `node_modules`, for:

- `@type {any}`
- `@param {any}`
- `@returns {any}`
- `@typedef {any}`
- `/** @type {*} */`
- `@template` misuse that erases to `any`
- textual TypeScript escapes if any appear in JSDoc comments

Current regex-style explicit `any` count is near zero, but that should not create false confidence.

#### C. Count suppressions and migration markers

Track per directory:

- `@ts-ignore`
- `@ts-expect-error`
- `@ts-nocheck`
- `@strict-debt(Pxx): reason`

Rules:

- During P00–P19, `@strict-debt` may exist only with a phase ID and reason.
- P20 must fail on any remaining `@strict-debt`.
- New `@ts-ignore` / `@ts-nocheck` should fail immediately.
- `@ts-expect-error` should require a reason and phase marker if temporarily allowed.

#### D. Compare against `docs/migration/strict-baseline.md`

The baseline file should contain a machine-readable block, for example:

```md
<!-- strict-baseline:start -->
| dir | ts_diagnostics | implicit_any | explicit_any | suppressions | strict_debt |
|---|---:|---:|---:|---:|---:|
| bin | 0 | 0 | 0 | 0 | 0 |
| skills | 0 | 0 | 0 | 0 | 0 |
| web-ai | 0 | 0 | 0 | 0 | 0 |
| scripts | 0 | 0 | 0 | 0 | 0 |
| benchmarks | 0 | 0 | 0 | 0 | 0 |
| test | 0 | 0 | 0 | 0 | 0 |
<!-- strict-baseline:end -->
```

During migration, the table may have nonzero counts only for not-yet-included directories. Once a directory is included, it should not regress.

### 4.2 `npm run check:strict-baseline`

Add script:

```json
"check:strict-baseline": "node scripts/check-strict-baseline.mjs"
```

Recommended related script:

```json
"typecheck": "tsc --noEmit -p tsconfig.strict.json"
```

Even if the package avoids build output, `typecheck` should be a first-class script.

### 4.3 Per-directory `any` and `@strict-debt` tracking

Use these buckets:

- `.`
- `bin`
- `skills/browser`
- `skills/vision-click`
- `web-ai`
- `web-ai/context-pack`
- `web-ai/eval`
- `web-ai/policy`
- `web-ai/trace`
- `scripts`
- `benchmarks`
- `test/helpers`
- `test/unit`
- `test/integration`
- `test/e2e`
- `test/spec`

For every phase, lower the baseline only for completed scope.

Example marker:

```js
// @strict-debt(P12): provider session JSON shape depends on live DOM response; replace with ProviderSessionDto after P12.
```

P20 rule:

```bash
grep -R "@strict-debt" bin skills web-ai scripts benchmarks test
# expected: empty
```

---

## 5. Open Questions for GPT Pro Review

1. **Should agbrowse keep bin files as `.mjs` forever under strategy B, or should it eventually ship compiled `dist/bin/*.js` despite npm publish risk?**

2. **Should `tsconfig.strict.json` include tests by final P20, or should package source and tests have separate strict configs?**  
   My recommendation: include tests by P15, but GPT Pro may prefer `tsconfig.strict.json` + `tsconfig.test.json`.

3. **Should agbrowse add `.d.ts` declaration output for consumers, or is strict internal checkJs enough?**  
   There is no public library API today, mostly CLI/package files, so I lean no declarations.

4. **Should Playwright types be imported directly in JSDoc (`import('playwright-core').Page`) or should agbrowse define smaller `PageLike` / `LocatorLike` shapes?**  
   I recommend small local shapes for browser-context helpers and direct Playwright types only at CDP/page boundaries.

5. **Should `skills/browser/browser.mjs` be split before strict annotation?**  
   It is 2,087 LOC. Strict migration will be safer if command parsing and command execution are separated first, but that is a behavioral refactor risk.

6. **Should `web-ai/cli.mjs` be annotated in place or split first?**  
   It is 1,007 LOC and central to provider behavior. I recommend annotate in place first, split only after strict is green.

7. **Should `exactOptionalPropertyTypes` be enabled for JSDoc/checkJs?**  
   It may have lower impact than in `.ts`, but still catches object-shape mistakes. I recommend enabling it in P18 if diagnostics are meaningful.

8. **Should published `files` continue to include raw `devlog/`, `structure/`, and `vitest.config.mjs` after strict migration?**  
   Not directly a TypeScript issue, but if touching package metadata, this is the right time to confirm npm package contents.

---

## 6. Cross-reference to cli-jaw Strict Plan

Patterns I would reuse from `/Users/jun/Developer/new/700_projects/cli-jaw/devlog/_plan/strict-migration/`:

### Reuse

1. **Baseline gate discipline**  
   Source: `01-strategy.md` lines 40–56.  
   Reuse the rule that every phase must pass a strict baseline gate and may not introduce unsanctioned `any` / suppressions.

2. **Single-concern phase boundaries**  
   Source: `03-phases.md` lines 8–12 and 63–67 in `01-strategy.md`.  
   Reuse: each phase has one scope, one rollback envelope, and no mixed flag-flip + annotation work.

3. **Universal checklist**  
   Source: `04-checklist.md` lines 14–44.  
   Reuse the universal verify command pattern, adapted to agbrowse:
   - `npx tsc --noEmit -p tsconfig.strict.json`
   - `npm test`
   - `npm run test:smoke`
   - `npm run check:strict-baseline`

4. **Canonical type mini-phase idea**  
   Source: `phases/03-P00.5-cli-engine-discriminator.md`.  
   Reuse the concept, not the exact type. For agbrowse, early canonical unions should be:
   - `WebAiVendor`
   - `WebAiStatus`
   - tab/session status
   - attachment policy
   - trace record kind

5. **Browser / web-ai split**  
   Sources:
   - `phases/03-P13-browser-cdp.md`
   - `phases/03-P14a-web-ai-shared.md`
   - `phases/03-P14b-web-ai-chatgpt.md`  
   Reuse the split between browser primitives, shared web-ai infrastructure, and provider-specific files. agbrowse has almost the same conceptual surface, but paths are `skills/browser/` and `web-ai/`, not `src/browser/`.

6. **`exactOptionalPropertyTypes` last**  
   Source: `phases/03-P18-flip-exactoptionalpropertytypes.md`.  
   Reuse the ordering: exact optional should be after DTO/session/provider shapes are already annotated.

7. **P20 cleanup semantics**  
   Source: `phases/03-P20-cleanup-audit.md`.  
   Reuse:
   - remove all `@strict-debt`;
   - freeze baseline;
   - strengthen gate;
   - make strict regression permanent.

### Diverge

1. **Do not reuse cli-jaw’s full `.ts` conversion assumption.**  
   agbrowse is all `.mjs` and published directly from source. Use checkJs instead.

2. **Do not introduce `dist/` unless GPT Pro rejects strategy B.**  
   cli-jaw can tolerate compiled TS layout more naturally. agbrowse’s `bin` and `files` fields make `dist/` a release risk.

3. **Baseline script must count TypeScript diagnostics, not just textual `any`.**  
   cli-jaw’s explicit-any count was useful because it was already `.ts`. agbrowse’s debt is mostly implicit JS typing.

4. **Tests should become strict later than source.**  
   cli-jaw had separate source/frontend concerns. agbrowse’s tests are 77 of 162 files and import everything; strict-test inclusion should wait until source shapes stabilize.

5. **Provider phases should mirror npm CLI risk, not just code directory size.**  
   `web-ai/chatgpt.mjs`, `web-ai/gemini-live.mjs`, `web-ai/grok-live.mjs`, and `web-ai/cli.mjs` are user-visible automation surfaces. Keep each rollbackable.