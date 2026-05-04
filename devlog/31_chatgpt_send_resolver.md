# Phase 30 — ChatGPT send-button resolver integration

This slice continues PR 16.2 with the next smallest ChatGPT mutation path:
submit button selection. The provider still keeps the legacy scoped selector
scan and Enter fallback, but a verified `send.click` target is preferred when
the ActionIntent resolver can identify one.

## Changes

- Added ChatGPT `sendButton` semantic target contract backed by the existing
  hardened `SEND_BUTTON_SELECTORS`.
- Added `send.click` to the ActionIntent operation map and self-heal intent
  feature map.
- `submitPromptFromComposer()` now accepts an optional resolver-selected
  `sendTarget` and tries it before the legacy send-button scan.
- `sendWebAi()` resolves `send.click` after prompt insertion and before
  prompt submission.
- Fake ChatGPT integration coverage now asserts both composer and send-button
  resolver validation paths run.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-chatgpt-send-resolver-home npx vitest run test/unit/action-intent.test.mjs test/unit/target-resolver.test.mjs test/unit/web-ai-self-heal.test.mjs test/unit/web-ai-composer.test.mjs test/integration/web-ai-fake-chatgpt.test.mjs --reporter=verbose`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Keep Gemini and Grok send-button resolver execution out of this slice until
  their selectors have provider-specific fixture or live evidence.
- Mirror the typed adapter and semantic `sendButton` contract into cli-jaw
  after the ChatGPT agbrowse path is stable through full gates.
