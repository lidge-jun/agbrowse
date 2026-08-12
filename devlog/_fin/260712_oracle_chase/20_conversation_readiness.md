# 20 — Conversation Readiness Hardening: Oracle vs agbrowse

Date: 2026-07-12
Oracle commits: `83c3ca25a894dfd667c6e3d80db98f76d655a42f` (Jul 10-11), `bae406f63e495516ae698606e39fe9f6e9d14022` (PR #313)
Oracle files: `src/browser/liveTabs.ts`, `src/browser/recoverConversation.ts`, `src/browser/actions/assistantResponse.ts`
agbrowse files: `web-ai/tab-recovery.mjs`, `web-ai/watcher.mjs`, `web-ai/tab-inspect.mjs`, `web-ai/session.mjs`

## Problem Context

When a ChatGPT conversation is recovered (tab reloaded, session resumed, or follow-up sent), the page initially shows historical turns. The latest visible assistant text may be from a prior turn, not the current response. Oracle's prior code could capture stale historical text, return "Answer now" placeholder text, or use snapshot data from the wrong turn.

## Oracle's Changes (PR #313)

### 1. Turn Ordering Verification

Oracle's tab inspection expression now computes explicit turn ordering:

```javascript
// New fields on ChatGptTabSummary:
assistantFollowsLatestUser?: boolean;  // true if lastAssistant is AFTER lastUser in DOM
lastAssistantTurnIndex?: number;       // index of last assistant turn in turns[]
lastUserTurnIndex?: number;            // index of last user turn in turns[]
```

The DOM expression uses `compareDocumentPosition` to find the actual latest user and assistant nodes regardless of data-attribute ordering, and filters answer nodes to exclude any that are contained by the latest user turn (preventing user-turn text from being read as assistant text).

`isRecoveredConversationHarvestReady()` now requires:
```javascript
const assistantFollowsLatestUser =
  harvested.assistantFollowsLatestUser === true ||
  (lastAssistantTurnIndex > lastUserTurnIndex);

return (
  harvested.stopExists === true ||
  (assistantCount > 0 &&
   assistantFollowsLatestUser &&   // NEW: must follow user turn
   latestAssistant.trim().length > 0 &&
   !isImageOnlyUiChromeText(latestAssistant) &&
   !isAnswerNowPlaceholderText(latestAssistant) &&  // NEW
   !/^answer now$/i.test(latestAssistant.trim()))
);
```

### 2. Snapshot-Turn Matching

Oracle's `inspectChatGptTab` and `harvestChatGptTab` now verify snapshot provenance before using it:

```javascript
const snapshotMatchesInspectedTurn =
  (snapshot.turnIndex === inspectedAssistantTurnIndex) ||
  (both undefined AND normalizedSnapshotText === normalizedInspectedText);

// Only use snapshot data if it matches:
const lastAssistantText = snapshotMatchesInspectedTurn ? snapshot.text : info.lastAssistantText;
const lastAssistantMessageId = snapshotMatchesInspectedTurn ? snapshot.messageId : undefined;
```

This prevents a captured snapshot from a prior assistant turn being attributed to the latest turn.

### 3. "Answer Now" Placeholder Rejection

`isAnswerNowPlaceholderText()` is now exported and used in the readiness check. It detects:
- "Answer now" (exact)
- "Pro thinking Answer now"
- "ChatGPT said: Answer now"
- Various case/whitespace variations

The readiness check also reorders its text source preference: `lastAssistantText` is checked BEFORE `lastAssistantMarkdown`, because the raw turn text exposes placeholder content that captured Markdown might mask.

### 4. Chrome Cleanup on CDP Failure

`recoverConversationTab` now wraps the entire `openChatGptTarget` + `waitForReady` sequence in a try/catch that kills Chrome on any failure (not just wait-for-ready failure):

```javascript
try {
  const targetId = await openChatGptTarget({ host, port, url });
  if (waitForReady) {
    await waitForRecoveredConversationReady(...);
  }
  return { host, port, url, ref: targetId, chrome };
} catch (error) {
  try { chrome.kill(); } catch { /* best-effort */ }
  throw error;
}
```

### 5. Explicit Timeout Failure

`liveTailSessionBrowserOutput` now throws `"Recovered ChatGPT conversation did not become ready in time."` when the deadline expires without readiness, instead of silently continuing with potentially stale content.

## agbrowse's Current Approach

agbrowse's tab recovery and watching uses:

- `tab-recovery.mjs` — `recoverSessionTab()` recovers a session by finding/opening the conversation URL. Uses `withSessionPage()` for scoped CDP connections.
- `watcher.mjs` — watch loop with `ensureWatcherAttached()` and `urlsCompatible()` for reattach-mismatch detection. The `terminal` flag comes from tick data.
- `tab-inspect.mjs` — `harvestTab()` for reading tab state.
- `session.mjs` — session state management including `recoveryCount`.

### Gap Analysis

| Oracle Hardening | agbrowse Status | Gap? |
| --- | --- | --- |
| Turn ordering verification (`assistantFollowsLatestUser`) | agbrowse does not appear to verify that the latest assistant turn follows the latest user turn. | **Missing** |
| Snapshot-turn matching (turnIndex comparison) | agbrowse does not appear to have a snapshot mechanism comparable to Oracle's `readAssistantSnapshot`. Its DOM reads are direct. | **Different architecture** — less vulnerable because no snapshot layer, but also no cross-check |
| "Answer now" placeholder rejection | agbrowse already rejects "Answer now" and "Pro thinking..." prefixes in `chatgpt.mjs:70`, applied during capture at `chatgpt.mjs:434`. "ChatGPT said: Answer now" variant is uncovered. | **Partial** |
| Chrome cleanup on CDP failure | agbrowse uses `withSessionPage()` scoping which has its own cleanup mechanism. Need to verify coverage. | **Investigate** |
| Explicit timeout failure for recovery | agbrowse's watcher has its own timeout/iteration handling. Need to verify if stale content can slip through. | **Investigate** |
| Conversation turn list via `buildConversationTurnListExpression` | agbrowse uses its own DOM traversal for turn extraction. | **Different implementation** — not directly comparable |

### Recommended Actions

1. **P1 — Extend placeholder text rejection**: agbrowse already filters "Answer now" and "Pro thinking..." variants (`chatgpt.mjs:70`). Add the "ChatGPT said: Answer now" variant that Oracle now also rejects. Low-cost incremental fix.

2. **P1 — Audit turn ordering in recovery scenarios**: Verify that agbrowse's tab-recovery and watcher paths cannot return historical assistant text from a prior turn when a new prompt has been sent.

3. **P2 — Verify CDP cleanup coverage**: Confirm that `withSessionPage()` and related cleanup mechanisms cover the same failure modes Oracle addressed (CDP.New failure, navigation failure, etc.).

4. **P2 — Consider turn-index tracking**: If agbrowse ever introduces snapshot-based caching of assistant responses, the snapshot-turn matching pattern from Oracle should be adopted.

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
