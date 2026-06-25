# 50 — Cycle (cli-jaw (.ts))

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` · **Status: ⬜ PENDING (stub — diff-level detail filled at this cycle's P/B phase)**

## Target
- **Repo / lang:** cli-jaw (.ts)
- **Severity:** P1
- **Gate command:** `npm test + npx tsc --noEmit`

## Gaps in scope
104.3 watcher cross-process FS lock (mkdir+heartbeat+PID staleness); 104.19 AX-tree CDP fallback (Playwright >=1.55); 105.4 model-tier -> poll-timeout table

## Build log

- **105.4 — tier-aware default poll timeout** — ✅ DONE — cli-jaw `4a314622`
  - NEW `tier-timeout.ts` (`TIER_DEFAULT_TIMEOUT_SEC` {instant:120, thinking:600, pro:3600,
    deep-research:3600} + `deriveTimeoutTier` reusing cli-jaw's per-vendor model normalizers +
    `resolveTimeoutDefaultSec`). Wired at both `createSession` sites (send + DR); DR run reuses
    `session.timeoutMs`. Fixes deep-research timing out at 20 min instead of 60. Tests BWAI-TIER-001..003.
- **104.3 — watcher cross-process FS lock** — ⬜ PENDING (next). `watcher.ts:activeWatchers` is an
  in-process Map only; port agbrowse `acquireWatcherSessionLock` (mkdir lockdir + heartbeat +
  PID-staleness → `watcher.already-running`).
- **104.19 — AX-tree CDP fallback** — ✅ DONE — cli-jaw `4b03ddd4`
  - `captureAccessibilitySnapshot` now falls back to `captureAxViaCdp` (CDP session from
    `page.context().newCDPSession`, `Accessibility.getFullAXTree`/`getPartialAXTree`) +
    `cdpNodesToAxTree`/`mapCdpNode`/role-aliases, adapted to cli-jaw's strict `AxNode`.
    Tests BWAI-AXCDP-001..003.
- **104.3 — watcher cross-process FS lock** — ⬜ PENDING (next). Port `acquireWatcherSessionLock`
  (atomic `mkdirSync` lockdir + EEXIST staleness via PID-liveness/`process.kill(pid,0)` + heartbeat-age
  → `watcher.already-running`) + wire into `watcher.ts` lifecycle (acquire on start, heartbeat, release
  on end). Higher risk (live-session lifecycle) → dedicated pass with concurrency tests.

**Gate so far:** full cli-jaw `npm test` → **4786 tests, 4768 pass, 0 fail**; tsc 0 (after 104.19).
