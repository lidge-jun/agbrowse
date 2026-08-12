# 80 — CDP Cleanup + Timeout Behavior Audit (G8 + G9)

Date: 2026-07-13
Status: audited (document-only, no code changes)
Oracle commit: `83c3ca25a894dfd667c6e3d80db98f76d655a42f`
Sol explorers: Feynman (G8), Kant (G9), reasoning_effort=high

## G8 — CDP Cleanup on Failure

**VERDICT: MISSING** — `recoverSessionTab` and `withSessionPage` lack ownership-wide failure boundaries.

### Key Findings

1. **`recoverSessionTab` leaks newly created targets** — the fresh-target lifecycle at `tab-recovery.mjs:95` has no try/catch/finally around `createTab + waitForPageByTargetId + waitForConversationReady + updateSession`. If any step throws after `createTab`, the target remains open and can become orphaned. `waitForPageByTargetId` failure becomes `null` but recovery still binds the session and reports success without proving a usable page.

2. **`withSessionPage` has no disposal** — at `tab-recovery.mjs:571`, `resolveSessionPage` failures bypass the catch entirely (runs before the try). The catch only handles page-death errors and retries once. No `finally`, no CDP-client disposal.

3. **`getPageByTargetId` failures have no caller-side cleanup** — three callers handle failure differently: `recoverSessionTab` propagates, `verifySessionTab` converts to `null`, `resolveSessionPage` propagates. None disposes the CDP session.

4. **Partial cleanup exists only in `openConversationInNewTab`** — at `tab-recovery.mjs:358`, it has try/catch with `closeTab` on mismatch/error. But `page-unavailable` returns without closing the target. Not used by `recoverSessionTab`.

5. **No `page.close`, `client.close`, `chrome.kill`, or `finally`** across `tab-recovery.mjs`, `session.mjs`, or `tab-pool.mjs`.

### Oracle Comparison

Oracle's `recoverConversationTab` wraps the entire `openChatGptTarget + waitForReady` in try/catch that calls `chrome.kill()` on any failure. agbrowse has no equivalent.

### Recommendation

**P1 implementation** — wrap the fresh-target lifecycle in `recoverSessionTab` with try/catch/finally that calls `closeTab` on any post-creation failure. Consider adding `closeTab` to `openConversationInNewTab`'s `page-unavailable` path. This is a targeted fix that doesn't require architectural changes.

## G9 — Timeout/Readiness Behavior

**VERDICT: MISSING** — watcher can silently continue with stale content; no explicit readiness failure throw.

### Key Findings

1. **`ensureWatcherAttached` skips conversation readiness** — at `watcher.mjs:480-497`, after navigating to the target URL it waits only for `domcontentloaded`, then reports success. No `waitForConversationReady`, no final URL verification, no login/error page detection. A login page on the correct host passes the preflight.

2. **Per-poll timeout becomes continued polling** — at `watcher.mjs:506-529`, `provider.poll-timeout` before the deadline is converted to `{ok: true, status: 'polling'}`. Does not throw, does not return answer text.

3. **Overall deadline returns success** — at `watcher.mjs:176-185`, deadline expiry returns `{ok: true, terminal: true, status: 'timeout'}`. The outer loop treats it as normal completion.

4. **No explicit readiness failure throw** — Oracle added `"Recovered ChatGPT conversation did not become ready in time."` when the readiness deadline expires. agbrowse has no equivalent; the watcher returns `ok: true` on timeout.

5. **`hasStreamingIndicator` is not a stale-content check** — at `watcher.mjs:431-438`, it checks only visible Stop buttons. Missing selectors, login pages, error pages, and cached DOM all produce `false`, allowing stale cached `session.answer` to be returned for already-complete sessions.

6. **Infinite retry without deadline** — without an explicit `deadline`, `timeout`, or `deadlineAt`, the watcher can retry poll timeouts indefinitely.

### Oracle Comparison

Oracle's `liveTailSessionBrowserOutput` now throws when recovered content doesn't become ready before the deadline. agbrowse's watcher returns `ok: true` on timeout without distinguishing "timed out waiting for content" from "content available but slow."

### Recommendation

**P1 implementation** — add `waitForConversationReady` call to `ensureWatcherAttached` after navigation. Consider adding an explicit readiness check for already-complete sessions (not just streaming indicator). Ensure `hasStreamingIndicator` covers progress bars and sidecar panels (now partially addressed by G3/G4 in `isStreaming`).

## Source Anchors

| File | Lines | Finding |
| --- | --- | --- |
| `tab-recovery.mjs` | 47-52 | `getPageByTargetId` outside try |
| `tab-recovery.mjs` | 75-88 | Navigation/readiness failure swallowed |
| `tab-recovery.mjs` | 95-115 | Fresh-target lifecycle without try/catch/finally |
| `tab-recovery.mjs` | 141-160 | `verifySessionTab` liveness-only check |
| `tab-recovery.mjs` | 358-371 | `openConversationInNewTab` partial cleanup |
| `tab-recovery.mjs` | 438-460 | `resolveSessionPage` uncaught propagation |
| `tab-recovery.mjs` | 571-580 | `withSessionPage` no finally/disposal |
| `watcher.mjs` | 32-36 | `WATCHER_STREAMING_SELECTORS` (Stop only) |
| `watcher.mjs` | 147-163 | Transient timeout promotion |
| `watcher.mjs` | 176-185 | Deadline returns `ok: true` |
| `watcher.mjs` | 242-250 | Returned timeout converted to polling |
| `watcher.mjs` | 311-340 | `normalizeWatchOptions` deadline calculation |
| `watcher.mjs` | 396-412 | Preflight: host only, composer=warn |
| `watcher.mjs` | 431-438 | `hasStreamingIndicator` Stop buttons only |
| `watcher.mjs` | 447-472 | `downgradeCompleteIfStillStreaming` |
| `watcher.mjs` | 480-497 | `ensureWatcherAttached` no readiness check |
| `watcher.mjs` | 506-529 | `callVendorPoll` timeout→polling conversion |
| `tab-pool.mjs` | 84, 93 | Pool cleanup delegation |

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
