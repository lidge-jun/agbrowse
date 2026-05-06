// @ts-check
/**
 * G07 — persistent action memory cache (pure, signature-validated).
 *
 * Intent: when a (origin, intent, dom-signature) triple has been
 * successfully resolved before, allow the agent loop to replay the
 * last-good ref/selector instead of re-running the full resolver.
 * The cache MUST refuse hits when the live signature differs, so a
 * UI change always falls back to the live resolver.
 *
 * This module is the storage + validation primitive. Wiring into
 * self-heal/target-resolver is a separate, opt-in step and is gated
 * behind --no-action-memory at the CLI surface.
 *
 * EXPERIMENTAL: not part of frozen MCP scope. See structure/commands.md.
 *
 * No hosted/cloud, no stealth, no external CDP.
 */

/**
 * @typedef {Object} ActionMemoryEntry
 * @property {string} intentId
 * @property {string} origin              page origin (https://x.test)
 * @property {string} signature           DOM signature hash for the intent at last-good
 * @property {string} ref                 last-good ref (e.g. '@e3') or selector
 * @property {string} lastGoodAt          ISO timestamp
 * @property {number} hits                successful replay count
 * @property {Object} validations
 * @property {number} validations.ok
 * @property {number} validations.fail
 */

/**
 * @typedef {Object} ActionMemorySnapshot
 * @property {'action-memory-v1'} schemaVersion
 * @property {Record<string, ActionMemoryEntry>} entries
 */

const SCHEMA_VERSION = 'action-memory-v1';

/**
 * @param {string} origin
 * @param {string} intentId
 * @param {string} signature
 */
export function actionMemoryKey(origin, intentId, signature) {
    return `${origin}::${intentId}::${signature}`;
}

/**
 * @param {Object} [opts]
 * @param {ActionMemorySnapshot} [opts.initial]
 */
export function createActionMemory(opts = {}) {
    /** @type {Map<string, ActionMemoryEntry>} */
    const store = new Map();
    if (opts.initial && opts.initial.entries && opts.initial.schemaVersion === SCHEMA_VERSION) {
        for (const [k, v] of Object.entries(opts.initial.entries)) {
            store.set(k, { ...v });
        }
    }
    return {
        /** @param {ActionMemoryEntry} entry */
        put(entry) {
            if (!entry || !entry.origin || !entry.intentId || !entry.signature || !entry.ref) {
                throw new Error('action-memory: entry requires origin, intentId, signature, ref');
            }
            const key = actionMemoryKey(entry.origin, entry.intentId, entry.signature);
            const existing = store.get(key);
            const merged = {
                ...entry,
                hits: existing ? existing.hits : (entry.hits || 0),
                validations: existing ? existing.validations : (entry.validations || { ok: 0, fail: 0 }),
                lastGoodAt: entry.lastGoodAt || new Date().toISOString(),
            };
            store.set(key, merged);
            return merged;
        },
        /**
         * Look up by (origin, intentId, signature). Hit ONLY if all three match
         * exactly. A signature drift is treated as a miss — caller must fall
         * back to the live resolver.
         * @param {string} origin
         * @param {string} intentId
         * @param {string} signature
         */
        get(origin, intentId, signature) {
            const key = actionMemoryKey(origin, intentId, signature);
            const entry = store.get(key);
            return entry ? { ...entry } : null;
        },
        /**
         * Record outcome of a replay attempt. Increments hits + validations.ok
         * on success, validations.fail otherwise. Used to score cache health.
         * @param {string} origin
         * @param {string} intentId
         * @param {string} signature
         * @param {'ok'|'fail'} outcome
         */
        recordReplay(origin, intentId, signature, outcome) {
            const key = actionMemoryKey(origin, intentId, signature);
            const entry = store.get(key);
            if (!entry) return null;
            const updated = {
                ...entry,
                hits: outcome === 'ok' ? entry.hits + 1 : entry.hits,
                validations: {
                    ok: outcome === 'ok' ? entry.validations.ok + 1 : entry.validations.ok,
                    fail: outcome === 'fail' ? entry.validations.fail + 1 : entry.validations.fail,
                },
            };
            store.set(key, updated);
            return updated;
        },
        /** @param {string} [origin] */
        list(origin) {
            const all = [...store.values()];
            return origin ? all.filter(e => e.origin === origin) : all;
        },
        clear() {
            store.clear();
        },
        /** @returns {ActionMemorySnapshot} */
        snapshot() {
            /** @type {Record<string, ActionMemoryEntry>} */
            const entries = {};
            for (const [k, v] of store.entries()) entries[k] = { ...v };
            return { schemaVersion: SCHEMA_VERSION, entries };
        },
        size() { return store.size; },
    };
}

/**
 * Validate a candidate hit against the current page signature. Returns
 * the entry only when the signatures match exactly. This is the
 * "safe replay" check the gate enforces.
 * @param {ActionMemoryEntry | null} entry
 * @param {string} currentSignature
 */
export function validateMemoryHit(entry, currentSignature) {
    if (!entry) return null;
    if (typeof currentSignature !== 'string' || !currentSignature) return null;
    if (entry.signature !== currentSignature) return null;
    return entry;
}

export const ACTION_MEMORY_SCHEMA_VERSION = SCHEMA_VERSION;
