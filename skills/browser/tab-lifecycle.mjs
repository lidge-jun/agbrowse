/**
 * Tab Lifecycle — Enforce MAX_TABS limit and idle timeout.
 */
import { closeTab, listManagedTabs } from './tab-manager.mjs';
import { listSessions } from '../../web-ai/session.mjs';

const MAX_TABS = parseInt(process.env.AGBROWSE_MAX_TABS || '10', 10);
const IDLE_TIMEOUT_MS = parseDuration(process.env.AGBROWSE_TAB_IDLE || '30m');

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
    pinnedTargetIds = new Set(),
    now = Date.now(),
    idleTimeoutMs = IDLE_TIMEOUT_MS,
    maxTabs = MAX_TABS,
    includeUntracked = false,
} = {}) {
    const selected = new Map();
    const closeable = (tabs || []).filter(tab =>
        tab?.targetId &&
        !pinnedTargetIds.has(tab.targetId) &&
        !activeSessionTargetIds.has(tab.targetId)
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
            (tracked || includeUntracked);
    });

    if (remaining.length > maxTabs) {
        const limitCloseCount = remaining.length - maxTabs;
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
 * Enforce MAX_TABS limit and idle timeout. Closes oldest non-pinned, non-active-session tabs.
 * @param {number} port - CDP port
 * @param {Object} opts
 * @returns {Promise<{closed: number, idleClosed: number, limitClosed: number}>}
 */
export async function cleanupIdleTabs(port, opts = {}) {
    const tabs = await listManagedTabs(port);
    const now = opts.now || Date.now();

    const activeSessionTargetIds = new Set();
    for (const session of listSessions({ active: true })) {
        if (session.targetId) activeSessionTargetIds.add(session.targetId);
    }

    const toClose = selectTabsForCleanup({
        tabs,
        activeSessionTargetIds,
        pinnedTargetIds: pinnedTabs,
        now,
        idleTimeoutMs: opts.idleTimeoutMs || IDLE_TIMEOUT_MS,
        maxTabs: opts.maxTabs ?? MAX_TABS,
        includeUntracked: opts.includeUntracked === true,
    });

    const summary = { closed: 0, idleClosed: 0, limitClosed: 0, untrackedClosed: 0 };
    for (const tab of toClose) {
        try {
            await closeTab(port, tab.targetId);
            summary.closed += 1;
            if (tab.cleanupReason === 'idle-timeout') summary.idleClosed += 1;
            else if (tab.cleanupReason === 'max-tabs') summary.limitClosed += 1;
            else if (tab.cleanupReason === 'untracked') summary.untrackedClosed += 1;
        } catch {
            // Tab may already be closed
        }
    }

    return summary;
}
