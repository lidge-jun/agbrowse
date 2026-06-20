# Tab Parallel Stability — Solution Plan

> ⚠️ **SUPERSEDED for scope by `20_pressure_test_verdict.md` (2026-06-20).** Pressure-test: each `web-ai` cmd is a separate OS process and a cross-process tab mutex (`active-command.target-owned`) already exists → claims 1 (TOCTOU) and 3 (send/poll mutex) DROP; claim 5 (3-TTL) out-of-scope. Real must-have = record-before-bind reorder + active-count cap (revert `maxTabs:Infinity`) + PID reaper + doc fix. The full atomic-acquire/heartbeat/admission program below is downscoped. Read the verdict first; this file is the full analysis.

> Locked decisions: concurrency target **vendor ≤ 5, global 12–16**; **pro = 3600s** is the source of truth for the model-aware deadline. Documentation only; code sketch is illustrative. Design A–E below is the merged output of the CLI sub-agent and the Backend employee (they converged).

## Sequencing rule (read first)

Land in this order — caps last:
1. Unify the three TTLs on the model-aware deadline + 60s heartbeat (§C). **Prerequisite for everything.**
2. Atomic lease acquire (§A) + per-session mutex (§B) + TOCTOU fix (§D).
3. Only then raise caps + add admission control (§E).

Raising caps (§E) *before* §C multiplies the collision rate — do not reorder.

## A. Atomic `acquire tab + record lease`

New `acquireActiveLease(port, input)` in `tab-lease-store.mjs`: inside **one** `withLeaseLock`, (a) enforce per-key + global **active** cap, (b) write the `active-session` row with fresh `lastHeartbeat`/`ownerPid`, (c) return `{ ok, lease, reason }`.

Ordering in `sendWebAi` (replaces `chatgpt.mjs:200-209`), all under the session lock (§B):
1. Resolve/create tab → `targetId`.
2. `acquireActiveLease(...)` — atomic cap-check + row write. If `!ok` → throw typed `provider.capacity` backpressure error (§E).
3. `bindSessionToTab(...)` — strictly **after** the durable lease exists. **Record-before-bind** closes the "bound target with no lease" window (Gap 2).
4. Compose/submit.
5. Finalize → `releaseCompletedLease` demotes `active-session → pooled`.

Apply the same pattern to `grok-live.mjs`, `gemini-live.mjs`, and `deepResearchWebAi`. **Lock ordering: session-command lock → lease lock (never reverse)** to avoid deadlock; both fs locks have retry-limit timeouts so worst case is a thrown "failed to acquire", not a hang.

## B. Per-session mutex (send + poll + watcher-reattach)

The lock primitive is correct (`session-store.mjs:262,272-316`); the fix is *where it's wrapped*:

| Path | Change |
|------|--------|
| Initial `send`/`query` | **Hoist `sessionId` minting** into `runCommand` before dispatch and wrap `sendWebAi` in `withSessionCommandLock(sessionId, …)`, making `cli.mjs:1361` symmetric with the resume path (`:1267`). (Lighter alt: lock on `tab:${targetId}` — rejected; a *reused pooled* tab could collide two sessions. Prefer the hoist.) |
| `poll` | Already correct (`cli.mjs:1107`). No change. |
| `queryWebAi` | Single outer lock around send+poll (`chatgpt.mjs:587-597`). |
| Watcher | Wrap the reattach+poll body (`watcher.mjs:176-188`) in `withSessionCommandLock(session.sessionId, …)` so a watcher `page.goto` can't fire while a live send/poll holds the session. |
| `sessions reattach` | Add the lock (`cli-sessions.mjs:123`). |

Result: send, poll, and watcher-reattach serialize on the same session → on the same `conversationUrl`.

## C. Unify the three TTLs (the load-bearing change)

Add to the `active-session` lease row: `lastHeartbeat`, `ownerPid`, `expiresAt`, `phase ('send'|'poll'|'watch')`. Drive **all** TTLs from the model-aware deadline imported from `260619_timeout_adaptive_scaling` (`resolveTimeoutSeconds`) — do not re-hardcode 3600 here.

```js
// hardcoded ceilings derived from the timeout table + 60s slack
const MODEL_LOCK_TTL_MS = { default: 1_260_000 /*21m*/, pro: 3_660_000 /*61m*/, deep: 3_660_000 };
```

- **Session command lock TTL** — pass `{ ttlMs: MODEL_LOCK_TTL_MS[tier], heartbeatMs: 60_000 }`; raise the `DEFAULT_SESSION_COMMAND_LOCK_TTL_MS` ceiling (`session-store.mjs:50`) to 61m.
- **Active-command TTL** — set `ttlMs: MODEL_LOCK_TTL_MS[tier]` in `withWebAiActiveCommand` (`cli.mjs:1308-1314`) so 2-min cleanup stops fighting a live pro poll.
- **Active-lease TTL + heartbeat** — `expiresAt = session.deadlineAt`; renew `lastHeartbeat` every **60s** from the session-lock heartbeat timer (`session-store.mjs:303-308`, already fires q15s — piggyback `touchActiveLease(targetId)`), plus each watcher tick and each poll iteration.

**Reaper** `reapStaleActiveLeases(port)` (called from `cleanupLeasedTabs`), inside `withLeaseLock`, reclaims an `active-session` lease only when **BOTH**: `now - lastHeartbeat > 180s` (3 missed beats) **AND** `!pidAlive(ownerPid)` (process dead). The pro-safe invariant:

> A legitimate 3600s pro wait has an old `leasedAt` but a `lastHeartbeat` renewed q60s and a live PID → it is **never** reaped. The reaper keys on heartbeat freshness + process liveness, **not** on `leasedAt`.

Numbers: heartbeat **60s**, miss threshold **180s**, grace past `expiresAt` **120s**. Even a SIGSTOP-frozen process reads alive to `process.kill(pid,0)` → not reaped (safe), at the cost of holding a slot until truly dead — acceptable.

## D. TOCTOU fix

1. **Typed `TabDeadError` + single-flight recovery.** Replace the brittle string-match `isPageDeathError` with a typed error; wrap `page.url()`/first-use in try/catch that throws it. Make recovery **single-flight per `targetId`** (in-process `Map<targetId, Promise>`) so N concurrent ops that see the same tab die trigger exactly one `recoverSessionTab`, not N racing `createTab`s. New `resolvePageForTarget(port, targetId)` helper (3 retries, 100ms backoff) replaces every `isTabAlive → getPageByTargetId` sequence in `recoverSessionTab`/`verifySessionTab`/`resolveSessionPage`. Keep `isTabAlive` only for cheap pool-scan decisions, never for "use this page".
2. **Acquire-and-validate under the session lock** (from §B) serializes resolve→use per session, reducing residual TOCTOU to "tab dies mid-op", which is the recoverable path. Keep the `catch {}` fall-through at `tab-recovery.mjs:63-66` but emit a structured warning so leaks/reattaches are observable.

## E. Scale to vendor 5 / global 12–16

Three layers, in order of necessity:
1. **Env limits (necessary, sufficient for the pool):** `AGBROWSE_PROVIDER_POOL_MAX_PER_KEY=5`, `AGBROWSE_PROVIDER_POOL_GLOBAL_MAX=14` (target 12–16 → pick 14), `AGBROWSE_MAX_TABS=20` (headroom above active+pooled). Fix the stale "TTL=15m" help text.
2. **Admission control on active sessions (the real gap):** `acquireActiveLease` (§A) counts current `active-session` leases per-key and globally and **rejects** when `activeCount >= cap` (`AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX=16`, per-vendor 5). Revert `ensureProviderTab`'s `maxTabs: Infinity` to `AGBROWSE_MAX_TABS` after slot acquire. This moves the cap from "pool cleanup" to "admission".
3. **Backpressure / fairness:** return a typed `WebAiError{ errorCode: 'provider.capacity', retryHint: 'retry-after', evidence: { activeCount, cap, retryAfterMs } }`. Prefer **reject-with-retry-after** over unbounded queueing at the 12–16 ceiling (avoids head-of-line blocking a 3600s pro session behind a queue). Optional bounded FIFO per `leaseKey` (≤120s wait) for fairness; keep `vendor ≤ 5` as a hard per-`leaseKey` sub-cap so one vendor can't starve the global pool. jaw/CLI callers must honor `retryAfterMs`.

## Code sketch (illustrative — NOT for commit)

```diff
// tab-lease-store.mjs — typedef + acquire/touch/reap
+ // Lease += lastHeartbeat, ownerPid, expiresAt, activeTtlMs   (reaper keys on lastHeartbeat, NOT leasedAt)
+ export async function acquireActiveLease(port, input) { return withLeaseLock(() => {
+   const active = readStore().leases.filter(l => l.state === 'active-session');
+   if (active.filter(l => l.leaseKey === key).length >= ACTIVE_PER_KEY) return { ok:false, reason:'vendor-cap' };
+   if (active.length >= ACTIVE_GLOBAL) return { ok:false, reason:'global-cap' };
+   /* write active-session row w/ lastHeartbeat+ownerPid; return { ok:true, lease } */ }); }
+ export async function touchActiveLease(targetId) { /* withLeaseLock: refresh lastHeartbeat */ }
+ export async function reapStaleActiveLeases(port, now) { /* reclaim iff stale(180s) AND !pidAlive(ownerPid) */ }

// chatgpt.mjs sendWebAi — replace L200-209 (record THEN bind)
+ const acq = await acquireActiveLease(port, { owner:'web-ai', vendor, sessionType:'send-poll', sessionId, targetId, url: page.url() });
+ if (!acq.ok) throw new WebAiError({ errorCode:'provider.capacity', stage:'lease-acquire', retryHint:'retry-after', evidence: acq });
+ bindSessionToTab(session.sessionId, targetId);

// cli.mjs — initial send symmetric with resume
- case 'send': return withWebAiActiveCommand(command, deps, input, () => sendWebAi(deps, input));
+ case 'send': return withSessionCommandLock(input.session ?? mintedSessionId,
+     () => withWebAiActiveCommand(command, deps, input, () => sendWebAi(deps, input)));

// watcher.mjs — serialize reattach+poll (wrap L176-188)
+ return withSessionCommandLock(session.sessionId, () => withSessionPage(deps, options.sessionId, async ({ page, targetId }) => {
+   await touchActiveLease(targetId); /* ensureWatcherAttached + poll */ }));
```

## Test Strategy (absorbs area-5 concurrency gaps)

Homes: `test/unit/web-ai-session-store.test.mjs` (lock FIFO at :222-225), `web-ai-watcher.test.mjs`, `tab-lifecycle.test.mjs`, `web-ai-shared-target-lock.test.mjs`.

1. **Concurrent send+poll on one session (mutex).** Slow stub send (resolve after 200ms) + concurrent `poll --session`; assert poll's lock-acquire blocks until send releases, and `conversationUrl` ends at the send-written value, never interleaved.
2. **Lease acquisition under contention (3→5→6 agents).** N simulated PIDs call `acquireActiveLease` on one store; assert exactly `min(N, cap)` succeed, rest `{ ok:false, reason:'global-cap' }`; ≤5 per `leaseKey`.
3. **Tab recovery during active polling.** Mid-poll, `isTabAlive`→true then `getPageByTargetId`→`TabDeadError` (the TOCTOU window); assert exactly one `createTab` fires across 3 concurrent callers on the same `targetId` (single-flight), session rebinds.
4. **Watcher reattach during mid-flight send.** Hold the session lock via a fake in-flight send; invoke `watchSessionOnce`; spy `page.goto` call-count == 0 while locked.
5. **Lease TTL expiry for crashed sessions.** `active-session` lease with dead `ownerPid` + `lastHeartbeat` = now−7min → `reapStaleActiveLeases` closes the tab + removes the row. Negative: live PID ⇒ not reaped even if heartbeat old.
6. **(critical) Legit 3600s pro wait is NOT reaped.** Lease `leasedAt` = now−3000s, `lastHeartbeat` = now−45s (q60s renewal), live PID; advance `now`; assert the lease survives. Second variant: drive the real `withSessionCommandLock` heartbeat over a fake clock to prove `touchActiveLease` keeps `lastHeartbeat` fresh across the hold.
7. **Atomicity (no unleased-bound window).** Interleave a reader between record and bind; assert it never observes a bound target whose `active-session` lease row is absent (record-before-bind invariant).

## Open Risks / Tradeoffs

- **Lease-TTL vs 3600s pro (primary).** Hinges on `lastHeartbeat` renewal firing for the full hour. Mitigations: process-dead AND-gate (live PID never reaped regardless of heartbeat); heartbeat runs on an `.unref()`'d `setInterval` independent of awaited work; `activeTtlMs`(≈6m via 180s+grace) ≫ heartbeat (60s) → ≥3× margin.
- **Two lock files** → fixed ordering (session → lease); opposite order risks deadlock. Documented + retry-timeout-bounded.
- **Backpressure choice** — reject-with-retry-after pushes retry policy to callers (jaw + CLI must honor `retryAfterMs`); a bounded queue is fairer but risks a CLI burst delaying a jaw employee. Reject is the safer default at the 12–16 ceiling; add a `priority` field only if needed.
- **Single-flight recovery is in-process only** — two separate CLI processes seeing the same tab die can still both `createTab`; the active-lease admission cap (§E.2) is the cross-process backstop.
- **Stale docs** — `cli.mjs:213` / `browser.mjs:3370` "TTL=15m" vs code 30m; fix with the cap bump.
