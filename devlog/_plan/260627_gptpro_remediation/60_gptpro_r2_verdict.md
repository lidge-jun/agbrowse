# 60 — GPT-Pro Round 2 Verdict (2026-06-27)

> Session: `01KW2HZXZ60AYB365HDM55QQYP` · Conversation: `https://chatgpt.com/c/6a3ec084-9ce8-83e8-a804-46c14dba8a48`

## Overall Verdict: **CONCERNS** (not PASS)

GPT-Pro acknowledged "a real improvement" but flagged residual issues. 2 PASS, 5 CONCERNS, 2 FAIL.

## Per-finding results

| # | Original | R2 Verdict | Summary |
|---|---|---|---|
| #8 (R1) | envelope shape | **PASS** | Shape-based detection correct + test covers subclass field survival |
| #2 (R2) | tier-timeout | **PASS** | poll/watch now fall back to session.timeoutMs |
| #1 (R3/R4) | TLS SSRF | **CONCERNS** | Redirect validation improved but DNS-rebinding TOCTOU remains. Need `--resolve host:port:ip` to pin curl to vetted IPs |
| #3 (R5) | session-store lock | **CONCERNS** | Substantially improved but still not fully atomic (crash between lock create and metadata write). Needs multi-process stress test |
| #4 (R5) | watcher-lock heartbeat | **FAIL** | Metadata write atomic now, but heartbeat still tied to poll-loop (not independent interval). Also stale-detection bug: live PID + invalid heartbeatAt = non-stale forever |
| #5 (R7a) | DR guard | **CONCERNS** | Streaming activity improves detection, but autoConfirmPlan result still ignored. Timeout path persists without requiring activity |
| #6 (R7b) | AX subtree | **CONCERNS** | Empty → unavailable fixed. But fetchRelatives:true still returns ancestors/siblings outside rootSelector |
| #7 | annotated screenshot | **FAIL** | Not touched — stub still returns input unchanged. Need implement or downgrade claim |
| #9 (R7c) | lease cleanup | **CONCERNS** | Capacity count half fixed. Cleanup race half not fixed (no activeCommandTargetIds exclusion) |

## Additional concerns

- **R6 overstated**: camoufox/ytdlp/bm25/structured-extractor wired, but `parsePublicFeed`/`formatFeedEvidence`/`extractCandidateUrlsFromText`/`rankDiscoveredCandidates` imported but no call sites
- **Test coverage insufficient**: TLS test only checks selectProfile, not redirects/SSRF. No watcher-lock, DR, AX-subtree, lease-cleanup tests

## Minimum for PASS (GPT-Pro's list)

1. **R4**: `--resolve host:port:ip` per hop + real SSRF/redirect tests
2. **R5 watcher**: independent unref'd heartbeat interval + stale-detection fix for invalid timestamps
3. **R5 session lock**: justify blocking Atomics.wait in async code + multi-process stress test
4. **#5 DR**: use autoConfirmPlan result + require activity before timeout persistence
5. **#6 AX**: filter CDP output to requested subtree only
6. **#7 screenshot**: implement or downgrade claim + regression test
7. **#9 lease cleanup**: add activeCommandTargetIds/completedSessions exclusions
8. **R6/R9**: wire feed/candidate-discovery for real + behavior/security tests
