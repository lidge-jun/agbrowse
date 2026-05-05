// @ts-check
/**
 * Tab Pool compatibility layer.
 *
 * Phase 9.3 moves authority to the durable tab lease store. This module keeps
 * the older poolTab/getPooledTab API while enforcing locked, owned leases.
 */
import {
    checkoutPooledLease,
    cleanupLeasedTabs,
    poolStats,
    releaseCompletedLease,
    removeLease,
} from './tab-lease-store.mjs';

/**
 * @typedef {Object} PoolTabOptions
 * @property {string} [owner]
 * @property {string} [sessionType]
 * @property {string|null} [sessionId]
 * @property {number} [port]
 * @property {string} [browserProfileKey]
 * @property {number} [maxPerKey]
 * @property {number} [globalMax]
 * @property {number} [ttlMs]
 */

/**
 * @typedef {Object} GetPooledTabOptions
 * @property {string} [owner]
 * @property {string} [sessionType]
 * @property {string} [origin]
 * @property {string} [url]
 * @property {string} [browserProfileKey]
 */

/**
 * @typedef {Object} CleanupPoolTabsOptions
 * @property {number} [maxAgeMs]
 * @property {string} [browserProfileKey]
 */

/**
 * @param {string} vendor
 * @param {string} targetId
 * @param {string|null|undefined} url
 * @param {PoolTabOptions} [options]
 */
export async function poolTab(vendor, targetId, url, options = {}) {
    if (!vendor || !targetId) return null;
    return releaseCompletedLease(options.port || 9222, {
        owner: options.owner || 'web-ai',
        vendor,
        sessionType: options.sessionType || 'send-poll',
        sessionId: options.sessionId || null,
        targetId,
        url,
        port: options.port || 9222,
        browserProfileKey: options.browserProfileKey,
        maxPerKey: options.maxPerKey,
        globalMax: options.globalMax,
        ttlMs: options.ttlMs,
    });
}

/**
 * @param {number} port
 * @param {string} vendor
 * @param {GetPooledTabOptions} [options]
 */
export async function getPooledTab(port, vendor, options = {}) {
    const lease = await checkoutPooledLease(port, {
        owner: options.owner || 'web-ai',
        vendor,
        sessionType: options.sessionType || 'send-poll',
        origin: options.origin,
        url: options.url,
        port,
        browserProfileKey: options.browserProfileKey,
    });
    return lease ? { targetId: lease.targetId, url: lease.url } : null;
}

/**
 * @param {string} vendor
 * @param {string} targetId
 */
export async function unpoolTab(vendor, targetId) {
    void vendor;
    await removeLease(targetId);
}

/**
 * @param {number} port
 * @param {CleanupPoolTabsOptions} [options]
 */
export async function cleanupPoolTabs(port, options = {}) {
    return cleanupLeasedTabs(port, options);
}

export async function getPoolStats() {
    return poolStats();
}
