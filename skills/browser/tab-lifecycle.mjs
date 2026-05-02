/**
 * Tab Lifecycle — Auto-close idle tabs, enforce max tabs, tab pooling
 */
import { closeTab, listManagedTabs } from './tab-manager.mjs';
import { getSession, listSessions } from '../../web-ai/session.mjs';

const TAB_IDLE_TIMEOUT_MS = parseDuration(
    process.env.AGBROWSE_TAB_IDLE || '30m'
);
const MAX_TABS = parseInt(process.env.AGBROWSE_MAX_TABS || '10', 10);
const POOL_MAX_AGE_MS = 60_000; // 1 minute — pooled tabs older than this are stale

const pinnedTabs = new Set(); // targetIds that should never auto-close
const tabPool = new Map(); // targetId -> { vendor, url, pooledAt, lastUsed }

function parseDuration(value) {
    const match = /^([\d.]+)\s*(ms|s|m|h|d)?$/i.exec(String(value).trim());
    if (!match) return 30 * 60_000; // default 30 min
    const n = parseFloat(match[1]);
    const unit = (match[2] || 'm').toLowerCase();
    const factor = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 60_000;
    return n * factor;
}

/**
 * Mark a tab as pinned (prevents auto-close)
 */
export function pinTab(targetId) {
    pinnedTabs.add(targetId);
}

/**
 * Unpin a tab (allows auto-close)
 */
export function unpinTab(targetId) {
    pinnedTabs.delete(targetId);
}

/**
 * Check if a tab is pinned
 */
export function isPinned(targetId) {
    return pinnedTabs.has(targetId);
}

/**
 * Add a closed tab to the pool for potential reuse
 */
export function poolTab(targetId, vendor, url) {
    tabPool.set(targetId, {
        vendor,
        url,
        pooledAt: Date.now(),
        lastUsed: Date.now(),
    });
}

/**
 * Try to reuse a pooled tab for a vendor
 * @returns {string|null} targetId if reusable, null otherwise
 */
export function getPooledTab(vendor) {
    const now = Date.now();
    for (const [targetId, info] of tabPool) {
        if (info.vendor === vendor && (now - info.pooledAt) < POOL_MAX_AGE_MS) {
            tabPool.delete(targetId);
            return targetId;
        }
    }
    return null;
}

/**
 * Clean up stale pooled tabs
 */
export function pruneStalePool() {
    const now = Date.now();
    for (const [targetId, info] of tabPool) {
        if ((now - info.pooledAt) >= POOL_MAX_AGE_MS) {
            tabPool.delete(targetId);
        }
    }
}

/**
 * Auto-close idle tabs and enforce MAX_TABS limit
 * @param {number} port - CDP port
 * @returns {Promise<{closed: number, idle: number, overLimit: number}>}
 */
export async function cleanupIdleTabs(port) {
    const tabs = await listManagedTabs(port);
    const now = Date.now();
    let idleClosed = 0;
    let overLimitClosed = 0;

    // Build set of targetIds currently bound to active sessions
    const activeSessionTargetIds = new Set();
    for (const session of listSessions({ active: true })) {
        if (session.targetId) activeSessionTargetIds.add(session.targetId);
    }

    // Close idle tabs (not pinned, not bound to active session)
    for (const tab of tabs) {
        if (pinnedTabs.has(tab.targetId)) continue;
        if (activeSessionTargetIds.has(tab.targetId)) continue;

        const lastActive = tab.lastActiveAt || 0;
        if (now - lastActive > TAB_IDLE_TIMEOUT_MS) {
            try {
                await closeTab(port, tab.targetId);
                poolTab(tab.targetId, inferVendorFromUrl(tab.url), tab.url);
                idleClosed += 1;
            } catch {
                // Tab may already be closed
            }
        }
    }

    // Re-fetch tabs after idle cleanup
    const remainingTabs = await listManagedTabs(port);
    const nonPinned = remainingTabs.filter(t => !pinnedTabs.has(t.targetId));

    // Enforce MAX_TABS — close oldest first
    if (nonPinned.length > MAX_TABS) {
        const toClose = nonPinned
            .sort((a, b) => (a.lastActiveAt || 0) - (b.lastActiveAt || 0))
            .slice(0, nonPinned.length - MAX_TABS);

        for (const tab of toClose) {
            if (activeSessionTargetIds.has(tab.targetId)) continue; // Never close active session tabs
            try {
                await closeTab(port, tab.targetId);
                poolTab(tab.targetId, inferVendorFromUrl(tab.url), tab.url);
                overLimitClosed += 1;
            } catch {
                // Tab may already be closed
            }
        }
    }

    pruneStalePool();

    return {
        closed: idleClosed + overLimitClosed,
        idle: idleClosed,
        overLimit: overLimitClosed,
    };
}

function inferVendorFromUrl(url) {
    if (!url) return null;
    if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'chatgpt';
    if (url.includes('gemini.google.com')) return 'gemini';
    if (url.includes('grok.com')) return 'grok';
    return null;
}

/**
 * Get current pool stats for diagnostics
 */
export function getPoolStats() {
    return {
        pooled: tabPool.size,
        pinned: pinnedTabs.size,
        maxTabs: MAX_TABS,
        idleTimeoutMs: TAB_IDLE_TIMEOUT_MS,
        entries: Array.from(tabPool.entries()).map(([targetId, info]) => ({
            targetId,
            vendor: info.vendor,
            ageMs: Date.now() - info.pooledAt,
        })),
    };
}
