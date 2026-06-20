// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { pollWebAi } from './chatgpt.mjs';
import { geminiPollWebAi } from './gemini-live.mjs';
import { grokPollWebAi } from './grok-live.mjs';
import { getSession, updateSession } from './session.mjs';
import { withSessionPage, urlsCompatible } from './tab-recovery.mjs';
import { withSessionCommandLock } from './session-store.mjs';
import { WebAiError, wrapError } from './errors.mjs';
import {
    defineCapability, runCapabilities,
    probeHostMatches, probeFirstVisibleSelector, worstCapabilityState,
} from './capability.mjs';
import { featureDefinitionsForVendor } from './doctor.mjs';
import { domHashAround } from './dom-hash.mjs';
import * as profileLock from '../skills/browser/profile-lock.mjs';

export const DEFAULT_WATCH_INTERVAL_MS = 15_000;
export const DEFAULT_WATCH_POLL_TIMEOUT_SEC = 30;
export const DEFAULT_WATCH_LOCK_STALE_MS = 5 * 60_000;
export const TERMINAL_SESSION_STATUSES = new Set(['complete', 'timeout', 'error']);

const PROVIDER_HOSTS = {
    chatgpt: new Set(['chatgpt.com', 'chat.openai.com']),
    gemini: new Set(['gemini.google.com']),
    grok: new Set(['grok.com']),
};

/**
 * @param {any} deps
 * @param {any} input
 * @param {any} notifier
 */
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
    /** @type {any[]} */
    const events = [];
    const emit = async (/** @type {any} */ event) => {
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
        return {
            ok: true,
            status: final?.status || 'watch-complete',
            sessionId: options.sessionId,
            final,
            eventsPrinted: true,
            events: options.captureEvents ? /** @type {any} */ (events) : undefined,
        };
    } finally {
        lock.release();
    }
}

/**
 * @param {any} deps
 * @param {any} input
 */
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

    if (session.status === 'timeout' && !isDeadlineExpired(session.deadlineAt)) {
        // Promote a transient (pre-deadline) timeout back to polling under the
        // session command lock so a concurrent live `poll --session` cannot
        // clobber the status mid-flip.
        await withSessionCommandLock(session.sessionId, async () => {
            const refreshed = getSession(session.sessionId) || session;
            if (refreshed.status === 'timeout' && !isDeadlineExpired(refreshed.deadlineAt)) {
                updateSession(session.sessionId, {
                    status: 'polling',
                    warnings: appendUniqueWarning(refreshed.warnings || [], 'watcher-resumed-transient-timeout'),
                });
                session.status = 'polling';
            } else {
                session.status = refreshed.status;
            }
        }, { ttlMs: 30_000, heartbeatMs: 0 });
    }
    if (TERMINAL_SESSION_STATUSES.has(session.status)) {
        return {
            ok: true, sessionId: session.sessionId, vendor,
            status: session.status, terminal: true,
            answerText: session.answer || null,
            warnings: session.warnings || [],
        };
    }
    if (isDeadlineExpired(session.deadlineAt)) {
        updateSession(session.sessionId, {
            status: 'timeout',
            lastError: { errorCode: 'provider.poll-timeout', message: 'watcher deadline reached' },
        });
        return {
            ok: true, sessionId: session.sessionId, vendor,
            status: 'timeout', terminal: true,
            warnings: ['deadline-reached'],
        };
    }

    // Phase 9.1: Use withSessionPage to resolve session's specific page, not active tab.
    // resolveSessionPage (allowNavigate) already self-heals root->/c/ URL drift and
    // returns the updated session; use that healed copy for the attach check instead
    // of the stale outer `session`, which previously re-introduced a false
    // reattach-mismatch (issue #77 watch-path).
    return withSessionPage(deps, options.sessionId, async ({ page, targetId, session: resolvedSession }) => {
        const profileLockSummary = await readProfileLockSummary()
            .catch(err => ({ state: 'unknown', error: err?.message || String(err) }));
        const reattach = await ensureWatcherAttached(page, resolvedSession || session, options);
        if (!reattach.ok) {
            return {
                ok: false, sessionId: session.sessionId, vendor,
                status: 'reattach-mismatch', terminal: false,
                url: reattach.url, warnings: reattach.warnings,
                profileLock: profileLockSummary,
            };
        }

        const preflight = await runWatcherPreflight(page, vendor);
        if (preflight.worst === 'fail') {
            updateSession(session.sessionId, {
                status: 'polling',
                lastError: {
                    errorCode: 'capability.unsupported',
                    message: 'pre-poll capability failed',
                    evidence: preflight.rows,
                },
            });
            return {
                ok: false, sessionId: session.sessionId, vendor,
                status: 'capability-fail', terminal: false,
                warnings: ['pre-poll-capability-fail'],
                preflight, profileLock: profileLockSummary,
            };
        }

        // Create session-specific deps so poll functions use the right page
        const sessionDeps = {
            ...deps,
            getPage: async () => page,
            getTargetId: async () => targetId,
        };

        const domHashBefore = await domHashAround(/** @type {any} */ (page), ['body'], { maxChars: options.domHashMaxChars }).catch(() => null);
        const pollResult = await callVendorPoll(sessionDeps, vendor, session, options);
        const domHashAfter = await domHashAround(/** @type {any} */ (page), ['body'], { maxChars: options.domHashMaxChars }).catch(() => null);
        const answerText = typeof (/** @type {any} */ (pollResult)).answerText === 'string'
            ? (/** @type {any} */ (pollResult)).answerText
            : (typeof (/** @type {any} */ (pollResult)).answer === 'string' ? (/** @type {any} */ (pollResult)).answer : null);
        const refreshed = getSession(session.sessionId) || session;
        let status = refreshed.status || pollResult.status || 'polling';

        if (status === 'timeout' && !isDeadlineExpired(refreshed.deadlineAt || session.deadlineAt)) {
            status = 'polling';
            updateSession(session.sessionId, {
                status,
                warnings: appendUniqueWarning(
                    refreshed.warnings || [],
                    `watcher-transient-poll-timeout:${options.pollTimeoutSec}s`,
                ),
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
            url: (/** @type {any} */ (page)).url?.() || null,
            answerText,
            warnings: [...(reattach.warnings || []), ...(pollResult.warnings || [])],
            preflight,
            profileLock: profileLockSummary,
        };
    });
}

/**
 * @param {any} opts
 */
export function createStdoutNotifier({ json = false, stream = process.stdout } = {}) {
    return async function notify(/** @type {any} */ event) {
        if (json) {
            stream.write(`${JSON.stringify(event)}\n`);
            return;
        }
        const bits = [
            '[web-ai watch]', event.capturedAt,
            `session=${event.sessionId}`, `type=${event.type}`,
            `status=${event.status || 'unknown'}`,
        ];
        if (event.vendor) bits.push(`vendor=${event.vendor}`);
        if (event.terminal) bits.push('terminal=true');
        if (event.warnings?.length) bits.push(`warnings=${event.warnings.join(',')}`);
        stream.write(`${bits.join('  ')}\n`);
    };
}

/**
 * @param {any} input
 */
export function normalizeWatchOptions(input = {}) {
    const sessionId = input.session || input.sessionId || null;
    const intervalMs = durationToMs(input.interval || input.intervalMs || DEFAULT_WATCH_INTERVAL_MS, 's');
    const pollTimeoutSec = Number(input.pollTimeoutSec || input.pollTimeout || DEFAULT_WATCH_POLL_TIMEOUT_SEC);
    const maxIterations = input.maxIterations === undefined || input.maxIterations === null || input.maxIterations === ''
        ? null : Number(input.maxIterations);
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
        maxIterations: Number.isFinite(maxIterations) && (/** @type {number} */ (maxIterations)) > 0 ? maxIterations : null,
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

/**
 * @param {any} sessionId
 * @param {any} opts
 */
export function acquireWatcherSessionLock(sessionId, { staleMs = DEFAULT_WATCH_LOCK_STALE_MS } = {}) {
    const dir = watcherLockPath(sessionId);
    mkdirSync(watcherHome(), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            mkdirSync(dir);
            writeWatcherLockMetadata(dir, {
                sessionId, pid: process.pid,
                startedAt: new Date().toISOString(),
                heartbeatAt: new Date().toISOString(),
            });
            return {
                lockPath: dir,
                heartbeat(extra = {}) {
                    writeWatcherLockMetadata(dir, {
                        sessionId, pid: process.pid,
                        heartbeatAt: new Date().toISOString(), ...extra,
                    });
                },
                release() { rmSync(dir, { recursive: true, force: true }); },
            };
        } catch (err) {
            if ((/** @type {any} */ (err))?.code !== 'EEXIST') throw err;
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
    throw new WebAiError({
        errorCode: 'watcher.already-running',
        stage: 'watcher-lock',
        retryHint: 'retry',
        message: `failed to acquire watcher lock for ${sessionId}`,
    });
}

/**
 * @param {any} page
 * @param {any} vendor
 */
export async function runWatcherPreflight(page, vendor) {
    const expectedHosts = (/** @type {any} */ (PROVIDER_HOSTS))[vendor] || new Set();
    const composer = featureDefinitionsForVendor(vendor).find(f => f.feature === 'composer');
    const capabilities = [
        defineCapability('provider.host', /** @type {any} */ ((/** @type {{page:any}} */ { page: p }) => probeHostMatches(p, expectedHosts))),
    ];
    if (composer) {
        capabilities.push(defineCapability('provider.composer-visible', /** @type {any} */ ((/** @type {{page:any}} */ { page: p }) =>
            probeFirstVisibleSelector(p, /** @type {string[]} */ (composer.selectors), {
                timeoutMs: 750,
                failState: 'warn',
                failNext: 'poll',
                okNext: 'poll',
            }))));
    }
    const rows = await runCapabilities({ page }, capabilities, { vendor });
    return { rows, worst: worstCapabilityState(rows) };
}

/**
 */
export async function readProfileLockSummary() {
    const candidates = ['getProfileLockStatus', 'readProfileLock', 'getProfileLock', 'inspectProfileLock'];
    for (const name of candidates) {
        if (typeof (/** @type {any} */ (profileLock))[name] !== 'function') continue;
        const value = await (/** @type {any} */ (profileLock))[name]();
        return { state: 'ok', source: name, evidence: scrubProfileLockEvidence(value) };
    }
    return { state: 'unknown', reason: 'no-compatible-profile-lock-export' };
}

// --- internal helpers ---

/**
 * @param {any} page
 * @param {any} session
 * @param {any} options
 */
async function ensureWatcherAttached(page, session, options) {
    const targetUrl = session.conversationUrl || session.originalUrl;
    if (!targetUrl) return { ok: true, warnings: ['session-has-no-conversation-url'] };
    const currentUrl = page.url?.() || '';
    // Use the canonical tolerant predicate (shared with resolveSessionPage) instead
    // of a stricter hash-only compare: same-conversation root->/c/ drift and trailing
    // slashes are compatible, while a genuinely different conversation or a
    // non-provider landing still mismatches and (with --navigate) re-navigates.
    if (urlsCompatible(targetUrl, currentUrl)) return { ok: true, url: currentUrl, warnings: [] };
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

/**
 * @param {any} deps
 * @param {any} vendor
 * @param {any} session
 * @param {any} options
 */
async function callVendorPoll(deps, vendor, session, options) {
    const pollFn = vendor === 'gemini' ? geminiPollWebAi
        : vendor === 'grok' ? grokPollWebAi
            : pollWebAi;
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

/**
 * @param {any} status
 * @param {any} result
 */
function deriveStreamingState(status, result = {}) {
    if (status === 'streaming' || result.streaming === true) return 'streaming';
    if (TERMINAL_SESSION_STATUSES.has(status)) return 'idle';
    return 'unknown';
}

/**
 * @param {any} warnings
 * @param {any} warning
 */
function appendUniqueWarning(warnings, warning) {
    return warnings.includes(warning) ? warnings : [...warnings, warning];
}

/**
 * @param {any} deadlineAt
 */
function isDeadlineExpired(deadlineAt) {
    if (!deadlineAt) return false;
    const t = Date.parse(deadlineAt);
    return Number.isFinite(t) && Date.now() >= t;
}

/**
 * @param {any} value
 * @param {any} label
 */
function toIsoDeadline(value, label) {
    const t = Date.parse(value);
    if (!Number.isFinite(t)) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'watcher-start',
            retryHint: 'fix-argument',
            message: `invalid ${label}: ${value}`,
        });
    }
    return new Date(t).toISOString();
}

/**
 * @param {any} value
 * @param {any} defaultUnit
 */
function durationToMs(value, defaultUnit = 's') {
    if (typeof value === 'number') return value;
    const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(String(value || '').trim());
    if (!match) return DEFAULT_WATCH_INTERVAL_MS;
    const n = Number(match[1]);
    const unit = (match[2] || defaultUnit).toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 1000;
    return n * factor;
}

/**
 */
function watcherHome() {
    return join(process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent'), 'web-ai-watchers');
}

/**
 * @param {any} sessionId
 */
function watcherLockPath(sessionId) {
    return join(watcherHome(), `${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.lock`);
}

/**
 * @param {any} dir
 * @param {any} metadata
 */
function writeWatcherLockMetadata(dir, metadata) {
    writeFileSync(join(dir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

/**
 * @param {any} dir
 */
function readWatcherLockMetadata(dir) {
    try {
        if (!existsSync(join(dir, 'metadata.json'))) return null;
        return JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
    } catch {
        return null;
    }
}

/**
 * @param {any} metadata
 * @param {any} staleMs
 */
function isWatcherLockStale(metadata, staleMs) {
    if (!metadata) return true;
    if (!pidAlive(Number(metadata.pid))) return true;
    const heartbeat = Date.parse(metadata.heartbeatAt || metadata.startedAt || '');
    return Number.isFinite(heartbeat) && Date.now() - heartbeat > staleMs;
}

/**
 * @param {any} pid
 */
function pidAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch (err) { return (/** @type {any} */ (err))?.code === 'EPERM'; }
}

/**
 * @param {any} value
 */
function scrubProfileLockEvidence(value) {
    if (!value || typeof value !== 'object') return value ?? null;
    const out = {};
    for (const key of ['pid', 'ownerPid', 'token', 'targetId', 'endpoint', 'wsEndpoint', 'createdAt', 'updatedAt', 'acquiredAt']) {
        if (Object.prototype.hasOwnProperty.call(value, key)) (/** @type {any} */ (out))[key] = (/** @type {any} */ (value))[key];
    }
    return out;
}
