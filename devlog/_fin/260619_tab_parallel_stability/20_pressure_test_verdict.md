# Tab Stability — Pressure-Test Verdict (2026-06-20)

> Adversarial review of `01_root_cause.md` + `10_solution_plan.md` against the user's actual goal: "N agents, one tab each, stays stable" (vendor ≤5, global 12–16). Outcome: **1 real observed bug + 2 real-but-narrow gaps, all over-engineered; 2 theoretical claims essentially already mitigated; 1 conditional/out-of-scope.** The locked vendor5/global12-16 decision still holds — it needs env caps + a count cap, not the queue/backpressure program.

## Decisive context the plan under-weighted

1. **Each `agbrowse web-ai <cmd>` is a separate short-lived OS process** (`cli.mjs:447`). N agents = N processes coordinating only through fs-locked JSON stores. **In-process mechanisms (the proposed single-flight `Map`) give ZERO cross-agent protection** — so they don't even serve the multi-agent goal.
2. **The cross-process tab mutex already exists.** `registerActiveCommand` (`active-command-store.mjs:156-167`) rejects a second command on the same `targetId` with a fs-locked `active-command.target-owned` error, and it wraps *every* send/poll/query via `withWebAiActiveCommand` (`cli.mjs:1312`). This is the "send+poll can't both drive one tab" guarantee — already shipped.

## Verdict per claim

| Claim | Verdict | Why |
|------|---------|-----|
| 2 · Lease↔session bind race (reattach-mismatch) | **DOWNSCOPE → 2-line reorder** | Real OBSERVED window (`chatgpt.mjs:200` sync bind / `:201` awaited lease). Fix = **record-before-bind** (swap the 2 lines ×4 sites). The atomic `acquireActiveLease` cap-machinery was bundled gold-plating. |
| 4 · Crashed-session lease leak | **DOWNSCOPE → PID reaper only** | Real leak, but `!pidAlive(ownerPid)` (already implemented `session-store.mjs:214`) is a sufficient+sound cross-process reap key. The 60s-heartbeat + phase + expiresAt tuning is for a single-process-stall case the goal doesn't need. |
| 6 · Admission control vendor5/global12-16 | **DOWNSCOPE → count cap** | Real gap: active leases are NEVER capped (`ensureProviderTab` unconditionally `createTab`s, `cli.mjs:1005`; caps only touch `pooled` rows). Fix = env bumps + revert `maxTabs:Infinity` + simple active-count check. Drop FIFO/retry-after/priority. |
| 1 · TOCTOU in tab recovery | **DROP** (add a warning log only) | Theoretical; `catch{}` fall-through already degrades to fresh-tab recovery (`tab-recovery.mjs:63-71,396-401`). Proposed single-flight is in-process-only → doesn't serve the N-process goal. |
| 3 · send+poll mutex (initial send) | **DROP** | The harmful collision is already blocked cross-process by `active-command.target-owned`. The one unlocked write (`conversationUrl`, `chatgpt.mjs:289`) is monotonic convergence to the same live URL, not a corrupting interleave. |
| 5 · 3-TTL collision at pro=3600s | **DROP** (conditional/out-of-scope) | Only bites IF pro=3600s is adopted (separate decision). Not on the path to multi-agent stability. |
| — · Stale "TTL=15m" doc | **KEEP** (trivial) | Code default is 30m (`tab-lease-store.mjs:64`); fix `cli.mjs:217`, `browser.mjs:3371`. |

## Already-mitigated / degrades gracefully today

- Concurrent same-tab ops across agents → rejected by `active-command.target-owned` (cross-process, fs-locked). *(kills Claim 3, softens 2)*
- Tab dies mid-recovery → `catch{}` + unconditional `createTab` + one `forceRecover` retry reopen a fresh tab. *(kills Claim 1)*
- Poll on wrong tab → `buildTargetMismatchResult` typed mismatch before any write (`chatgpt.mjs:358-369`).
- Reuse stealing an active tab → `findReusableProviderTab` excludes active-session + active-command targets (`cli.mjs:1054,1060`). *(residual = only the L200/L201 ordering)*
- Dead tabs → `cleanupLeasedTabs` already drops `!isTabAlive` leases (`:350-354`). Gap = only crashed-process-with-live-tab.

## Minimal Viable Version (ranked by service to the goal)

1. **Record-before-bind reorder** — swap `chatgpt.mjs:200↔201` (+ `deepResearchWebAi:625`, `grok-live.mjs:210`, `gemini-live.mjs:270`). The only OBSERVED bug; the most direct cause of reattach-mismatch. ~2 lines ×4 sites, no new API.
2. **Active-lease count cap + revert `maxTabs:Infinity`** — per-key (≤5) + global (12–16) check on `active-session` rows inside the existing `withLeaseLock`; `cli.mjs:982` → finite `AGBROWSE_MAX_TABS`; bump 3 env defaults. Makes the (N+1)th bounded instead of spawning unbounded tabs.
3. **PID-based active-lease reaper** — persist `ownerPid`; `reapStaleActiveLeases` reclaims iff `!pidAlive(ownerPid)`; call from existing `cleanupLeasedTabs`. Stops a crashed agent eating a slot.
4. **Stale-doc fix** (free).

Items 1–3 are load-bearing and each maps 1:1 to a concrete failure of "N agents, one tab each."

## Recommendation

DOWNSCOPE and split into must-have vs defer.
- **Must-have (ships the goal):** reorder · active-count cap + revert Infinity + env bumps · PID reaper · doc fix.
- **Defer/cut:** typed `TabDeadError`+single-flight (in-process-only), hoist-sessionId initial-send lock (cross-process `target-owned` already covers the harm), full 3-TTL unification + 60s heartbeat + phase (couple to a separate pro=3600s decision), reject-with-retry-after / FIFO / priority.

Same pattern as skill-envelope: the load-bearing capability (cross-process tab mutex via `active-command.target-owned`; graceful fresh-tab recovery via `catch{}`) **already exists**. `10_solution_plan.md` is **superseded by this verdict** for scope; `01_root_cause.md` stays as background.
