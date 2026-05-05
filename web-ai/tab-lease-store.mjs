// @ts-check
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { closeTab, isTabAlive } from '../skills/browser/tab-manager.mjs';
import { activeCommandTargetIds } from './active-command-store.mjs';

/**
 * @typedef {{
 *   owner: string,
 *   vendor: string,
 *   sessionType: string,
 *   origin: string,
 *   browserProfileKey: string,
 *   targetId: string,
 *   sessionId: string|null,
 *   url: string|null,
 *   state: string,
 *   leasedAt: string,
 *   pooledAt: string|null,
 *   finalizedAt: string|null,
 *   poolExpiresAt: string|null,
 *   leaseDisposition: string|null,
 *   updatedAt: string,
 *   leaseKey: string,
 *   closePreviousState?: string,
 *   cleanupReason?: string,
 *   closeFailedAt?: string,
 * }} Lease
 *
 * @typedef {{
 *   owner?: string,
 *   vendor?: string,
 *   sessionType?: string,
 *   origin?: string,
 *   url?: string|null,
 *   browserProfileKey?: string,
 *   port?: string|number,
 *   targetId?: string,
 *   sessionId?: string|null,
 *   state?: string,
 *   leasedAt?: string,
 *   pooledAt?: string|null,
 *   finalizedAt?: string|null,
 *   poolExpiresAt?: string|null,
 *   leaseDisposition?: string|null,
 *   updatedAt?: string,
 *   leaseKey?: string,
 *   ttlMs?: number,
 *   maxPerKey?: number,
 *   globalMax?: number,
 *   completedSessions?: boolean,
 *   now?: number,
 * }} LeaseInput
 *
 * @typedef {{ targetId?: string, vendor?: string, owner?: string, state?: string }} ListLeasesFilter
 * @typedef {{ version: number, leases: Lease[] }} StoreFile
 */

const STORE_VERSION = 1;
const LOCK_RETRY_MS = 25;
const LOCK_RETRY_LIMIT = 200;
const STALE_LOCK_MS = 30_000;
const DEFAULT_POOL_TTL_MS = parseDuration(process.env.AGBROWSE_PROVIDER_POOL_TTL || '5m');
const DEFAULT_POOL_MAX_PER_KEY = parseInt(process.env.AGBROWSE_PROVIDER_POOL_MAX_PER_KEY || '1', 10);
const DEFAULT_POOL_GLOBAL_MAX = parseInt(process.env.AGBROWSE_PROVIDER_POOL_GLOBAL_MAX || '4', 10);

function home() {
    return process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
}

function storePath() {
    return join(home(), 'web-ai-tab-leases.json');
}

function lockPath() {
    return `${storePath()}.lock`;
}

/**
 * @param {string|number|undefined} value
 * @returns {number}
 */
export function parseDuration(value) {
    const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(String(value || '').trim());
    if (!match) return 5 * 60_000;
    const n = Number(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 60_000;
    return n * factor;
}

/**
 * @param {LeaseInput} [input]
 * @returns {string}
 */
export function buildLeaseKey({ owner = 'web-ai', vendor = 'chatgpt', sessionType = 'send-poll', origin = '', url = '', browserProfileKey = '', port = '' } = {}) {
    return [
        owner,
        vendor,
        sessionType,
        origin || originFromUrl(url),
        browserProfileKey || String(port || process.env.CDP_PORT || '9222'),
    ].join(':');
}

/**
 * @param {string|null|undefined} url
 * @returns {string}
 */
export function originFromUrl(url) {
    try {
        return new URL(/** @type {string} */ (url)).origin;
    } catch {
        return 'unknown-origin';
    }
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withLeaseLock(fn) {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    /** @type {number|null} */
    let fd = null;
    let attempts = 0;
    while (attempts < LOCK_RETRY_LIMIT) {
        try {
            fd = openSync(path, 'wx');
            try {
                writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
            } catch { /* best-effort lock metadata */ }
            break;
        } catch (error) {
            if (/** @type {{ code?: string }} */ (error)?.code !== 'EEXIST') throw error;
            attempts += 1;
            if (isStaleLock(path)) {
                try { unlinkSync(path); } catch { /* raced with releaser */ }
                continue;
            }
            await sleep(LOCK_RETRY_MS);
        }
    }
    if (fd === null) throw new Error(`web-ai tab lease: failed to acquire lock at ${path}`);
    try {
        return await fn();
    } finally {
        try { closeSync(fd); } catch { /* already closed */ }
        try { unlinkSync(path); } catch { /* already gone */ }
    }
}

/**
 * @param {string} path
 */
function isStaleLock(path) {
    try {
        const parsed = /** @type {{ acquiredAt?: string }} */ (JSON.parse(readFileSync(path, 'utf8')));
        const acquired = Date.parse(parsed?.acquiredAt || '');
        return !Number.isFinite(acquired) || Date.now() - acquired > STALE_LOCK_MS;
    } catch {
        return true;
    }
}

/**
 * @param {number} ms
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** @returns {StoreFile} */
function readStore() {
    const path = storePath();
    if (!existsSync(path)) return { version: STORE_VERSION, leases: [] };
    try {
        const parsed = /** @type {{ version?: unknown, leases?: unknown }} */ (JSON.parse(readFileSync(path, 'utf8')));
        return {
            version: Number(parsed?.version) || STORE_VERSION,
            leases: Array.isArray(parsed?.leases) ? /** @type {Lease[]} */ (parsed.leases.filter((/** @type {{ targetId?: string }} */ lease) => lease?.targetId)) : [],
        };
    } catch {
        return { version: STORE_VERSION, leases: [] };
    }
}

/**
 * @param {{ leases: Lease[] }} store
 */
function writeStore(store) {
    const path = storePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, `${JSON.stringify({ version: STORE_VERSION, leases: store.leases || [] }, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
}

/**
 * @param {ListLeasesFilter} [filter]
 * @returns {Promise<Lease[]>}
 */
export async function listLeases(filter = {}) {
    return withLeaseLock(async () => {
        let leases = readStore().leases;
        if (filter.targetId) leases = leases.filter(lease => lease.targetId === filter.targetId);
        if (filter.vendor) leases = leases.filter(lease => lease.vendor === filter.vendor);
        if (filter.owner) leases = leases.filter(lease => lease.owner === filter.owner);
        if (filter.state) leases = leases.filter(lease => lease.state === filter.state);
        return leases;
    });
}

/**
 * @param {LeaseInput} [input]
 * @returns {Promise<Lease>}
 */
export async function recordActiveLease(input = {}) {
    const now = new Date().toISOString();
    return withLeaseLock(async () => {
        const store = readStore();
        const lease = normalizeLease({
            ...input,
            state: 'active-session',
            leasedAt: input.leasedAt || now,
            updatedAt: now,
        });
        store.leases = store.leases.filter(row => !sameTargetScope(row, lease) && !sameSessionScope(row, lease));
        store.leases.push(lease);
        writeStore(store);
        return lease;
    });
}

/**
 * @param {number} port
 * @param {LeaseInput} [input]
 * @returns {Promise<{ targetId: string, url: string|null, lease: Lease }|null>}
 */
export async function checkoutPooledLease(port, input = {}) {
    const now = Date.now();
    /** @type {Lease[]} */
    const toClose = [];
    /** @type {Set<string>} */
    const deadIds = new Set();
    /** @type {Lease|null} */
    let selected = null;
    return withLeaseLock(async () => {
        const store = readStore();
        const key = buildLeaseKey(input);
        const candidates = store.leases
            .filter(lease => lease.state === 'pooled' && lease.leaseKey === key)
            .sort((a, b) => Date.parse(b.pooledAt || '') - Date.parse(a.pooledAt || ''));
        for (const lease of candidates) {
            const expires = Date.parse(lease.poolExpiresAt || '');
            if (Number.isFinite(expires) && now >= expires) {
                if (await isTabAlive(port, lease.targetId)) toClose.push({ ...lease, cleanupReason: 'pool-expired' });
                continue;
            }
            if (!(await isTabAlive(port, lease.targetId))) {
                deadIds.add(scopedTargetKey(lease));
                continue;
            }
            selected = lease;
            break;
        }
        const closingIds = new Set(toClose.map(row => scopedTargetKey(row)));
        store.leases = store.leases
            .filter(row => !(selected && sameTargetScope(row, selected)))
            .filter(row => !deadIds.has(scopedTargetKey(row)))
            .map(row => closingIds.has(scopedTargetKey(row)) ? { ...row, state: 'closing', closePreviousState: row.state, updatedAt: new Date().toISOString() } : row);
        writeStore(store);
        const sel = /** @type {Lease|null} */ (selected);
        return sel ? { targetId: sel.targetId, url: sel.url, lease: sel } : null;
    }).then(async result => {
        await closeLeasesAndUpdateStore(port, uniqueByIdentity(toClose));
        return result;
    });
}

/**
 * @param {number} port
 * @param {LeaseInput} [input]
 * @returns {Promise<{ pooled: boolean, closed: number, closedTabs: Lease[], skipped?: { reason: string, current: Lease|null } }>}
 */
export async function releaseCompletedLease(port, input = {}) {
    const now = new Date();
    const pooledAt = now.toISOString();
    const ttlMs = input.ttlMs ?? DEFAULT_POOL_TTL_MS;
    const maxPerKey = input.maxPerKey ?? DEFAULT_POOL_MAX_PER_KEY;
    const lease = normalizeLease({
        ...input,
        state: 'pooled',
        finalizedAt: input.finalizedAt || pooledAt,
        pooledAt,
        poolExpiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        leaseDisposition: maxPerKey > 0 ? 'pooled' : 'close',
        updatedAt: pooledAt,
    });
    /** @type {Lease[]} */
    const toClose = [];
    /** @type {{ reason: string, current: Lease|null }|null} */
    let skipped = null;
    await withLeaseLock(async () => {
        const store = readStore();
        const current = store.leases.find(row => sameTargetScope(row, lease));
        if (!current || current.state !== 'active-session' || !lease.sessionId || current.sessionId !== lease.sessionId) {
            skipped = { reason: 'lease-not-current-active-session', current: current || null };
            return;
        }
        store.leases = store.leases.filter(row => !sameTargetScope(row, lease));
        if (maxPerKey > 0) store.leases.push(lease);
        else {
            const closingLease = { ...lease, state: 'closing', closePreviousState: 'completed-session', cleanupReason: 'pool-disabled', leaseDisposition: 'closing' };
            store.leases.push(closingLease);
            toClose.push(closingLease);
        }
        toClose.push(...selectOverflowAndExpired(store.leases.filter(row => sameBrowserProfile(row, lease)), {
            nowMs: now.getTime(),
            maxPerKey,
            globalMax: input.globalMax ?? DEFAULT_POOL_GLOBAL_MAX,
        }));
        const closing = new Set(toClose.map(row => scopedTargetKey(row)));
        store.leases = store.leases.map(row => closing.has(scopedTargetKey(row)) ? { ...row, state: 'closing', closePreviousState: row.closePreviousState || row.state, updatedAt: pooledAt } : row);
        writeStore(store);
    });
    if (skipped) return { pooled: false, closed: 0, closedTabs: [], skipped };
    const closedTabs = await closeLeasesAndUpdateStore(port, uniqueByIdentity(toClose));
    return { pooled: maxPerKey > 0 && !closedTabs.some(row => row.targetId === lease.targetId), closed: closedTabs.length, closedTabs };
}

/**
 * @param {number} port
 * @param {LeaseInput} [input]
 * @returns {Promise<{ closed: number, closedTabs: Lease[] }>}
 */
export async function cleanupLeasedTabs(port, input = {}) {
    const nowMs = input.now || Date.now();
    /** @type {Lease[]} */
    const toClose = [];
    const browserProfileKey = String(input.browserProfileKey || port || process.env.CDP_PORT || '9222');
    const activeTargets = await activeCommandTargetIds({ browserProfileKey });
    await withLeaseLock(async () => {
        const store = readStore();
        /** @type {string[]} */
        const dead = [];
        for (const lease of store.leases) {
            if (lease.browserProfileKey !== browserProfileKey) continue;
            if (!(await isTabAlive(port, lease.targetId))) dead.push(lease.targetId);
        }
        store.leases = store.leases.filter(lease => lease.browserProfileKey !== browserProfileKey || !dead.includes(lease.targetId));
        const closeableLeases = store.leases.filter(lease => lease.browserProfileKey === browserProfileKey && !activeTargets.has(lease.targetId));
        toClose.push(...selectOverflowAndExpired(closeableLeases, {
            nowMs,
            maxPerKey: input.maxPerKey ?? DEFAULT_POOL_MAX_PER_KEY,
            globalMax: input.globalMax ?? DEFAULT_POOL_GLOBAL_MAX,
        }));
        if (input.completedSessions === true) {
            toClose.push(...closeableLeases.filter(lease => lease.state === 'completed-session'));
        }
        const closing = new Set(toClose.map(row => scopedTargetKey(row)));
        store.leases = store.leases.map(row => closing.has(scopedTargetKey(row)) ? { ...row, state: 'closing', closePreviousState: row.closePreviousState || row.state, updatedAt: new Date().toISOString() } : row);
        writeStore(store);
    });
    const closedTabs = await closeLeasesAndUpdateStore(port, uniqueByIdentity(toClose));
    return { closed: closedTabs.length, closedTabs };
}

/**
 * @param {string|undefined} targetId
 * @param {LeaseInput} [scope]
 */
export async function removeLease(targetId, scope = {}) {
    if (!targetId) return;
    await withLeaseLock(async () => {
        const store = readStore();
        const scoped = normalizeLease({ ...scope, targetId });
        store.leases = store.leases.filter(lease => !sameTargetScope(lease, scoped));
        writeStore(store);
    });
}

/** @returns {Promise<Record<string, number>>} */
export async function poolStats() {
    const leases = await listLeases();
    /** @type {Record<string, number>} */
    const stats = {};
    for (const lease of leases.filter(row => row.state === 'pooled')) {
        stats[lease.leaseKey] = (stats[lease.leaseKey] || 0) + 1;
    }
    return stats;
}

/**
 * @param {LeaseInput} [input]
 * @returns {Lease}
 */
function normalizeLease(input = {}) {
    const origin = input.origin || originFromUrl(input.url);
    /** @type {Lease} */
    const lease = {
        owner: input.owner || 'web-ai',
        vendor: input.vendor || 'chatgpt',
        sessionType: input.sessionType || 'send-poll',
        origin,
        browserProfileKey: input.browserProfileKey || String(input.port || process.env.CDP_PORT || '9222'),
        targetId: /** @type {string} */ (input.targetId),
        sessionId: input.sessionId || null,
        url: input.url || null,
        state: input.state || 'active-session',
        leasedAt: input.leasedAt || new Date().toISOString(),
        pooledAt: input.pooledAt || null,
        finalizedAt: input.finalizedAt || null,
        poolExpiresAt: input.poolExpiresAt || null,
        leaseDisposition: input.leaseDisposition || null,
        updatedAt: input.updatedAt || new Date().toISOString(),
        leaseKey: '',
    };
    lease.leaseKey = input.leaseKey || buildLeaseKey(lease);
    return lease;
}

/**
 * @param {Partial<Lease>} lease
 */
function scopedTargetKey(lease) {
    return [lease.owner || '', lease.vendor || '', lease.sessionType || '', lease.origin || '', lease.browserProfileKey || '', lease.targetId || ''].join(':');
}

/**
 * @param {Partial<Lease>|null|undefined} a
 * @param {Partial<Lease>|null|undefined} b
 */
function sameTargetScope(a, b) {
    return a?.targetId && b?.targetId && scopedTargetKey(a) === scopedTargetKey(b);
}

/**
 * @param {Partial<Lease>|null|undefined} a
 * @param {Partial<Lease>|null|undefined} b
 */
function sameSessionScope(a, b) {
    return a?.sessionId && b?.sessionId && a.sessionId === b.sessionId && a.owner === b.owner && a.vendor === b.vendor && a.sessionType === b.sessionType && a.browserProfileKey === b.browserProfileKey;
}

/**
 * @param {Partial<Lease>|null|undefined} a
 * @param {Partial<Lease>|null|undefined} b
 */
function sameBrowserProfile(a, b) {
    return a?.owner === b?.owner && a?.vendor === b?.vendor && a?.sessionType === b?.sessionType && a?.browserProfileKey === b?.browserProfileKey;
}

/**
 * @param {Lease[]} leases
 * @param {{ nowMs: number, maxPerKey: number, globalMax: number }} options
 * @returns {Lease[]}
 */
function selectOverflowAndExpired(leases, { nowMs, maxPerKey, globalMax }) {
    /** @type {Lease[]} */
    const selected = [];
    const pooled = leases.filter(lease => lease.state === 'pooled');
    for (const lease of pooled) {
        const expires = Date.parse(lease.poolExpiresAt || '');
        if (Number.isFinite(expires) && nowMs >= expires) selected.push({ ...lease, cleanupReason: 'pool-expired' });
    }
    const selectedIds = new Set(selected.map(lease => lease.targetId));
    /** @type {Map<string, Lease[]>} */
    const byKey = new Map();
    for (const lease of pooled.filter(lease => !selectedIds.has(lease.targetId))) {
        if (!byKey.has(lease.leaseKey)) byKey.set(lease.leaseKey, []);
        /** @type {Lease[]} */ (byKey.get(lease.leaseKey)).push(lease);
    }
    for (const list of byKey.values()) {
        const ordered = list.slice().sort((a, b) => Date.parse(b.pooledAt || '') - Date.parse(a.pooledAt || ''));
        for (const lease of ordered.slice(Math.max(0, maxPerKey))) {
            selected.push({ ...lease, cleanupReason: 'max-pooled-per-key' });
        }
    }
    const remaining = pooled
        .filter(lease => !selected.some(row => row.targetId === lease.targetId))
        .sort((a, b) => Date.parse(b.pooledAt || '') - Date.parse(a.pooledAt || ''));
    for (const lease of remaining.slice(Math.max(0, globalMax))) {
        selected.push({ ...lease, cleanupReason: 'max-pooled-global' });
    }
    return selected;
}

/**
 * @param {Lease[]} leases
 * @returns {Lease[]}
 */
function uniqueByIdentity(leases) {
    /** @type {Set<string>} */
    const seen = new Set();
    return leases.filter(lease => {
        const key = scopedTargetKey(lease);
        if (!lease?.targetId || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * @param {number} port
 * @param {Lease[]} leases
 * @returns {Promise<Lease[]>}
 */
async function closeLeasesAndUpdateStore(port, leases) {
    /** @type {Lease[]} */
    const closed = [];
    /** @type {Lease[]} */
    const failed = [];
    for (const lease of leases) {
        try {
            await closeTab(port, lease.targetId);
            closed.push(lease);
        } catch {
            if (await isTabAlive(port, lease.targetId)) failed.push(lease);
            else closed.push(lease);
        }
    }
    if (closed.length > 0 || failed.length > 0) {
        await withLeaseLock(async () => {
            const store = readStore();
            const closedKeys = new Set(closed.map(row => scopedTargetKey(row)));
            const failedKeys = new Set(failed.map(row => scopedTargetKey(row)));
            store.leases = store.leases
                .filter(row => !closedKeys.has(scopedTargetKey(row)))
                .map(row => failedKeys.has(scopedTargetKey(row))
                    ? { ...row, state: row.closePreviousState || 'pooled', closeFailedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
                    : row);
            writeStore(store);
        });
    }
    return closed;
}
