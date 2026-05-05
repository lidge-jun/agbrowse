I have enough data. Producing the strategy report now.

---

# Strict-Migration Strategy — `agbrowse`

> Read-only analysis. Mirrors the cli-jaw `devlog/_plan/strict-migration/` layout. Drop this file in as `devlog/_plan/strict-migration/01-strategy.md` (with the diagnostic numbers split out into `00-diagnostic.md` once they're re-run on the day work starts).
> Repo: `/Users/jun/Developer/new/700_projects/agbrowse` · branch state inspected at HEAD on disk · `162` `.mjs` source files, ~`22.2k` LOC.

---

## 1. Repo structure summary

### 1.1 Top-level layout

```
agbrowse/
├── bin/                  2 .mjs   (thin shebang wrappers, ~1 line each)
├── skills/
│   ├── browser/          7 .mjs   (browser.mjs = 2087 LOC, the giant)
│   ├── vision-click/     2 .mjs   (+ SKILL.md)
│   └── web-ai/           SKILL.md only
├── web-ai/              50 .mjs in root + 21 in subdirs
│   ├── context-pack/     8 .mjs
│   ├── eval/             5 .mjs
│   ├── policy/           4 .mjs
│   └── trace/            4 .mjs
├── scripts/              2 .mjs + 2 .sh
├── benchmarks/agbrowse/  2 .mjs
├── test/
│   ├── unit/            54 .test.mjs
│   ├── integration/     14 .test.mjs
│   ├── helpers/          6 .mjs
│   ├── spec/             2 .test.mjs
│   ├── e2e/              1 .test.mjs (smoke)
│   ├── fixtures/         JSON/YAML/HTML
│   └── golden/           baselines
├── docs/, structure/, devlog/, assets/
├── package.json         "type":"module", bin points at .mjs files
├── vitest.config.mjs    include: test/**/*.test.mjs
└── (no tsconfig.json yet, no typescript dep)
```

### 1.2 Entry points

- `bin/agbrowse.mjs` → 1-line shebang + `import '../skills/browser/browser.mjs'` (the 2087-LOC dispatch tree).
- `bin/agbrowse-vision-click.mjs` → 1-line shebang + `import '../skills/vision-click/vision-click.mjs'`.
- Both shipped via `package.json` `bin` map. The `files` manifest publishes `bin/`, `skills/`, `web-ai/`, `benchmarks/`, `docs/`, `structure/`, `devlog/`, `vitest.config.mjs`. No `dist/`.

### 1.3 Module-count ranking (top runtime modules, source only)

| Path | LOC |
|---|---:|
| `skills/browser/browser.mjs` | 2087 |
| `web-ai/cli.mjs` | 1007 |
| `web-ai/gemini-live.mjs` | 619 |
| `web-ai/chatgpt.mjs` | 617 |
| `web-ai/chatgpt-model.mjs` | 603 |
| `web-ai/grok-live.mjs` | 486 |
| `web-ai/watcher.mjs` | 476 |
| `web-ai/self-heal.mjs` | 383 |
| `skills/browser/tab-manager.mjs` | 370 |
| `web-ai/chatgpt-composer.mjs` | 363 |

Anything `>500 LOC` is candidate for a phase split (mirror cli-jaw P10/P14 splitting rules).

### 1.4 Existing JSDoc surface

- `@ts-check` directives in source: **0** (only the test/skill JSDoc has scattered `@typedef` blocks).
- Source `@param` / `@returns` / `@type` annotations total: **~51** lines across the entire `.mjs` corpus.
- The richest typed module is `web-ai/types.mjs` (frozen-object enums + `@typedef` unions for `WebAiVendor`, `WebAiStatus`, `AttachmentPolicy`, `QuestionEnvelope`).

Implication: agbrowse is **not** a "JSDoc-typed JS" project. It is essentially **untyped JavaScript** with one canonical `types.mjs`. A migration is closer to ima2-gen's "flip strict in one pass" than to cli-jaw's "tighten the residual `any`s" — but the LOC is mid (22k), so a **phased rename + tsc emit** is still the right shape.

---

## 2. Test stack analysis

- Runner: **vitest `^3.2.4`** (single dev dep). Config: `test/**/*.test.mjs`, `fileParallelism: false`, 30s timeouts.
- All tests are `.mjs`, use `from 'vitest'` and import the production `.mjs` files via relative paths (e.g. `'../../web-ai/action-cache.mjs'`).
- Helpers in `test/helpers/` (`exec-browser.mjs`, `fixture-server.mjs`, `temp-env.mjs`, `snapshot-utils.mjs`) are spawned/forked subprocess-style.

### What needs to change

vitest **runs `.ts` natively via esbuild** — no extra dep needed. The migration cost on the test side is therefore:

| Concern | Action |
|---|---|
| File extension | Rename `*.test.mjs` → `*.test.ts` **only after** the imported source file has been renamed `.mjs`→`.ts`. Otherwise the import path breaks. |
| Vitest include glob | Update `vitest.config.mjs` (or rename to `.ts`) to match `test/**/*.test.{ts,mjs}` during the migration, then `*.test.ts` only at the end. |
| Subprocess helpers | `test/helpers/exec-*.mjs` use `node` to spawn the bin. They must keep loading the **published `.mjs` shape** (or whatever the post-build emit shape ends up being). Decision in §3. |
| Strict in tests | cli-jaw deferred test typechecking to a follow-up issue. **Recommend the same here**: add tests to the typecheck graph in a final phase (PNN-tests-strict) only. Do not block the main migration on test typing. |
| Fixture loading | JSON/YAML fixtures are loaded with `node:fs` — TS-agnostic, no change. |

**Bottom line**: tests need *minimal* config tweaks, not rewrites. Keep `.mjs` tests through P01–PNN-1; flip in the cleanup phase.

---

## 3. Build / transpile decision

### 3.1 Constraints

- `package.json` is `"private": false` with `publishConfig.access = "public"` — **published to npm**. Downstream consumers `import` from `agbrowse/web-ai/...` and run the `agbrowse` bin.
- `bin` map points directly at `.mjs` files in source. The `files` array publishes source `.mjs` verbatim — there is no current build.
- Engines: `node >= 18` only. No bundling, just ESM.
- Single runtime dep: `playwright-core ^1.58.2`. CDP is hand-rolled (`Runtime.evaluate` / `Page.*` / `DOM.*` calls visible across `web-ai/browser-primitives.mjs`, `skills/browser/*.mjs`).

### 3.2 Three options considered

| Option | Cost | Risk | Verdict |
|---|---|---|---|
| **A. Keep `.mjs`, add `@ts-check` + JSDoc only** (no rename) | LOW | Low for users, **HIGH** for migration: JSDoc generics + complex unions are painful, and you will hit ergonomic walls on `web-ai/cli.mjs` (1007 LOC dispatch). | Good as a P00.5 *baseline* gate, **not** as the end state. |
| **B. Rename `.mjs` → `.ts`, emit to `dist/`, repath `bin` and `files`** | MEDIUM | Single breaking change to publish layout (one major version bump). Standard. | **Recommended**. |
| **C. Rename `.mjs` → `.ts`, run via `tsx` shim in production bin** | LOW dev / **HIGH** runtime | Ships TS source + tsx runtime cost on every cold start. Unacceptable for a CLI binary. | Reject. |

### 3.3 Recommended strategy (Option B, with a JSDoc stepping stone)

```
P00     →  tsconfig.json (allowJs + checkJs + strict:false) + @ts-check baseline gate
P00.5   →  Canonical type module(s) — promote web-ai/types.mjs → web-ai/types.ts (sole .ts file)
P01     →  Add tsc build emitting to dist/<mirror layout>; keep src .mjs running for now;
            wire `npm run build`, but do NOT yet repoint bin
P02     →  Repoint bin and files manifest to dist/, ship a 0.2.0 preview, gate downstream consumers
P03..PNN→  Rename .mjs → .ts directory by directory, lock the JSDoc-baseline gate so it never regresses
PNN-flip→  Flip strict-family flags one at a time (mirror cli-jaw P15..P18)
```

The "JSDoc baseline first" stepping stone means **P01 doesn't break anyone** — every published file is still `.mjs` shape. Risk is concentrated at **P02** (publish layout flip), which is gated on a preview tag and a downstream consumer audit (see Risk #5).

---

## 4. Phase plan (P00.5 → P20)

> Mirrors cli-jaw structure: each phase = single concern, single PR, independently mergeable, target branch `chore/strict-migration`. "Expected new errors" estimates assume the previous phase has merged.

| Phase | Scope (files) | tsconfig flip | Expected new errors | Success gate |
|---|---|---|---:|---|
| **P00** Diagnostic + CI baseline | `scripts/check-strict-baseline.mjs` (new), `docs/migration/strict-baseline.md` (new). Counts JSDoc gaps, `any`-shape baseline (will be 0 since no TS yet — instead count un-`@ts-check`'d files), file-count floor. NO source touched. | none | 0 | `npm test` green; new gate self-passes; PR in CI lists `check:strict-baseline`. |
| **P00.5** Canonical type module | Promote `web-ai/types.mjs` → `web-ai/types.ts`. Convert frozen-object enums to `as const` + literal-union `type`. Re-export. All consumers keep working (tsc emits identical `.mjs` to dist/ in P01; until then, leave a `.mjs` re-export shim). | none | <5 | typecheck of *just* `types.ts` via local `tsc --noEmit` script; vitest still green. |
| **P01** Add `tsc` build pipeline | Add `typescript`, `@types/node` devDeps. Add `tsconfig.json` (`allowJs:true`, `checkJs:true`, `strict:false`, `noEmit:false`, `outDir:"dist"`, `rootDir:"."`). Add `npm run build` + `npm run typecheck`. **Do not yet repoint bin.** Add JSDoc-gap regression gate. | `allowJs`, `checkJs`, `strict:false` | ~30 (latent JSDoc errors surface) | typecheck exit 0; tests green; `dist/` parity audit (`diff -r` of `.mjs` source vs emitted `.mjs`). |
| **P02** Repoint `bin` + `files` to `dist/` | `package.json`: `bin.agbrowse → dist/bin/agbrowse.mjs`; `files: [dist/, README.md, ...]`. Bump version `0.2.0-preview`. Add `prepublishOnly: npm run build && npm test`. | none | 0 | `npm pack` produces correct tarball; smoke install in tmp dir; `agbrowse --help` works; downstream consumer audit (see Risk #5). |
| **P03** Convert `bin/` + `scripts/` (4 files) | Rename `bin/*.mjs` → `bin/*.ts`, `scripts/render-trace-report.mjs` + `scripts/run-web-ai-eval.mjs` → `.ts`. Shebangs preserved by tsc `// @ts-nocheck`-free emit (sanity check). | none | <10 | bin smoke; eval script smoke. |
| **P04** Convert `skills/vision-click/` (2 files) | `vision-click.mjs`, `vision-core.mjs` → `.ts`. Cold module, low CDP surface. | none | ~20 | unit `test/unit/vision-core.test.mjs` green; e2e smoke. |
| **P05** Convert `skills/browser/` core (7 files) | `browser-core.mjs`, `profile-lock.mjs`, `tab-manager.mjs`, `tab-monitor.mjs`, `tab-lifecycle.mjs`, `skill-install.mjs`. **Defer `browser.mjs` (2087 LOC)** to P05b. | none | ~80 | tests `browser-core`, `tab-lifecycle`, `profile-lock` green. |
| **P05b** Convert `skills/browser/browser.mjs` | The 2087-LOC dispatcher. Split into a folder of `.ts` files **before** type annotation if diff exceeds 500 lines. | none | ~120 | full browser test suite + manual `agbrowse status` smoke. |
| **P06** Convert `web-ai/` foundations | `types.ts` already done (P00.5). Convert `errors.mjs`, `constants.mjs`, `dom-hash.mjs`, `ref-registry.mjs`, `action-trace.mjs`, `action-intent.mjs`, `action-cache.mjs`, `cache-metrics.mjs` (the cold leaves). | none | ~40 | corresponding unit tests green. |
| **P07** Convert `web-ai/policy/` + `web-ai/trace/` | 4 + 4 files. Tightly-scoped sub-namespaces. | none | ~30 | `test:trace-policy` script green. |
| **P08** Convert `web-ai/eval/` + `web-ai/context-pack/` | 5 + 8 files. Mostly pure functions over fixtures. | none | ~40 | `test:eval` + `eval:web-ai:fixtures` smoke. |
| **P09** Convert `web-ai/` browser primitives & session layer | `browser-primitives.mjs`, `ax-snapshot.mjs`, `target-resolver.mjs`, `observe-targets.mjs`, `post-action-assert.mjs`, `session.mjs`, `session-store.mjs`, `tab-pool.mjs`, `tab-lease-store.mjs`, `tab-recovery.mjs`, `tab-finalizer.mjs`, `active-command-store.mjs`. The CDP-touching core. | none | ~150 | `test:smoke` (self-heal) green; live browser smoke (Backend employee verifies). |
| **P10** Convert `web-ai/` provider — ChatGPT | `chatgpt.mjs`, `chatgpt-model.mjs`, `chatgpt-composer.mjs`, `chatgpt-attachments.mjs`. Hot file group. | none | ~80 | `web-ai-composer`, `chatgpt-attachments` tests green; live ChatGPT round-trip via fixture. |
| **P11** Convert `web-ai/` provider — Gemini | `gemini-live.mjs`, `gemini-model.mjs`. | none | ~60 | gemini live test green. |
| **P12** Convert `web-ai/` provider — Grok | `grok-live.mjs`, `grok-model.mjs`. | none | ~50 | grok live policy test green. |
| **P13** Convert remaining `web-ai/` (cli, mcp, doctor, watcher, audit) | `cli.mjs` (1007), `mcp-server.mjs`, `mcp-state.mjs`, `tool-schema.mjs`, `browser-tool-schema.mjs`, `vendor-editor-contract.mjs`, `contract-audit.mjs`, `source-audit.mjs`, `answer-artifact.mjs`, `copy-markdown.mjs`, `doctor.mjs`, `watcher.mjs`, `eval-runner.mjs`, `cli-sessions.mjs`, `capability.mjs`, `churn-log.mjs`, `question.mjs`, `self-heal.mjs`. **Split into P13a (cli.mjs alone), P13b (mcp/tool-schema), P13c (the rest)** if diff > 500 lines. | none | ~250 | full vitest suite + `test:mcp` + `test:source-audit`. |
| **P14** Convert `test/helpers/` + `benchmarks/` | 6 + 2 files. Test-side helpers and benchmark scaffolding. | none | ~20 | full vitest. |
| **P15** Convert `test/**/*.test.mjs` to `.test.ts` | 71 test files. Bulk rename. Update `vitest.config` include glob. JSDoc on test helpers becomes redundant. | none | ~80 (in tests only) | full vitest; coverage delta < 1%. |
| **P16** Flip `strict: true` (master switch) | Enables `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `alwaysStrict`, `useUnknownInCatchVariables`, `noImplicitThis`. The big one. | `strict:true` | **300–500** | typecheck must reach 0 within the phase (split P16a/b/c by dir if needed). |
| **P17** Flip `noUncheckedIndexedAccess` | Surfaces `arr[i]` returning `T \| undefined`. Bites all CDP response unwrapping. | `noUncheckedIndexedAccess` | ~80 | typecheck 0; tests green. |
| **P18** Flip `noImplicitOverride` + `noFallthroughCasesInSwitch` + `noImplicitReturns` | Bundle three control-flow flags (cli-jaw P15+P16 pattern). | three flags | ~20 | typecheck 0. |
| **P19** Flip `noPropertyAccessFromIndexSignature` | Forces bracket access on dynamic CDP shapes / ref registries. | one flag | ~50 | typecheck 0. |
| **P20** Flip `exactOptionalPropertyTypes` | The hardest flag. Will surface `{ x?: T }` vs `{ x: T \| undefined }` mismatches across CDP responses, vendor adapters. Split by dir if diff > 600 lines (P20a `web-ai/`, P20b `skills/browser/`, P20c `bin`+`scripts`). | one flag | ~150 | typecheck 0; full e2e. |
| **P21** Cleanup + audit | Remove `// @strict-debt` markers; `allowJs:false`, `checkJs:false`; delete dead `.mjs` re-export shims; update `docs/migration/strict-baseline.md`; lock the regression gate; bump version `0.3.0`. | `allowJs:false`, `checkJs:false` | 0 | full CI; package smoke install; downstream consumer re-audit. |

> Estimated total: **22 phases**, 60–110 autonomous-agent-hours. Roughly mirrors cli-jaw's 56–100h band, scaled down for the smaller LOC but up for the JS→TS rename overhead that cli-jaw didn't pay.

---

## 5. Risk table (top 10)

| # | Risk | Where it bites | Mitigation |
|---|---|---|---|
| 1 | **Dynamic CDP responses** — `Runtime.evaluate`, `DOM.getDocument`, etc. return effectively-`unknown` shapes hand-massaged across `web-ai/browser-primitives.mjs`, `web-ai/ax-snapshot.mjs`, `skills/browser/browser.mjs`. | P09, P17, P19, P20 | Define a `cdp-types.ts` namespace early in P00.5/P09 with conservative `unknown` + narrow guards. Don't lean on `@types/playwright-core` CDP surface — it's intentionally minimal. |
| 2 | **`skills/browser/browser.mjs` is 2087 LOC** with deep CLI dispatch trees. | P05b | Mandatory pre-rename split into a folder-of-files. Do this in a *non-typing* PR (P05a) before P05b. |
| 3 | **JSDoc accuracy is low** (~51 annotations across 162 files). The `checkJs` baseline in P01 will flush out latent bugs, not just type gaps. | P01, P03+ | Treat first-30 surfaced `checkJs` errors as *bugs to triage*, not type debt. Some will be real. Allocate buffer. |
| 4 | **Vitest TS interop on subprocess helpers** — `test/helpers/exec-browser.mjs` spawns the bin and reads NDJSON. After P02, the bin path lives in `dist/`, so the helper must resolve `dist/bin/...`. | P02, P14 | Centralize the bin resolution in one helper (`resolveBinPath()`); update once at P02. |
| 5 | **Downstream consumers** — `agbrowse` is a published npm package. Repointing `bin`/`files` to `dist/` in P02 is a publish-shape break. | P02, P21 | (a) Ship `0.2.0-preview` not `0.2.0`. (b) Audit github code-search for `from 'agbrowse/`. (c) Add a one-version `.mjs` re-export shim that re-exports from `dist/` for the deprecated path. (d) Document the path change in `CHANGELOG.md`. |
| 6 | **Bin shebang preservation** — tsc emits `.mjs` from `.ts` but does NOT preserve `#!/usr/bin/env node`. | P03 | Use `tsc` with a postbuild script (`scripts/add-shebang.mjs`) that prepends shebang and `chmod +x` to the two emitted bin files. Alternative: keep bin as a 1-line `.mjs` wrapper that imports the compiled entry. **Recommended: keep wrapper**. |
| 7 | **Hot-churn directories** — `web-ai/` providers churn weekly (per cli-jaw's evidence; agbrowse mirrors that pattern with chatgpt/gemini/grok). | P10, P11, P12 | One provider per phase, no cross-cutting change. Rebase `chore/strict-migration` daily. |
| 8 | **Vitest config rename** — converting `vitest.config.mjs` → `.ts` requires a `vitest/config` types import; getting that wrong silently disables the strict glob. | P15 | Convert config in its own micro-PR with a config-only smoke (`vitest list`) gate. |
| 9 | **`exactOptionalPropertyTypes` blast radius** on CDP optional fields (`ariaLabel?`, `bounds?`, `loaderId?`). | P20 | Split P20 by directory (mirror cli-jaw P18a/b/c). Allow per-call-site fixes inside the phase, contrary to "no mixed-concern" rule. |
| 10 | **Test fixtures** under `test/fixtures/` (JSON, YAML, HTML) loaded by string path — invisible to typecheck, easy to break paths during dir restructure. | P09, P15 | Audit fixture paths before P09 (any rename of a *helper* doesn't move fixtures, but tsc emit + `dist/` path *might* if rootDir is chosen wrong). Use `rootDir:"."` and emit only source files (exclude `test/fixtures/**`). |

---

## 6. Reference: cli-jaw plan layout to mirror

Files under `/Users/jun/Developer/new/700_projects/cli-jaw/devlog/_plan/strict-migration/`:

```
00-diagnostic.md              — numbers-only baseline (any counts, hot-dir map, churn 7d)
01-strategy.md                — branching, CI gate, rollback, freeze windows, effort estimate
02-ndjson-union-design.md     — design doc for the central type union (cli-jaw-specific)
03-phases.md                  — P00 → P20 phase index, ~one screen per phase
04-checklist.md               — linear tickable rows, universal verify command set
05-decision-required.md       — open questions (must be answered before specific phases start)
06-pro-review-r1.md           — GPT Pro review round 1 (introduces P00.5 mini-phase)
07-pro-review-r2.md           — GPT Pro review round 2
phases/                       — one detailed file per phase (~200–500 lines each)
    03-P00-ci-strict-gates.md
    03-P00.5-cli-engine-discriminator.md
    03-P01-types-lib.md
    03-P02-src-core.md
    03-P03-messaging-discord-security.md
    03-P04-telegram.md
    03-P05-memory-prompt.md
    03-P06-orchestrator-utils.md
    03-P07-orchestrator-state-machine.md
    03-P08-manager-backend.md
    03-P09-routes.md
    03-P10a-src-cli.md / 03-P10b-bin.md           ← phase-split convention (a/b/c)
    03-P11a-cli-events-types.md / 03-P11b-events-ts-annotation.md / 03-P11c-acceptance-gate.md
    03-P12a-spawn-copilot.md / 03-P12b-spawn-rest.md
    03-P13-browser-cdp.md
    03-P14a-web-ai-shared.md / 03-P14b-…chatgpt / 03-P14c-…gemini / 03-P14d-…grok / 03-P14e-…utils
    03-P15-flip-noimplicitoverride.md
    03-P16-flip-nopropertyaccessfromindexsignature.md
    03-P17-flip-control-flow-bundle.md
    03-P18-flip-exactoptionalpropertytypes.md (+ 03-P18a/b/c by dir)
    03-P19-frontend-strict-flags.md
    03-P20-cleanup-audit.md
```

### Naming convention to mirror in agbrowse

- Top-level docs: `NN-kebab-name.md` where `NN` is sortable index (`00`, `01`, …).
- Per-phase docs: `phases/03-P##-kebab-scope.md` (the leading `03-` echoes that they belong under `03-phases.md` index).
- Phase splits use lowercase letter suffix: `03-P10a-src-cli.md`, `03-P10b-bin.md`.
- Each phase doc is structured: `1. Goal · 2. Scope (in/out) · 3. Inventory · 4. Per-file diff plan · 5. Verification gate · 6. Rollback test · 7. Notes`.
- Phase docs are **plan-only** ("No source code is changed by this document") until execution.

### Recommended agbrowse tree (drop in as-is)

```
devlog/_plan/strict-migration/
    00-diagnostic.md            ← rerun on day-of with fresh counts
    01-strategy.md              ← THIS document
    02-build-pipeline-design.md ← agbrowse-specific: mirrors cli-jaw's NDJSON design doc.
                                  Decides: tsc emit layout, dist/ shape, bin shebang, publish flip.
    03-phases.md                ← table from §4 above, expanded
    04-checklist.md             ← linear rows + universal verify command
    05-decision-required.md     ← e.g. "Major version bump at P02 or stay 0.x?", "Drop @ts-check on
                                  unconverted .mjs once strict is on?", "Tests in typecheck graph at
                                  P15 or P21?"
    06-pro-review-r1.md         ← GPT Pro pass after 02 + 03 written
    phases/
        03-P00-ci-strict-gates.md
        03-P00.5-types-canonical.md
        03-P01-tsc-build-pipeline.md
        03-P02-publish-shape-flip.md
        03-P03-bin-scripts-convert.md
        03-P04-vision-click-convert.md
        03-P05a-browser-mjs-split.md
        03-P05b-browser-mjs-convert.md
        03-P06-web-ai-foundations.md
        03-P07-web-ai-policy-trace.md
        03-P08-web-ai-eval-context-pack.md
        03-P09-web-ai-browser-session.md
        03-P10-provider-chatgpt.md
        03-P11-provider-gemini.md
        03-P12-provider-grok.md
        03-P13a-web-ai-cli.md
        03-P13b-web-ai-mcp.md
        03-P13c-web-ai-rest.md
        03-P14-test-helpers-benchmarks.md
        03-P15-tests-rename-ts.md
        03-P16-flip-strict-master.md (+ 16a/b/c if needed)
        03-P17-flip-noUncheckedIndexedAccess.md
        03-P18-flip-control-flow-bundle.md
        03-P19-flip-noPropertyAccessFromIndexSignature.md
        03-P20-flip-exactOptionalPropertyTypes.md (+ 20a/b/c)
        03-P21-cleanup-audit.md
```

---

## 7. Things to decide before writing `02-build-pipeline-design.md`

Borrowed from cli-jaw's `05-decision-required.md` discipline. None of these can be guessed silently:

1. **Major-version bump?** P02 is a publish-shape break. `0.2.0-preview` (recommended) vs `1.0.0`?
2. **Bin strategy:** keep 1-line `.mjs` shebang wrapper that imports `dist/...`, or fully rebuild bin from TS via shebang-prepend script?
3. **Dist layout:** `dist/<mirror-of-source>` (so paths stay parallel) or `dist/` flat? Recommendation: mirror.
4. **JSDoc gate scope:** does `checkJs` apply to test `.mjs` during P01–P14 or only source? Recommendation: source only, test flip happens in P15.
5. **Tests in typecheck graph:** P15 (when renamed) or P21 (cleanup, with their own tsconfig)? Recommendation: P15.
6. **Strict-debt marker convention:** `// @strict-debt(P##): reason` (mirror cli-jaw) — adopt verbatim, or new prefix `@agb-strict-debt`?
7. **`@types/node`:** pin to a specific Node 18.x DT version vs `^20.x`? Repo declares `engines: node>=18`.
8. **Re-export shim removal:** at P21 (recommended) or hold one minor version after P02 for downstream grace period?

---

*End of strategy. Ready to drop into `agbrowse/devlog/_plan/strict-migration/01-strategy.md` after running `scripts/check-strict-baseline.mjs` (P00) for fresh §1.4 numbers on the actual migration day.*