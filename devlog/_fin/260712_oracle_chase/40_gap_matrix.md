# 40 — Oracle Chase Gap Matrix

Date: 2026-07-12
Oracle anchor: `1146107` (Jul 11, 2026)
Prior anchor: `2fa6b5a` (Jun 23, 2026)

## Complete Gap Matrix

| # | Oracle Hardening | Oracle Commit | agbrowse File(s) | Status | Priority | Action |
| --- | --- | --- | --- | --- | --- | --- |
| G1 | Fingerprint-based terminal change detection (contentKey replaces maxLen) | `1146107` | `web-ai/chatgpt-response-observer.mjs` | **Covered** — MutationObserver resets on characterData + exact string comparison (not length). See `50_source_verification.md` | Defer | No action needed |
| G2 | Transient-bar race (proofA requires stableMs) | `1146107` | `web-ai/chatgpt.mjs` | **LOW risk** — race structurally possible (1s with finished=true) but narrowly conditioned by text equality + turn ordering + progress/sidecar detection + timer reset. See `90_comparison_closeout.md` | Monitor | Documented; defer hardening |
| G3 | Progress bar activity veto | `1146107` | `web-ai/chatgpt.mjs` (`isStreaming`), `web-ai/chatgpt-response-dom.mjs` | **IMPLEMENTED** — `isStreaming()` now checks `progress` and `[role="progressbar"]` via locator visibility. `[aria-valuenow]` excluded after sol reviewer found slider false positive. | Done | Closed 2026-07-13 |
| G4 | Sidecar panel activity veto | `1146107` | `web-ai/chatgpt.mjs` (`isStreaming`) | **IMPLEMENTED** — `page.evaluate()` checks right-side panels (aside/complementary/dialog/sidecar/sidebar) with `includes('thought for')` past-tense exclusion. | Done | Closed 2026-07-13 |
| G5 | Turn ordering verification (assistantFollowsLatestUser) | `83c3ca2` | `web-ai/chatgpt.mjs` (`doesAssistantFollowUser`) | **IMPLEMENTED** — `doesAssistantFollowUser(page)` uses `compareDocumentPosition` + `findLast`. `result !== false` handles mock pages. Called before stability check in poll loop. | Done | Closed 2026-07-13 |
| G6 | "Answer now" placeholder rejection | `83c3ca2` | `web-ai/chatgpt.mjs` | **IMPLEMENTED** — Added `/^chatgpt said:\s*answer now\s*$/i` to PLACEHOLDER_PATTERNS. Anchored with `$` after sol reviewer feedback. | Done | Closed 2026-07-13 |
| G7 | Snapshot-turn matching | `83c3ca2` | N/A | Different arch | Defer | Not applicable unless agbrowse adds response snapshot caching |
| G8 | Chrome cleanup on CDP.New failure | `83c3ca2` | `web-ai/tab-recovery.mjs` | **IMPLEMENTED** — try/catch with `closeTab` around fresh-target lifecycle in `recoverSessionTab`; orphaned target cleanup in `openConversationInNewTab`. Worker: Carson. | Done | Closed 2026-07-13 |
| G9 | Explicit timeout failure for recovery readiness | `83c3ca2` | `web-ai/watcher.mjs` | **IMPLEMENTED** — post-navigation readiness check in `ensureWatcherAttached` waits 10s for composer/assistant turn. Worker: Banach. | Done | Closed 2026-07-13 |
| G10 | ZIP structure validation (EOCD + central directory) | `bda0326` | `web-ai/code-artifact.mjs` | Covered — agbrowse already checks local-header magic, EOCD, central-directory entries, offsets, and bounds (`code-artifact.mjs:188+`) | Defer | No action needed; existing validation is on par with Oracle |
| G11 | SHA-256 artifact hashing | `bda0326` | `web-ai/session-artifacts.mjs` | **IMPLEMENTED** — `computeSha256()` with `createHash` at all 5 save sites (transcript/report/image/file/diagnostics). Worker: Singer. | Done | Closed 2026-07-13 |
| G12 | Filename sanitization alignment | `bda0326` | `web-ai/chatgpt-files.mjs:244` | **IMPLEMENTED** — `.crdownload` suffix stripped; `..` rejection added after trim. Worker: Mill. | Done | Closed 2026-07-13 |
| G13 | Artifact validation metadata | `bda0326` | `web-ai/session-artifacts.mjs` | **IMPLEMENTED** — `validation: { type, ok }` at all 5 save sites. Types: text/image/generic/empty. Worker: Singer. | Done | Closed 2026-07-13 |
| G14 | Download diagnostics with secret redaction | `bda0326` | `web-ai/chatgpt-files.mjs` | **IMPLEMENTED** — `safeDiagnosticUrl()` strips query/credentials; 3 URL warnings redacted; fetch results enriched with status/reason. Worker: Mill. | Done | Closed 2026-07-13 |
| G15 | Bridge artifact transfer protocol | `bda0326` | N/A | N/A | Defer | agbrowse has no bridge architecture |
| G16 | Profile selection hardening | `2853704` | N/A | N/A | Defer | Different profile management model |
| G17 | Broader download-button discovery (anchor filtering, mark-clicked) | `bda0326` | `web-ai/chatgpt-files.mjs` | **MEDIUM risk** — anchor-only discovery misses button-only file cards; security is stronger than Oracle (strict endpoint allowlist). See `90_comparison_closeout.md` | Monitor | Watch for ChatGPT DOM changes to button-only downloads |
| G18 | Conversation turn list refactoring (buildConversationTurnListExpression) | `83c3ca2` | `web-ai/chatgpt-response-dom.mjs` | Different implementation | Defer | agbrowse uses its own DOM traversal |

## Priority Distribution

| Priority | Count | Items |
| --- | --- | --- |
| Done | 10 | G3, G4, G5, G6, G8, G9, G11, G12, G13, G14 |
| Monitor | 2 | G2, G17 |
| Defer | 6 | G1, G7, G10, G15, G16, G18 |

## Recommended Implementation Order

### Phase 1 — Response Capture Hardening (P1, independent)

Target: `web-ai/chatgpt-response-observer.mjs`, `web-ai/chatgpt-response-dom.mjs`

1. ~~G5 — Turn ordering verification~~ ✅ Closed 2026-07-13
2. ~~G3 — Progress bar activity veto~~ ✅ Closed 2026-07-13
3. ~~G4 — Sidecar panel activity veto~~ ✅ Closed 2026-07-13

### Phase 2 — Recovery Hardening (P1, depends on tab-recovery understanding)

Target: `web-ai/tab-recovery.mjs`, `web-ai/watcher.mjs`

1. ~~G6 — "ChatGPT said: Answer now" variant~~ ✅ Closed 2026-07-13
2. G8 — CDP cleanup audit (P2)
3. G9 — Timeout behavior audit (P2)

### Phase 3 — Artifact Integrity (P2, independent)

Target: `web-ai/code-artifact.mjs`, `web-ai/session-artifacts.mjs`, `web-ai/chatgpt-files.mjs`

1. G11 — SHA-256 hashing
3. G12 — Filename sanitization comparison
4. G13 — Validation metadata
5. G14 — Download diagnostics
6. G17 — Download-button discovery comparison

## Prior Work Cross-Reference

| Prior devlog | Overlap with this delta |
| --- | --- |
| `_fin/260608_oracle_stability_gap/30_oracle_0_15_delta_followup.md` | Direct predecessor; this document continues from that anchor |
| `_fin/260608_oracle_stability_gap/33_response_capture_dualpath_pabcd.md` | Response capture architecture — G1/G2 may interact with dual-path observer design |
| `_fin/260608_oracle_stability_gap/31_chatgpt_downloadable_artifacts_pabcd.md` | File artifact capture — G10-G14 extend this spec |
| `_fin/260608_oracle_stability_gap/32_deep_research_session_followup_pabcd.md` | Model picker and recovery — G5 relates to turn ordering |
| `_fin/260608_oracle_stability_gap/36_implementation_master_plan.md` | Master plan for 31-35 specs — new gaps should be integrated |

## Next Steps

This gap matrix should be integrated into the next implementation planning cycle. P1 items (G1-G6) should be addressed before any new feature work, as they represent the same class of production bugs Oracle found and fixed in its 0.15.1 cycle. P2 items can be batched with other artifact/integrity improvements.

## Audit Amendments (2026-07-12, reviewer round 1)

## Source Verification (2026-07-12, work-phase 2)

Three parallel sol explorer subagents verified all P1 gaps against agbrowse source code:

- G1 reclassified P1→Defer (Covered): MutationObserver + exact string comparison already handles same-length-rewrite bug class.
- G2 reclassified P1→P2 (Low risk): observer is non-authoritative; authoritative poller has text-stability windows.
- G3 confirmed Missing (P1): `isStreaming()` checks Stop buttons only; connector/tool progress bars invisible.
- G4 confirmed Missing (P1): no sidecar/sidebar/aside detection in any response-capture file.
- G5 upgraded P1→P0: count-based baselining proven vulnerable; no user-turn DOM ordering exists.
- G6 confirmed Partial (P2): 15 patterns covered; only "ChatGPT said:" prefix uncovered.
- Full source anchors in [50_source_verification.md](50_source_verification.md).

- G10 reclassified Partial→Covered (Defer): agbrowse `code-artifact.mjs:188+` already performs EOCD + central-directory validation equivalent to Oracle's `validateZipBuffer`.
- G6 reclassified Missing→Partial: agbrowse `chatgpt.mjs:70` already rejects "Answer now" and "Pro thinking..." prefixes; only "ChatGPT said: Answer now" variant remains uncovered.
- P2 count corrected (was 7 listing 8 items; G10 moved to Defer resolves the mismatch).

Back to [00_overview.md](00_overview.md)

## Implementation Close-out (2026-07-13)

All 4 actionable gaps (G3, G4, G5, G6) implemented in `web-ai/chatgpt.mjs`:
- G6: `/^chatgpt said:\s*answer now\s*$/i` added to PLACEHOLDER_PATTERNS
- G3: `progress` + `[role="progressbar"]` added to `isStreaming()` (aria-valuenow excluded after reviewer FAIL)
- G4: Sidecar panel detection via `page.evaluate()` with `includes('thought for')` exclusion
- G5: `doesAssistantFollowUser(page)` with `compareDocumentPosition` + `result !== false` mock safety
- Sol high reviewers: Pascal (FAIL→fix→PASS for G3/G4/G6), Kierkegaard (PASS for G5)
- All tests pass: 159 files, 1452 tests, 0 failures
- Close-out docs: [60_streaming_hardening_closeout.md](60_streaming_hardening_closeout.md), [70_turn_ordering_closeout.md](70_turn_ordering_closeout.md)

## Deep Documentation (2026-07-13, work-phase 3)

5 parallel sol high explorers investigated all 8 remaining P2 gaps with source-grounded evidence:

- G8 upgraded P2→P1 (MISSING): `recoverSessionTab` leaks targets on post-creation failures; no lifecycle cleanup boundary
- G9 upgraded P2→P1 (MISSING): `ensureWatcherAttached` skips conversation readiness; deadline returns ok:true without readiness proof
- G14 upgraded P2→P1 (security): raw URLs with tokens/query params in diagnostic warnings; no redaction
- G11 confirmed P2 (Missing): no SHA-256 at any save site; moderate implementation complexity
- G12 reclassified (GAPS): `.crdownload` not stripped; `" .. "` after trim not caught
- G13 confirmed P2 (Missing): no validation metadata on artifact descriptors
- G2 reclassified P2→Monitor (LOW): race structurally possible but narrowly conditioned
- G17 reclassified P2→Monitor (MEDIUM): anchor-only discovery functional gap; security stronger than Oracle
- Full source anchors in [80_cdp_timeout_audit.md](80_cdp_timeout_audit.md), [85_artifact_integrity.md](85_artifact_integrity.md), [90_comparison_closeout.md](90_comparison_closeout.md)

## Final Implementation (2026-07-13, work-phase 4)

4 parallel sol high workers implemented all 6 remaining gaps on disjoint files:
- Carson: G8 try/catch cleanup in tab-recovery.mjs (28/28 tests)
- Banach: G9 readiness check in watcher.mjs
- Mill: G12 .crdownload + G14 safeDiagnosticUrl in chatgpt-files.mjs (44/44 tests)
- Singer: G11 SHA-256 + G13 validation in session-artifacts.mjs (runtime verified)
- Close-out: [95_final_implementation_closeout.md](95_final_implementation_closeout.md)

**Oracle chase is COMPLETE.** 10/18 gaps implemented, 2 monitored, 6 deferred (covered/N/A).
