---
created: 2026-05-05
phase: P02
status: done
parent: ../01-strategy.md
gpt-pro-verdict: pending (round 3 — pre-merge sweep)
---
# P02 — bin shim contract

## Goal

Lock the shape of the published `bin/` shims so subsequent strict-migration
phases (P03 → P13) cannot accidentally break the npm publish contract.

## Invariants enforced

1. `package.json#bin` keys/values are exactly:
   - `agbrowse` → `bin/agbrowse.mjs`
   - `agbrowse-vision-click` → `bin/agbrowse-vision-click.mjs`
2. Each shim has `#!/usr/bin/env node` on line 1.
3. Each shim is a thin two-line file: shebang + a single relative `.mjs`
   import. No logic. No `.ts`, no transpile dependency, no
   `process.argv` parsing.
4. Each shim has the owner-executable bit set.
5. The skill entry imported by each shim resolves to a real `.mjs` file.
6. `package.json#files` matches the substrate-frozen array verbatim.

## Why these specific invariants

- The shim contract is the load-bearing constraint of the hybrid migration
  strategy (see `../01-strategy.md` and `../_gpt-pro-arbitration-r1.md`).
- If P04+ ever needs to ship transpiled output, the *test* must fail on the
  shim shape change so the phase doc explicitly proposes the new layout
  (P14 territory). No silent drift.
- The `files` array assertion mirrors the same intent for the publish
  manifest. Any addition or removal is a visible test failure.

## Artifact

- `test/integration/bin-shim-contract.test.mjs` — single contract test,
  6 assertions per shim + 2 package-level assertions.

## Gates (all green at HEAD)

- `npm run typecheck`        → ok
- `npm run check:strict-baseline` → ok (frozen floor unchanged)
- `npm run smoke:bins`       → ok
- `npm run pack:dry`         → 170 files (manifest unchanged)
- `npm test -- bin-shim-contract` → 8/8 pass

## Out of scope

- Loader/dist decisions (P14).
- Replacing the shim with a `.ts` entry point (P14).
- Testing actual subcommand behaviour beyond `--help` (covered by smoke +
  existing `cli-help.test.mjs`).
