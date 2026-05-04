# Phase 35 — ChatGPT copy resolver trace

This slice makes ChatGPT copy fallback resolution auditable in the same session
trace as send-path target resolution. When `allowCopyMarkdownFallback` is
enabled, the `copy.lastResponse` resolver result is appended after the copy
attempt and the returned `traceSummary` reflects the full persisted session
trace, not only the latest poll-local step.

## Changes

- `pollWebAi()` creates a copy resolver trace context only when copy markdown
  fallback is enabled and a session is available.
- `resolveOptionalChatGptCopyTarget()` records `copy.lastResponse` resolver
  metadata with the same scrubbed target and summarized-attempt shape used by
  `composer.fill`, `send.click`, and `upload.attach`.
- `persistResolverTrace()` now summarizes the persisted session trace after
  append, so `queryWebAi()` keeps combined send and copy resolver evidence.
- The fake ChatGPT integration test now exercises copy fallback, verifies the
  resolver-selected copy button, and asserts that prompt text is absent from
  stored resolver trace steps.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-copy-trace-home npx vitest run test/integration/web-ai-fake-chatgpt.test.mjs test/unit/web-ai-action-trace.test.mjs test/unit/web-ai-copy-markdown.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home CDP_PORT=49321 npm test`

## Follow-ups

- Mirror copy resolver trace summary into cli-jaw after confirming its typed
  session lifecycle can persist scrubbed resolver metadata without content
  leakage.
