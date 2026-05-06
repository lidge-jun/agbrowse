# Phase 24 — Answer artifact and source audit foundation

This slice starts Phase 17 without touching live provider mutation paths.

## Changes

- Added `web-ai/answer-artifact.mjs` to normalize provider poll output into a
  portable answer artifact shape.
- Added `web-ai/source-audit.mjs` for fixture/unit source coverage checks:
  claims, sourced claims, unsourced claims, source quality rows, and gaps.
- Added unit coverage for answer artifact exactness, text-safe summaries,
  inline source extraction, unsourced claim detection, and absence-claim scope
  requirements.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-unit-home npx vitest run test/unit/web-ai-answer-artifact.test.mjs test/unit/web-ai-source-audit.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`

## Follow-ups

- Add `--require-source-audit` for Grok research responses.
- Thread answer artifacts into provider poll/query results after compatibility
  review with cli-jaw.
