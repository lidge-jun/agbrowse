# 70 — Turn Ordering Close-out (G5)

Date: 2026-07-13
Status: implemented
Oracle commit: `83c3ca25a894dfd667c6e3d80db98f76d655a42f` (conversation readiness hardening)

## Problem

agbrowse used count-based baselining (`answers.slice(baseline.assistantCount)`). If the baseline count became stale, polling could treat historical assistant text as the current response.

No user-turn DOM ordering verification existed, so response acceptance did not prove that the latest assistant turn followed the latest user turn.

## Solution

Added `doesAssistantFollowUser(page)` at `web-ai/chatgpt.mjs:365`. The helper runs in `page.evaluate()` and uses `compareDocumentPosition` to verify that the last assistant turn follows the last user turn in DOM order.

The helper is error-safe with `.catch(() => true)`. The polling loop calls it at `web-ai/chatgpt.mjs:466-471`, before the existing stability check, and continues polling when the user turn is still latest.

## Key Design Decisions

- Uses `findLast` to select the latest assistant and user conversation turns.
- The `roleOf` helper checks both a turn's direct `data-message-author-role` attribute and a child element carrying that attribute.
- Returns `false` when either turn is missing, conservatively withholding readiness.
- Uses `catch(() => true)` so transient evaluation failures do not block polling.

## Prior Gap Classification

G5 was classified as **P0** in `50_source_verification.md`: the most impactful verified gap because stale count-based baselines could leak historical assistant text.

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
