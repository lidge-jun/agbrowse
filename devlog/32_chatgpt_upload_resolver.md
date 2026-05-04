# Phase 31 — ChatGPT upload resolver integration

This slice continues PR 16.2 with the ChatGPT upload-open surface. File input
selection and attachment evidence remain in the existing upload helper; only
the button used to expose the file input now prefers a resolver-selected
`upload.attach` target.

## Changes

- Exported ChatGPT upload button selectors from `chatgpt-attachments.mjs` and
  reused them in the provider semantic target contract.
- `attachLocalFileLive()` now accepts an optional `uploadTarget` and tries that
  verified selector before scanning the legacy upload selector list.
- `sendWebAi()` resolves `upload.attach` before ChatGPT file/context-package
  upload when an upload path is present.
- Added unit coverage for resolver-selected upload target use and
  `upload.attach` target resolution.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-chatgpt-upload-resolver-home npx vitest run test/unit/chatgpt-attachments.test.mjs test/unit/target-resolver.test.mjs test/unit/action-intent.test.mjs test/integration/web-ai-fake-chatgpt.test.mjs --reporter=verbose`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home npm test`

## Follow-ups

- Keep Gemini and Grok upload resolver execution separate because they use
  provider-specific file chooser and evidence paths.
- Add trace-visible resolver diagnostics for composer/send/upload once the
  provider actions all share the same contract surface.
