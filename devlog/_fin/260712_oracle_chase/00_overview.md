# 00 — Oracle Chase Delta: Overview

Date: 2026-07-12
Status: analysis
Parent: devlog/00_index.md
Prior anchor: devlog/_fin/260608_oracle_stability_gap/30_oracle_0_15_delta_followup.md

## Anchor Update

| Field | Previous (2026-06-24) | Current (2026-07-12) |
| --- | --- | --- |
| Oracle head SHA | `2fa6b5a6ed927d467587d487af9d09e78653c42b` | `114610762975ca96136e92387c31fd875c6b03a2` |
| Oracle head date | 2026-06-23 | 2026-07-11 |
| Latest published release | v0.15.0 (2026-06-19) | v0.15.0 (still latest published) |
| Unreleased cycle | 0.15.1 (6 commits) | 0.15.1 (expanded, ~15+ commits since v0.15.0) |
| agbrowse version | v0.1.15 | v0.1.7 (current) |

## Delta Summary (`2fa6b5a..1146107`)

Since the previous audit anchor, Oracle's main branch has accumulated significant hardening commits across three major areas plus dependency maintenance. No new published release has been cut — these are all part of the unreleased 0.15.1 cycle.

### High-value changes (chronological)

| # | Commit | Date | Area | Summary |
| --- | --- | --- | --- | --- |
| 1 | `bda0326` (#277) | Jul 2 | Bridge/Artifact | Secure bridge artifact transfer: token-protected endpoint, ZIP validation, SHA-256 verification, safe filename sanitization, serialized transfers, manual fallback for mixed-version deployments |
| 2 | `2853704` | Jul 10 | Browser/Profile | Harden recovered browser profile selection |
| 3 | `83c3ca2` (PR #313) | Jul 10-11 | Browser/Recovery | Harden recovered conversation readiness: turn-ordering (`assistantFollowsLatestUser`), snapshot-turn matching, "Answer now" placeholder rejection, Chrome cleanup on CDP failure, explicit fail on readiness timeout |
| 4 | `bae406f` (PR #313 merge) | Jul 10 | Browser/Recovery | Merge of PR #226 hardening recovery |
| 5 | `1146107` | Jul 11 | Browser/Terminal | Terminal gate hardening round-2: fingerprint-based change detection (not length-only), transient-bar race fix (proofA needs `stableMs`), progress-bar and sidecar-panel activity veto |
| 6 | `a25eff1` | Jul 11 | Dependencies | Bump @google/genai 2.10→2.11, openai 6.45→6.46 |

### Dependency-only changes

Multiple dependabot PRs bumping openai, @google/genai, devtools-protocol, oxlint, vitest, etc. These do not introduce behavioral changes in Oracle's browser automation logic.

## Oracle's Hardening Themes Since 0.15.0

### 1. Terminal Gate (Response Completion Detection)

Oracle rewrote its terminal-gate classifier from length-tracking to content-fingerprinting. Three specific P1 fixes:

- **Fingerprint change detection**: `classifyTurnTerminal` now uses a `contentKey` (messageId + full text) instead of `maxLen`. Any content change — including equal-length rewrites, shorter final answers replacing longer preambles — resets the stability clocks.
- **Transient-bar race**: `proofA` (debounced action bar) now also requires `stableMs >= config.minStableMs`, closing a race where finished-action controls could surface while only the first 1-13 tokens had rendered.
- **Activity veto expansion**: `buildThinkingActivePredicateJs` now detects live `<progress>` / `[role="progressbar"]` elements and right-side thinking/reasoning sidecar panels (with explicit exclusion of past-tense "Thought for Xs" completed panels).

See: [10_terminal_gate_hardening.md](10_terminal_gate_hardening.md)

### 2. Recovered Conversation Readiness

Oracle significantly hardened how it verifies a recovered ChatGPT conversation is actually showing a current answer (not a historical one or a placeholder):

- **Turn ordering**: New `assistantFollowsLatestUser` flag + `lastAssistantTurnIndex` / `lastUserTurnIndex` — readiness now requires the latest assistant turn to follow the latest user turn in DOM order.
- **Snapshot-turn matching**: `inspectChatGptTab` and `harvestChatGptTab` now verify that the captured snapshot's `turnIndex` matches the inspected turn before using snapshot data (text, messageId, turnId).
- **Placeholder rejection**: `isAnswerNowPlaceholderText` exported and used in readiness check — "Pro thinking Answer now", "ChatGPT said: Answer now" variants are rejected.
- **Chrome cleanup**: `recoverConversationTab` now kills the launched Chrome when `openChatGptTarget` itself fails (not just when wait-for-ready fails).
- **Explicit timeout failure**: `liveTailSessionBrowserOutput` now throws when recovered content doesn't become ready before the deadline (was silently continuing).

See: [20_conversation_readiness.md](20_conversation_readiness.md)

### 3. Secure Bridge Artifact Transfer

Oracle added a complete artifact-transfer protocol for bridge mode (Windows host -> Linux client):

- Token-protected `GET /runs/<runId>/artifacts/<artifactId>` endpoint
- Pull-based transfer with SHA-256 verification and byte-size validation
- ZIP structure validation (magic bytes, EOCD, central directory bounds)
- Safe filename sanitization (`sanitizeArtifactFilename`)
- Capability discovery via `/health` response
- Manual fallback guidance for mixed-version deployments
- Host-path and signed-URL stripping from client-visible data

See: [30_bridge_artifact_transfer.md](30_bridge_artifact_transfer.md)

### 4. Profile Selection Hardening

Commit `2853704` hardens recovered browser profile selection. Details are minor compared to the three areas above.

## agbrowse Relevance Assessment

| Oracle Area | agbrowse Relevance | Priority |
| --- | --- | --- |
| Terminal gate (fingerprint detection) | **HIGH** — agbrowse uses its own response-observer polling in `chatgpt-response-observer.mjs` and `chatgpt-response-dom.mjs`. The same class of bugs (length-only tracking, transient-bar race, missing sidecar detection) could apply. | P1 |
| Conversation readiness (turn ordering) | **MEDIUM** — agbrowse has `tab-recovery.mjs` and `watcher.mjs` with reattach logic, but does not appear to have turn-ordering verification or placeholder rejection. | P1 |
| Bridge artifact transfer | **LOW** — agbrowse does not have a bridge/remote architecture. However, the ZIP validation, SHA-256, and filename sanitization patterns are reusable for `session-artifacts.mjs` and `chatgpt-files.mjs`. | P2 |
| Profile selection | **LOW** — agbrowse's profile management is different from Oracle's. | Defer |

See: [40_gap_matrix.md](40_gap_matrix.md)

## Documents in This Unit

| File | Content | Status |
| --- | --- | --- |
| [00_overview.md](00_overview.md) | This overview + anchor update | done |
| [10_terminal_gate_hardening.md](10_terminal_gate_hardening.md) | Terminal gate fingerprint detection analysis | done |
| [20_conversation_readiness.md](20_conversation_readiness.md) | Recovered conversation readiness comparison | done |
| [30_bridge_artifact_transfer.md](30_bridge_artifact_transfer.md) | Bridge artifact transfer relevance assessment | done |
| [40_gap_matrix.md](40_gap_matrix.md) | Complete gap matrix with priorities | done |
| [50_source_verification.md](50_source_verification.md) | Source-level verification of P1 gaps with code anchors | done |
| [60_streaming_hardening_closeout.md](60_streaming_hardening_closeout.md) | G6+G3+G4 implementation close-out | done |
| [70_turn_ordering_closeout.md](70_turn_ordering_closeout.md) | G5 turn ordering implementation close-out | done |
| [80_cdp_timeout_audit.md](80_cdp_timeout_audit.md) | G8+G9 CDP cleanup and timeout behavior audit | done |
| [85_artifact_integrity.md](85_artifact_integrity.md) | G11+G13+G14 artifact integrity assessment | done |
| [90_comparison_closeout.md](90_comparison_closeout.md) | G2+G12+G17 comparison close-out | done |
