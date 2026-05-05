// @ts-check

/**
 * @typedef {{ snapshotId?: string, [extra: string]: unknown }} McpSnapshot
 */

/**
 * @typedef {{
 *   latestSnapshot?: McpSnapshot,
 *   latestSnapshots?: Record<string, McpSnapshot>,
 *   [extra: string]: unknown,
 * }} McpState
 */

const SNAPSHOT_SCOPES = new Set(['web_ai', 'browser']);

/**
 * @param {Partial<McpState>} [state]
 * @returns {McpState}
 */
export function ensureMcpState(state = {}) {
    if (!state.latestSnapshots || typeof state.latestSnapshots !== 'object' || Array.isArray(state.latestSnapshots)) {
        state.latestSnapshots = {};
    }
    if (state.latestSnapshot && !state.latestSnapshots.web_ai) {
        state.latestSnapshots.web_ai = state.latestSnapshot;
    }
    return /** @type {McpState} */ (state);
}

/**
 * @param {Partial<McpState>} state
 * @param {string} scope
 * @param {McpSnapshot} snapshot
 * @returns {McpSnapshot}
 */
export function setLatestSnapshot(state, scope, snapshot) {
    assertSnapshotScope(scope);
    const normalized = ensureMcpState(state);
    /** @type {Record<string, McpSnapshot>} */ (normalized.latestSnapshots)[scope] = snapshot;
    if (scope === 'web_ai') normalized.latestSnapshot = snapshot;
    return snapshot;
}

/**
 * @param {Partial<McpState>} state
 * @param {string} scope
 * @returns {McpSnapshot|null}
 */
export function getLatestSnapshot(state, scope) {
    assertSnapshotScope(scope);
    return /** @type {Record<string, McpSnapshot>} */ (ensureMcpState(state).latestSnapshots)[scope] || null;
}

/**
 * @param {Partial<McpState>} state
 * @param {string} scope
 * @param {string} snapshotId
 * @returns {McpSnapshot}
 */
export function requireLatestSnapshot(state, scope, snapshotId) {
    const snapshot = getLatestSnapshot(state, scope);
    if (!snapshot || snapshot.snapshotId !== snapshotId) throw new Error('stale snapshotId');
    return snapshot;
}

/**
 * @param {string} scope
 */
function assertSnapshotScope(scope) {
    if (!SNAPSHOT_SCOPES.has(scope)) throw new Error(`unknown MCP snapshot scope: ${scope}`);
}
