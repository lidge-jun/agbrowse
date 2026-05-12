# Plan — web-ai session rebinding hardening

Status: plan only  
Issue: https://github.com/lidge-jun/agbrowse/issues/77  
Source: recovered GPT Pro agbrowse-only audit + live interrupted Pro session recovery on 2026-05-10

## Plain goal

`agbrowse web-ai --session <id>` should behave like a durable handle to one provider conversation, not like "whatever ChatGPT/Gemini/Grok tab happens to be active". If a long Pro/Deep Think run outlives the shell, times out locally, or the tab target changes, the CLI should either recover the bound target with explicit evidence or fail with a precise session/target/lock reason.

## Current failure chain to lock down

```text
send returned sessionId
-> ChatGPT tab kept streaming
-> poll timed out locally and marked session timeout
-> watch treated timeout as terminal immediately
-> active-tab poll saw root -> /c/... conversation mismatch
-> session poll was blocked by stale .cmd lock from a dead pid
-> manual stale lock removal allowed session poll to complete
```

## Scope

### P0 correctness

- `sessions reattach` must use the same target-id recovery path as `poll --session`.
- `sessions resume` must use the same session-bound page/deps wrapper as `poll --session`.
- session command locks must heartbeat and distinguish dead PID stale locks from live long polls.
- `watch --session` must not treat a transient local poll timeout as terminal when the session deadline has not expired.
- add `sessions doctor <id>` to show session target, URL, lock, active command, tab, and recommended next action.

### P1 hardening

- make provider tab reuse more conservative so pooled/reusable tabs are not mistaken for a clean session target.
- add regression tests for closed tab, root-to-conversation URL drift, stale lock, wrong active tab, and watch recovery.

### P2 naming cleanup

- split copy fallback policy wording from OS clipboard read wording. Do not prioritize local file path guards in this plan.

## Repository signals read

- `package.json`: JS ESM package, Vitest, `typecheck:checkjs`.
- `structure/INDEX.md`: structure docs are source of truth and must be updated when runtime contracts/commands change.
- `structure/runtime_contracts.md`: session/tab runtime contract already says session recovery is required.
- `structure/commands.md`: `sessions resume`, `sessions reattach`, `watch`, and `doctor` command surface is documented.
- `devlog/00_index.md`: new active plans belong under `devlog/_plan/`; `_fin/mvp/` is read-only history.

## File map

| Path | Action | Purpose |
| --- | --- | --- |
| `web-ai/session-store.mjs` | MODIFY | heartbeat + PID-aware session command lock, expose lock inspection |
| `web-ai/tab-recovery.mjs` | MODIFY | export reusable `resolveSessionPage()` used by poll/resume/reattach/watch |
| `web-ai/cli-sessions.mjs` | MODIFY | route `resume`/`reattach`/new `doctor` through session-bound recovery |
| `web-ai/watcher.mjs` | MODIFY | continue polling after transient timeout before session deadline |
| `web-ai/cli.mjs` | MODIFY | command/help/parser updates, possible shared session-bound helper import |
| `web-ai/session-doctor.mjs` | NEW | pure session diagnostic report builder |
| `web-ai/policy/enforce.mjs` | MODIFY P2 | rename/split copy fallback action from OS clipboard read |
| `web-ai/mcp-server.mjs` | MODIFY P2 | align MCP copy fallback policy naming if P2 is included |
| `README.md` | MODIFY | document durable session recovery and beta caveat |
| `structure/runtime_contracts.md` | MODIFY | update session lock/recovery contract |
| `structure/commands.md` | MODIFY | add `sessions doctor <id>` and clarify reattach/resume |
| `docs/production-readiness.md` | MODIFY | mark web-ai durable sessions beta until #77 matrix is green |
| `test/unit/web-ai-session-store.test.mjs` | MODIFY | lock heartbeat/PID stale tests |
| `test/unit/web-ai-sessions-command.test.mjs` | MODIFY | resume/reattach/doctor source + behavioral tests |
| `test/unit/web-ai-tab-recovery.test.mjs` | NEW | closed tab/recovered target/root drift tests |
| `test/unit/web-ai-watcher.test.mjs` | NEW | transient timeout does not end watch before deadline |
| `test/unit/web-ai-session-doctor.test.mjs` | NEW | doctor report redaction and recommendation tests |
| `test/unit/web-ai-provider-session.test.mjs` | MODIFY | update source-contract expectations around session-bound helpers |
| `test/integration/web-ai-policy-cli.test.mjs` | MODIFY P2 | policy wording compatibility tests |

## Diff-level plan

### 1. MODIFY `web-ai/session-store.mjs`

Current lock behavior:

```diff
-const STALE_LOCK_MS = 5 * 60 * 1000;
+const STORE_LOCK_STALE_MS = 5 * 60 * 1000;
+const SESSION_COMMAND_LOCK_HEARTBEAT_MS = 15_000;
+const DEFAULT_SESSION_COMMAND_LOCK_TTL_MS = 35 * 60 * 1000;
```

Current stale check is timestamp-only:

```diff
-function isStaleLock(path) {
+function isStoreLockStale(path) {
     try {
         const raw = readFileSync(path, 'utf8');
         const parsed = JSON.parse(raw);
         const acquired = Date.parse(parsed?.acquiredAt || '');
         if (!Number.isFinite(acquired)) return true;
-        return Date.now() - acquired > STALE_LOCK_MS;
+        return Date.now() - acquired > STORE_LOCK_STALE_MS;
     } catch {
         return true;
     }
 }
```

Also rename the only remaining caller inside `withStoreLock` (currently `session-store.mjs:152`):

```diff
     while (attempts < LOCK_RETRY_LIMIT) {
         try {
             fd = openSync(path, 'wx');
             break;
         } catch (err) {
             if (err?.code !== 'EEXIST') throw err;
             attempts += 1;
-            const stale = isStaleLock(path);
+            const stale = isStoreLockStale(path);
             if (stale) {
                 try { unlinkSync(path); } catch { /* race */ }
                 continue;
             }
             sleepBlockingMs(LOCK_RETRY_MS);
         }
     }
```

Add PID-aware command-lock helpers. `commandLockMetadata` and `readLockFile` are now defined explicitly so the diff below does not depend on undefined symbols:

```diff
+function commandLockMetadata(sessionId, ttlMs, acquiredAtMs = Date.now()) {
+    const ttl = Number(ttlMs || DEFAULT_SESSION_COMMAND_LOCK_TTL_MS);
+    const now = Date.now();
+    return {
+        pid: process.pid,
+        sessionId,
+        acquiredAt: new Date(acquiredAtMs).toISOString(),
+        heartbeatAt: new Date(now).toISOString(),
+        expiresAt: new Date(now + ttl).toISOString(),
+    };
+}
+
+function readLockFile(path) {
+    if (!existsSync(path)) return null;
+    try {
+        return { path, ...JSON.parse(readFileSync(path, 'utf8')) };
+    } catch {
+        return { path, corrupt: true };
+    }
+}
+
+function pidAlive(pid) {
+    if (!Number.isFinite(pid) || pid <= 0) return false;
+    try { process.kill(pid, 0); return true; }
+    catch (err) { return err?.code === 'EPERM'; }
+}
+
+function isSessionCommandLockStale(path) {
+    const lock = readLockFile(path);
+    if (!lock || lock.corrupt) return true;
+    if (!pidAlive(Number(lock.pid))) return true;
+    const heartbeat = Date.parse(lock.heartbeatAt || lock.acquiredAt || '');
+    const expires = Date.parse(lock.expiresAt || '');
+    if (Number.isFinite(expires)) return expires <= Date.now();
+    return Number.isFinite(heartbeat) && Date.now() - heartbeat > DEFAULT_SESSION_COMMAND_LOCK_TTL_MS;
+}
+
+export function readSessionCommandLock(sessionId) {
+    const path = sessionCommandLockPath(sessionId);
+    const raw = readLockFile(path);
+    if (!raw) return null;
+    if (raw.corrupt) return { ...raw, stale: true };
+    return { ...raw, stale: isSessionCommandLockStale(path) };
+}
```

Contract: `readSessionCommandLock` always returns a populated `stale: boolean` (never `undefined`), so downstream branches such as `lock?.stale === false` are well-defined.

Current command lock:

```diff
-export async function withSessionCommandLock(sessionId, fn) {
+export async function withSessionCommandLock(sessionId, fn, options = {}) {
     const path = sessionCommandLockPath(sessionId);
     mkdirSync(dirname(path), { recursive: true });
     let fd = null;
     let attempts = 0;
+    const ttlMs = Number(options.ttlMs || DEFAULT_SESSION_COMMAND_LOCK_TTL_MS);
+    const heartbeatMs = Number(options.heartbeatMs ?? SESSION_COMMAND_LOCK_HEARTBEAT_MS);
+    const acquiredAtMs = Date.now();
     while (attempts < LOCK_RETRY_LIMIT) {
         try {
             fd = openSync(path, 'wx');
             try {
-                writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString(), sessionId }));
+                writeFileSync(fd, JSON.stringify(commandLockMetadata(sessionId, ttlMs, acquiredAtMs)));
             } catch { /* best-effort metadata write */ }
             break;
         } catch (err) {
             const e = /** @type {NodeJS.ErrnoException} */ (err);
             if (e?.code !== 'EEXIST') throw err;
             attempts += 1;
-            const stale = isStaleLock(path);
+            const stale = isSessionCommandLockStale(path);
             if (stale) {
                 try { unlinkSync(path); } catch { /* races resolve naturally */ }
                 continue;
             }
             sleepBlockingMs(LOCK_RETRY_MS);
         }
     }
     if (fd === null) {
         throw new Error(`web-ai session command: failed to acquire lock for ${sessionId} after ${LOCK_RETRY_LIMIT} attempts`);
     }
+    const heartbeatTimer = heartbeatMs > 0 ? setInterval(() => {
+        try { writeFileSync(path, JSON.stringify(commandLockMetadata(sessionId, ttlMs, acquiredAtMs))); } catch { /* best effort */ }
+    }, Math.max(1000, heartbeatMs)) : null;
+    heartbeatTimer?.unref?.();
     try {
         return await fn();
     } finally {
+        if (heartbeatTimer) clearInterval(heartbeatTimer);
         try { closeSync(fd); } catch { /* already closed */ }
         try { unlinkSync(path); } catch { /* already gone */ }
     }
 }
```

Acceptance:

- a dead PID lock is removed immediately.
- a live PID lock with fresh heartbeat is not removed after 5 minutes.
- long poll command lock TTL defaults longer than the longest documented poll example.

### 2. MODIFY `web-ai/tab-recovery.mjs`

Extract the current private resolver inside `withSessionPage` into an exported primitive:

```diff
+export async function resolveSessionPage(deps, sessionId, options = {}) {
+    const allowNavigate = options.allowNavigate !== false;
+    const forceRecover = options.forceRecover === true;
+    const session = getSession(sessionId);
+    if (!session) throw new Error(`Session not found: ${sessionId}`);
+    // Move existing resolvePage body here.
+    // Return value MUST match the contract documented below.
+}
```

`resolveSessionPage` return contract (locked; callers in §3 and §5 depend on this exact shape):

```ts
type ResolveSessionPageOk = {
    mismatch: false,
    page: Page,                          // always non-null when mismatch === false
    targetId: string,
    session: WebAiSessionRecord,         // post-recovery refreshed record
    recovered: boolean,                  // true if a new tab was opened or stored target was replaced
    strategy: 'existing-tab' | 'new-tab' | 'recovered',
    warnings: string[],
    url: string,                         // page.url() at resolve time
    conversationUrl: string | null,      // session.conversationUrl after resolve
};

type ResolveSessionPageMismatch = {
    mismatch: true,
    page: null,                          // never opened — caller decides next step
    targetId: string | null,             // last known targetId from session record
    session: WebAiSessionRecord,
    recovered: false,
    strategy: 'existing-tab' | 'new-tab' | 'recovered',
                                         // 'existing-tab' = tab matched but URL drifted,
                                         // 'recovered'    = stored target would need replacement,
                                         // 'new-tab'      = would need to open a new tab but
                                         //                  allowNavigate=false prevented it.
    warnings: string[],
    url: string | null,                  // current chrome URL when tab exists, else null
    conversationUrl: string | null,
};

type ResolveSessionPageResult = ResolveSessionPageOk | ResolveSessionPageMismatch;
```

`mismatch: true` is returned only when `allowNavigate === false` and either:
- the resolved tab's URL is not on `session.conversationUrl`/`session.originalUrl`'s host+pathname prefix, or
- the stored target is closed and a new tab would have to be created to recover.

In all other branches the function returns `mismatch: false` and `page` is guaranteed non-null.

Then simplify `withSessionPage`:

```diff
-export async function withSessionPage(deps, sessionId, fn) {
-    const session = getSession(sessionId);
-    if (!session) throw new Error(`Session not found: ${sessionId}`);
-    const port = deps.getPort();
-    async function resolvePage(forceRecover = false) {
-        ...
-    }
-    const first = await resolvePage();
+export async function withSessionPage(deps, sessionId, fn) {
+    const first = await resolveSessionPage(deps, sessionId, { allowNavigate: true });
     try {
         return await fn(first);
     } catch (err) {
         if (!isPageDeathError(err)) throw err;
-        const recovered = await resolvePage(true);
+        const recovered = await resolveSessionPage(deps, sessionId, { allowNavigate: true, forceRecover: true });
         return fn(recovered);
     }
 }
```

Acceptance:

- `poll --session`, `stop --session`, `send --session`, `query --session`, `watch --session`, `sessions resume`, and `sessions reattach` share the same binding code.
- root URL -> live `/c/...` provider conversation URL continues to prefer the live URL.
- explicit reattach can report mismatch without mutating the wrong active tab.

### 3. MODIFY `web-ai/cli-sessions.mjs`

Subcommand whitelist:

```diff
-const SESSIONS_SUBCOMMANDS = new Set(['list', 'show', 'resume', 'reattach', 'prune']);
+const SESSIONS_SUBCOMMANDS = new Set(['list', 'show', 'resume', 'reattach', 'doctor', 'prune']);
```

Imports:

```diff
 import { pollWebAi } from './chatgpt.mjs';
 import { geminiPollWebAi } from './gemini-live.mjs';
 import { grokPollWebAi } from './grok-live.mjs';
 import { WebAiError } from './errors.mjs';
 import { getSession, listSessions, pruneSessionsOlderThan } from './session.mjs';
+import { resolveSessionPage, withSessionPage } from './tab-recovery.mjs';
+import { withSessionCommandLock } from './session-store.mjs';
+import { buildSessionDoctorReport } from './session-doctor.mjs';
```

Resume current behavior:

```diff
-        const pollFn = session.vendor === 'gemini' ? geminiPollWebAi : session.vendor === 'grok' ? grokPollWebAi : pollWebAi;
-        const result = await pollFn(deps, pollInput);
+        const pollFn = session.vendor === 'gemini' ? geminiPollWebAi : session.vendor === 'grok' ? grokPollWebAi : pollWebAi;
+        const result = await withSessionCommandLock(id, () => withSessionPage(deps, id, async ({ page, targetId, session: refreshed }) => {
+            const sessionDeps = {
+                ...deps,
+                getPage: async () => page,
+                getTargetId: async () => targetId,
+                getCdpSession: async () => page.context().newCDPSession(page),
+            };
+            return pollFn(sessionDeps, { ...pollInput, vendor: refreshed.vendor, session: refreshed.sessionId });
+        }));
         return { ...result, status: result.status || 'resumed' };
```

Reattach current behavior:

```diff
-        const page = await deps.getPage();
-        const currentUrl = page?.url?.() || null;
-        const targetUrl = session.conversationUrl || session.originalUrl;
-        ...
-        return { ok: true, status: 'reattached', sessionId: id, url: targetUrl, warnings: ['already on conversationUrl'] };
+        const resolved = await resolveSessionPage(deps, id, { allowNavigate: input.navigate === true });
+        if (resolved.mismatch) {
+            return {
+                ok: false,
+                status: 'reattach-mismatch',
+                sessionId: id,
+                targetId: resolved.targetId,
+                url: resolved.url,
+                conversationUrl: resolved.conversationUrl,
+                warnings: resolved.warnings,
+            };
+        }
+        return {
+            ok: true,
+            status: 'reattached',
+            sessionId: id,
+            targetId: resolved.targetId,
+            url: resolved.page.url?.() || resolved.session.conversationUrl,
+            recovered: resolved.recovered === true,
+            strategy: resolved.strategy || 'existing-tab',
+            warnings: resolved.warnings || [],
+        };
```

New doctor subcommand:

```diff
+    if (sub === 'doctor') {
+        const id = rest[0] || values.session;
+        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions doctor <id> requires a sessionId' });
+        return buildSessionDoctorReport(deps, id, { navigate: input.navigate === true });
+    }
```

Human output:

```diff
+    if (result.status === 'session-doctor') {
+        console.log(`session ${result.sessionId}: ${result.summary}`);
+        for (const line of result.recommendations || []) console.log(`- ${line}`);
+        return;
+    }
```

Acceptance:

- `sessions resume` no longer polls through whatever `deps.getPage()` happens to be.
- `sessions reattach` never uses active tab as truth when a stored target exists.
- `sessions doctor` works without reading answer body or prompt content.

### 4. NEW `web-ai/session-doctor.mjs`

Complete planned public surface:

```js
// @ts-check
import { getSession } from './session.mjs';
import { readSessionCommandLock } from './session-store.mjs';
import { listActiveCommands } from './active-command-store.mjs';
import { verifySessionTab } from './tab-recovery.mjs';

export async function buildSessionDoctorReport(deps, sessionId, options = {}) {
    const session = getSession(sessionId);
    if (!session) {
        return {
            ok: false,
            status: 'session-doctor',
            sessionId,
            summary: 'missing session record',
            recommendations: ['Run: agbrowse web-ai sessions list'],
        };
    }
    const port = deps.getPort?.() || 9222;
    const target = await verifySessionTab(deps, session).catch(error => ({ valid: false, needsRecovery: true, error: error?.message || String(error) }));
    const lock = readSessionCommandLock(sessionId);
    const activeCommands = await listActiveCommands({ browserProfileKey: String(port) }).catch(error => [{ status: 'unknown', error: error?.message || String(error) }]);
    const recommendations = recommendSessionActions({ session, target, lock, activeCommands, navigate: options.navigate === true });
    return {
        ok: true,
        status: 'session-doctor',
        sessionId,
        vendor: session.vendor,
        summary: summarizeSession({ session, target, lock }),
        session: sanitizeSession(session),
        target,
        lock,
        activeCommands,
        recommendations,
    };
}

export function sanitizeSession(session) {
    return {
        sessionId: session.sessionId,
        vendor: session.vendor,
        status: session.status,
        deadlineAt: session.deadlineAt || null,
        targetId: session.targetId || null,
        tabId: session.tabId || null,
        originalUrl: redactUrl(session.originalUrl),
        conversationUrl: redactUrl(session.conversationUrl),
        updatedAt: session.updatedAt,
        warnings: session.warnings || [],
        lastError: session.lastError || null,
        tabState: session.tabState || null,
    };
}

function summarizeSession({ session, target, lock }) {
    if (lock?.pid && lock?.stale === false) return 'locked by another command';
    if (!target?.valid) return 'target missing or needs recovery';
    return `${session.status} on live target`;
}

function recommendSessionActions({ session, target, lock, navigate }) {
    const out = [];
    if (lock?.pid && lock?.stale === false) out.push('A command lock is active; wait or inspect the PID before retrying.');
    if (!target?.valid && navigate) out.push(`Run sessions reattach ${session.sessionId} --navigate to recover the tab.`);
    if (!target?.valid && !navigate) out.push(`Run sessions doctor ${session.sessionId} --navigate or poll --session ${session.sessionId} --navigate.`);
    if (session.status === 'timeout') out.push('If the provider tab is still streaming and deadline is future, retry poll/watch with --session.');
    if (out.length === 0) out.push(`Run: agbrowse web-ai poll --vendor ${session.vendor || 'chatgpt'} --session ${session.sessionId} --navigate`);
    return out;
}

function redactUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
        return String(url);
    }
}
```

Implementation note: `readSessionCommandLock` always returns `stale: boolean` per §1, so `summarizeSession`/`recommendSessionActions` can rely on `lock.stale` directly without further hedging. Keep doctor output parseable JSON under a small budget and do not include prompt/answer text.

### 5. MODIFY `web-ai/watcher.mjs`

Import diff (resolves audit D2 from round 2 — `withSessionCommandLock` is currently absent from `watcher.mjs:1-25`):

```diff
 import { withSessionPage } from './tab-recovery.mjs';
+import { withSessionCommandLock } from './session-store.mjs';
```

Place this immediately after the existing `./tab-recovery.mjs` import. No other `session-store` import is needed because `getSession`/`updateSession` are already imported from `./session.mjs` in the current source.

Ordering decision (resolves audit F6): the timeout→polling promotion MUST run **inside** `withSessionCommandLock` so it cannot race a concurrent `poll --session` that holds the live command lock and writes `status: 'timeout'`. The watcher already owns its own watcher directory lock (`watcher.mjs:52`); the session command lock is separate. Acquire it before mutating `session.status`.

Current early terminal branch:

```diff
-    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
+    if (session.status === 'timeout' && !isDeadlineExpired(session.deadlineAt)) {
+        await withSessionCommandLock(session.sessionId, async () => {
+            // re-read inside the lock to avoid clobbering a fresh status from a live poll
+            const refreshed = getSession(session.sessionId) || session;
+            if (refreshed.status === 'timeout' && !isDeadlineExpired(refreshed.deadlineAt)) {
+                updateSession(session.sessionId, {
+                    status: 'polling',
+                    warnings: appendUniqueWarning(refreshed.warnings || [], 'watcher-resumed-transient-timeout'),
+                });
+                session.status = 'polling';
+            } else {
+                session.status = refreshed.status;
+            }
+        }, { ttlMs: 30_000, heartbeatMs: 0 });
+    }
+    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
         return {
             ok: true, sessionId: session.sessionId, vendor,
             status: session.status, terminal: true,
```

Notes:

- short TTL (`30s`) + `heartbeatMs: 0` keeps the watcher's intent tiny; it is a status-flip, not a long poll.
- if `withSessionCommandLock` cannot be acquired (another command owns it), the watcher must skip the promotion this tick and rely on the next watch interval — that branch is preferred over forcing a flip.

Acceptance:

- a local poll timeout before deadline becomes `polling`, not terminal.
- a real expired deadline still becomes terminal `timeout`.
- a concurrent `poll --session` holding the session command lock prevents the watcher from clobbering its status.
- watch events include a warning when it resumes a transient timeout.

### 6. MODIFY `web-ai/cli.mjs`

Help text:

```diff
-  sessions <sub>      Manage persisted sessions: list | show | resume | reattach | prune
+  sessions <sub>      Manage persisted sessions: list | show | resume | reattach | doctor | prune
...
-  agbrowse web-ai sessions reattach <sessionId> [--navigate]
+  agbrowse web-ai sessions reattach <sessionId> [--navigate]
+  agbrowse web-ai sessions doctor   <sessionId> [--navigate] [--json]
```

Browser-required sessions:

```diff
-const BROWSER_REQUIRED_SESSION_COMMANDS = new Set(['resume', 'reattach']);
+const BROWSER_REQUIRED_SESSION_COMMANDS = new Set(['resume', 'reattach', 'doctor']);
```

Session command handoff remains before `runCommand`, but tests should assert that `sessions resume` and `sessions reattach` no longer own independent active-tab logic.

### 7. P1 MODIFY tab reuse in `web-ai/cli.mjs`

Audit F7 decision (locked): the `!lease` early-return MUST stay `return true` to preserve current `findReusableProviderTab` semantics and keep `test/unit/web-ai-provider-session.test.mjs:167-173` green. P1 only **adds** an extra `lease.clean === true` requirement *when* a lease record exists. P1 is additive over P0 and cannot remove a code path that other tests rely on.

```diff
 function isReusableByLease(targetId, leaseByTargetId) {
     const lease = leaseByTargetId.get(targetId);
     if (!lease) return true;                                       // unchanged — additive policy only
-    return ['web-ai', 'cli-jaw'].includes(lease.owner) &&
-        ['pooled', 'completed-session'].includes(lease.state);
+    if (!['web-ai', 'cli-jaw'].includes(lease.owner)) return false;
+    if (!['pooled', 'completed-session'].includes(lease.state)) return false;
+    // P1: when a session bound to this target is still active/incomplete, refuse reuse
+    // and require an explicit clean lease bit when finalizing completed provider tabs.
+    if (lease.state === 'completed-session' && lease.clean !== true) return false;
+    return true;
 }
```

Staging (P1 is additive only):

```text
1. P0 keeps current reuse behavior (lease-free tabs still reusable).
2. P1 adds a `lease.clean === true` gate ONLY for `completed-session` lease records.
   - leaseless tabs continue to be reusable (preserves provider-session.test.mjs expectations).
   - `pooled` leases continue to be reusable without the clean bit.
3. The clean bit is set by the finalizer of completed provider sessions; until that
   plumbing lands, `completed-session` leases without `clean === true` are skipped.
```

Acceptance:

- `--new-tab`/`--parallel` remains the recommended long-run path.
- existing `provider-session.test.mjs` reuse expectations stay green without modification.
- an old provider conversation tab marked `completed-session` is reused only with `clean === true`.

### 8. P2 MODIFY copy fallback policy wording

Current action:

```diff
-        clipboardRead: input.allowCopyMarkdownFallback === true,
+        clipboardWriteIntercept: input.allowCopyMarkdownFallback === true,
```

Policy compatibility:

```diff
-    if (action.clipboardRead && policy.allowClipboardRead !== true && !action.unsafeAllow?.includes('clipboard-read')) {
-        throw policyError('policy.clipboard-read-denied', 'policy-enforce', 'clipboard read denied by policy', { ruleId: 'allowClipboardRead' });
+    if (action.clipboardWriteIntercept && policy.allowClipboardRead !== true && !action.unsafeAllow?.includes('clipboard-read') && !action.unsafeAllow?.includes('clipboard-write-intercept')) {
+        throw policyError('policy.clipboard-write-intercept-denied', 'policy-enforce', 'provider copy capture denied by policy', { ruleId: 'allowClipboardRead' });
     }
```

Compatibility rule:

- keep `allowClipboardRead` and `--unsafe-allow clipboard-read` working for one minor version.
- add `--unsafe-allow clipboard-write-intercept` as clearer naming.
- update README/tests to say the default policy gate is for provider copy capture, not OS clipboard read.

### 9. Tests

#### MODIFY `test/unit/web-ai-session-store.test.mjs`

Add cases:

```js
it('does not treat a live command lock heartbeat as stale after five minutes', async () => { ... });
it('treats a command lock from a dead pid as stale and allows reacquire', async () => { ... });
it('session command lock records heartbeatAt and expiresAt metadata', async () => { ... });
```

#### NEW `test/unit/web-ai-tab-recovery.test.mjs`

Required cases:

```js
it('recoverSessionTab updates targetId and conversationUrl after fresh tab recovery', async () => { ... });
it('resolveSessionPage returns mismatch without navigating when allowNavigate=false', async () => { ... });
it('resolveSessionPage prefers live provider conversation URL over stale provider root', async () => { ... });
it('withSessionPage retries once after page death and uses the recovered target', async () => { ... });
```

#### MODIFY `test/unit/web-ai-sessions-command.test.mjs`

Explicit line-anchored replacements (resolves audit F8):

```diff
-// line 53 (whitelist regex)
-expect(sessionsSrc).toMatch(/SESSIONS_SUBCOMMANDS = new Set\(\['list', 'show', 'resume', 'reattach', 'prune'\]\)/);
+expect(sessionsSrc).toMatch(/SESSIONS_SUBCOMMANDS = new Set\(\['list', 'show', 'resume', 'reattach', 'doctor', 'prune'\]\)/);
```

```diff
-// lines 60-64 (subcommand loop)
-for (const sub of ['list', 'show', 'resume', 'reattach', 'prune']) {
+for (const sub of ['list', 'show', 'resume', 'reattach', 'doctor', 'prune']) {
     ...
 }
```

```diff
-// line 67 — vendor-ternary regex assertion
-    it('resume forwards to vendor-specific poll function', () => {
-        expect(sessionsSrc).toMatch(/session\.vendor === 'gemini' \? geminiPollWebAi : session\.vendor === 'grok' \? grokPollWebAi : pollWebAi/);
-    });
+    it('resume polls through withSessionPage and withSessionCommandLock', () => {
+        expect(sessionsSrc).toContain('withSessionPage');
+        expect(sessionsSrc).toContain('withSessionCommandLock');
+    });
```

Add behavioral fake-deps tests for:

- `sessions reattach <id>` uses stored target page, not active page.
- `sessions reattach <id>` returns `reattach-mismatch` without `--navigate`.
- `sessions reattach <id> --navigate` updates session URL/target when recovery creates a new tab.
- `sessions doctor <id>` reports lock and target state without answer text.

Heartbeat timer note (resolves audit R3): any test that calls `withSessionCommandLock` directly MUST pass `{ heartbeatMs: 0 }` to disable the 15s `setInterval` and avoid timer leaks under Vitest fake timers. The new `web-ai-session-store.test.mjs` heartbeat case should pass an explicit small `heartbeatMs` (e.g. `50`) and use real timers + `await new Promise(r => setTimeout(r, …))` rather than `vi.useFakeTimers()`.

#### NEW `test/unit/web-ai-watcher.test.mjs`

Required cases:

```js
it('does not treat timeout as terminal before deadline', async () => { ... });
it('keeps deadline-expired timeout terminal', async () => { ... });
```

#### NEW `test/unit/web-ai-session-doctor.test.mjs`

Required cases:

```js
it('redacts conversation URLs and excludes prompt/answer text', async () => { ... });
it('recommends poll --session when target is valid and no lock exists', async () => { ... });
it('recommends reattach --navigate when target is missing', async () => { ... });
```

#### MODIFY `test/unit/web-ai-provider-session.test.mjs`

Update source-string contracts so they assert the new shared resolver surface:

```diff
+expect(cliSrc).toContain('BROWSER_REQUIRED_SESSION_COMMANDS = new Set([\\'resume\\', \\'reattach\\', \\'doctor\\'])');
+expect(recoverySrc).toContain('export async function resolveSessionPage');
```

Tab-reuse assertions (lines 160-173) stay unchanged because §7 P1 is additive: `if (!lease) return true` is preserved, so leaseless reuse expectations remain green. ONLY when a future commit adds a `completed-session` lease record in this test's fixtures will the test need to set `lease.clean = true` — flag this in §7 P1 acceptance, do not pre-edit.

#### P2 MODIFY policy tests

Keep existing compatibility tests green and add:

```js
it('allows provider copy capture with clipboard-write-intercept unsafe allowance', async () => { ... });
it('copy fallback denial message no longer claims OS clipboard read', async () => { ... });
```

### 10. Docs

#### MODIFY `structure/runtime_contracts.md`

```diff
-| Active command | 같은 target에 병렬 mutation이 들어오면 fail-closed 한다 |
+| Active command | 같은 target에 병렬 mutation이 들어오면 fail-closed 하며 heartbeat로 장기 작업 소유권을 유지한다 |
+| Session command lock | `web-ai-sessions.json.cmd.<session>.lock`은 PID/heartbeat/expiresAt 기반이며 dead PID lock은 stale로 회수한다 |
+| Session doctor | `sessions doctor <id>`는 target, URL, lock, active command, recovery recommendation을 prompt/answer 없이 출력한다 |
```

#### MODIFY `structure/commands.md`

```diff
-| `sessions resume` | Yes | session poll resume |
-| `sessions reattach` | Yes | session과 tab 다시 연결 |
+| `sessions resume` | Yes | 저장된 session target을 resolve/recover한 뒤 provider poll resume |
+| `sessions reattach` | Yes | 저장된 targetId 기반으로 session과 tab 다시 연결; active tab을 truth로 쓰지 않음 |
+| `sessions doctor` | Yes | session target/lock/active command/recovery recommendation 진단 |
```

#### MODIFY `README.md`

Anchor (verified against current README): the section structure is `## Web AI` H2 at README.md:326 → `### Sessions` H3 at README.md:375. Insert the new content as an H4 subsection **at the end of the `### Sessions` H3 block**, immediately before the next sibling H3 (or the next H2 if `### Sessions` is the last subsection):

```md
#### Durable session recovery

Session recovery is target-bound. `poll --session`, `watch --session`,
`sessions resume`, and `sessions reattach` resolve the session's stored target
first, then recover/navigate only when the command permits it. Use
`agbrowse web-ai sessions doctor <id> --json` when a shell was interrupted or
a provider tab outlived a local timeout.
```

Safety net: if either `## Web AI` H2 or `### Sessions` H3 cannot be located by literal string match, the implementer MUST stop and report rather than invent a section or promote the new H4 to a higher level.

#### MODIFY `docs/production-readiness.md`

Add or update:

```md
Web-AI durable sessions remain beta until the #77 matrix is green:
closed target recovery, root-to-conversation URL drift, stale command lock,
wrong active tab, and watch transient timeout recovery.
```

## Verification plan

Focused commands:

```bash
npm run typecheck:checkjs
npx vitest run \
  test/unit/web-ai-session-store.test.mjs \
  test/unit/web-ai-sessions-command.test.mjs \
  test/unit/web-ai-tab-recovery.test.mjs \
  test/unit/web-ai-watcher.test.mjs \
  test/unit/web-ai-session-doctor.test.mjs \
  test/unit/web-ai-provider-session.test.mjs \
  test/unit/active-command-store.test.mjs \
  test/unit/web-ai-doctor.test.mjs
bash structure/check-doc-drift.sh
git diff --check
```

Live smoke after unit pass:

```bash
SID=$(agbrowse web-ai send --vendor chatgpt --model pro --inline-only --parallel --timeout 1800 --prompt "Reply with READY after a short delay." --json | jq -r .sessionId)
agbrowse web-ai sessions doctor "$SID" --json
agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800 --navigate --json
agbrowse web-ai watch --session "$SID" --once --json
```

Employee verification:

```bash
cli-jaw dispatch --agent "Backend" --task "Project root: /Users/jun/Developer/new/700_projects/agbrowse

Read-only verification. Check the web-ai session rebinding patch against issue #77:
- session resume/reattach/watch/poll use target-bound session recovery, not active tab
- session command lock heartbeat cannot stale out a live long poll
- dead PID lock is recoverable
- no prompt/answer text leaks from sessions doctor
- focused tests and structure docs cover the changed behavior

Report DONE or NEEDS_FIX with file/line evidence." 
```

Use `timeout=600000` for the dispatch command in the Boss shell.

## Commit split after approval

1. `fix(web-ai): harden session rebinding and command locks`
   - `session-store`, `tab-recovery`, `cli-sessions`, `watcher`, session tests.
2. `feat(web-ai): add session doctor diagnostics`
   - `session-doctor`, CLI/help, doctor tests.
3. `docs(web-ai): document durable session recovery limits`
   - README, structure docs, production readiness.
4. Optional P2: `fix(policy): clarify provider copy fallback policy`
   - policy naming compatibility + tests/docs.

## Open decisions before build

1. Should `sessions doctor <id>` require Chrome/CDP for tab truth, or allow offline store-only mode when Chrome is down?
2. Should `sessions reattach <id>` without `--navigate` recover a closed tab, or only inspect/report until `--navigate` is passed?
3. ~~Should tab reuse be made strict now (`lease.clean === true`) or staged after P0 so current pooled-tab behavior is not disrupted?~~ — **Resolved by audit F7 (round 1).** §7 P1 is additive: the `!lease` early-return is preserved and `lease.clean === true` only gates `completed-session` lease reuse.

## Audit corrections log

Round 1 (2026-05-11) — Backend PLAN AUDIT returned FAIL with findings F1–F10. The following plan-level corrections were applied before re-audit:

- §1: defined `commandLockMetadata(sessionId, ttlMs, acquiredAtMs)` and `readLockFile(path)` explicitly; added `withStoreLock` call-site rename diff; threaded `acquiredAtMs` through lock acquisition + heartbeat to preserve original acquired timestamp; `readSessionCommandLock` now returns a populated `stale: boolean`.
- §2: locked the `resolveSessionPage` return contract (TS-style) covering both `mismatch: false` and `mismatch: true` shapes, including `strategy` enum and the exact condition under which `mismatch: true` is returned.
- §4: removed the "final code may add `stale`…" hedge; doctor branches on `lock.stale === false` directly.
- §5: watcher's `timeout → polling` promotion now runs inside `withSessionCommandLock` with a short TTL and `heartbeatMs: 0`, and re-reads session state inside the lock to avoid clobbering a concurrent live poll.
- §7: P1 rewritten as additive — `!lease` early-return preserved, `lease.clean === true` only required when `lease.state === 'completed-session'`. Staging text updated.
- §9: line-anchored test edits for `web-ai-sessions-command.test.mjs:53/61/67`; `web-ai-provider-session.test.mjs` reuse assertions explicitly kept unchanged (with note about future clean-bit fixtures); added `{ heartbeatMs: 0 }` testing note for heartbeat-affected cases.
- §10: README edit now cites the existing `## Web AI sessions` H2 as the anchor and instructs the implementer to stop if that anchor is absent.

Round 2 (2026-05-11) — Backend re-audit returned PASS with 2 mechanical defects. Both patched before B phase entry:

- D1: §10 README anchor corrected from non-existent `## Web AI sessions` H2 to the verified `## Web AI` H2 → `### Sessions` H3 structure; new subsection demoted to H4 (`#### Durable session recovery`) and a stop-on-anchor-miss safety net was retained.
- D2: §5 watcher.mjs gained an explicit `+import { withSessionCommandLock } from './session-store.mjs';` diff because the live watcher source did not yet import it.
