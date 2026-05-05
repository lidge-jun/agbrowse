---
created: 2026-05-05
status: done
tags: [agbrowse, strict-migration, typescript]
---
# P00 — strict tooling baseline

## Goal

Land the strict-migration substrate without touching runtime: `tsconfig.json`, `types/agbrowse-shared.d.ts`, `scripts/check-strict-baseline.mjs`, `scripts/smoke-bins.mjs`, and `docs/migration/strict-baseline.md`. Wire `npm` scripts that every later phase depends on. No `.mjs` is converted in this phase.

## Files added

| Path | Purpose |
|---|---|
| `tsconfig.json` | Root strict config: `strict:true`, `noEmit:true`, `module:NodeNext`, `target:ES2022`. Includes `types/`, `bin/`, `web-ai/`, `scripts/`, `test/` for `.ts`/`.mts`/`.cts` only. Excludes `**/*.mjs`, `**/*.js` so `.mjs` is structurally unchecked until per-file conversion. |
| `types/agbrowse-shared.d.ts` | Shared boundary types: `Json`, `JsonObject`, `CliResult<T>`, `VendorTabRef`. First strict surface for cross-module shapes. |
| `scripts/check-strict-baseline.mjs` | Counts `\bany\b` and `@strict-debt` per tracked dir; runs `tsc --noEmit`; fails on regression. |
| `scripts/smoke-bins.mjs` | Execs both bin shims with `--help`; fails on missing executable bit, non-zero exit, or missing CLI banner. |
| `docs/migration/strict-baseline.md` | Frozen floor: all tracked dirs at `any=0, debt=0, allow=0`. |

## package.json scripts added

```json
"typecheck": "tsc --noEmit",
"check:strict-baseline": "node scripts/check-strict-baseline.mjs",
"pack:dry": "npm pack --dry-run --json",
"smoke:bins": "node scripts/smoke-bins.mjs"
```

## devDependencies added

- `typescript@^5.6.0`
- `@types/node@^20.0.0`

## Invariants held

- `package.json#bin` unchanged.
- `package.json#files` manifest unchanged (verified by `pack:dry`: 170 files, same categories).
- Both bin shims keep shebang + executable bit (verified by `smoke:bins`).
- No `dist/` directory shipped.

## Verification (HEAD on `chore/strict-migration`)

```bash
npm run typecheck             # → ok (no .ts files yet, no errors)
npm run check:strict-baseline # → ✅ strict-baseline OK
npm run smoke:bins            # → ✓ bin/agbrowse.mjs --help ok / ✓ bin/agbrowse-vision-click.mjs --help ok
npm run pack:dry              # → 170 files, 348185 bytes, manifest unchanged
npm test                      # → 463 passed | 12 skipped (475 total), 68 files passed | 2 skipped
```

All gates GREEN. P00 complete.
