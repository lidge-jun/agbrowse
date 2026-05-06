# Phase 32 — ChatGPT copy resolver integration

This slice continues PR 16.2 with ChatGPT copy-markdown fallback. Copy buttons
are often repeated across many assistant turns, so the resolver target is
optional and only influences selector priority inside the existing last-turn
scoped copy helper.

## Changes

- `pollWebAi()` resolves `copy.lastResponse` before ChatGPT copy-markdown
  fallback attempts.
- `captureCopiedResponseText()` accepts an optional `copyTarget` and prepends
  that selector to the last-turn scoped copy selector list.
- Existing provider-specific selectors keep their order when the resolver
  returns an already-known generic copy selector, so ChatGPT response-copy
  buttons stay ahead of code-block copy controls.
- If the resolver cannot identify an unambiguous copy button, the existing
  scoped copy scan still runs unchanged.
- Added focused coverage for copy target selector priority and unambiguous
  `copy.lastResponse` target resolution.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-chatgpt-copy-resolver-home npx vitest run test/unit/web-ai-copy-markdown.test.mjs test/unit/target-resolver.test.mjs test/integration/web-ai-fake-chatgpt.test.mjs --reporter=verbose`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`
- `npm run docs:counts`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`

## Follow-ups

- Add trace-visible resolver diagnostics so copy fallback can report whether
  the resolver path or legacy scoped scan selected the button.
- Mirror this into cli-jaw with its existing typed `resolveActionTarget()` path
  by passing an optional copy target into the response copy helper.
