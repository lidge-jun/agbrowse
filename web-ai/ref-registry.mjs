// @ts-check
import { WebAiError } from './errors.mjs';

/**
 * @typedef {{
 *   snapshotId: string|null,
 *   axHash: string|null,
 *   domHash: string|null,
 *   refs: Record<string, unknown>,
 *   createdAt: number,
 *   stale: boolean,
 *   invalidatedAt: number|null,
 * }} RefRegistry
 */

/**
 * @typedef {{ snapshotId?: string, axHash?: string, domHash?: string, refs?: Record<string, unknown> }} SnapshotInput
 */

/**
 * @param {SnapshotInput|null|undefined} snapshot
 * @returns {RefRegistry}
 */
export function createRefRegistry(snapshot) {
    return {
        snapshotId: snapshot?.snapshotId || null,
        axHash: snapshot?.axHash || null,
        domHash: snapshot?.domHash || null,
        refs: { ...(snapshot?.refs || {}) },
        createdAt: Date.now(),
        stale: false,
        invalidatedAt: null,
    };
}

/**
 * @param {unknown} page
 * @param {RefRegistry|null|undefined} registry
 * @param {string} ref
 * @param {{ expectedSnapshotId?: string|null, currentDomHash?: string|null, currentAxHash?: string|null, allowStale?: boolean }} [options]
 * @returns {Promise<unknown>}
 */
export async function resolveRef(page, registry, ref, {
    expectedSnapshotId = null,
    currentDomHash = null,
    currentAxHash = null,
    allowStale = false,
} = {}) {
    void page;
    const normalized = normalizeRef(ref);
    if (!allowStale) {
        assertRegistryFresh(registry, { expectedSnapshotId, currentDomHash, currentAxHash, ref: normalized });
    }
    const entry = registry?.refs?.[normalized];
    if (!entry) {
        throw new WebAiError({
            errorCode: 'snapshot.ref-not-found',
            stage: 'snapshot-ref-resolve',
            retryHint: 're-snapshot',
            message: `ref ${normalized} not found in current snapshot registry`,
            evidence: { ref: normalized, snapshotId: registry?.snapshotId || null },
        });
    }
    return entry;
}

/**
 * @param {RefRegistry|null|undefined} registry
 * @param {{ domHash?: string|null, axHash?: string|null }} [args]
 * @returns {boolean}
 */
export function invalidateRefsOnDomChange(registry, { domHash = null, axHash = null } = {}) {
    if (!registry) return false;
    const changed = (domHash && registry.domHash && domHash !== registry.domHash)
        || (axHash && registry.axHash && axHash !== registry.axHash);
    if (!changed) return false;
    registry.refs = {};
    registry.domHash = domHash || registry.domHash;
    registry.axHash = axHash || registry.axHash;
    registry.stale = true;
    registry.invalidatedAt = Date.now();
    return true;
}

/**
 * @param {RefRegistry|null|undefined} registry
 * @param {{ expectedSnapshotId?: string|null, currentDomHash?: string|null, currentAxHash?: string|null }} [args]
 * @returns {boolean}
 */
export function isRegistryStale(registry, {
    expectedSnapshotId = null,
    currentDomHash = null,
    currentAxHash = null,
} = {}) {
    if (!registry || registry.stale === true) return true;
    if (expectedSnapshotId && registry.snapshotId !== expectedSnapshotId) return true;
    if (currentDomHash && registry.domHash && currentDomHash !== registry.domHash) return true;
    if (currentAxHash && registry.axHash && currentAxHash !== registry.axHash) return true;
    return false;
}

/**
 * @param {RefRegistry|null|undefined} registry
 * @param {{ expectedSnapshotId?: string|null, currentDomHash?: string|null, currentAxHash?: string|null, ref?: string }} [context]
 */
function assertRegistryFresh(registry, context = {}) {
    if (!isRegistryStale(registry, context)) return;
    throw new WebAiError({
        errorCode: 'snapshot.ref-stale',
        stage: 'snapshot-ref-resolve',
        retryHint: 're-snapshot',
        message: `ref ${context.ref || ''} belongs to a stale snapshot registry`.trim(),
        evidence: {
            snapshotId: registry?.snapshotId || null,
            expectedSnapshotId: context.expectedSnapshotId || null,
            domHash: registry?.domHash || null,
            currentDomHash: context.currentDomHash || null,
            axHash: registry?.axHash || null,
            currentAxHash: context.currentAxHash || null,
        },
    });
}

/**
 * @param {unknown} ref
 * @returns {string}
 */
function normalizeRef(ref) {
    const value = String(ref || '').trim();
    if (!value) return value;
    if (value.startsWith('@')) return value;
    return `@${value}`;
}
