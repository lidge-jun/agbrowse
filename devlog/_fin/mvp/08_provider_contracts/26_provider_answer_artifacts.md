# Phase 25 — Provider answer artifacts

This slice threads the Phase 17 answer artifact contract into live provider poll
results without removing the legacy `answerText` field.

## Changes

- Added `withAnswerArtifact()` so provider results can attach normalized answer
  metadata in one place.
- ChatGPT, Gemini, and Grok poll success paths now return `answerArtifact`
  alongside `answerText`, `baseline`, `usedFallbacks`, and `warnings`.
- The artifact records provider, session, conversation URL, capture method,
  markdown/text payload, exactness score, response stable duration when known,
  and capture warnings.
- Updated the fake ChatGPT integration fixture to assert the new provider result
  contract while preserving the old `answerText` contract.
- Added a typedef for `AnswerArtifact` in `web-ai/types.mjs`.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-artifact-home npx vitest run test/unit/web-ai-answer-artifact.test.mjs --reporter=verbose`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-artifact-home npx vitest run test/integration/web-ai-fake-chatgpt.test.mjs --reporter=verbose`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-artifact-home npm run test:unit`
- `npm run test:eval-fixtures`
- `npm run docs:counts`
- `npm run docs:drift`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Add source-audit enforcement flags for research workflows.
- Mirror the `answerArtifact` output shape in cli-jaw after its browser route
  layer adopts the same provider result contract.
