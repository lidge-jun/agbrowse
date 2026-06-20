# Tab Parallel Stability — Root Cause (verified)

> All paths under `web-ai/` unless noted. Two independent investigations (CLI sub-agent + Backend employee) reached the same four root causes; both are folded in. Line numbers observed 2026-06-19.

## Pool defaults today

`maxPerKey=3` (vendor cap), `globalMax=8`, TTL `30m` (`tab-lease-store.mjs:64-66`). Note: help text in `cli.mjs:213` and `skills/browser/browser.mjs:3370` says "TTL=15m" — **stale doc**, actual default is 30m.

## Gap 1 — TOCTOU in tab recovery

`tab-recovery.mjs:34-68` — `recoverSessionTab` checks liveness, then *separately* fetches the page; the tab can close in the gap:

```js
const alive = await isTabAlive(port, session.targetId);          // L34
if (alive) {
    const page = await getPageByTargetId(port, session.targetId); // L38
    if (page) {
        const currentUrl = page.url();                            // L41 — can throw "Target closed"
        ...
        await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 }); // L51 — can throw
```

The same check→use pattern recurs in `verifySessionTab` (`:121-131`) and `resolveSessionPage` (`:294,:311`). `withSessionPage` (`:391-402`) only retries on `isPageDeathError` — a **string-match** classifier (`:179-188`, matches `'target closed'|'page closed'|'crash'`) — so any death that doesn't stringify to those tokens escapes as a hard error. The Backend employee confirmed the identical pattern in `skills/browser/tab-manager.mjs:395-401,427-444`.

## Gap 2 — Lease↔session binding is non-atomic (sync bind + async lease)

`chatgpt.mjs:200-209`:

```js
if (targetId) bindSessionToTab(session.sessionId, targetId);   // L200 — synchronous session-store write
if (targetId) await recordActiveLease({ ... targetId, url: page.url(), port }); // L201 — separate awaited fs-locked write
```

`bindSessionToTab` (`session.mjs:277`) updates the session immediately; `recordActiveLease` (`tab-lease-store.mjs:221`) takes a **different lock file** (`web-ai-tab-leases.json.lock`) than the session store. Between L200 and the lease being durably written, the session is **bound to a target with no active lease row**. A watcher running in a separate process (`watcher.mjs:114` `watchSessionOnce` → `withSessionPage` → `ensureWatcherAttached` `:398-412`) can read the session in that window; a concurrent `checkoutPooledLease`/`cleanupLeasedTabs` on the same `browserProfileKey` can then treat that target as free → **reattach-mismatch**. Same bug in `deepResearchWebAi` (`chatgpt.mjs:625-633`). The `active-command` row (`cli.mjs:1305-1318`) partially mitigates via `activeCommandTargetIds` (`tab-lease-store.mjs:345,355`) but is keyed on the command's lifetime, not the lease.

## Gap 3 — No send+poll mutex on the same session

The lock primitive exists (`session-store.mjs:272` `withSessionCommandLock`) and **poll holds it** (`cli.mjs:1107`), **resume-send holds it** (`cli.mjs:1267`). But it's only taken when `input.session` is set (`cli.mjs:1266`). The **initial** send creates the session *inside* `sendWebAi` and dispatches through the unlocked branch:

```js
case 'send': return withWebAiActiveCommand(command, deps, input, () => sendWebAi(deps, input)); // cli.mjs:1361 — NO lock
```

`sendWebAi` (`chatgpt.mjs:160-321`) never acquires the lock, yet it mutates `conversationUrl` at `:289-291`:

```js
const finalUrl = page.url();
if (session && finalUrl !== session.conversationUrl)
    updateSession(session.sessionId, { conversationUrl: finalUrl });   // L290
```

while `poll` reads/writes the same field. Two writers on one session's `conversationUrl`, no shared mutex = the classic send/poll race. The watcher is also unprotected: its lock (`watcher.mjs:142`) wraps only the timeout→polling status flip; the actual reattach+poll (`watcher.mjs:176-188`, including `page.goto` at `:404`) runs **outside** any session lock. `queryWebAi` = send→poll with no outer lock (`chatgpt.mjs:587-597`).

## Gap 4 — Crashed-session lease leak (no TTL on active leases)

`recordActiveLease` writes `state: 'active-session'` with `leasedAt`/`updatedAt` but **no `poolExpiresAt`, no heartbeat** (`tab-lease-store.mjs:225-230`). Every reclamation path keys off `state === 'pooled'` + `poolExpiresAt`:

```js
// checkoutPooledLease L254-256 — active-session never selected
.filter(lease => lease.state === 'pooled' && lease.leaseKey === key)
// selectOverflowAndExpired L465-468 — pooled only
const pooled = leases.filter(lease => lease.state === 'pooled');
```

`cleanupLeasedTabs` (`:340-370`) reclaims an `active-session` lease only if the **tab is physically dead** (`!isTabAlive`, `:352`). A **crashed CLI/jaw process** leaves the tab open and the lease intact → the tab is locked forever, permanently consuming a `maxPerKey=3`/`globalMax=8` slot. `releaseCompletedLease` (`:289`) is the only `active-session → pooled` transition and runs only on the happy path.

## Gap 5 (scaling) — No admission control on *live* concurrency

`ensureProviderTab` (`cli.mjs:972-1011`) cleans pooled tabs, tries a pooled/reused tab, otherwise **unconditionally `createTab`** (`:1001`, with `maxTabs: Infinity` at `:978`). `globalMax`/`maxPerKey` are consulted **only** inside `selectOverflowAndExpired` over `pooled` rows — they cap the **idle pool, never the count of concurrent active-session leases**. So nothing today queues or rejects the 13th concurrent send; it just opens another tab. This is the gap that must close before scaling to vendor 5 / global 12–16.

## ⚠️ The cross-cutting risk — three TTLs collide at pro=3600s

Independently flagged by the Backend employee as the *single biggest risk*. A live session is governed by three TTLs, none aware of pro=3600s:

| TTL | Value | Source | At pro=3600s |
|-----|-------|--------|--------------|
| Session command lock | 35 min | `session-store.mjs:50` | Expires mid-wait → another command seizes the session |
| Active-command heartbeat | 2 min | `active-command-store.mjs:37` | Expires mid-poll → cleanup stops protecting the tab |
| Active-session lease | none | `tab-lease-store.mjs:221-236` | Crashed session locks the tab forever |

Fix must unify all three on the **model-aware deadline from `260619_timeout_adaptive_scaling`** + a 60s heartbeat *before* raising caps. See `10_solution_plan.md` §C/§E.

## Evidence index

`tab-recovery.mjs` 34-68, 121-131, 179-188, 294, 311, 391-402 · `chatgpt.mjs` 160-321, 190-209, 289-291, 587-597, 625-633 · `tab-lease-store.mjs` 64-66, 221-236, 243-282, 289-333, 340-370, 462-490 · `session-store.mjs` 46-50, 227-234, 262, 272-316 · `cli.mjs` 972-1011, 1101-1128, 1265-1319, 1326-1410 (init send 1361) · `watcher.mjs` 114-188, 398-412 · `session.mjs` 246-266, 277-288 · `active-command-store.mjs` 37 · `skills/browser/tab-manager.mjs` 395-444 · `skills/browser/tab-lifecycle.mjs`.
