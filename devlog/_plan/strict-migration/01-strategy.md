---
created: 2026-05-05
status: approved
tags: [agbrowse, strict-migration, typescript]
gpt-pro-verdict: PASS (round 1)
---
# Strategy — agbrowse TypeScript-strict migration

## Decision (GPT Pro round 1: PASS)

**Hybrid: A-types, B-package-surface.**

- Migrate source `.mjs` → `.ts` incrementally with `tsc --noEmit` strict checking (Plan A's type model).
- Keep `bin/agbrowse.mjs` + `bin/agbrowse-vision-click.mjs` as stable shebang shims and keep the published `files` manifest unchanged (Plan B's package surface).
- Only **P14+** may decide runtime/publish layout (loader vs. generated `.mjs` vs. approved `dist/`), gated by `npm pack` + install smoke.

This mirrors the proven cli-jaw `chore/strict-migration` shape: `.ts` source, `.mjs` bin shims, `tsc --noEmit`, no emitted `dist/`.

## Why hybrid (condensed from arbitration)

- Plan A (full `.mjs` → `.ts` + `dist/` repath) reaches real `.ts` fastest but moves the npm `bin` target — a publish-contract break for current consumers of `bin/agbrowse.mjs`.
- Plan B (JSDoc + `checkJs`) preserves the package surface but requires 162 files of `@param/@type` annotations before yielding a useful internal type model, and JSDoc remains second-class for advanced strict patterns.
- Hybrid keeps the package surface stable while giving us native `.ts` types incrementally. Full GPT Pro arbitration: `_gpt-pro-arbitration-r1.md`.

## Hard invariants (P00.5 → P13)

1. `package.json#bin` unchanged.
2. `package.json#files` manifest unchanged.
3. Bin shebangs preserved + executable bits intact.
4. `npm test` (vitest) green after every phase.
5. No shipped `dist/`.
6. Each new `.ts` file has zero `tsc --noEmit` errors at phase exit.
7. Any new runtime dependency requires explicit phase approval.

## Tooling baseline (introduced in P00)

- `tsconfig.json` at root: `strict: true`, `noEmit: true`, `allowJs: true`, `checkJs: false` (we type `.ts` only; `.mjs` is structural until each file is converted).
- `tsconfig.frontend.json`: not needed (agbrowse has no frontend bundle).
- `scripts/check-strict-baseline.mjs`:
  - Runs `tsc --noEmit` at root.
  - Counts `\bany\b` occurrences and `@strict-debt` markers per directory.
  - Compares against frozen floor in `docs/migration/strict-baseline.md`.
- `package.json#scripts`:
  - `typecheck`: `tsc --noEmit`
  - `check:strict-baseline`: `node scripts/check-strict-baseline.mjs`
  - `pack:dry`: `npm pack --dry-run --json`
  - `smoke:bins`: smoke test that both bin shims exec and respond to `--help`.

## 20-phase plan (titles from GPT Pro arbitration)

| Phase | File | Scope |
|---|---|---|
| P00.5 | `00-diagnostic.md` | Freeze repo shape, bin paths, manifest, vitest baseline. |
| P00 | `phases/03-P00-strict-tooling-baseline.md` | tsconfig + typecheck/pack:dry/smoke scripts + strict-baseline tracker. |
| P01 | `phases/03-P01-jsdoc-bridge-and-type-inventory.md` | Minimal JSDoc bridge typedefs; inventory implicit-any/unsafe boundary hotspots. |
| P02 | `phases/03-P02-bin-shim-contract.md` | Lock both bin shims with shebang + executable + smoke coverage. |
| P03 | `phases/03-P03-module-graph-and-import-extensions.md` | Map `.mjs` import graph; classify leaf modules safe for `.ts` conversion. |
| P04 | `phases/03-P04-leaf-utils-to-ts.md` | Convert leaf utility modules to `.ts`; preserve runtime via shims/tests. |
| P05 | `phases/03-P05-config-and-cli-parser-types.md` | Type argv/env/config/option-normalization paths. |
| P06 | `phases/03-P06-filesystem-and-asset-types.md` | Type fs/path/`import.meta.url`/asset-resolution boundaries. |
| P07 | `phases/03-P07-browser-session-types.md` | Type browser/session lifecycle + async resource ownership. |
| P08 | `phases/03-P08-action-command-types.md` | Type command/action plans, execution results, validation. |
| P09 | `phases/03-P09-vision-click-types.md` | Type vision-click pipeline + bin integration + image/coord shapes. |
| P10 | `phases/03-P10-skills-web-ai-types.md` | Type `skills/` + `web-ai/` interfaces and serialized contracts. |
| P11 | `phases/03-P11-test-fixture-types.md` | Type test helpers/fixtures; `.mjs` tests stay unless conversion required. |
| P12 | `phases/03-P12-error-event-result-types.md` | Typed errors/events/result unions/logging payloads. |
| P13 | `phases/03-P13-strictness-ratchet.md` | Ratchet stricter compiler options; remove temporary any/unknown. |
| P14 | `phases/03-P14-runtime-loader-or-build-decision.md` | Decide publish runtime: loader dep vs generated `.mjs` vs `dist/`. |
| P15 | `phases/03-P15-declaration-output-and-types-field.md` | Generate/validate `.d.ts` for any supported import surface. |
| P16 | `phases/03-P16-npm-pack-install-smoke.md` | `npm pack` + local/global install + bin smoke on supported Node versions. |
| P17 | `phases/03-P17-downstream-consumer-audit.md` | CLI use, deep-import audit, examples, semver impact. |
| P18 | `phases/03-P18-release-go-no-go.md` | Final typecheck + vitest + pack + smoke + changelog + version + publish decision. |

## Phase rule

Go only when typecheck, vitest, and package-surface invariants remain green.
No-Go on bin path drift, unreviewed manifest drift, or unproven published runtime.

## First-three-phases gates

**P00.5 — preflight repo shape**
- `npm test` exits 0 (baseline).
- No `.ts` rename, no `dist/`, no bin repath, no manifest change.
- `bin/agbrowse.mjs`, `bin/agbrowse-vision-click.mjs` remain bins; both `--help` works.

**P00 — strict tooling baseline**
- `npm run typecheck` (i.e. `tsc --noEmit`) exits 0.
- `npm test` exits 0.
- `npm run pack:dry` exits 0 and shows the same manifest categories as before (no `dist/`).
- `scripts/check-strict-baseline.mjs` runs and emits the frozen floor.

**P01 — JSDoc bridge + type inventory**
- `npm run typecheck`, `npm test`, `npm run pack:dry`, `npm run smoke:bins` all exit 0.
- New `types/` directory contains `agbrowse-shared.d.ts` (or equivalent) with shared boundary typedefs only.
- `docs/migration/strict-baseline.md` lists the inventory of implicit-any/unsafe boundary hotspots.
- No `.mjs` → `.ts` rename starts here. JSDoc remains a bridge, not the endpoint.

## References

- cli-jaw plan: `/Users/jun/Developer/new/700_projects/cli-jaw/devlog/_plan/strict-migration/`
- GPT Pro arbitration: `_gpt-pro-arbitration-r1.md`
- Sub-agent inputs: `_subagent-opus-4.7-analysis.md`, `_subagent-gpt-5.5-analysis.md`
