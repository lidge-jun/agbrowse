# PR: Add Perplexity Web-AI Provider

## Summary

This change adds Perplexity as a first-class web-AI provider in agbrowse. It
uses the existing local Chrome/CDP runtime and follows the established
send, poll, session, artifact, recovery, CLI, and MCP contracts used by the
other providers.

## What Changed

- Added Perplexity model selection for the observed picker rows, including
  English `Thinking` and Korean `사고` controls.
- Added fail-closed model and effort validation before browser mutation.
  Sonar 2 is selectable but has no Thinking control. GLM 5.2 and Nemotron 3
  Ultra are Thinking-only.
- Added Perplexity send, poll, stop, query, session binding, lease tracking,
  timeout recovery, and strict `/search/<id>` conversation URL checks.
- Added file upload support with delayed attachment-preview verification.
- Added answer artifact persistence with lossless `answer` and
  `answerArtifact.text` equality.
- Added scoped citation extraction. A collapsed Sources pane is opened when
  needed and is left open; file-only answers correctly use an empty citation
  array when no URL citation exists.
- Added CLI, MCP, policy, doctor, editor-contract, eval fixtures, fixture
  provenance, documentation, and provider regression coverage.

## Verification

Automated checks completed:

- `68` focused Perplexity/session tests passed.
- `npm run test:release-gates` passed: `76` structure and count checks.
- `npm run gate:typecheck` passed.
- `npm run check:module-graph` passed.
- Perplexity offline eval passed for baseline, cosmetic-churn, and
  structural-churn variants.

Live smoke completed with the authenticated Perplexity browser profile:

- Attached `/tmp/agbrowse-perplexity-code-check.js`.
- Selected GPT-5.6 Terra Thinking.
- Sent and recovered session
  `01KXAA20X4XHXEA2BG4FBX3ATD`.
- Returned answer: `sum([1, 2, 3])` evaluates to `6`.
- Session status: `complete`.
- `answer === answerArtifact.text`: `true`.
- File-only source panel remained open with no URL citations; this was
  recorded as `citationState: unavailable` with `citations: []`.

## Review Focus

- Provider lifecycle parity with Gemini and Grok.
- Fail-closed model, Thinking, locked-row, and URL recovery behavior.
- Progress-gated completion and streaming postconditions.
- Attachment preview timing and file-only citation handling.
- Long-answer and citation artifact persistence.
- No regression to existing ChatGPT, Gemini, or Grok contracts.

## Known Boundary

The provider is browser-UI based and depends on the authenticated Perplexity
DOM contract. Selector changes should fail closed and require a refreshed
observation/fixture rather than silently submitting or returning stale data.
