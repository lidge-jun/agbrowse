# Phase 29 — ChatGPT composer resolver integration

This slice starts PR 16.2 with the smallest provider mutation path: ChatGPT
composer fill. It keeps the existing visibility preflight, then requires the
ActionIntent resolver to verify the actual composer target before text is
inserted.

## Changes

- `sendWebAi()` now resolves `composer.fill` through
  `resolveTargetForIntent()` before mutating the ChatGPT composer.
- Composer helpers accept a resolver-selected `composerTarget` and use that
  selector instead of re-running the legacy visible-selector search.
- ChatGPT semantic composer selectors now reuse the hardened
  `chatgpt-composer.mjs` selector list so resolver and live insertion do not
  drift.
- Resolver failures surface as `provider.composer-not-visible` with intent,
  attempted selector, confidence, and validation evidence.
- Fake ChatGPT integration coverage now asserts the resolver validation path
  runs before prompt insertion.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-chatgpt-resolver-home npx vitest run test/unit/web-ai-composer.test.mjs test/unit/action-intent.test.mjs test/unit/target-resolver.test.mjs test/integration/web-ai-fake-chatgpt.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Move ChatGPT send, upload, stop, copy, and model picker actions onto the same
  resolver contract.
- Repeat provider integration for Gemini and Grok after ChatGPT composer has
  stayed stable through full test gates.
