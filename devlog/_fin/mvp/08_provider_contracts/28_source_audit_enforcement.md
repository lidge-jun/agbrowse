# Phase 27 — Source audit enforcement

This slice turns the Phase 17 source-audit helper into an opt-in CLI gate for
completed research answers.

## Changes

- Added `--require-source-audit` to `web-ai poll/query` result handling.
- Added `--source-audit-ratio`, `--source-audit-scope`, and
  `--source-audit-date` CLI options.
- Completed answers now attach `sourceAudit` when the audit passes.
- Unsourced claims, missing absence-claim scope/date, and invalid audit ratios
  fail closed with `source-audit.*` errors.
- Render/send results without answer text are not audited.
- Documented the source-audit workflow in README and runtime contracts.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-source-audit-home npx vitest run test/unit/web-ai-source-audit.test.mjs test/unit/web-ai-source-audit-enforcement.test.mjs --reporter=verbose`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-source-audit-home npx vitest run test/integration/web-ai-cli-contract.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Thread source-audit summaries into trace evidence without recording raw answer
  text.
- Add provider fixture cases that exercise copied markdown answers with source
  audit enabled.
