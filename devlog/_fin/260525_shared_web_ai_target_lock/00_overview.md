# Shared web-ai target lock hardening

## Problem

agbrowse intentionally shares one headed Chrome/CDP port, commonly `9222`, to
keep memory usage low. Multiple `agbrowse web-ai` commands can therefore run
against the same browser profile while using different provider tabs.

The current safety invariant is correct but under-explained:

```text
send/query/poll/stop for one web-ai session must keep using the same CDP targetId.
```

When that invariant fails, ChatGPT polling returns `target-mismatch` /
`target changed during poll`. In a shared-port workflow this usually means the
poll path looked at the active/current provider tab instead of the session-bound
tab.

## Goal

Make shared-port web-ai operation predictable:

- keep `9222` shared-port operation supported;
- prevent session-less `poll` / `stop` from silently choosing the wrong active
  session when more than one live provider session exists;
- route unambiguous session-less `poll` / `stop` through the bound session page;
- make `stop --session` work as an interrupt even when another active command
  currently owns that target;
- expose actionable target-mismatch diagnostics in JSON output.

## Planned files

- MODIFY `web-ai/cli.mjs`
  - resolve ambiguous `poll` / `stop` calls before active-tab routing;
  - auto-bind only when exactly one active provider session exists;
  - make `stop --session` bypass active-command ownership and the long-lived
    per-session command mutex as an interrupt path.
  - update help text so shared-port session ambiguity and stop interrupt
    behavior are visible before the user hits the error.
- MODIFY `web-ai/errors.mjs`
  - document `session.target-ambiguous` with `target-resolution` stage and
    `pass-session` retry hint;
  - clarify `cdp.target-mismatch` also covers poll-stage target drift.
- MODIFY `web-ai/chatgpt.mjs`
  - include `expectedTargetId`, `actualTargetId`, `port`, `recovery`, and
    structured `targetMismatch` evidence in `target-mismatch` results.
- MODIFY `web-ai/gemini-live.mjs`
  - align session-less ambiguity behavior through the CLI layer only; no provider
    behavior change unless tests show provider-specific output needs parity.
- MODIFY `web-ai/grok-live.mjs`
  - same as Gemini; CLI-level routing should be provider-agnostic.
- ADD `web-ai/session-target-guard.mjs`
  - small shared helper for provider-scoped active-session candidates,
    ambiguity errors, and exactly-one auto-bind decisions at the CLI layer.
- ADD/UPDATE tests
  - `test/unit/web-ai-shared-target-lock.test.mjs`
  - `test/unit/web-ai-provider-session.test.mjs` source-contract updates where
    needed.

## Behavioral contract

For `agbrowse web-ai poll --vendor chatgpt` without `--session`:

- zero active sessions: keep existing baseline/current-tab behavior;
- one active session: treat it as `--session <id>` and use `withSessionPage`;
- two or more active sessions: fail closed with candidate session ids and target
  ids, asking the caller to pass `--session`.
- the failure uses a typed `session.target-ambiguous` error with evidence:
  `port`, `vendor`, `command`, and `candidates: [{ sessionId, targetId,
  status, conversationUrl }]`.
- active-session counting is scoped to the requested provider; one ChatGPT
  session and one Gemini session are not ambiguous for a ChatGPT poll.
- auto-binding honors the caller's navigation policy. It must not silently force
  tab recovery or navigate a saved session unless the command explicitly allows
  it.

For `agbrowse web-ai stop --vendor chatgpt` without `--session`:

- zero active sessions: keep existing active-tab Escape behavior;
- one active session: stop that session-bound target;
- two or more active sessions: fail closed with candidates.

For `agbrowse web-ai stop --session <id>`:

- resolve `sessionId -> targetId -> page`;
- press Escape on that page;
- do not register a competing active-command lease for the same target.
- do not release, overwrite, or mutate the active-command lease held by the
  running owner; `stop --session` is an interrupt action, not ownership transfer.
- do not contend for the long-lived `withSessionCommandLock` held by a running
  `poll --session`; stop must be able to interrupt while the poll loop still
  owns that per-session mutex.

For provider poll target drift:

The provider result remains a poll result rather than a thrown error envelope,
but it carries both top-level convenience fields and a structured
`targetMismatch` object so automation can consume the evidence consistently:

```json
{
  "ok": false,
  "status": "target-mismatch",
  "sessionId": "...",
  "expectedTargetId": "...",
  "actualTargetId": "...",
  "port": 9222,
  "targetMismatch": {
    "expectedTargetId": "...",
    "actualTargetId": "...",
    "port": 9222
  },
  "recovery": "agbrowse web-ai poll --vendor chatgpt --session ... --navigate --json"
}
```

## Verification

- Employee plan verification before implementation.
- Focused tests written before implementation for:
  - `poll` with 0 / 1 / 2+ active sessions;
  - `stop` with 0 / 1 / 2+ active sessions;
  - 2+ active provider sessions fail closed with candidate `sessionId` and
    `targetId` values;
  - ambiguity failure uses `session.target-ambiguous`, `target-resolution`, and
    `pass-session`, with candidate evidence;
  - exactly one active provider session routes through `withSessionPage`;
  - `stop --session` succeeds even when an active command lease already owns the
    same target, and does not release that owner's lease;
  - `stop --session` succeeds and presses Escape while a running `poll --session`
    for the same id is holding the session command lock;
  - after `stop --session`, the owner's running active-command row remains
    unchanged in the active-command store;
  - ChatGPT target-mismatch JSON includes `expectedTargetId`,
    `actualTargetId`, `port`, `targetMismatch`, and `recovery`;
  - CLI-level routing is provider-agnostic for ChatGPT, Gemini, and Grok.
- Existing focused web-ai session tests.
- `npm run test:unit -- test/unit/web-ai-shared-target-lock.test.mjs ...`
- `npm run test:trace-policy`
- `npm run typecheck:checkjs`
- `git diff --check`
- Smoke:
  - `npm run smoke:bins`
  - `npm run test:smoke`
- Post-commit GPT Pro verification with context package scoped to this change.

## GPT Pro remediation

Post-commit GPT Pro verification initially returned `NEEDS_FIX` for two edge
cases:

- target-resolution `cdp.target-mismatch` errors lacked
  `expectedTargetId`, `actualTargetId`, `port`, nested `targetMismatch`, and a
  concrete `recovery` command;
- `stop --session <id>` could route through the default ChatGPT branch when the
  stored session belonged to Gemini or Grok and `--vendor` was omitted.

The remediation adds structured recovery evidence to `sessionResolutionError`
and resolves `poll`/`stop --session` vendor from the stored session before
choosing provider-specific functions. Unit coverage now drives the real
`runWebAiCli` path for both cases.

## Provider parity note

ChatGPT has an in-loop target drift guard in its poll loop. Gemini and Grok
currently rely on connect-stage URL checks and the CLI-level session binding
rather than provider-specific per-iteration target drift diagnostics. This
patch keeps that scope deliberate: provider-agnostic safety is enforced in the
CLI routing layer, while ChatGPT receives the richer structured diagnostic where
the drift guard already exists.
