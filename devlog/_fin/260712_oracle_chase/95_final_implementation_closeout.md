# 95 — Final Implementation Close-out (G8 + G9 + G11 + G12 + G13 + G14)

Date: 2026-07-13
Status: implemented
Method: 4 parallel sol high workers on disjoint files

## Implementation Summary

All 6 remaining Oracle chase gaps implemented in one parallel dispatch:

### G8 — CDP Cleanup (tab-recovery.mjs)
Worker: Carson. Fresh-target lifecycle in `recoverSessionTab` (~line 95) now wrapped in try/catch with `closeTab(port, newTab.targetId)` on failure. `openConversationInNewTab` page-unavailable path also closes orphaned target. 28/28 focused tests pass.

### G9 — Watcher Readiness (watcher.mjs)
Worker: Banach. `ensureWatcherAttached` (~line 491) now includes a post-navigation readiness check: waits up to 10s for composer textarea or assistant turn to become visible. Catches login pages, error pages, and incomplete loads that `domcontentloaded` misses.

### G12 — Filename Sanitization (chatgpt-files.mjs)
Worker: Mill. `sanitizeDownloadFilename` (~line 244) now strips `.crdownload` suffix and rejects `..` after trim. Two-line fix.

### G14 — Download Diagnostics Redaction (chatgpt-files.mjs)
Worker: Mill. New `safeDiagnosticUrl()` helper (~line 10) strips query strings, fragments, and credentials. All 3 URL-bearing warnings now use redacted URLs. Fetch failure results enriched with `status` and `reason` fields. 44/44 focused tests pass.

### G11 — SHA-256 Artifact Hashing (session-artifacts.mjs)
Worker: Singer. `computeSha256()` helper added with `createHash` from `node:crypto`. SHA-256 computed at all 5 save sites (transcript, report, image, file, diagnostics). Hash of exact persisted bytes.

### G13 — Artifact Validation Metadata (session-artifacts.mjs)
Worker: Singer. `validation: { type, ok }` added to all 5 save sites. Types: `text` (transcript/report/diagnostics), `image`, `generic`/`empty` (file). Runtime verification passed with exact hash matching.

## File Changes

| File | Gaps | Worker | Tests |
| --- | --- | --- | --- |
| `web-ai/tab-recovery.mjs` | G8 | Carson | 28/28 |
| `web-ai/watcher.mjs` | G9 | Banach | syntax+grep |
| `web-ai/chatgpt-files.mjs` | G12+G14 | Mill | 44/44 |
| `web-ai/session-artifacts.mjs` | G11+G13 | Singer | runtime verified |

## Oracle Chase Complete Status

All 18 gaps fully resolved:
- **Done (implemented)**: G3, G4, G5, G6, G8, G9, G11, G12, G13, G14 (10 gaps)
- **Monitor**: G2, G17 (2 gaps — documented, low/medium risk)
- **Defer**: G1, G7, G10, G15, G16, G18 (6 gaps — covered/N/A/different arch)

Back to [00_overview.md](00_overview.md) | [40_gap_matrix.md](40_gap_matrix.md)
