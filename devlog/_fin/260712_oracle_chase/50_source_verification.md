# 50 — Source-Level Verification of P1 Gaps

Date: 2026-07-12
Status: source-grounded verification (work-phase 2)
Method: 3 parallel sol explorer subagents reading agbrowse source

## G1 — Fingerprint-Based Change Detection

**Verdict: Covered (reclassified from Partial)**

agbrowse is NOT vulnerable to Oracle's same-length-rewrite bug class. Two mechanisms protect it:

1. **MutationObserver resets on `characterData` changes** — the observer at `chatgpt-response-observer.mjs:62` watches `{ childList: true, subtree: true, characterData: true }`. Any text change, regardless of resulting length, resets the 1.2s quiet timer.

2. **Exact string comparison** — recovery at `chatgpt-response-observer.mjs:133` uses `stableLatest === latest` (full text equality), not length comparison. Equal length with different content fails the stability check.

3. **Authoritative poller** uses `latest === stableText` at `chatgpt.mjs:434-455` — again full text comparison.

The only gap vs Oracle is the absence of a message/turn identity component in the fingerprint (Oracle uses `messageId::fullText`). This matters less for agbrowse because its architecture doesn't cache snapshots across polls.

## G2 — Transient-Bar Race

**Verdict: Low Risk (reclassified from Investigate)**

The observer can emit premature `{ settled: true }` if the Stop button is transiently absent, but this is mitigated by design:

- The observer is **explicitly non-authoritative** (`chatgpt-response-observer.mjs:3-6`): it only wakes the poll loop early, never makes the completion decision.
- The authoritative poller in `chatgpt.mjs:434-455` has its own multi-layered stability check:
  - Text must equal `stableText` for a size-dependent duration (1-8 seconds)
  - Streaming is rechecked via `isStreaming(page)` (Stop button visibility)
  - Finished-action controls (`copy-turn-action-button`, etc.) provide positive completion evidence
- Recovery path at `chatgpt-response-observer.mjs:127` rechecks streaming after the wait window.

The transient-bar race is therefore possible as a premature wake signal but does not directly cause premature finalization. The authoritative poller's text-stability window is the real guard.

## G3 — Progress Bar Activity Veto

**Verdict: Confirmed Missing in General Path**

`isStreaming()` at `chatgpt.mjs:730-735` checks ONLY Stop buttons:
```js
async function isStreaming(page) {
    for (const selector of ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]']) {
        const first = page.locator(selector).first();
        if (typeof first.isVisible === 'function' && await first.isVisible().catch(() => false)) return true;
    }
    return false;
}
```

No `<progress>`, `[role="progressbar"]`, `[aria-valuenow]`, or `[data-testid*="progress"]` detection exists in the general path.

Deep Research has its own progress detection at `chatgpt-deep-research.mjs:24-29` covering `[role="progressbar"]` and research-specific selectors. This is absent from the general path.

**Risk**: Connector/tool phases that surface only a progress bar (no Stop button) will not be detected as "streaming", and the observer may declare settlement while generation is ongoing.

## G4 — Sidecar Panel Activity Veto

**Verdict: Confirmed Missing**

No selectors exist for `sidecar`, `sidebar`, `aside`, `[role="complementary"]`, or right-side panel containers in any of the response-capture files. The assistant reader at `chatgpt-response-dom.mjs:20-39` queries only top-level assistant-turn elements.

**Risk**: A reasoning/thinking phase exposed only through a right-side UI panel (no inline label, no Stop button) will not prevent completion detection.

## G5 — Turn Ordering Verification

**Verdict: Confirmed Missing**

agbrowse uses count-based baselining, not DOM-order verification:

- Polling: `answers.slice(baseline.assistantCount)` at `chatgpt.mjs:434`
- Baseline reconstruction: `sessionToBaseline()` at `session.mjs:512` uses stored `envelopeSummary.assistantCount`
- Tab inspection: `tab-inspect.mjs:30` takes the global last assistant element without user-turn ordering

No user-turn selector or user-turn index exists. No `assistantFollowsLatestUser` equivalent. No `compareDocumentPosition` between user and assistant nodes.

**Risk**: A stale `baseline.assistantCount` (from a prior session state, page reload, or DOM mutation) can allow historical assistant text from a prior turn to be returned as the current response. This is the most impactful gap.

## G6 — Placeholder Rejection

**Verdict: Confirmed Partial**

`PLACEHOLDER_PATTERNS` at `chatgpt.mjs:70-86` covers 15 patterns including `^answer now$` (anchored) and `^pro thinking` (prefix). The `isFinalAnswer()` function at `chatgpt.mjs:1115` applies these via regex test.

**Uncovered variant**: `ChatGPT said: Answer now` — does not match `^answer now$` because of the "ChatGPT said:" prefix. `cleanAssistantText()` at `chatgpt.mjs:1123` only strips "Thought for Xs" prefix, not "ChatGPT said:".

**Fix**: Add `/chatgpt said:\s*answer now/i` to `PLACEHOLDER_PATTERNS` or strip "ChatGPT said:" in `cleanAssistantText()`.

## Revised Priority Assessment

| Gap | Original Priority | Revised Priority | Rationale |
| --- | --- | --- | --- |
| G1 | P1 | Defer (Covered) | MutationObserver + exact string comparison already covers this |
| G2 | P1 | P2 (Low risk) | Non-authoritative observer + authoritative poller stability window mitigate |
| G3 | P1 | P1 | Confirmed missing in general path; real risk from connector phases |
| G4 | P1 | P1 | Confirmed missing; sidecar-only reasoning phases invisible |
| G5 | P1 | P0 | Confirmed missing; most impactful gap — historical text can leak |
| G6 | P1 | P2 | Only "ChatGPT said:" prefix uncovered; most placeholders already filtered |

## Source Anchors

| File | Lines | Finding |
| --- | --- | --- |
| `chatgpt-response-observer.mjs` | 3-6 | Observer is non-authoritative (documented) |
| `chatgpt-response-observer.mjs` | 19 | 1.2s quiet window constant |
| `chatgpt-response-observer.mjs` | 44-65 | Observer logic: MutationObserver + quiet timer + Stop check |
| `chatgpt-response-observer.mjs` | 125-144 | Recovery: exact string comparison + streaming recheck |
| `chatgpt-response-observer.mjs` | 186 | Recovery stability window: 3-5s based on text length |
| `chatgpt-response-dom.mjs` | 9-12 | Stop selectors (Stop button only) |
| `chatgpt-response-dom.mjs` | 20-39 | Top-level assistant text reader |
| `chatgpt.mjs` | 63-68 | Finished-action selectors (copy/thumbs/share) |
| `chatgpt.mjs` | 70-86 | PLACEHOLDER_PATTERNS (15 patterns) |
| `chatgpt.mjs` | 434-455 | Authoritative poller: text stability + streaming + finished checks |
| `chatgpt.mjs` | 730-735 | isStreaming(): Stop button only |
| `chatgpt.mjs` | 1064-1068 | readAssistantMessages(): assistant-only collection |
| `chatgpt.mjs` | 1115-1118 | isFinalAnswer(): placeholder regex filter |
| `chatgpt.mjs` | 1123-1126 | cleanAssistantText(): "Thought for" prefix strip only |
| `chatgpt-deep-research.mjs` | 24-29 | Deep Research progress selectors (includes progressbar) |
| `chatgpt-deep-research.mjs` | 91-95, 278-300, 409-415 | Deep Research progress blocking |
| `session.mjs` | 512-523 | sessionToBaseline(): count-based, no ordering |
| `tab-inspect.mjs` | 30-32 | Global last-assistant selection |
| `tab-recovery.mjs` | 75-86 | Recovery: URL navigation + waitForConversationReady |
| `tab-recovery.mjs` | 141-159 | verifySessionTab(): liveness check only |
| `watcher.mjs` | 188-204 | Watcher reattach flow |
| `watcher.mjs` | 252-263 | Streaming-deferred completion |
| `watcher.mjs` | 480-497 | ensureWatcherAttached(): URL compatibility only |

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
