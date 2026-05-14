# Plan: Deep Research Contract

**Status: draft** | **Priority: P2** | **Depends: 15_artifacts_archive_contract**

## Problem

`--research deep` and `web-ai/chatgpt-deep-research.mjs` exist, but the feature
is not discoverable and does not yet match Oracle's Deep Research contract.

Current shallow state:

- Parser accepts `research`.
- `query` branches to `deepResearchWebAi` when `input.research === 'deep'`.
- Help, README, and skill docs do not expose `--research deep`.
- MCP schema does not expose it.
- There are no Deep Research tests in agbrowse.
- Completion saves a report artifact but does not clearly finalize tab/session
  lifecycle through the shared finalizer.

## Oracle Delta

Oracle Deep Research includes:

- explicit `--browser-research deep` / MCP `browserResearchMode: "deep"`;
- progress monitoring;
- account/security block fail-fast;
- iframe/report surface capture;
- reattach recovery for incomplete captures;
- saved Deep Research report artifact;
- archive skip semantics.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/cli.mjs` | MODIFY | Expose or explicitly gate `--research deep`. |
| `web-ai/chatgpt-deep-research.mjs` | MODIFY | Add testable selectors, progress states, and finalization handoff. |
| `web-ai/chatgpt.mjs` | MODIFY | Share finalization/report artifact flow. |
| `web-ai/session.mjs` | MODIFY | Persist research mode and progress metadata. |
| `web-ai/tab-finalizer.mjs` | MODIFY | Preserve Deep Research artifact and skip auto archive. |
| `README.md` | MODIFY | Document beta/experimental status if enabled. |
| `skills/web-ai/SKILL.md` | MODIFY | Add agent guidance and timeout expectations. |
| `structure/CAPABILITY_TRUTH_TABLE.md` | MODIFY | Mark Deep Research beta/experimental/deferred. |
| `test/unit/web-ai-deep-research.test.mjs` | NEW | Unit tests for mode activation, blocked state, report extraction, timeout. |

## Diff Plan

Two acceptable product choices:

### Option A: Support as beta

- Add help text:

```text
--research deep  Activate ChatGPT Deep Research mode. ChatGPT only.
```

- Require ChatGPT vendor.
- Reject with `--follow-up`.
- Use longer default timeout.
- Persist:
  - `researchMode: 'deep'`
  - progress state
  - report artifact descriptor
  - final status
- Call finalizer after report save, with archive auto-skip.

### Option B: Keep experimental/deferred

- Keep parser support only if necessary for internal runs.
- Add help text marking it experimental, or remove parser reachability.
- Truth table must say Deep Research is experimental/deferred.
- MCP must reject it intentionally.

## Guardrails

- Do not claim reliable Deep Research until fixture and live-smoke behavior is
  stable.
- Do not combine with follow-ups.
- Do not archive Deep Research sessions in auto mode.
- Do not save empty reports as successful artifacts.
- Do not lose partial reports on timeout.
- Do not hide account/security blocks behind generic poll timeouts.

## Test Plan

1. Help exposes `--research deep` or explicitly documents deferral.
2. Non-ChatGPT vendor with deep research fails before browser mutation.
3. Deep Research plus follow-ups fails before browser mutation.
4. Mode button missing produces a warning and fallback behavior.
5. Account block returns blocked status.
6. Iframe report extraction returns report text and sources.
7. Timeout with partial report saves partial artifact.
8. Auto archive skips Deep Research sessions.

## Acceptance Criteria

- Deep Research support level is unambiguous.
- Users and agents can discover the actual support status.
- Report artifacts and session lifecycle are tested.
- No hidden beta feature is presented as Oracle parity without tests.
