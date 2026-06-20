# Plan: Multi-Turn Lifecycle Closeout

**Status: draft** | **Priority: P1** | **Depends: 15_artifacts_archive_contract**

## Problem

`--follow-up` and `web-ai/chatgpt-multi-turn.mjs` exist, but the lifecycle is
not closed. The feature is hidden from help/docs, lacks tests, and the success
path does not finalize the provider tab after follow-up turns.

There are two different UX concepts that must not be conflated:

- Batch follow-ups: `query --prompt "A" --follow-up "B" --follow-up "C"`
  sends all caller-provided prompts sequentially in one command run.
- Later session follow-up: run one prompt, read the answer, then come back in a
  later shell command with `--session <id>` and a new prompt.

This plan closes only the batch follow-up contract unless it explicitly adds a
separate later-session follow-up command. Later-session follow-up should remain
deferred and documented if it is not implemented in the same slice.

Current shallow state:

- Parser accepts repeatable `--follow-up`.
- `query` calls the initial prompt with `skipFinalize` when follow-ups exist.
- `sendMultiTurn` records turns and transcripts.
- Successful multi-turn does not mark the session complete, call
  `finalizeProviderTab`, pool/close/archive consistently, or expose a durable
  final artifact contract.

## Oracle Delta

Oracle browser follow-ups are explicit only:

- no autonomous follow-up generation;
- repeatable browser follow-up prompts stay in one conversation;
- multi-turn is not combined with Deep Research;
- archive is skipped or controlled by policy;
- session metadata records per-turn status and final answer.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `web-ai/cli.mjs` | MODIFY | Add help/docs text and finalize after follow-ups. |
| `web-ai/chatgpt-multi-turn.mjs` | MODIFY | Return final session patch and artifact descriptors. |
| `web-ai/chatgpt.mjs` | MODIFY | Share polling helpers or expose a safe finalization path. |
| `web-ai/session.mjs` | MODIFY | Ensure session summary includes follow-up state. |
| `web-ai/tab-finalizer.mjs` | MODIFY | Accept sessionType/follow-up metadata for archive decisions. |
| `README.md` | MODIFY | Add multi-turn example and non-autonomous guardrail. |
| `skills/web-ai/SKILL.md` | MODIFY | Add agent rule for explicit follow-ups only. |
| `structure/CAPABILITY_TRUTH_TABLE.md` | MODIFY | Add multi-turn support row. |
| `test/unit/web-ai-multi-turn.test.mjs` | NEW | Turn recording, timeout, transcript, finalization preparation. |
| `test/integration/web-ai-cli-contract.test.mjs` | MODIFY | Assert help exposes `--follow-up`. |

## Diff Plan

### `web-ai/cli.mjs`

Add help:

```text
--follow-up <text>  Repeatable ChatGPT follow-up prompt in the same conversation.
                    Explicit batch mode only: all follow-ups run sequentially
                    in this command invocation. Not supported with --research deep.
```

Validation:

- reject `--follow-up` with non-ChatGPT vendors unless implemented;
- reject `--follow-up` with `--research deep`;
- keep `send` behavior explicit: either support follow-ups only in `query`, or
  document that `send` returns a session for manual follow-up via future command.
- document that later-session follow-up via `--session <id> --prompt <text>` is
  out of scope unless implemented and tested as a distinct workflow.

### `web-ai/chatgpt-multi-turn.mjs`

Return a complete lifecycle payload:

```javascript
{
  ok,
  sessionId,
  conversationUrl,
  turns,
  finalAnswer,
  warnings,
  finalStatus,
  transcriptMarkdown,
}
```

On success:

- update session `status: 'complete'`;
- set `completedAt`;
- set `conversationUrl`;
- set `answer` to the final follow-up answer;
- set `followUpCount`;
- save transcript once per completed sequence or de-duplicate artifact records.

On partial failure:

- update session `status: 'partial'`;
- preserve completed turns;
- do not archive.

### Finalization

After `sendMultiTurn`, call `finalizeProviderTab` once with:

```javascript
archiveFlag: input.archiveFlag,
sessionType: 'multi-turn',
answerText: multiResult.finalAnswer,
```

`resolveArchivePolicy` should skip multi-turn in `auto` mode.

## Guardrails

- Never invent follow-ups.
- Never describe batch `--follow-up` as an interactive or later-session
  conversation mode.
- If later-session follow-up is deferred, say so in help/README/skill docs.
- Do not finalize after the initial turn when follow-ups remain.
- Do not combine Deep Research and follow-ups.
- Do not archive partial sessions.
- Do not duplicate transcript artifacts on every turn unless descriptors are
  de-duplicated.

## Test Plan

1. `--follow-up` appears in help.
2. `--follow-up` with `--research deep` fails before browser mutation.
3. Help/README/skill text explicitly says follow-ups are batch sequential in one command.
4. If later-session follow-up is deferred, docs say it is deferred.
5. Successful two follow-ups updates session status to complete.
6. Partial turn failure updates status to partial.
7. Finalizer is called exactly once after all follow-ups.
8. Auto archive skips multi-turn sessions.
9. Transcript artifact contains initial prompt and follow-up turns.

## Acceptance Criteria

- Multi-turn has a documented CLI contract.
- Successful multi-turn sessions are finalized exactly once.
- Partial multi-turn sessions remain recoverable and unarchived.
- Tests cover lifecycle and archive policy interactions.
