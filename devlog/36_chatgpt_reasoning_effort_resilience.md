# Phase 36 — ChatGPT reasoning effort resilience

This slice hardens ChatGPT reasoning effort selection for the current
`chatgpt.com` hero and model menu variants. The previous selector contract
assumed effort rows started with `Light`, `Standard`, `Extended`, or `Heavy`.
Live menus can put the model name first, such as `GPT-5.5 Thinking Extended` or
`GPT-5.5 Pro Standard`, and the exact effort trigger test id can be absent.

## Changes

- Model row matching now accepts model names anywhere in the row text instead of
  requiring `Pro`, `Thinking`, or `Heavy` at the start.
- Effort option matching now accepts every supported effort label anywhere in
  the row text, covering:
  - Thinking: `light`, `standard`, `extended`, `heavy`
  - Pro: `standard`, `extended`
- Effort menu opening now falls back to generic effort/reasoning controls and
  keyboard open behavior when exact `*-thinking-effort` test ids are missing.
- Effort menu verification now rejects model-specific menus for the other
  ChatGPT model. This avoids treating a Pro `Standard`/`Extended` menu as a
  valid Thinking effort menu, or the reverse.
- Labels-only effort menus now reject unsupported labels for the requested
  model. A Pro request no longer accepts a labels-only menu that also exposes
  `Light` or `Heavy`.
- Checked model and checked effort verification now also read checked row text
  and active pill text, which keeps verification stable on hero/new-chat menus.
- Unit coverage now simulates model-first menu labels for every supported
  ChatGPT reasoning effort, verifies the generic effort trigger fallback, and
  covers the wrong-model menu, labels-only menu, and active-pill verification
  cases for both Thinking and Pro where applicable.

## Verification

- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-effort-test-home npx vitest run test/unit/web-ai-chatgpt-model.test.mjs test/integration/web-ai-cli-contract.test.mjs --reporter=verbose`
- `npm run docs:counts`
- `npm run docs:drift`
- `git diff --check`
- `npm run test:eval-fixtures`
- `env BROWSER_AGENT_HOME=/private/tmp/agbrowse-full-test-home CDP_PORT=49321 npm test`

## Notes

The sandboxed focused integration command must set `BROWSER_AGENT_HOME` to a
writable temp directory. Without that, context-package CLI tests fail with
`EPERM` while attempting to write under the default home directory; that failure
is environmental and unrelated to ChatGPT effort selection.
