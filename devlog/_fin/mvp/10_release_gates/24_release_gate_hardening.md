# Phase 23 — Release gate hardening

This slice makes the release path match the Phase 21 readiness contract and
the new `structure/` source-of-truth gates.

## Changes

- `scripts/release.sh` now runs:
  - `npm run docs:drift`
  - `npm run docs:counts`
  - `npm run test:eval-fixtures`
  - `npm run eval:web-ai:fixtures`
  - `git diff --check`
- `scripts/release-preview.sh` runs the same gates before pack/publish dry-run.
- Release and preview release commits now use the required `[agent]` prefix.
- `.github/workflows/release.yml` runs the same structure and fixture-eval
  gates before package verification.
- `.github/workflows/contract-drift.yml` watches `structure/**` so source of
  truth changes trigger drift checks.

## Verification

- `npm run docs:drift`
- `npm run docs:counts`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`
- `git diff --check`

## Follow-ups

- Add source-audit and MCP protocol gates after Phase 17 and Phase 18 land.
