# 10 — Terminal Gate Hardening: Oracle vs agbrowse

Date: 2026-07-12
Oracle commit: `114610762975ca96136e92387c31fd875c6b03a2` (Jul 11, 2026)
Oracle files: `src/browser/actions/assistantResponse.ts`, `src/browser/actions/thinkingStatus.ts`
agbrowse files: `web-ai/chatgpt-response-observer.mjs`, `web-ai/chatgpt-response-dom.mjs`, `web-ai/tab-finalizer.mjs`, `web-ai/watcher.mjs`

## Oracle's Terminal Gate Architecture

Oracle uses a pure, unit-testable `classifyTurnTerminal()` function that receives one `TerminalSample` per poll cycle and returns `{ state, terminal }`. The gate has two independent proof paths:

- **proofA** (debounced action bar): the ChatGPT action bar (copy/thumbs/etc.) is visible, the stop button is not, and BOTH the bar debounce counter AND the content-stability time requirement are satisfied. Not vetoed by `thinkingActive` (a stale reasoning panel should not block a clearly-finished turn).
- **proofB** (quiet window): no disturbance for `minQuietMs`, no active thinking, and the captured text exceeds `minTextLen` (to reject implausibly short captures).

### Change 1: Fingerprint-Based Change Detection

**Before (length-only):**
```
const grew = sample.len > state.maxLen;
const disturbed = grew || sample.stopVisible || sample.thinkingActive;
```

**After (content fingerprint):**
```
const changed = !state.seen || sample.contentKey !== state.lastKey;
const disturbed = changed || sample.stopVisible || sample.thinkingActive;
```

The `contentKey` is constructed as `${messageId ?? turnId ?? ""}::${fullText}`, so:
- An equal-length rewrite (preamble replaced by answer of same length) resets clocks
- A shorter final answer replacing a longer preamble resets clocks
- A new turn with the same text resets clocks (different messageId)

**Bug class fixed:** length-only tracking treats a same-length or shorter rewrite as "stable" — the gate could finalize mid-change, returning a truncated or mixed response.

### Change 2: Transient-Bar Race Fix

**Before:** proofA only required `barStableCycles >= config.barConfirmCycles`.

**After:** proofA additionally requires `stableMs >= config.minStableMs`, where `stableMs = now - lastChangeAt`. This closes the race where ChatGPT surfaces finished-action controls (copy/thumbs) while only the first 1-13 tokens have rendered.

**Bug class fixed:** the action bar sometimes appears during early streaming, before the answer is complete. proofA would have fired (bar visible for enough cycles) even though the text was still actively changing.

### Change 3: Activity Veto Expansion

Oracle's `buildThinkingActivePredicateJs` (injected into the browser page) now has two new detection paths:

1. **Live progress bar detection** — `<progress>`, `[role="progressbar"]`, `[aria-valuenow]`, `[data-testid*="progress"]` elements. Some connector/tool phases surface only a progress bar with no label/shimmer.

2. **Right-side sidecar panel detection** — `aside`, `[role="complementary"]`, `[role="dialog"]`, `[data-testid*="thinking"]`, `[class*="sidecar"]`, `[class*="sidebar"]`. The panel must either carry a live progress bar OR be on the right side (left >= 35% of viewport width, >= 180x120px) and contain thinking/reasoning text. Past-tense "Thought for Xs" text is explicitly excluded.

**Bug class fixed:** a connector phase exposed only through a right-side UI panel (no inline label, no shimmer) was not detected as "thinking active", so proofB could finalize a settled preamble during that phase.

## agbrowse's Current Approach

agbrowse uses a different architecture for response completion detection:

- `chatgpt-response-observer.mjs` — polls the DOM for assistant response text, uses `stableLatest` comparison (re-reads and checks equality) to determine stability.
- `chatgpt-response-dom.mjs` — extracts assistant response text from the ChatGPT DOM.
- `tab-finalizer.mjs` — finalizes tab state after response completion.
- `watcher.mjs` — the watch/poll loop that uses `terminal` flag from ticks.

### Gap Analysis

| Oracle Hardening | agbrowse Status | Gap? |
| --- | --- | --- |
| Fingerprint-based change detection (contentKey) | agbrowse uses text equality comparison via `stableLatest` re-read. This is closer to Oracle's new approach than Oracle's old length-only approach, but does not include messageId/turnId in the fingerprint. | **Partial** — text comparison is better than length-only, but missing identity component |
| Transient-bar race (proofA + stableMs) | agbrowse does not appear to have a dual-proof system (action bar + quiet window). Its stability check is simpler. | **Investigate** — need to verify if agbrowse has an equivalent race condition |
| Progress bar activity veto | agbrowse does not appear to detect `<progress>` / `[role="progressbar"]` elements as activity signals. | **Missing** |
| Sidecar panel activity veto | agbrowse does not appear to detect right-side thinking/reasoning sidecar panels. | **Missing** |
| Past-tense "Thought for Xs" exclusion | Not applicable if sidecar detection is not implemented. | N/A (blocked by above) |

### Recommended Actions

1. **P1 — Audit `chatgpt-response-observer.mjs` stability logic**: Compare the re-read/equality approach against Oracle's fingerprint approach. Determine if agbrowse is vulnerable to the same-length-rewrite bug class.

2. **P1 — Add progress bar detection to thinking-active checks**: If agbrowse has any thinking/streaming detection heuristic, add `<progress>` and `[role="progressbar"]` to it.

3. **P1 — Add sidecar panel detection**: When agbrowse detects ChatGPT's thinking/reasoning state, include right-side sidecar panels in the detection scope (with past-tense exclusion).

4. **P2 — Consider dual-proof architecture**: Evaluate whether agbrowse would benefit from Oracle's two-path (action bar + quiet window) completion detection, which provides both aggressive and conservative finalization.

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
