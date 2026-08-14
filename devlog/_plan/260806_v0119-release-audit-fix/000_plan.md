# 000 — v0119-release-audit-fix: Plan

> DIFFLEVEL-ROADMAP-01: write this doc to full diff-level precision (exact paths,
> NEW/MODIFY/DELETE, before/after diffs) BEFORE P -> A. An empty scaffold does not
> satisfy the rule; the A-phase reviewer FAILS outline-only phase docs.

## Objective

Repair the failed v0.1.19 release. Observed failure: `origin/main` HEAD is
`1463a53 release: v0.1.19` (2026-07-28) but npm serves 0.1.18 and no `v0.1.19`
tag/GitHub release exists. Release workflow run `30305274558` (workflow_dispatch,
2026-07-27) failed at the `Audit` step: `npm audit --audit-level=high` exit 1 on:

- `brace-expansion <=5.0.7` (high) — transitive via `archiver -> archiver-utils
  -> glob -> minimatch` and `archiver -> readdir-glob -> minimatch`
- `postcss <=8.5.22` (high) — transitive via `vitest -> vite` (dev-only)
- `esbuild 0.27.3-0.28.0` (low) — dev-only, below the high gate, non-blocking

P-phase evidence: in a detached worktree of `origin/main`
(`$TMPDIR/tmp.EWNMJnxRwX/main-check`), `npm audit fix` yields a
package-lock.json-only change (20 lines) and `npm audit --audit-level=high`
then exits 0. No `package.json` change; all bumps stay inside existing ranges.

Outcome: lockfile fix committed and pushed to `origin/main`, Release workflow
re-dispatched (`version=0.1.19`, `tag=latest`, `dry-run=false`) and green,
`npm view agbrowse version` == `0.1.19`, GitHub `v0.1.18` Latest replaced by
`v0.1.19` (workflow pushes the tag/release on successful publish).

User authorization: "너가 고쳐서 보내" — push to main and the real publish are
explicitly approved for this unit.

## Loop-spec

- Loop archetype: verifier-defined (spec-satisfaction repair; CI + npm registry
  state are the verifiers)
- Write scope: `package-lock.json` on `main` checkout only; devlog unit docs.
  Out-of-scope: `dev` branch (241 commits ahead), source code, `package.json`
  ranges, the esbuild low advisory.
- Budget / bounds: one release-workflow dispatch (~5 min run); if the run fails
  twice on new causes, stop and report NEEDS_HUMAN.

## Work-phase map (one phase = one full PABCD cycle)

| WP | Doc | Slice | Depends on |
|----|-----|-------|------------|
| wp1 | 010 | lockfile audit fix -> push main -> dispatch release -> verify publish | — |

## Accept criteria

- c1: `npm audit --audit-level=high` exits 0 on the pushed main tree.
- c2: Release workflow run (dispatch, dry-run=false) concludes success.
- c3: `npm view agbrowse version` returns `0.1.19`.
- c4: `v0.1.19` tag + GitHub release exist and are Latest.
