# Phase 28 — ActionIntent target resolver

This slice starts Phase 16 without rewriting provider send paths. The existing
self-heal resolver remains the execution engine; new modules expose the
explicit contract boundary that cli-jaw can mirror.

## Changes

- Added `web-ai/action-intent.mjs` for serializable `ActionIntent` contracts:
  intent id, provider, operation, role/name hints, CSS fallbacks, required
  evidence, ambiguity policy, and confidence threshold.
- Added `web-ai/target-resolver.mjs` as an explainable wrapper around
  `resolveActionTarget()`.
- Resolver results now have a stable JSON-compatible shape with intent,
  selected target, confidence, resolution source, attempts, and error code.
- Added focused unit coverage for intent derivation, serialization,
  ambiguous matches, hidden targets, and successful CSS fallback resolution.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-resolver-home npx vitest run test/unit/action-intent.test.mjs test/unit/target-resolver.test.mjs test/unit/web-ai-self-heal.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Move provider composer/upload/copy/model actions onto `resolveTargetForIntent`
  incrementally.
- Mirror `ActionIntent` and resolver result shapes in cli-jaw TypeScript routes.
