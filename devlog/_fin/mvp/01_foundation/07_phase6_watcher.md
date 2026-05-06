# Phase 6 — Watcher

GPT Pro diff-level plan finalized 2026-05-01. Research sources: Playwright MCP
snapshots, Browser-Use CLI session reuse, Stagehand session replay, cli-jaw
production watcher (`src/browser/web-ai/watcher.ts`).

## Scope

Implement a standalone CLI watcher:

```bash
agbrowse web-ai watch --session <id>
```

It does **not** add an HTTP server, watcher fan-out, notification channels,
daemon install, or resume-after-agbrowse-process-restart. It does add:

* one watcher process per session, enforced by a per-session lock;
* a long-running poll loop;
* stdout event notifications;
* optional reattach via `--navigate`;
* pre-poll capability checks;
* session telemetry fields for `lastDomHash`, `lastAxHash`,
  `lastStreamingState`, and `lastResponseCharCount`.

## Non-goals

- No web UI dashboard.
- No multi-machine sync.
- No background daemon installation.

## cli-jaw mirror

**Direction reverses for this phase:** cli-jaw is the source of truth, not
agbrowse.

cli-jaw already has a production watcher:

- `src/browser/web-ai/watcher.ts` — long-running poll loop with reattach,
  notify-on-complete, expired-session detection, and resume-after-restart
  recovery (`resumeStoredWebAiWatchers`).
- `src/browser/web-ai/notifications.ts` — channel send helper + ledger.
- HTTP routes `/api/browser/web-ai/watch` and `/api/browser/web-ai/watchers`.
- CLI command `cli-jaw browser web-ai watch --vendor <v> --session <id>`.
- Tests `tests/unit/browser-web-ai-watcher.test.ts` cover 8+ lifecycle
  scenarios.

| Item | cli-jaw status |
| --- | --- |
| Long-running poll | **Already production** |
| Notification target | **Already production** — channel send endpoint |
| Resume after restart | **Already production** — `resumeStoredWebAiWatchers` |
| Stale session detection | **Already production** — `WEB-AI-WATCH-005` |

Phase 6 in **agbrowse** ports a minimal subset. No notification channels —
stdout only. No HTTP server, no resume-after-restart.

---

## File plan

| Action | File | Description |
| --- | --- | --- |
| **NEW** | `web-ai/watcher.mjs` | ~400 lines. Poll loop, per-session lock, stdout notifier, preflight. |
| **MODIFY** | `web-ai/session.mjs` | 4 new fields: `lastDomHash`, `lastAxHash`, `lastStreamingState`, `lastResponseCharCount`. |
| **MODIFY** | `web-ai/types.mjs` | Add `POLLING` to `WEB_AI_STATUS`. |
| **MODIFY** | `web-ai/cli.mjs` | Add `watch` command, help text, arg parsing, dispatch. |

---

## NEW file: `web-ai/watcher.mjs`

### Exported API surface

```js
export const DEFAULT_WATCH_INTERVAL_MS;       // 15_000
export const DEFAULT_WATCH_POLL_TIMEOUT_SEC;   // 30
export const DEFAULT_WATCH_LOCK_STALE_MS;      // 5 * 60_000
export const TERMINAL_SESSION_STATUSES;        // Set(['complete', 'timeout', 'error'])

export async function watchSession(deps, input = {}, notifier = null);
export async function watchSessionOnce(deps, input = {});
export function createStdoutNotifier({ json = false, stream = process.stdout } = {});
export function normalizeWatchOptions(input = {});
export function acquireWatcherSessionLock(sessionId, options = {});
export async function runWatcherPreflight(page, vendor);
export async function readProfileLockSummary();
```

### Complete skeleton

```js
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { pollWebAi } from './chatgpt.mjs';
import { geminiPollWebAi } from './gemini-live.mjs';
import { grokPollWebAi } from './grok-live.mjs';
import { getSession, updateSession } from './session.mjs';
import { WebAiError, wrapError } from './errors.mjs';
import { defineCapability, runCapabilities, probeHostMatches, probeFirstVisibleSelector, worstCapabilityState } from './capability.mjs';
import { featureDefinitionsForVendor } from './doctor.mjs';
import { domHashAround } from './dom-hash.mjs';
import * as profileLock from './profile-lock.mjs';

export const DEFAULT_WATCH_INTERVAL_MS = 15_000;
export const DEFAULT_WATCH_POLL_TIMEOUT_SEC = 30;
export const DEFAULT_WATCH_LOCK_STALE_MS = 5 * 60_000;
export const TERMINAL_SESSION_STATUSES = new Set(['complete', 'timeout', 'error']);

const PROVIDER_HOSTS = {
    chatgpt: new Set(['chatgpt.com', 'chat.openai.com']),
    gemini: new Set(['gemini.google.com']),
    grok: new Set(['grok.com']),
};

export async function watchSession(deps, input = {}, notifier = null) {
    const options = normalizeWatchOptions(input);
    if (!options.sessionId) {
        throw new WebAiError({
            errorCode: 'watcher.session-missing',
            stage: 'watcher-start',
            retryHint: 'pass-session',
            message: 'web-ai watch requires --session <sessionId>',
        });
    }

    const lock = acquireWatcherSessionLock(options.sessionId, { staleMs: options.lockStaleMs });
    const notify = notifier || createStdoutNotifier({ json: options.json });
    const events = [];
    const emit = async (event) => {
        const enriched = { capturedAt: new Date().toISOString(), sessionId: options.sessionId, ...event };
        if (options.captureEvents) events.push(enriched);
        await notify(enriched);
    };

    let final = null;
    try {
        if (options.deadlineAt) updateSession(options.sessionId, { deadlineAt: options.deadlineAt });
        await emit({ type: 'watch.start', status: 'watching', intervalMs: options.intervalMs, pollTimeoutSec: options.pollTimeoutSec });

        for (let iteration = 1; ; iteration += 1) {
            lock.heartbeat({ iteration });
            const tick = await watchSessionOnce(deps, { ...options, session: options.sessionId });
            final = tick;
            await emit({
                type: 'watch.tick',
                iteration,
                status: tick.status,
                terminal: tick.terminal === true,
                vendor: tick.vendor,
                url: tick.url || null,
                warnings: tick.warnings || [],
            });

            if (tick.terminal === true) {
                await emit({ type: `watch.${tick.status}`, status: tick.status, terminal: true, vendor: tick.vendor });
                break;
            }
            if (options.once) {
                final = { ...tick, ok: true, status: 'watch-once', watchStatus: tick.status, terminal: false };
                break;
            }
            if (options.maxIterations && iteration >= options.maxIterations) {
                final = { ...tick, ok: true, status: 'watch-max-iterations', watchStatus: tick.status, terminal: false };
                await emit({ type: 'watch.max-iterations', status: 'watch-max-iterations', terminal: false, iteration });
                break;
            }
            await sleep(options.intervalMs);
        }
        return { ok: true, status: final?.status || 'watch-complete', sessionId: options.sessionId, final, eventsPrinted: true, events: options.captureEvents ? events : undefined };
    } finally {
        lock.release();
    }
}

export async function watchSessionOnce(deps, input = {}) {
    const options = normalizeWatchOptions(input);
    const session = getSession(options.sessionId);
    if (!session) {
        throw new WebAiError({
            errorCode: 'watcher.session-missing',
            stage: 'watcher-load-session',
            retryHint: 'sessions-list',
            message: `no session record for ${options.sessionId}`,
            evidence: { sessionId: options.sessionId },
        });
    }
    const vendor = session.vendor || options.vendor || 'chatgpt';
    if (options.vendor && session.vendor && options.vendor !== session.vendor) {
        throw new WebAiError({
            errorCode: 'watcher.vendor-mismatch',
            stage: 'watcher-load-session',
            retryHint: 'omit-vendor-or-use-session-vendor',
            message: `session ${options.sessionId} belongs to ${session.vendor}, not ${options.vendor}`,
            vendor: options.vendor,
            evidence: { sessionVendor: session.vendor, requestedVendor: options.vendor },
        });
    }

    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
        return { ok: true, sessionId: session.sessionId, vendor, status: session.status, terminal: true, answerText: session.answer || null, warnings: session.warnings || [] };
    }
    if (isDeadlineExpired(session.deadlineAt)) {
        updateSession(session.sessionId, { status: 'timeout', lastError: { errorCode: 'provider.poll-timeout', message: 'watcher deadline reached' } });
        return { ok: true, sessionId: session.sessionId, vendor, status: 'timeout', terminal: true, warnings: ['deadline-reached'] };
    }

    const page = await deps.getPage();
    const profileLockSummary = await readProfileLockSummary().catch(err => ({ state: 'unknown', error: err?.message || String(err) }));
    const reattach = await ensureWatcherAttached(page, session, options);
    if (!reattach.ok) {
        return { ok: false, sessionId: session.sessionId, vendor, status: 'reattach-mismatch', terminal: false, url: reattach.url, warnings: reattach.warnings, profileLock: profileLockSummary };
    }

    const preflight = await runWatcherPreflight(page, vendor);
    if (preflight.worst === 'fail') {
        updateSession(session.sessionId, {
            status: 'polling',
            lastError: { errorCode: 'capability.unsupported', message: 'pre-poll capability failed', evidence: preflight.rows },
        });
        return { ok: false, sessionId: session.sessionId, vendor, status: 'capability-fail', terminal: false, warnings: ['pre-poll-capability-fail'], preflight, profileLock: profileLockSummary };
    }

    const domHashBefore = await domHashAround(page, ['body'], { maxChars: options.domHashMaxChars }).catch(() => null);
    const pollResult = await callVendorPoll(deps, vendor, session, options);
    const domHashAfter = await domHashAround(page, ['body'], { maxChars: options.domHashMaxChars }).catch(() => null);
    const answerText = typeof pollResult.answerText === 'string' ? pollResult.answerText : (typeof pollResult.answer === 'string' ? pollResult.answer : null);
    const refreshed = getSession(session.sessionId) || session;
    let status = refreshed.status || pollResult.status || 'polling';

    if (status === 'timeout' && !isDeadlineExpired(refreshed.deadlineAt || session.deadlineAt)) {
        status = 'polling';
        updateSession(session.sessionId, {
            status,
            warnings: appendUniqueWarning(refreshed.warnings || [], `watcher-transient-poll-timeout:${options.pollTimeoutSec}s`),
        });
    }

    updateSession(session.sessionId, {
        lastDomHash: domHashAfter || domHashBefore || refreshed.lastDomHash || null,
        lastStreamingState: deriveStreamingState(status, pollResult),
        lastResponseCharCount: answerText ? answerText.length : (refreshed.lastResponseCharCount || 0),
    });

    return {
        ok: pollResult.ok !== false,
        sessionId: session.sessionId,
        vendor,
        status,
        terminal: TERMINAL_SESSION_STATUSES.has(status),
        url: page.url?.() || null,
        answerText,
        warnings: [...(reattach.warnings || []), ...(pollResult.warnings || [])],
        preflight,
        profileLock: profileLockSummary,
    };
}

export function createStdoutNotifier({ json = false, stream = process.stdout } = {}) {
    return async function notify(event) {
        if (json) {
            stream.write(`${JSON.stringify(event)}\n`);
            return;
        }
        const bits = [`[web-ai watch]`, event.capturedAt, `session=${event.sessionId}`, `type=${event.type}`, `status=${event.status || 'unknown'}`];
        if (event.vendor) bits.push(`vendor=${event.vendor}`);
        if (event.terminal) bits.push('terminal=true');
        if (event.warnings?.length) bits.push(`warnings=${event.warnings.join(',')}`);
        stream.write(`${bits.join('  ')}\n`);
    };
}

export function normalizeWatchOptions(input = {}) {
    const sessionId = input.session || input.sessionId || null;
    const intervalMs = durationToMs(input.interval || input.intervalMs || DEFAULT_WATCH_INTERVAL_MS, 's');
    const pollTimeoutSec = Number(input.pollTimeoutSec || input.pollTimeout || DEFAULT_WATCH_POLL_TIMEOUT_SEC);
    const maxIterations = input.maxIterations === undefined || input.maxIterations === null || input.maxIterations === '' ? null : Number(input.maxIterations);
    const deadlineAt = input.deadline
        ? toIsoDeadline(input.deadline, 'deadline')
        : input.timeout && Number(input.timeout) > 0
            ? new Date(Date.now() + Number(input.timeout) * 1000).toISOString()
            : input.deadlineAt || null;
    return {
        ...input,
        sessionId,
        intervalMs,
        pollTimeoutSec: Number.isFinite(pollTimeoutSec) && pollTimeoutSec > 0 ? pollTimeoutSec : DEFAULT_WATCH_POLL_TIMEOUT_SEC,
        maxIterations: Number.isFinite(maxIterations) && maxIterations > 0 ? maxIterations : null,
        deadlineAt,
        once: input.once === true,
        navigate: input.navigate === true,
        json: input.json === true,
        captureEvents: input.captureEvents === true,
        lockStaleMs: durationToMs(input.lockStaleMs || DEFAULT_WATCH_LOCK_STALE_MS, 'ms'),
        domHashMaxChars: Number(input.domHashMaxChars || 32768),
        navigateTimeoutMs: Number(input.navigateTimeoutMs || 30_000),
    };
}

export function acquireWatcherSessionLock(sessionId, { staleMs = DEFAULT_WATCH_LOCK_STALE_MS } = {}) {
    const dir = watcherLockPath(sessionId);
    mkdirSync(watcherHome(), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            mkdirSync(dir);
            writeWatcherLockMetadata(dir, { sessionId, pid: process.pid, startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
            return {
                lockPath: dir,
                heartbeat(extra = {}) { writeWatcherLockMetadata(dir, { sessionId, pid: process.pid, heartbeatAt: new Date().toISOString(), ...extra }); },
                release() { rmSync(dir, { recursive: true, force: true }); },
            };
        } catch (err) {
            if (err?.code !== 'EEXIST') throw err;
            const existing = readWatcherLockMetadata(dir);
            if (isWatcherLockStale(existing, staleMs)) {
                rmSync(dir, { recursive: true, force: true });
                continue;
            }
            throw new WebAiError({
                errorCode: 'watcher.already-running',
                stage: 'watcher-lock',
                retryHint: 'reuse-existing-watcher-or-remove-stale-lock',
                message: `a watcher is already running for session ${sessionId}`,
                evidence: existing,
            });
        }
    }
    throw new WebAiError({ errorCode: 'watcher.already-running', stage: 'watcher-lock', retryHint: 'retry', message: `failed to acquire watcher lock for ${sessionId}` });
}

export async function runWatcherPreflight(page, vendor) {
    const expectedHosts = PROVIDER_HOSTS[vendor] || new Set();
    const composer = featureDefinitionsForVendor(vendor).find(f => f.feature === 'composer');
    const capabilities = [
        defineCapability('provider.host', ({ page: p }) => probeHostMatches(p, expectedHosts)),
    ];
    if (composer) {
        capabilities.push(defineCapability('provider.composer-visible', ({ page: p }) => probeFirstVisibleSelector(p, composer.selectors, {
            timeoutMs: 750,
            failState: 'warn',
            failNext: 'poll',
            okNext: 'poll',
        })));
    }
    const rows = await runCapabilities({ page }, capabilities, { vendor });
    return { rows, worst: worstCapabilityState(rows) };
}

export async function readProfileLockSummary() {
    const candidates = ['getProfileLockStatus', 'readProfileLock', 'getProfileLock', 'inspectProfileLock'];
    for (const name of candidates) {
        if (typeof profileLock[name] !== 'function') continue;
        const value = await profileLock[name]();
        return { state: 'ok', source: name, evidence: scrubProfileLockEvidence(value) };
    }
    return { state: 'unknown', reason: 'no-compatible-profile-lock-export' };
}

// --- internal ---

async function ensureWatcherAttached(page, session, options) {
    const targetUrl = session.conversationUrl || session.originalUrl;
    if (!targetUrl) return { ok: true, warnings: ['session-has-no-conversation-url'] };
    const currentUrl = page.url?.() || '';
    if (urlsEquivalentForWatch(currentUrl, targetUrl)) return { ok: true, url: currentUrl, warnings: [] };
    if (options.navigate) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: options.navigateTimeoutMs });
        return { ok: true, url: targetUrl, warnings: [`reattached:navigated-from=${currentUrl}`] };
    }
    return {
        ok: false,
        url: currentUrl,
        warnings: [`current tab ${currentUrl} does not match session conversationUrl ${targetUrl}; pass --navigate to switch tabs`],
    };
}

async function callVendorPoll(deps, vendor, session, options) {
    const pollFn = vendor === 'gemini' ? geminiPollWebAi : vendor === 'grok' ? grokPollWebAi : pollWebAi;
    try {
        return await pollFn(deps, {
            vendor,
            session: session.sessionId,
            timeout: String(options.pollTimeoutSec),
            allowCopyMarkdownFallback: options.allowCopyMarkdownFallback === true,
            navigate: options.navigate === true,
        });
    } catch (rawErr) {
        const err = wrapError(rawErr);
        if (err.errorCode === 'provider.poll-timeout' && !isDeadlineExpired(session.deadlineAt)) {
            updateSession(session.sessionId, {
                status: 'polling',
                lastError: err.toJSON ? err.toJSON() : { errorCode: err.errorCode, message: err.message },
            });
            return { ok: true, status: 'polling', warnings: [`transient-poll-timeout:${options.pollTimeoutSec}s`] };
        }
        throw err;
    }
}

function deriveStreamingState(status, result = {}) {
    if (status === 'streaming' || result.streaming === true) return 'streaming';
    if (TERMINAL_SESSION_STATUSES.has(status)) return 'idle';
    return 'unknown';
}

function appendUniqueWarning(warnings, warning) {
    return warnings.includes(warning) ? warnings : [...warnings, warning];
}

function isDeadlineExpired(deadlineAt) {
    if (!deadlineAt) return false;
    const t = Date.parse(deadlineAt);
    return Number.isFinite(t) && Date.now() >= t;
}

function toIsoDeadline(value, label) {
    const t = Date.parse(value);
    if (!Number.isFinite(t)) {
        throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'watcher-start', retryHint: 'fix-argument', message: `invalid ${label}: ${value}` });
    }
    return new Date(t).toISOString();
}

function durationToMs(value, defaultUnit = 's') {
    if (typeof value === 'number') return value;
    const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(String(value || '').trim());
    if (!match) return DEFAULT_WATCH_INTERVAL_MS;
    const n = Number(match[1]);
    const unit = (match[2] || defaultUnit).toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 1000;
    return n * factor;
}

function watcherHome() {
    return join(process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent'), 'web-ai-watchers');
}

function watcherLockPath(sessionId) {
    return join(watcherHome(), `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.lock`);
}

function writeWatcherLockMetadata(dir, metadata) {
    writeFileSync(join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function readWatcherLockMetadata(dir) {
    try {
        if (!existsSync(join(dir, 'metadata.json'))) return null;
        return JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
    } catch {
        return null;
    }
}

function isWatcherLockStale(metadata, staleMs) {
    if (!metadata) return true;
    if (!pidAlive(Number(metadata.pid))) return true;
    const heartbeat = Date.parse(metadata.heartbeatAt || metadata.startedAt || '');
    return Number.isFinite(heartbeat) && Date.now() - heartbeat > staleMs;
}

function pidAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return err?.code === 'EPERM';
    }
}

function urlsEquivalentForWatch(a, b) {
    try {
        const ua = new URL(a);
        const ub = new URL(b);
        ua.hash = '';
        ub.hash = '';
        return ua.toString() === ub.toString();
    } catch {
        return String(a || '') === String(b || '');
    }
}

function scrubProfileLockEvidence(value) {
    if (!value || typeof value !== 'object') return value ?? null;
    const out = {};
    for (const key of ['pid', 'ownerPid', 'token', 'targetId', 'endpoint', 'wsEndpoint', 'createdAt', 'updatedAt', 'acquiredAt']) {
        if (Object.prototype.hasOwnProperty.call(value, key)) out[key] = value[key];
    }
    return out;
}
```

---

## MODIFY `web-ai/session.mjs`

```diff
     status: 'sent',
     answer: null,
     lastError: null,
     warnings: [],
+    lastDomHash: null,
+    lastAxHash: null,
+    lastStreamingState: 'unknown',
+    lastResponseCharCount: 0,
 };
```

---

## MODIFY `web-ai/types.mjs`

```diff
 export const WEB_AI_STATUS = Object.freeze({
     READY: 'ready',
     RENDERED: 'rendered',
     SENT: 'sent',
+    POLLING: 'polling',
     STREAMING: 'streaming',
     COMPLETE: 'complete',
     BLOCKED: 'blocked',
@@
- * @typedef {'ready'|'rendered'|'sent'|'streaming'|'complete'|'blocked'|'timeout'|'error'} WebAiStatus
+ * @typedef {'ready'|'rendered'|'sent'|'polling'|'streaming'|'complete'|'blocked'|'timeout'|'error'} WebAiStatus
```

---

## MODIFY `web-ai/cli.mjs`

Add `watch` to COMMANDS, import `watchSession`, add `WEB_AI_WATCH_USAGE`
help text, wire arg parsing (`--interval`, `--poll-timeout`, `--max-iterations`,
`--once`, `--navigate`), dispatch to `watchSession`, add `printWatchHuman`.

New error codes in usage: `watcher.session-missing | watcher.already-running`.

New CLI help: `agbrowse web-ai watch --help`

```text
Usage:
  agbrowse web-ai watch --session <sessionId> [options]

Watch a single persisted web-ai session until it reaches complete, timeout,
or error. The watcher is a foreground process and writes progress notifications
to stdout.

Required:
  --session <id>        Persisted session id from web-ai send/query/sessions list.

Options:
  --vendor <name>       Optional guard; must match the stored session vendor.
  --interval <dur>      Delay between poll attempts. Default: 15s
  --poll-timeout <sec>  Short provider poll timeout per attempt. Default: 30
  --timeout <sec>       Override overall watcher/session deadline to now + seconds.
  --deadline <iso>      Override overall watcher/session deadline.
  --navigate            Navigate back to conversationUrl if active tab differs.
  --once                Run one watch tick and exit.
  --max-iterations <n>  Stop after n watch ticks.
  --json                Emit JSONL progress events plus final JSON summary.
```

New usage example in global help:

```bash
# Watch from a supervisor or terminal until complete.
agbrowse web-ai watch --session "$SID" --interval 15s --poll-timeout 30 --navigate
```

---

## Test plan

### `tests/unit/web-ai-watcher.test.mjs` (12 cases)

```js
test('watchSessionOnce loads a persisted session and invokes the vendor poll function with --session');
test('watchSession emits start tick and terminal stdout notifications');
test('watchSession enforces one watcher per session with a lock');
test('watchSession reclaims stale watcher lock when pid is dead');
test('watchSessionOnce treats provider.poll-timeout as polling before deadline');
test('watchSessionOnce marks session timeout when deadlineAt has passed');
test('watchSessionOnce returns reattach-mismatch when current tab differs and --navigate is false');
test('watchSessionOnce navigates to conversationUrl when --navigate is true');
test('watchSessionOnce runs host and composer capability preflight before polling');
test('watchSessionOnce records lastDomHash lastStreamingState and lastResponseCharCount');
test('createStdoutNotifier emits JSONL when json=true');
test('normalizeWatchOptions parses interval pollTimeout maxIterations and deadline overrides');
```

### `tests/unit/web-ai-cli-watch.test.mjs` (4 cases)

```js
test('web-ai watch --help prints exact watch help');
test('web-ai watch requires --session');
test('web-ai watch passes interval poll-timeout once max-iterations and navigate to watchSession');
test('web-ai watch --json emits JSONL progress and final JSON summary');
```

### `tests/unit/web-ai-session-shape.test.mjs` (1 case)

```js
test('createSession initializes watcher telemetry fields');
```

---

## Exit criteria

1. `agbrowse web-ai watch --session <id>` starts a foreground process and prints progress lines to stdout.
2. A second watcher for the same session fails with `watcher.already-running`.
3. A dead watcher process leaves a reclaimable stale lock.
4. `--navigate` reattaches to `conversationUrl`; without `--navigate`, mismatch is reported.
5. Provider short poll timeouts do not prematurely terminalize the session before `deadlineAt`.
6. Terminal statuses `complete`, `timeout`, `error` stop the loop.
7. Session store records `lastDomHash`, `lastStreamingState`, `lastResponseCharCount`.
8. Unit tests pass with existing 237-test suite plus Phase 6 tests.

---

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Provider `pollWebAi` internally marks timeout on short `--poll-timeout` | Watcher reclassifies `provider.poll-timeout` as transient polling until `deadlineAt` |
| Unknown `profile-lock.mjs` export names | `readProfileLockSummary()` probes likely export names without hard failure |
| Watcher lock left behind after crash | Per-session lock includes PID and heartbeat; dead PID or stale heartbeat is reclaimed |
| Capability preflight too strict during streaming | Composer visibility is `warn`, not `fail`; host mismatch remains `fail` |
| stdout JSON + final JSON may surprise parsers | Help explicitly says JSONL progress + final summary; consume line-by-line |

---

## Estimate

**2.5–3.5 engineer-days**

* watcher loop and lock: 1.0 day
* CLI integration and help: 0.5 day
* session telemetry and preflight integration: 0.5 day
* tests and flake hardening: 1.0–1.5 days
