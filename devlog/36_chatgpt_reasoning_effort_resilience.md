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
- Broad generic effort triggers no longer accept labels-only menus. They must
  expose model text; otherwise the runtime falls back to row-bound keyboard or
  geometry paths.
- Rejected generic/text effort menus are dismissed before the row-bound
  fallbacks run, so a stale labels-only menu cannot be accepted later with the
  row-bound verification policy.
- Thinking effort menus are verified by the requested effort and plan-visible
  base labels. `Standard` / `Extended` menus no longer require Pro-only
  `Light` / `Heavy` labels, while `Light` / `Heavy` still must be visible when
  requested.
- The model capability/status probe uses the same requested-effort menu
  verification path as selection, so status checks cannot drift from send-time
  selection behavior.
- Model-menu open detection now ignores the closed `model-switcher-dropdown-button`
  and only treats visible `model-switcher-gpt-*` rows as model menu evidence.
- Final checked-model verification skips standalone effort labels, so a checked
  `Heavy` effort row cannot be misread as the Pro model.
- Exact `*-thinking-effort` triggers now use locator actionability only. Hidden
  or otherwise non-actionable exact triggers no longer get a raw coordinate
  click before generic, text, keyboard, or geometry fallbacks can run.
- Effort verification now reopens the model menu when ChatGPT closes it after
  selecting an effort option, so changed efforts can be verified across all
  supported Thinking and Pro effort choices.
- Split-pill hero verification no longer reads a standalone `Heavy` effort pill
  as the Pro model when a separate Thinking model pill is present. A bare
  `Heavy` pill is only a last-resort Pro model fallback after non-effort model
  pill text has been checked.
- Model option selection now rejects standalone effort labels and observed
  Pro effort-pill labels (`Heavy`, `Standard Pro`, `Extended Pro`) before
  treating a candidate as a model row. This keeps missing model-row test IDs
  from turning effort controls into Pro model options.
- Visible-text-only `Effort` / `Reasoning effort` controls are covered through
  a text trigger fallback and row-near geometry fallback.
- Checked model and checked effort verification now also read checked row text
  and active pill text from both `button` and role-button composer pills, which
  keeps verification stable on hero/new-chat menus.
- Unit coverage now simulates model-first menu labels for every supported
  ChatGPT reasoning effort, verifies the generic effort trigger fallback, and
  covers hidden exact effort triggers, post-effort menu closure, effort-only
  Pro labels in model-option lookup, wrong-model menus, labels-only menus,
  visible-text-only controls, split-pill hero verification in both Thinking
  and Pro request directions, and active-pill verification cases for both
  Thinking and Pro where applicable.

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
