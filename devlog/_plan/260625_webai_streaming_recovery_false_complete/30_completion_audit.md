# ChatGPT web-ai false-complete completion audit

Date: 2026-06-25

Goal:

Fix agbrowse ChatGPT web-ai false-complete handling end-to-end: ensure poll/watch never report complete while ChatGPT is still streaming, de-duplicate nested assistant DOM fragments, make timeout recovery finality-safe, add watcher defense, update targeted tests/docs, and collect verification evidence.

## Scope

This audit covers the implementation committed as:

- `cff76ed fix(web-ai): prevent ChatGPT streaming false completes`

Prior planning evidence:

- `devlog/_plan/260625_webai_streaming_recovery_false_complete/00_overview.md`
- `devlog/_plan/260625_webai_streaming_recovery_false_complete/00_repro_and_root_cause.md`
- `devlog/_plan/260625_webai_streaming_recovery_false_complete/10_patch_plan.md`
- `devlog/_plan/260625_webai_streaming_recovery_false_complete/20_verification_matrix.md`

Runtime smoke evidence:

- `devlog/_smoke/260625_webai_streaming_recovery_false_complete/02_poll_while_stop_visible_long.json`
- `devlog/_smoke/260625_webai_streaming_recovery_false_complete/03_watch_while_stop_visible_long.json`
- `devlog/_smoke/260625_webai_streaming_recovery_false_complete/04_final_poll_complete.json`
- `devlog/_smoke/260625_webai_streaming_recovery_false_complete/05_notes.md`

## Requirement Evidence

| Requirement | Status | Authoritative evidence |
| --- | --- | --- |
| ChatGPT `poll` must not report `complete` while response generation is still streaming. | Met | `web-ai/chatgpt.mjs` returns `buildDeferredPollingResult()` with `recovery-deferred-streaming` when recovered text exists but `recovered.streaming === true`; `test/unit/web-ai-provider-session.test.mjs` covers the streaming recovery path; live smoke `devlog/_smoke/260625_webai_streaming_recovery_false_complete/02_poll_while_stop_visible_long.json` records `"status": "timeout"`, `"recoverable": true`, and `"retryHint": "poll-or-resume"` instead of `complete`. |
| Timeout recovery must only finalize when finality is proven. | Met | `web-ai/chatgpt-response-observer.mjs` returns explicit `streaming`, `finished`, and `responseStableMs` metadata; `web-ai/chatgpt.mjs` computes `canComplete` only from `finished === true` or `responseStableMs > 0`; `test/unit/web-ai-chatgpt-response-observer.test.mjs` covers streaming, finished, and stable recovery metadata. |
| Copy-markdown fallback must not finalize while ChatGPT is still streaming. | Met | `web-ai/chatgpt.mjs` checks `isStreaming(page)` before copy-markdown completion and returns `copy-markdown-deferred-streaming`; `test/unit/web-ai-provider-session.test.mjs` includes `ChatGPT copy-markdown timeout fallback defers completion if stop button becomes visible`. |
| `watch` must not treat a complete-looking provider result as terminal if ChatGPT is still streaming. | Met | `web-ai/watcher.mjs` checks `status === 'complete' && await hasStreamingIndicator(page, vendor)` and downgrades to `status: 'polling'`, `terminal: false`, with `watcher-complete-deferred-streaming`; live smoke `devlog/_smoke/260625_webai_streaming_recovery_false_complete/03_watch_while_stop_visible_long.json` records `"terminal": false` and `"watchStatus": "polling"`. |
| Nested assistant DOM fragments must not be counted as separate assistant turns. | Met | `web-ai/chatgpt-response-dom.mjs` exports shared top-level assistant extraction helpers; `web-ai/chatgpt.mjs` uses them in both evaluate and locator fallback paths; `test/unit/web-ai-chatgpt-response-fragments.test.mjs` covers nested dedup, sibling top-level turns, baseline slicing, and locator fallback dedup. |
| Watcher streaming guard must avoid Gemini false positives from completion footers. | Met | `web-ai/watcher.mjs` scopes Gemini streaming selectors to stop-like controls only; `test/unit/web-ai-watcher.test.mjs` verifies Gemini completion footers are not treated as in-flight streaming. |
| Documentation, tests, and structure counts must be updated. | Met | `devlog/_plan/260625_webai_streaming_recovery_false_complete/` contains plan and audit docs; `devlog/_smoke/260625_webai_streaming_recovery_false_complete/` contains live smoke evidence; `structure/str_func.md` and `structure/phase_status.md` were updated by count tooling in the implementation commit. |

## Verification Evidence

Fresh C-phase checks after commit `cff76ed`:

| Gate | Evidence |
| --- | --- |
| TypeScript build check | `npm run typecheck` exited 0. |
| Full test suite | `npm test` exited 0: `Test Files 132 passed | 2 skipped (134)`, `Tests 1082 passed | 12 skipped (1094)`. |
| Release gates | `npm run test:release-gates` exited 0: `All structure drift checks passed (144)` and `All structure count checks passed (62)`. |
| Whitespace | `git diff --check` exited 0 with no output. |
| Worktree | `git status --short` had no output after commit. |
| Independent build verifier | Backend employee returned `DONE` after checking U11 copy-markdown coverage, live smoke artifacts, recovery/fallback finality, DOM dedup, Gemini-safe watcher guard, targeted suites, release gates, whitespace, and changed-file checkjs evidence. |

## Runtime Evidence Notes

- `03_watch_while_stop_visible.json` is not the streaming watch proof because that short prompt completed before the watch sample. The valid watch streaming proof is `03_watch_while_stop_visible_long.json`.
- `02_poll_while_stop_visible_long.json` is the stronger poll streaming proof because it was captured during the long generation window.
- `04_final_poll_complete.json` proves the final path still completes after streaming finishes, with `responseStableMs: 1641`.
- `06_stop_long.json` records the cleanup action used to stop the long smoke session after evidence collection.

## Residual Risk

The implementation depends on current ChatGPT stop-button selectors. If ChatGPT removes or renames all stop-like controls, the false-complete guard would need selector maintenance. Existing doctor/capability checks should surface that as provider DOM drift rather than silently proving finality.

No remaining objective requirement lacks direct source, test, or runtime evidence in this audit.
