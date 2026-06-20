# Tab Parallel Stability

## Problem
Multiple agents sharing one CDP instance with tab-per-session model has race conditions across tab recovery, lease binding, and concurrent send/poll operations.

## Key Gaps

### TOCTOU in tab recovery
- `tab-recovery.mjs:34-68` — `isTabAlive()` check and `getPageByTargetId()` are not atomic
- Tab can close between check and use

### Lease-session binding race
- `chatgpt.mjs:200-201` — `bindSessionToTab()` (sync) and `recordActiveLease()` (async) are separate
- Watcher can start polling before lease is recorded -> reattach-mismatch

### No send+poll mutex
- `sendWebAi()` and `pollWebAi()` can race on same session's `conversationUrl`
- `withSessionCommandLock` only partially applied

### Crashed session lease leak
- `tab-lease-store.mjs:227` — active leases have no TTL
- Crashed sessions lock tabs forever, manual cleanup required

## Goal
Stable multi-agent CDP sharing: multiple jaw employees or CLI agents connect to one Chrome instance, each with its own tab, no reattach-mismatch, no lease leaks.

## Test Coverage Needed
- Concurrent send+poll on same session (mutex correctness)
- Lease acquisition under high contention (3+ agents)
- Tab recovery during active polling
- Watcher reattach during mid-flight send
- Lease TTL expiration for crashed sessions

## Decision (locked 2026-06-19)
Concurrency target **vendor ≤ 5, global 12–16** (today 3 / 8). Investigated by a CLI sub-agent AND the Backend employee independently — both converged on the same 4 root causes. **Prerequisite:** unify the 3 colliding TTLs (session lock / active-command / active-lease) on the pro=3600s model-aware deadline from `260619_timeout_adaptive_scaling` + 60s heartbeat **before** raising caps. See `01_root_cause.md`, `10_solution_plan.md` (§C sequencing).

## Pressure-test (2026-06-20) — DOWNSCOPE & split
Separate-process model + existing `active-command.target-owned` cross-process mutex kill claims 1 & 3; claim 5 out-of-scope. Must-have = record-before-bind reorder + active-count cap (revert `maxTabs:Infinity`) + PID reaper + doc fix. See `20_pressure_test_verdict.md`. **This is the one area with real, load-bearing fixes for the multi-agent goal.**

## Status
- [x] Interview/requirements gathering
- [x] Plan (`10_solution_plan.md`) — superseded for scope
- [x] Pressure-test (`20_pressure_test_verdict.md`)
- [ ] Implementation (MVV must-have set, if approved)
- [ ] Verification
