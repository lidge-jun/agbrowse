---
created: 2026-06-25
status: planning
tags: [agbrowse, verification, web-ai, chatgpt]
---
# Verification Matrix

## Unit Fixtures

| ID | Surface | Scenario | Expected |
| --- | --- | --- | --- |
| U1 | assistant extraction | one top-level assistant block with nested paragraph nodes | one message, full block text |
| U2 | assistant extraction | two sibling top-level assistant blocks | two messages, in order |
| U3 | recovery | stop button visible and text exists | non-terminal recovery result |
| U4 | recovery | stop button absent and action buttons visible | terminal recovery allowed |
| U5 | recovery | placeholder text only | null / no recovery |
| U6 | recovery | `responseStableMs` would be 0 | no terminal complete |
| U7 | watcher | poll returns complete but stop visible | `polling`, `terminal:false` |
| U8 | watcher | poll returns complete and stop absent | `complete`, `terminal:true` |
| U9 | extraction fallback | evaluate path fails, locator fallback sees nested nodes | one top-level message |
| U10 | observer baseline | observer sees nested nodes after top-level dedup change | no terminal decision; early wake only |
| U11 | copy-markdown timeout | stable text exists but stop button visible | non-terminal / timeout, not complete |
| U12 | vendor streaming helper | Gemini completion footer present | not classified as in-flight streaming |

## Integration / Live Smoke

| ID | Command | Expected |
| --- | --- | --- |
| L1 | long ChatGPT Pro prompt, poll with short timeout while generation continues and `Stop answering` visible | `status:"polling"` or `timeout`, not `complete` |
| L2 | same session after visible completion | `status:"complete"` with full answer text |
| L3 | `agbrowse web-ai watch --session ... --json` during ongoing generation | no `watch.complete` while `Stop answering` is visible |
| L4 | same watch after completion | emits `watch.complete` once |

## Regression Risks

| Risk | Guard |
| --- | --- |
| Real short answers never complete because recovery requires too much evidence | normal poller still completes via existing non-streaming stable path |
| ChatGPT DOM changes remove action buttons | completion can still use no-stop + stability window |
| Nested filtering removes legitimate sibling turns | filter only removes descendants contained by another matched node |
| Watcher masks real provider complete | watcher only defers when streaming indicator is visibly present |
| Recovery no longer rescues missed final answers | no-stop + stable recovery path keeps rescue behavior |

## Required Evidence Bundle

Before marking this patch done, collect:

- targeted unit test output;
- release gate output;
- one live DOM proof showing `Stop answering` + poll/watch non-terminal;
- one live proof after completion showing full answer capture;
- `git diff --check`.

## Locked Decisions For Plan Audit

1. Recovery may complete with action-button/finished evidence. Without finished
   evidence, no-stop plus a bounded non-zero stability re-read is acceptable.
   Otherwise return non-terminal.
2. Watcher guard stays in `watcher.mjs` for this patch. A normalized provider
   `streaming` field is future cleanup, not required here.
3. `response-recovered-after-timeout` remains a warning on successful recovery,
   but only when finality proof exists and `responseStableMs > 0`.
4. Explicit `--web-search` composer failure is out of scope. Track separately
   as a composer-tools fail-closed policy patch.
