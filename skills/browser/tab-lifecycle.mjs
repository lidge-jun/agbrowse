/**
 * Tab Lifecycle — Enforce MAX_TABS limit and idle timeout.
 */
import { closeTab, listManagedTabs } from './tab-manager.mjs';
import { listSessions } from '../../web-ai/session.mjs';
import { listLeases } from '../../web-ai/tab-lease-store.mjs';
import { activeCommandTargetIds } from '../../web-ai/active-command-store.mjs';

const MAX_TABS = parseInt(process.env.AGBROWSE_MAX_TABS || '10', 10);
const IDLE_TIMEOUT_MS = parseDuration(process.env.AGBROWSE_TAB_IDLE || '30m');
const PROVIDER_ORIGINS = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com',
    grok: 'https://grok.com',
};

const pinnedTabs = new Set(); // targetIds that should never auto-close

export function pinTab(targetId) {
    pinnedTabs.add(targetId);
}

export function unpinTab(targetId) {
    pinnedTabs.delete(targetId);
}

export function isPinned(targetId) {
    return pinnedTabs.has(targetId);
}

export function parseDuration(value) {
    const match = /^(\d+)\s*(ms|s|m|h)?$/i.exec(String(value || '').trim());
    if (!match) return 30 * 60 * 1000;
    const n = Number(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 60_000;
    return n * factor;
}

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

export function selectProviderTabsForCleanup({
    tabs,
    vendor,
    keep = 1,
    activeSessionTargetIds = new Set(),
    activeCommandTargetIds: activeCommandTargets = new Set(),
    pinnedTargetIds = new Set(),
} = {}) {
    const origin = PROVIDER_ORIGINS[vendor];
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

function isCloseableByOwnership(tab, leaseByTargetId, includeUntracked) {
    if (!leaseByTargetId) return true;
    const lease = leaseByTargetId.get(tab.targetId);
    if (!lease) return includeUntracked === true;
    return ['web-ai', 'cli-jaw'].includes(lease.owner) &&
        ['pooled', 'completed-session'].includes(lease.state);
}

/**
 * Enforce MAX_TABS limit and idle timeout. Closes oldest non-pinned, non-active-session tabs.
 * @param {number} port - CDP port
 * @param {Object} opts
 * @returns {Promise<{closed: number, idleClosed: number, limitClosed: number}>}
 */
export async function cleanupIdleTabs(port, opts = {}) {
    const tabs = await listManagedTabs(port);
    const now = opts.now || Date.now();
    const leases = await listLeases().catch(() => []);
    const leaseByTargetId = new Map(leases.map(lease => [lease.targetId, lease]));

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

function providerOriginFromUrl(url = '') {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}
