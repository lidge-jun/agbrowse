/**
 * Tab Pool — Reuse unbound vendor tabs instead of creating new ones.
 * Tracks tabs that recently completed a session and are still alive.
 */
import { isTabAlive } from '../skills/browser/tab-manager.mjs';

const POOL = new Map(); // vendor -> [{ targetId, url, pooledAt }]
const POOL_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
const POOL_MAX_SIZE = 3; // max pooled tabs per vendor

/**
 * Add a tab to the pool when its session completes.
 * @param {string} vendor
 * @param {string} targetId
 * @param {string} url
 */
export function poolTab(vendor, targetId, url) {
    if (!vendor || !targetId) return;
    const list = POOL.get(vendor) || [];
    // Remove duplicates
    const filtered = list.filter(t => t.targetId !== targetId);
    filtered.push({ targetId, url, pooledAt: Date.now() });
    // Enforce max size (FIFO)
    while (filtered.length > POOL_MAX_SIZE) filtered.shift();
    POOL.set(vendor, filtered);
}

/**
 * Try to get a reusable tab from the pool.
 * @param {number} port
 * @param {string} vendor
 * @returns {Promise<{targetId, url}|null>}
 */
export async function getPooledTab(port, vendor) {
    const list = POOL.get(vendor);
    if (!list || list.length === 0) return null;

    const now = Date.now();
    // Find first alive tab that's not too old
    for (const entry of list) {
        if (now - entry.pooledAt > POOL_MAX_AGE_MS) continue;
        const alive = await isTabAlive(port, entry.targetId);
        if (alive) return { targetId: entry.targetId, url: entry.url };
    }

    // All stale or dead — clear this vendor's pool
    POOL.delete(vendor);
    return null;
}

/**
 * Remove a tab from the pool (e.g. when it is explicitly closed).
 * @param {string} vendor
 * @param {string} targetId
 */
export function unpoolTab(vendor, targetId) {
    const list = POOL.get(vendor);
    if (!list) return;
    POOL.set(vendor, list.filter(t => t.targetId !== targetId));
    if (POOL.get(vendor).length === 0) POOL.delete(vendor);
}

/**
 * Get pool stats for diagnostics.
 * @returns {Object}
 */
export function getPoolStats() {
    const stats = {};
    for (const [vendor, list] of POOL) {
        stats[vendor] = list.length;
    }
    return stats;
}
