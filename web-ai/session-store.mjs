// @ts-check
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @typedef {{
 *   sessionId: string,
 *   vendor: string|null,
 *   createdAt: string,
 *   updatedAt: string,
 *   deadlineAt: string|null,
 *   targetId: string|null,
 *   tabId: string|null,
 *   tabState?: { createdAt?: string, lastActiveAt?: string, recoveryCount?: number, closeCount?: number, [extra: string]: unknown },
 *   originalUrl: string|null,
 *   conversationUrl: string|null,
 *   promptHash: string,
 *   envelopeSummary?: Record<string, unknown>,
 *   status: string,
 *   answer: unknown,
 *   lastError: unknown,
 *   warnings: unknown[],
 *   lastDomHash: string|null,
 *   lastAxHash: string|null,
 *   lastStreamingState?: string,
 *   lastResponseCharCount?: number,
 *   trace: unknown[],
 *   [extra: string]: unknown,
 * }} WebAiSession
 */

/**
 * @typedef {{
 *   version: number,
 *   sessions: WebAiSession[],
 *   [extra: string]: unknown,
 * }} WebAiSessionStore
 */

export const SESSION_STORE_VERSION = 1;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LOCK_RETRY_MS = 25;
const LOCK_RETRY_LIMIT = 200;
const STORE_LOCK_STALE_MS = 5 * 60 * 1000;
const SESSION_COMMAND_LOCK_HEARTBEAT_MS = 15_000;
const DEFAULT_SESSION_COMMAND_LOCK_TTL_MS = 35 * 60 * 1000;

function home() {
    return process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
}

function storePath() {
    return join(home(), 'web-ai-sessions.json');
}

function lockPath() {
    return `${storePath()}.lock`;
}

/**
 * @param {number} [now]
 * @returns {string}
 */
export function generateSessionId(now = Date.now()) {
    return encodeTime(now) + encodeRandom();
}

/**
 * @param {number|string} ms
 * @returns {string}
 */
function encodeTime(ms) {
    let t = Math.max(0, Math.floor(Number(ms) || 0));
    const out = new Array(10);
    for (let i = 9; i >= 0; i--) {
        out[i] = CROCKFORD[t % 32];
        t = Math.floor(t / 32);
    }
    return out.join('');
}

/** @returns {string} */
function encodeRandom() {
    const bytes = randomBytes(10);
    let bits = 0n;
    for (const b of bytes) bits = (bits << 8n) | BigInt(b);
    let out = '';
    for (let i = 0; i < 16; i++) {
        out = CROCKFORD[Number(bits & 31n)] + out;
        bits >>= 5n;
    }
    return out;
}

/** @returns {WebAiSessionStore} */
export function readSessionStore() {
    const path = storePath();
    if (!existsSync(path)) return { version: SESSION_STORE_VERSION, sessions: [] };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object') return { version: SESSION_STORE_VERSION, sessions: [] };
        if (!Array.isArray(parsed.sessions)) parsed.sessions = [];
        if (typeof parsed.version !== 'number') parsed.version = SESSION_STORE_VERSION;
        return parsed;
    } catch {
        return { version: SESSION_STORE_VERSION, sessions: [] };
    }
}

/** @returns {WebAiSessionStore} */
function readSessionStoreLocked() {
    return withStoreLock(() => readSessionStore());
}

/**
 * @param {WebAiSessionStore} store
 */
export function writeSessionStore(store) {
    const path = storePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
}

/**
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function withStoreLock(fn) {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    let attempts = 0;
    while (attempts < LOCK_RETRY_LIMIT) {
        try {
            const fd = openSync(path, 'wx');
            try {
                writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
            } catch { /* best-effort metadata write */ }
            try {
                return fn();
            } finally {
                try { closeSync(fd); } catch { /* already closed */ }
                try { unlinkSync(path); } catch { /* already gone */ }
            }
        } catch (err) {
            const e = /** @type {NodeJS.ErrnoException} */ (err);
            if (e?.code !== 'EEXIST') throw err;
            attempts += 1;
            const stale = isStoreLockStale(path);
            if (stale) {
                try { unlinkSync(path); } catch { /* races resolve naturally */ }
                continue;
            }
            sleepBlockingMs(LOCK_RETRY_MS);
        }
    }
    throw new Error(`web-ai session store: failed to acquire lock at ${path} after ${LOCK_RETRY_LIMIT} attempts`);
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function isStoreLockStale(path) {
    try {
        const raw = readFileSync(path, 'utf8');
        const parsed = JSON.parse(raw);
        const acquired = Date.parse(parsed?.acquiredAt || '');
        if (!Number.isFinite(acquired)) return true;
        return Date.now() - acquired > STORE_LOCK_STALE_MS;
    } catch {
        return true;
    }
}

/**
 * @param {string} sessionId
 * @param {number} ttlMs
 * @param {number} [acquiredAtMs]
 */
function commandLockMetadata(sessionId, ttlMs, acquiredAtMs = Date.now()) {
    const ttl = Number(ttlMs || DEFAULT_SESSION_COMMAND_LOCK_TTL_MS);
    const now = Date.now();
    return {
        pid: process.pid,
        sessionId,
        acquiredAt: new Date(acquiredAtMs).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttl).toISOString(),
    };
}

/**
 * @param {string} path
 */
function readLockFile(path) {
    if (!existsSync(path)) return null;
    try {
        return { path, ...JSON.parse(readFileSync(path, 'utf8')) };
    } catch {
        return { path, corrupt: true };
    }
}

/**
 * @param {number} pid
 */
function pidAlive(pid) {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (/** @type {any} */ (err))?.code === 'EPERM';
    }
}

/**
 * @param {string} path
 */
function isSessionCommandLockStale(path) {
    const lock = readLockFile(path);
    if (!lock || lock.corrupt) return true;
    if (!pidAlive(Number(lock.pid))) return true;
    const heartbeat = Date.parse(lock.heartbeatAt || lock.acquiredAt || '');
    const expires = Date.parse(lock.expiresAt || '');
    if (Number.isFinite(expires)) return expires <= Date.now();
    return Number.isFinite(heartbeat) && Date.now() - heartbeat > DEFAULT_SESSION_COMMAND_LOCK_TTL_MS;
}

/**
 * @param {string} sessionId
 */
export function readSessionCommandLock(sessionId) {
    const path = sessionCommandLockPath(sessionId);
    const raw = readLockFile(path);
    if (!raw) return null;
    if (raw.corrupt) return { ...raw, stale: true };
    return { ...raw, stale: isSessionCommandLockStale(path) };
}

/** @param {number} ms */
function sleepBlockingMs(ms) {
    const end = Date.now() + ms;
    // Avoid spawning child processes / busy-wait via Atomics.wait on a shared buffer.
    const buf = new SharedArrayBuffer(4);
    const view = new Int32Array(buf);
    Atomics.wait(view, 0, 0, Math.max(0, end - Date.now()));
}

/**
 * @param {string} sessionId
 * @returns {string}
 */
function sessionCommandLockPath(sessionId) {
    return `${storePath()}.cmd.${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.lock`;
}

/**
 * @template T
 * @param {string} sessionId
 * @param {() => Promise<T>} fn
 * @param {{ ttlMs?: number, heartbeatMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withSessionCommandLock(sessionId, fn, options = {}) {
    const path = sessionCommandLockPath(sessionId);
    mkdirSync(dirname(path), { recursive: true });
    /** @type {number|null} */
    let fd = null;
    let attempts = 0;
    const ttlMs = Number(options.ttlMs || DEFAULT_SESSION_COMMAND_LOCK_TTL_MS);
    const heartbeatMs = Number(options.heartbeatMs ?? SESSION_COMMAND_LOCK_HEARTBEAT_MS);
    const acquiredAtMs = Date.now();
    while (attempts < LOCK_RETRY_LIMIT) {
        try {
            fd = openSync(path, 'wx');
            try {
                writeFileSync(fd, JSON.stringify(commandLockMetadata(sessionId, ttlMs, acquiredAtMs)));
            } catch { /* best-effort metadata write */ }
            break;
        } catch (err) {
            const e = /** @type {NodeJS.ErrnoException} */ (err);
            if (e?.code !== 'EEXIST') throw err;
            attempts += 1;
            const stale = isSessionCommandLockStale(path);
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
    const heartbeatTimer = heartbeatMs > 0
        ? setInterval(() => {
            try { writeFileSync(path, JSON.stringify(commandLockMetadata(sessionId, ttlMs, acquiredAtMs))); } catch { /* best effort */ }
        }, Math.max(1000, heartbeatMs))
        : null;
    heartbeatTimer?.unref?.();
    try {
        return await fn();
    } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        try { closeSync(fd); } catch { /* already closed */ }
        try { unlinkSync(path); } catch { /* already gone */ }
    }
}

/**
 * @param {WebAiSession} session
 * @returns {WebAiSession}
 */
export function insertSession(session) {
    return withStoreLock(() => {
        const store = readSessionStore();
        store.sessions.push(session);
        writeSessionStore(store);
        return session;
    });
}

/**
 * @param {string} sessionId
 * @param {Partial<WebAiSession> & Record<string, unknown>} patch
 * @returns {WebAiSession|null}
 */
export function patchSession(sessionId, patch) {
    return withStoreLock(() => {
        const store = readSessionStore();
        const idx = store.sessions.findIndex((s) => s.sessionId === sessionId);
        if (idx < 0) return null;
        store.sessions[idx] = { ...store.sessions[idx], ...patch };
        writeSessionStore(store);
        return store.sessions[idx];
    });
}

/**
 * @param {{ sessionId?: string, vendor?: string, status?: string, active?: boolean, limit?: number }} [filter]
 * @returns {WebAiSession[]}
 */
export function listStoredSessions(filter = {}) {
    const store = readSessionStoreLocked();
    let rows = store.sessions;
    if (filter.sessionId) rows = rows.filter((s) => s.sessionId === filter.sessionId);
    if (filter.vendor) rows = rows.filter((s) => s.vendor === filter.vendor);
    if (filter.status) rows = rows.filter((s) => s.status === filter.status);
    if (filter.active === true) rows = rows.filter((session) => isSessionActive(session));
    rows = rows.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (typeof filter.limit === 'number' && filter.limit > 0) rows = rows.slice(-filter.limit);
    return rows;
}

/**
 * @param {WebAiSession|null|undefined} session
 * @param {number} [now]
 * @returns {boolean}
 */
export function isSessionActive(session, now = Date.now()) {
    if (!session || !['sent', 'polling'].includes(session.status)) return false;
    const deadline = Date.parse(session.deadlineAt || '');
    return !Number.isFinite(deadline) || deadline > now;
}

/**
 * @param {{ olderThanMs?: number, before?: string, status?: string }} [opts]
 * @returns {{ removed: number, remaining: number }}
 */
export function pruneSessions({ olderThanMs, before, status } = {}) {
    return withStoreLock(() => {
        const store = readSessionStore();
        const cutoff = before
            ? Date.parse(before)
            : olderThanMs
                ? Date.now() - olderThanMs
                : null;
        const before_count = store.sessions.length;
        store.sessions = store.sessions.filter((session) => {
            const created = Date.parse(session.createdAt || '');
            if (status && session.status !== status) return true;
            if (cutoff !== null && Number.isFinite(created) && created < cutoff) return false;
            return true;
        });
        const removed = before_count - store.sessions.length;
        writeSessionStore(store);
        return { removed, remaining: store.sessions.length };
    });
}

/** @returns {Array<Record<string, unknown>>} */
export function loadLegacyBaselines() {
    const path = join(home(), 'web-ai-baselines.json');
    if (!existsSync(path)) return [];
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed?.baselines) ? parsed.baselines : [];
    } catch {
        return [];
    }
}
