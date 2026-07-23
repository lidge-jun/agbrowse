# 070 — Recoverable CDP disconnect classification and bounded harvest (G30)

Date: 2026-07-24  
Status: Diff-level implementation roadmap  
Format: DIFFLEVEL-ROADMAP-01  
Work-phase: WP6  
Upstream evidence: Oracle `28c584db`

## Objective

Distinguish a Playwright/CDP socket loss from Chrome or target death during an in-flight watcher harvest. A disconnect is recoverable only when an independent DevTools HTTP probe succeeds and the session's saved `targetId` is present in `/json/list`. On that proven-live path, preserve the non-terminal session and perform exactly one reattach-plus-harvest attempt. Endpoint failure, missing target, absent target id, malformed target data, and target-list errors fail closed and do not navigate or create a replacement tab.

The watcher is the natural policy owner: `watchSessionOnce` owns in-flight harvest (`web-ai/watcher.mjs:123-230`), while `tab-recovery.mjs` owns page rebinding. The liveness probe is a small dependency-leaf module and must not use the disconnected Playwright client.

## Gaps covered

| Gap | Current failure | Planned closure |
| --- | --- | --- |
| G30 | `isPageDeathError` handles target/page/browser closure but not generic CDP socket loss; `withSessionPage` force-recovers without endpoint+target proof; watcher has no disconnect policy | Classify socket-disconnect errors, prove endpoint and saved target over HTTP, preserve polling state, and run one watcher-owned reattach/harvest attempt only on proven liveness |

## File change map

| Action | Exact path | Functions / anchors in current tree | Diff intent |
| --- | --- | --- | --- |
| NEW | `web-ai/cdp-liveness.mjs` | new `probeCdpLiveness`, `isRecoverableCdpDisconnect` | Probe `/json/version` then `/json/list` with bounded HTTP timeouts; fail closed for requested-target uncertainty |
| MODIFY | `web-ai/tab-recovery.mjs` | `isPageDeathError` `:206-219`; `resolveSessionPage` `:417-568`; `withSessionPage` `:570-590` | Add `isCdpDisconnectError`; expose one non-duplicating `reattachSessionPage` operation that refuses replacement-tab recovery for this path |
| MODIFY | `web-ai/watcher.mjs` | imports `:11-18`; `watchSessionOnce` `:123-230`; watcher harvest callback begins `:193`; `callVendorPoll` `:515-539` | Catch only CDP-disconnect errors around the whole attach/preflight/poll harvest, classify liveness, retain polling state, then invoke one bounded reattach+harvest attempt |
| MODIFY | `test/unit/web-ai-tab-recovery.test.mjs` | source/guard suite `:7-34`; imported guards `:38-44` | Test disconnect matcher separation and no replacement-tab reattach contract |
| MODIFY | `test/unit/web-ai-watcher.test.mjs` | watcher source contracts `:8-58`; executable helpers after `:92` | Test recoverable, endpoint-dead, target-missing, list-error, and one-attempt behavior |
| NEW | `test/unit/web-ai-cdp-liveness.test.mjs` | new focused unit suite | Exercise HTTP-independent injected probe functions and fail-closed classification |

## Proposed diffs

### 1. Add an independent, bounded liveness probe

Before: no local endpoint-plus-target classifier.

After — `web-ai/cdp-liveness.mjs`:

```js
// @ts-check

/**
 * @typedef {{ endpointReachable: boolean, targetFound: boolean|null, matchedUrl?: string, error?: string }} CdpLiveness
 */

/**
 * @param {{ port: number, targetId?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<CdpLiveness>}
 */
export async function probeCdpLiveness(options) {
    const port = Number(options.port);
    const targetId = options.targetId?.trim() || '';
    if (!Number.isFinite(port) || port <= 0) {
        return { endpointReachable: false, targetFound: null, error: 'missing debug port' };
    }
    if (!targetId) {
        return { endpointReachable: false, targetFound: null, error: 'missing target id' };
    }

    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs || 1_500;
    try {
        const versionResponse = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!versionResponse.ok) {
            return { endpointReachable: false, targetFound: null, error: `DevTools version HTTP ${versionResponse.status}` };
        }
    } catch (err) {
        return { endpointReachable: false, targetFound: null, error: String(/** @type {any} */ (err)?.message || err) };
    }

    try {
        const listResponse = await fetchImpl(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!listResponse.ok) {
            return { endpointReachable: true, targetFound: null, error: `DevTools list HTTP ${listResponse.status}` };
        }
        const targets = await listResponse.json();
        if (!Array.isArray(targets)) {
            return { endpointReachable: true, targetFound: null, error: 'DevTools target list is not an array' };
        }
        const match = targets.find(target => target?.id === targetId || target?.targetId === targetId);
        return match
            ? { endpointReachable: true, targetFound: true, matchedUrl: typeof match.url === 'string' ? match.url : undefined }
            : { endpointReachable: true, targetFound: false };
    } catch (err) {
        return { endpointReachable: true, targetFound: null, error: String(/** @type {any} */ (err)?.message || err) };
    }
}

/**
 * @param {CdpLiveness} liveness
 * @returns {boolean}
 */
export function isRecoverableCdpDisconnect(liveness) {
    return liveness.endpointReachable === true && liveness.targetFound === true;
}
```

Unlike Oracle's optional endpoint-only case, the watcher always has a persisted session and therefore requires its `targetId`. This tighter local contract prevents a root navigation/new-tab fallback from being mistaken for recovery.

### 2. Separate socket loss from page/target death

Before — `web-ai/tab-recovery.mjs:210-219`:

```js
export function isPageDeathError(err) {
    const e = /** @type {{ message?: unknown }} */ (err);
    const msg = String(e?.message || err || '').toLowerCase();
    return (
        msg.includes('target closed') ||
        msg.includes('page closed') ||
        msg.includes('browser has been closed') ||
        msg.includes('crash')
    );
}
```

After, retain that function and add a non-overlapping classifier:

```js
/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isCdpDisconnectError(err) {
    const e = /** @type {{ message?: unknown }} */ (err);
    const msg = String(e?.message || err || '').toLowerCase();
    if (isPageDeathError(err)) return false;
    return (
        msg.includes('browser disconnected') ||
        msg.includes('connection closed') ||
        msg.includes('websocket is not open') ||
        msg.includes('websocket closed') ||
        msg.includes('connection to the browser')
    );
}
```

Do not add these strings to `isPageDeathError`: that existing branch may create a replacement tab (`recoverSessionTab:95-120`), which is forbidden until liveness is proven and is the wrong action when the original target is alive.

### 3. Add a target-preserving reattach primitive

After `resolveSessionPage` and before `withSessionPage` in `web-ai/tab-recovery.mjs`:

```js
/**
 * Reconnect to the saved target after independent liveness proof.
 * Never navigates and never creates a replacement target.
 * @param {RecoverDeps} deps
 * @param {string} sessionId
 * @returns {Promise<ResolvedPage<unknown>>}
 */
export async function reattachSessionPage(deps, sessionId) {
    const session = getSession(sessionId);
    if (!session?.targetId) throw new Error(`Session ${sessionId} has no targetId for CDP reattach`);
    const page = await getPageByTargetId(deps.getPort(), session.targetId);
    if (!page) throw new Error(`Session ${sessionId} target ${session.targetId} unavailable after CDP reconnect`);
    page.url();
    return { page, targetId: session.targetId, session };
}
```

`getPageByTargetId` reaches the tab manager whose cached browser is cleared on `browser.disconnected` (`skills/browser/tab-manager.mjs:103-115`), so this call naturally establishes a new Playwright-over-CDP client while binding the same proven-live target.

### 4. Make watcher recovery exactly once

Refactor the current callback body at `web-ai/watcher.mjs:193-230` into an internal helper without changing its contents:

```js
async function harvestWatcherSession(deps, options, session, vendor, resolved) {
    const { page, targetId, session: resolvedSession } = resolved;
    // Move the existing profile-lock, ensureWatcherAttached, preflight,
    // sessionDeps, callVendorPoll, persistence, and return logic here unchanged.
}
```

Then replace the direct return with one catch and one retry:

```js
const runHarvest = async () => withSessionPage(
    deps,
    options.sessionId,
    resolved => harvestWatcherSession(deps, options, session, vendor, resolved),
);

try {
    return await runHarvest();
} catch (err) {
    if (!isCdpDisconnectError(err)) throw err;

    const preserved = getSession(options.sessionId) || session;
    const liveness = await probeCdpLiveness({
        port: deps.getPort(),
        targetId: preserved.targetId,
    });
    const recoverable = isRecoverableCdpDisconnect(liveness);
    updateSession(options.sessionId, {
        status: 'polling',
        lastError: {
            errorCode: 'watcher.cdp-disconnected',
            message: recoverable
                ? 'CDP client disconnected; saved target is still reachable'
                : 'CDP connection lost and saved target liveness was not proven',
            evidence: { ...liveness, recoverable },
        },
        warnings: appendUniqueWarning(
            preserved.warnings || [],
            recoverable ? 'watcher-cdp-reattach-once' : 'watcher-cdp-recovery-skipped',
        ),
    });
    if (!recoverable) throw err;

    const reattached = await reattachSessionPage(deps, options.sessionId);
    return harvestWatcherSession(deps, options, preserved, vendor, reattached);
}
```

Required imports:

```js
import { probeCdpLiveness, isRecoverableCdpDisconnect } from './cdp-liveness.mjs';
import {
    isCdpDisconnectError,
    reattachSessionPage,
    withSessionPage,
    urlsCompatible,
} from './tab-recovery.mjs';
```

There is deliberately no loop around the second `harvestWatcherSession` call. If reattach or the resumed harvest disconnects/fails, it escapes to the caller. The session remains `polling` with evidence and can be resumed explicitly; no second automatic attempt is made.

## Test plan

Repository command: `npm test` (`package.json:41`, Vitest). Focused command:

```sh
npx vitest run test/unit/web-ai-cdp-liveness.test.mjs test/unit/web-ai-tab-recovery.test.mjs test/unit/web-ai-watcher.test.mjs --reporter=verbose
```

New focused cases:

- `probeCdpLiveness reports recoverable when version responds and saved target is listed`
- `probeCdpLiveness reports endpoint dead when /json/version rejects or times out`
- `probeCdpLiveness reports target missing when /json/list omits saved targetId`
- `probeCdpLiveness fails closed when /json/list errors, is non-OK, or returns malformed JSON`
- `probeCdpLiveness fails closed without targetId`
- `isCdpDisconnectError matches socket/client disconnect wording but excludes target/page/browser closed and crash`
- `watchSessionOnce preserves polling state and invokes reattachSessionPage once on proven liveness`
- `watchSessionOnce does not reattach when Chrome endpoint is unreachable`
- `watchSessionOnce does not reattach when target is missing or target-list proof is uncertain`
- `watchSessionOnce does not make a second automatic attempt when resumed harvest fails`
- `watchSessionOnce rethrows unrelated poll/provider errors without probing liveness`

Use injected `fetchImpl` response doubles for the liveness unit suite. For watcher execution tests, expose or dependency-inject the probe/reattach functions rather than opening a real browser. Keep one optional manual smoke outside the deterministic suite:

1. Start agbrowse Chrome and an in-flight ChatGPT watch.
2. Record the session `targetId`.
3. Drop only the Playwright/CDP WebSocket while leaving Chrome running.
4. Observe `watcher-cdp-reattach-once` and a completed/continued harvest from the same target.
5. Repeat after closing Chrome; observe `watcher-cdp-recovery-skipped` and no new tab.

Full regression command:

```sh
npm test
```

## Accept criteria

- Socket loss is not classified as target death.
- Recovery requires successful `/json/version` and positive saved-target membership in `/json/list`.
- No probe uses the disconnected Playwright connection.
- Endpoint down, target absent, missing target id, list failure, malformed response, and timeout all skip automatic recovery.
- Proven-live recovery reuses the same target id; it never calls `createTab`, navigates to a fallback, or mutates `targetId`.
- Session status remains non-terminal and liveness evidence is retained.
- At most one automatic reattach+harvest attempt occurs per caught disconnect.
- Focused and full Vitest suites pass.

### C-ACTIVATION-GROUNDING-01 activation scenarios

| Conditional path | How to trigger | Observable proof that the branch fired |
| --- | --- | --- |
| Socket disconnect matcher | Throw `Error('WebSocket is not open: readyState 3')` during watcher harvest | Liveness probe is called; ordinary page-death force-recovery is not |
| Endpoint alive + target alive | `/json/version` 200; `/json/list` contains saved id | `watcher-cdp-reattach-once` warning, same target id rebound, one resumed harvest |
| Chrome gone | Make `/json/version` refuse/timeout | `watcher-cdp-recovery-skipped`; no reattach/create/navigation call |
| Target gone | Return 200 target list without saved id | `targetFound:false` evidence; no automatic recovery |
| Target proof uncertain | Return 500, malformed JSON, or throw from `/json/list` | `targetFound:null` plus error; classifier returns false |
| Missing saved target | Session has null/empty `targetId` | Probe fails closed with `missing target id`; no endpoint-only recovery |
| Reattach succeeds | First harvest disconnects; same-target rebind and poll complete | Session reaches provider-derived completion and answer is harvested |
| Reattach fails again | First harvest disconnects; second harvest throws | Exactly one `reattachSessionPage` invocation; error escapes and session remains polling |
| True page death | Throw `Target closed` | Existing `isPageDeathError` path handles it; CDP liveness branch is not entered |
| Unrelated provider failure | Throw `provider.poll-timeout` or capability error | Existing watcher behavior remains; probe call count is zero |

## Risks / rollback

- **Error-string drift:** Playwright wording can change. Keep matcher tests against observed variants and do not use a broad `closed` substring that would conflate target death.
- **HTTP race:** a target can disappear after positive proof. Same-target reattach then fails once and escapes; it must not fall back to a new tab.
- **Double recovery:** `withSessionPage` already retries `isPageDeathError` once (`tab-recovery.mjs:580-590`). Keeping CDP errors out of that classifier prevents two independent retries.
- **Session terminal overwrite:** only enter this branch from the non-terminal section of `watchSessionOnce` (`watcher.mjs:164-186`), and re-read the session before writing `polling`.
- **Remote host scope:** current agbrowse dependencies expose a local CDP port. This phase probes `127.0.0.1`; remote DevTools host support requires an explicit dependency contract and is out of scope.
- **Rollback:** remove watcher catch/imports and the new liveness module together. The added disconnect classifier/reattach primitive can be removed independently only after no caller imports them. Existing page-death recovery remains unchanged.
