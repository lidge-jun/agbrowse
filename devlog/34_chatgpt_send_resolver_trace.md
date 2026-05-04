# Phase 34 — ChatGPT send resolver trace

This slice turns the ChatGPT send path's resolver choices into durable session
evidence. The trace records ActionIntent target resolution metadata only:
intent, operation, resolution source, selected target shape, confidence, and
validation attempts. It intentionally excludes prompt text, answer text, and
context package contents.

## Changes

- `sendWebAi()` creates an action trace context for the session before resolving
  ChatGPT action targets.
- `composer.fill`, `send.click`, and optional `upload.attach` resolver results
  are appended to the session trace after successful prompt submission.
- `queryWebAi()` carries the send trace summary through the combined query
  result so CLI/MCP callers can see that resolver evidence exists.
- The fake ChatGPT integration test now verifies that resolver trace steps are
  persisted and do not contain the user prompt.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-resolver-trace-home npx vitest run test/integration/web-ai-fake-chatgpt.test.mjs test/unit/web-ai-action-trace.test.mjs test/unit/web-ai-trace-persistence.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home CDP_PORT=49321 npm test`

Note: the full test command pins `CDP_PORT=49321` so the stale-PID lifecycle
test is isolated from any real browser already listening on the default 9222
port.

## Follow-ups

- Persist ChatGPT `copy.lastResponse` resolver trace in the polling fallback
  path.
- Mirror the send resolver trace summary into cli-jaw's typed response capture
  and session lifecycle if its session trace shape can accept resolver steps
  without leaking prompt or answer content.
