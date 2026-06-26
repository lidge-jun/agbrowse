# 70 — GPT-Pro R2 Residuals: Master Plan

> Goal: GPT-Pro R2 residuals 전체 패치 (8 items) · created 2026-06-27
> Source: [60_gptpro_r2_verdict.md](60_gptpro_r2_verdict.md)

## 4 PABCD Cycles

| Cyc | Doc | Repo | Items | Kind |
|---|---|---|---|---|
| **1** | [80_](80_c1_ssrf_dns_pin.md) | agbrowse | (1) `--resolve` DNS pin + (8a) real SSRF/redirect tests | security fix |
| **2** | [90_](90_c2_watcher_heartbeat.md) | cli-jaw | (2) watcher independent heartbeat + stale-detection fix + (3) session-lock Atomics.wait removal | concurrency fix |
| **3** | [100_](100_c3_guards_and_claims.md) | cli-jaw + agbrowse | (4) DR autoConfirmPlan + timeout guard + (5) AX subtree filtering + (6) screenshot claim downgrade + (7) lease cleanup exclusions | guard fixes |
| **4** | [110_](110_c4_wiring_and_tests.md) | agbrowse | (8b) feed/candidate-discovery wiring + behavior tests | wiring + tests |

### Cycle 1: SSRF DNS pin (agbrowse)
- MODIFY `safety.mjs`: `dnsRebindingGuard` returns resolved addresses
- MODIFY `tls-fetch.mjs`: capture returned IPs, inject `--resolve host:port:ip` per hop
- NEW test: redirect to private IP rejected, relative redirects, max-redirect exhaustion

### Cycle 2: Watcher heartbeat + session lock (cli-jaw)
- MODIFY `watcher-lock.ts`: `acquireWatcherSessionLock` starts an `unref()`'d `setInterval(60s)` heartbeat; fix `isWatcherLockStale` to treat invalid timestamps as stale after grace window
- MODIFY `watcher.ts`: remove manual `state.lock?.heartbeat()` (now automatic)
- MODIFY `session-store.ts`: replace `sleepBlockingMs` (Atomics.wait) with `await setTimeout` in `withSessionCommandLock`; `withStoreLock` stays sync (fast ops, TTL headroom)

### Cycle 3: Guards + claims (both repos)
- MODIFY `chatgpt-deep-research.ts`: use `autoConfirmPlan` result; require `researchActivityObserved` on timeout path before persisting report
- MODIFY `ax-snapshot.ts` or `actions.ts`: filter CDP AX nodes to requested subtree only (remove ancestors/siblings outside rootSelector)
- MODIFY `annotated-screenshot.mjs` (agbrowse): downgrade capability claim in CAPABILITY_TRUTH_TABLE.md from "ready" to "experimental (stub)" + add regression test asserting stub behavior
- MODIFY `tab-lease-store.ts`: add `activeCommandTargetIds` param to `cleanupLeasedTabs`, skip in-use targets

### Cycle 4: Feed/candidate wiring + tests (agbrowse)
- MODIFY `adaptive-fetch/index.mjs`: call `parsePublicFeed` on discovered feed responses; call `extractCandidateUrlsFromText`/`rankDiscoveredCandidates` to enrich candidate list
- Remove dead imports or wire them to real call sites
- NEW tests: feed parsing in ladder, candidate discovery enrichment

## Convergence tracker

| Cyc | Status | Commit(s) | Gate |
|---|---|---|---|
| 1 | ⬜ | — | — |
| 2 | ⬜ | — | — |
| 3 | ⬜ | — | — |
| 4 | ⬜ | — | — |
