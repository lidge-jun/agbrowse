const SNAPSHOT_SCOPES = new Set(['web_ai', 'browser']);

export function ensureMcpState(state = {}) {
    if (!state.latestSnapshots || typeof state.latestSnapshots !== 'object' || Array.isArray(state.latestSnapshots)) {
        state.latestSnapshots = {};
    }
    if (state.latestSnapshot && !state.latestSnapshots.web_ai) {
        state.latestSnapshots.web_ai = state.latestSnapshot;
    }
    return state;
}

export function setLatestSnapshot(state, scope, snapshot) {
    assertSnapshotScope(scope);
    const normalized = ensureMcpState(state);
    normalized.latestSnapshots[scope] = snapshot;
    if (scope === 'web_ai') normalized.latestSnapshot = snapshot;
    return snapshot;
}

export function getLatestSnapshot(state, scope) {
    assertSnapshotScope(scope);
    return ensureMcpState(state).latestSnapshots[scope] || null;
}

export function requireLatestSnapshot(state, scope, snapshotId) {
    const snapshot = getLatestSnapshot(state, scope);
    if (!snapshot || snapshot.snapshotId !== snapshotId) throw new Error('stale snapshotId');
    return snapshot;
}

function assertSnapshotScope(scope) {
    if (!SNAPSHOT_SCOPES.has(scope)) throw new Error(`unknown MCP snapshot scope: ${scope}`);
}
