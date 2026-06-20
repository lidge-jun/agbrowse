// @ts-check
/**
 * Tab Lifecycle — Enforce MAX_TABS limit and idle timeout.
 */
import { closeTab, listManagedTabs } from './tab-manager.mjs';
import { listSessions } from '../../web-ai/session.mjs';
import { listLeases } from '../../web-ai/tab-lease-store.mjs';
import { activeCommandTargetIds } from '../../web-ai/active-command-store.mjs';

/** @typedef {import('./tab-manager.mjs').ManagedTabRow} ManagedTabRow */
/** @typedef {import('../../web-ai/tab-lease-store.mjs').Lease} Lease */

/**
 * @typedef {ManagedTabRow & { cleanupReason?: string, vendor?: string }} CleanupTab
 */

const MAX_TABS = parseInt(process.env.AGBROWSE_MAX_TABS || '20', 10);
const IDLE_TIMEOUT_MS = parseDuration(process.env.AGBROWSE_TAB_IDLE || '30m');

export const DEFAULT_MAX_TABS = MAX_TABS;
/** @type {Readonly<Record<string, string>>} */
const PROVIDER_ORIGINS = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com',
    grok: 'https://grok.com',
};

/** @type {Set<string>} targetIds that should never auto-close */
const pinnedTabs = new Set();

/** @param {string} targetId */
export function pinTab(targetId) {
    pinnedTabs.add(targetId);
}

/** @param {string} targetId */
export function unpinTab(targetId) {
    pinnedTabs.delete(targetId);
}

/**
 * @param {string} targetId
 * @returns {boolean}
 */
export function isPinned(targetId) {
    return pinnedTabs.has(targetId);
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function parseDuration(value) {
    const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(String(value || '').trim());
    if (!match) return 30 * 60 * 1000;
    const n = Number(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 60_000;
    return n * factor;
}

/**
 * @typedef {Object} SelectTabsOptions
 * @property {ManagedTabRow[]} [tabs]
 * @property {Set<string>} [activeSessionTargetIds]
 * @property {Set<string | null>} [activeCommandTargetIds]
 * @property {Set<string>} [pinnedTargetIds]
 * @property {number} [now]
 * @property {number} [idleTimeoutMs]
 * @property {number} [maxTabs]
 * @property {boolean} [includeUntracked]
 * @property {Map<string, Lease> | null} [leaseByTargetId]
 */

/**
 * @param {SelectTabsOptions} [opts]
 * @returns {CleanupTab[]}
 */
export function selectTabsForCleanup({
    tabs,
    activeSessionTargetIds = new Set(),
    activeCommandTargetIds: activeCommandTargets = new Set(),
    pinnedTargetIds = new Set(),
    now = Date.now(),
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    maxTabs = MAX_TABS,
    includeUntracked = false,
    leaseByTargetId = null,
} = {}) {
    /** @type {Map<string, CleanupTab>} */
    const selected = new Map();
    const closeable = (tabs || []).filter(tab =>
        tab?.targetId &&
        !pinnedTargetIds.has(tab.targetId) &&
        !activeSessionTargetIds.has(tab.targetId) &&
        !activeCommandTargets.has(tab.targetId) &&
        isCloseableByOwnership(tab, leaseByTargetId, includeUntracked)
    );

    for (const tab of closeable) {
        const lastActiveAt = Number(tab.lastActiveAt);
        const tracked = Number.isFinite(lastActiveAt) && lastActiveAt > 0;
        if ((tracked && now - lastActiveAt > idleTimeoutMs) || (!tracked && includeUntracked)) {
            selected.set(tab.targetId, { ...tab, cleanupReason: tracked ? 'idle-timeout' : 'untracked' });
        }
    }

    const remaining = (tabs || []).filter(tab => tab?.targetId && !selected.has(tab.targetId));
    const remainingUnpinned = remaining.filter(tab => {
        const lastActiveAt = Number(tab.lastActiveAt);
        const tracked = Number.isFinite(lastActiveAt) && lastActiveAt > 0;
        return !pinnedTargetIds.has(tab.targetId) &&
            !activeSessionTargetIds.has(tab.targetId) &&
            !activeCommandTargets.has(tab.targetId) &&
            (tracked || includeUntracked) &&
            isCloseableByOwnership(tab, leaseByTargetId, includeUntracked);
    });

    const limitSourceCount = leaseByTargetId ? remainingUnpinned.length : remaining.length;
    if (limitSourceCount > maxTabs) {
        const limitCloseCount = limitSourceCount - maxTabs;
        const oldest = remainingUnpinned
            .slice()
            .sort((a, b) => (Number(a.lastActiveAt) || 0) - (Number(b.lastActiveAt) || 0))
            .slice(0, limitCloseCount);
        for (const tab of oldest) {
            selected.set(tab.targetId, { ...tab, cleanupReason: 'max-tabs' });
        }
    }

    return Array.from(selected.values());
}

/**
 * @typedef {Object} SelectProviderOptions
 * @property {ManagedTabRow[]} [tabs]
 * @property {string} [vendor]
 * @property {number} [keep]
 * @property {Set<string>} [activeSessionTargetIds]
 * @property {Set<string | null>} [activeCommandTargetIds]
 * @property {Set<string>} [pinnedTargetIds]
 */

/**
 * @param {SelectProviderOptions} [opts]
 * @returns {CleanupTab[]}
 */
export function selectProviderTabsForCleanup({
    tabs,
    vendor,
    keep = 1,
    activeSessionTargetIds = new Set(),
    activeCommandTargetIds: activeCommandTargets = new Set(),
    pinnedTargetIds = new Set(),
} = {}) {
    const origin = PROVIDER_ORIGINS[/** @type {string} */ (vendor)];
    if (!origin) return [];
    const keepCount = Math.max(0, Number.isFinite(Number(keep)) ? Number(keep) : 1);
    return (tabs || [])
        .filter(tab => tab?.targetId && providerOriginFromUrl(tab.url) === origin)
        .filter(tab =>
            !pinnedTargetIds.has(tab.targetId) &&
            !activeSessionTargetIds.has(tab.targetId) &&
            !activeCommandTargets.has(tab.targetId)
        )
        .sort((a, b) => (Number(b.lastActiveAt) || 0) - (Number(a.lastActiveAt) || 0))
        .slice(keepCount)
        .map(tab => ({ ...tab, cleanupReason: 'provider-overflow', vendor }));
}

/**
 * @param {ManagedTabRow} tab
 * @param {Map<string, Lease> | null | undefined} leaseByTargetId
 * @param {boolean} includeUntracked
 * @returns {boolean}
 */
function isCloseableByOwnership(tab, leaseByTargetId, includeUntracked) {
    if (!leaseByTargetId) return true;
    const lease = leaseByTargetId.get(tab.targetId);
    if (!lease) return includeUntracked === true;
    return ['web-ai', 'cli-jaw'].includes(lease.owner) &&
        ['pooled', 'completed-session'].includes(lease.state);
}

/**
 * @typedef {Object} CleanupOptions
 * @property {number} [now]
 * @property {number} [idleTimeoutMs]
 * @property {number} [maxTabs]
 * @property {boolean} [includeUntracked]
 * @property {string} [provider]
 * @property {number} [keepProviderTabs]
 */

/**
 * @typedef {Object} CleanupSummary
 * @property {number} closed
 * @property {number} idleClosed
 * @property {number} limitClosed
 * @property {number} untrackedClosed
 * @property {number} providerClosed
 */

/**
 * Enforce MAX_TABS limit and idle timeout. Closes oldest non-pinned, non-active-session tabs.
 * @param {number} port - CDP port
 * @param {CleanupOptions} [opts]
 * @returns {Promise<CleanupSummary>}
 */
export async function cleanupIdleTabs(port, opts = {}) {
    const tabs = await listManagedTabs(port);
    const now = opts.now || Date.now();
    const leases = await listLeases().catch(() => /** @type {Lease[]} */ ([]));
    const leaseByTargetId = new Map(leases.map(lease => [lease.targetId, lease]));

    /** @type {Set<string>} */
    const activeSessionTargetIds = new Set();
    for (const session of listSessions({ active: true })) {
        if (session.targetId) activeSessionTargetIds.add(session.targetId);
    }
    const activeCommandTargets = await activeCommandTargetIds({ browserProfileKey: String(port) });

    const toClose = selectTabsForCleanup({
        tabs,
        activeSessionTargetIds,
        activeCommandTargetIds: activeCommandTargets,
        pinnedTargetIds: pinnedTabs,
        now,
        idleTimeoutMs: opts.idleTimeoutMs || IDLE_TIMEOUT_MS,
        maxTabs: opts.maxTabs ?? MAX_TABS,
        includeUntracked: opts.includeUntracked === true,
        leaseByTargetId,
    });
    if (opts.provider) {
        for (const tab of selectProviderTabsForCleanup({
            tabs,
            vendor: opts.provider,
            keep: opts.keepProviderTabs ?? 1,
            activeSessionTargetIds,
            activeCommandTargetIds: activeCommandTargets,
            pinnedTargetIds: pinnedTabs,
        })) {
            if (!toClose.some(row => row.targetId === tab.targetId)) toClose.push(tab);
        }
    }

    const summary = { closed: 0, idleClosed: 0, limitClosed: 0, untrackedClosed: 0, providerClosed: 0 };
    for (const tab of toClose) {
        try {
            await closeTab(port, tab.targetId);
            summary.closed += 1;
            if (tab.cleanupReason === 'idle-timeout') summary.idleClosed += 1;
            else if (tab.cleanupReason === 'max-tabs') summary.limitClosed += 1;
            else if (tab.cleanupReason === 'untracked') summary.untrackedClosed += 1;
            else if (tab.cleanupReason === 'provider-overflow') summary.providerClosed += 1;
        } catch {
            // Tab may already be closed
        }
    }

    return summary;
}

/**
 * Same selection logic as cleanupIdleTabs but never invokes Target.closeTarget.
 * Returns a JSON-serialisable plan describing what would be closed.
 *
 * @param {number} port
 * @param {CleanupOptions} [opts]
 * @returns {Promise<{
 *   wouldClose: Array<{ targetId: string, title?: string, url?: string, idleForMs: number|null, reason: string, vendor?: string }>,
 *   counts: { total: number, idleClosed: number, limitClosed: number, untrackedClosed: number, providerClosed: number, leaseClosed: number },
 *   maxTabs: number,
 *   idleTimeoutMs: number,
 *   tabsTotal: number
 * }>}
 */
export async function planCleanupIdleTabs(port, opts = {}) {
    const tabs = await listManagedTabs(port);
    const now = opts.now || Date.now();
    const leases = await listLeases().catch(() => /** @type {Lease[]} */ ([]));
    const leaseByTargetId = new Map(leases.map(lease => [lease.targetId, lease]));

    /** @type {Set<string>} */
    const activeSessionTargetIds = new Set();
    for (const session of listSessions({ active: true })) {
        if (session.targetId) activeSessionTargetIds.add(session.targetId);
    }
    const activeCommandTargets = await activeCommandTargetIds({ browserProfileKey: String(port) });

    const idleTimeoutMs = opts.idleTimeoutMs || IDLE_TIMEOUT_MS;
    const maxTabs = opts.maxTabs ?? MAX_TABS;

    const toClose = selectTabsForCleanup({
        tabs,
        activeSessionTargetIds,
        activeCommandTargetIds: activeCommandTargets,
        pinnedTargetIds: pinnedTabs,
        now,
        idleTimeoutMs,
        maxTabs,
        includeUntracked: opts.includeUntracked === true,
        leaseByTargetId,
    });
    if (opts.provider) {
        for (const tab of selectProviderTabsForCleanup({
            tabs,
            vendor: opts.provider,
            keep: opts.keepProviderTabs ?? 1,
            activeSessionTargetIds,
            activeCommandTargetIds: activeCommandTargets,
            pinnedTargetIds: pinnedTabs,
        })) {
            if (!toClose.some(row => row.targetId === tab.targetId)) toClose.push(tab);
        }
    }

    const counts = { total: 0, idleClosed: 0, limitClosed: 0, untrackedClosed: 0, providerClosed: 0, leaseClosed: 0 };
    /** @type {any[]} */
    const wouldClose = [];
    for (const tab of toClose) {
        const lastActiveAt = Number(tab.lastActiveAt);
        const idleForMs = Number.isFinite(lastActiveAt) && lastActiveAt > 0 ? now - lastActiveAt : null;
        wouldClose.push({
            targetId: tab.targetId,
            title: tab.title,
            url: tab.url,
            idleForMs,
            reason: tab.cleanupReason || 'unknown',
            vendor: tab.vendor,
        });
        counts.total += 1;
        if (tab.cleanupReason === 'idle-timeout') counts.idleClosed += 1;
        else if (tab.cleanupReason === 'max-tabs') counts.limitClosed += 1;
        else if (tab.cleanupReason === 'untracked') counts.untrackedClosed += 1;
        else if (tab.cleanupReason === 'provider-overflow') counts.providerClosed += 1;
    }

    return { wouldClose, counts, maxTabs, idleTimeoutMs, tabsTotal: tabs.length };
}

/**
 * Pick non-active, non-pinned tabs to suggest closing, oldest-idle first,
 * up to enough to bring count to maxTabs - 1.
 * Untracked tabs (no lastActiveAt) are sorted last (we don't know their age).
 *
 * @param {Array<{ targetId: string, title?: string, url?: string, lastActiveAt?: number, idleForMs?: number|null, idleFor?: string }>} tabs
 * @param {number} maxTabs
 * @returns {Array<{ targetId: string, title?: string, url?: string, idleFor?: string }>}
 */
export function pickCleanupCandidates(tabs, maxTabs = MAX_TABS) {
    const pool = (tabs || [])
        .filter(t => t && t.targetId && !pinnedTabs.has(t.targetId))
        .map(t => ({
            ...t,
            _idle: Number.isFinite(Number(t.lastActiveAt)) && Number(t.lastActiveAt) > 0
                ? Date.now() - Number(t.lastActiveAt)
                : -1,
        }));
    pool.sort((a, b) => {
        // Tracked & most-idle first, untracked (=-1) sorted last.
        if (a._idle === -1 && b._idle !== -1) return 1;
        if (a._idle !== -1 && b._idle === -1) return -1;
        return b._idle - a._idle;
    });
    const overflow = Math.max(0, pool.length - (maxTabs - 1));
    return pool.slice(0, Math.max(overflow, Math.min(3, pool.length)))
        .map(({ _idle, ...rest }) => rest);
}

/**
 * @param {string} [url]
 * @returns {string | null}
 */
function providerOriginFromUrl(url = '') {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}
