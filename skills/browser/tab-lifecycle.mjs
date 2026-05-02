/**
 * Tab Lifecycle — Enforce MAX_TABS limit. Idle timeout disabled: listManagedTabs
 * does not return real lastActiveAt metadata, so all tabs appear idle.
 */
import { closeTab, listManagedTabs } from './tab-manager.mjs';
import { listSessions } from '../../web-ai/session.mjs';

const MAX_TABS = parseInt(process.env.AGBROWSE_MAX_TABS || '10', 10);

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

/**
 * Enforce MAX_TABS limit. Closes oldest non-pinned, non-active-session tabs.
 * @param {number} port - CDP port
 * @returns {Promise<{closed: number}>}
 */
export async function cleanupIdleTabs(port) {
    const tabs = await listManagedTabs(port);
    let closed = 0;

    const activeSessionTargetIds = new Set();
    for (const session of listSessions({ active: true })) {
        if (session.targetId) activeSessionTargetIds.add(session.targetId);
    }

    const nonPinned = tabs.filter(t => !pinnedTabs.has(t.targetId));

    if (nonPinned.length > MAX_TABS) {
        const toClose = nonPinned
            .sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0))
            .slice(0, nonPinned.length - MAX_TABS);

        for (const tab of toClose) {
            if (activeSessionTargetIds.has(tab.targetId)) continue;
            try {
                await closeTab(port, tab.targetId);
                closed += 1;
            } catch {
                // Tab may already be closed
            }
        }
    }

    return { closed };
}
