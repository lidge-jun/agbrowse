---
created: 2026-05-05
status: done
tags: [agbrowse, strict-migration, typescript]
---
# P00.5 — Diagnostic baseline

Read-only diagnostic snapshot of the agbrowse repo at the moment strict migration started. Mirrors cli-jaw `devlog/_plan/strict-migration/00-diagnostic.md`.

## Repo shape (HEAD on `chore/strict-migration`)

| Metric | Count |
|---|---:|
| `.mjs` source files (non-node_modules) | 162 |
| `.ts` files | 0 |
| `.js` files | 0 |
| Test files (`test/**/*.test.mjs`) | 77 |
| Top-level dirs in `files` manifest | README.md, bin/, skills/, web-ai/, benchmarks/, docs/, structure/, devlog/, vitest.config.mjs |

## Bin entry points (immutable until P14)

- `bin/agbrowse.mjs` — primary CLI, has `#!/usr/bin/env node` shebang.
- `bin/agbrowse-vision-click.mjs` — vision-click sub-CLI.
- `package.json#bin`: `{"agbrowse":"bin/agbrowse.mjs","agbrowse-vision-click":"bin/agbrowse-vision-click.mjs"}`.
- These paths are a **package contract**. Any change is a publish-surface break and is gated to **P14+** behind `npm pack`/`install` smoke.

## Test stack

- `vitest run --reporter=verbose` (see `package.json#scripts.test`).
- Vitest natively transpiles `.ts` via esbuild — no extra rig needed when we add `.ts` source files.
- Tests stay `.mjs` until P11 (`03-P11-test-fixture-types.md`).

## Existing strict-typing surface

- Zero `@param`, `@returns`, `@type` JSDoc annotations across 162 source `.mjs` files.
- No `tsconfig.json` exists.
- No `scripts/check-strict-baseline.mjs`-equivalent.

## Engines

- `node>=18`, `type:module`, ESM-only.
- Native Node TypeScript stripping is **not relied on**: published runtime stays `.mjs` until P14 decides loader strategy.

## Frozen invariants for P00.5..P13

1. `package.json#bin` paths unchanged.
2. `package.json#files` manifest unchanged.
3. `bin/*.mjs` shebangs preserved and executable.
4. `vitest run` passes after every phase.
5. No `dist/` directory shipped.
6. No new runtime dependency added without explicit phase approval.

## Verification (run during P00.5)

```bash
cd /Users/jun/Developer/new/700_projects/agbrowse
node --version          # >= v18
ls bin/                 # agbrowse.mjs, agbrowse-vision-click.mjs both present
head -1 bin/agbrowse.mjs                     # #!/usr/bin/env node
head -1 bin/agbrowse-vision-click.mjs        # #!/usr/bin/env node
test -x bin/agbrowse.mjs && echo OK
test -x bin/agbrowse-vision-click.mjs && echo OK
npm test                # baseline: all green
./bin/agbrowse.mjs --help | head -5    # CLI responds
```

All P00.5 checks must PASS before P00 begins. No source code is changed by this phase.
