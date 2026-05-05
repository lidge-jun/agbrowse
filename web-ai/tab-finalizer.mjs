// @ts-check
import { updateSession } from './session.mjs';
import { poolTab } from './tab-pool.mjs';

const FINALIZABLE_STATUSES = new Set(['complete', 'completed']);

/**
 * @typedef {Object} FinalizeDeps
 * @property {() => number} [getPort]
 */

/**
 * @typedef {Object} FinalizeSession
 * @property {string} [sessionId]
 * @property {string} [targetId]
 * @property {string} [vendor]
 * @property {string} [conversationUrl]
 * @property {string} [originalUrl]
 */

/**
 * @typedef {Object} FinalizePage
 * @property {() => string} [url]
 */

/**
 * @typedef {Object} FinalizeOptions
 * @property {string} [vendor]
 * @property {FinalizeSession} [session]
 * @property {FinalizePage} [page]
 * @property {string} [answerText]
 * @property {string} [status]
 * @property {unknown[]} [warnings]
 */

/**
 * @typedef {{ finalized: false, reason: string } | { finalized: true, pool: unknown }} FinalizeResult
 */

/**
 * @param {FinalizeDeps} [deps]
 * @param {FinalizeOptions} [options]
 * @returns {Promise<FinalizeResult>}
 */
export async function finalizeProviderTab(deps, {
    vendor,
    session,
    page,
    answerText,
    status = 'complete',
    warnings = [],
} = {}) {
    if (!session?.sessionId || !session.targetId || !FINALIZABLE_STATUSES.has(status)) {
        return { finalized: false, reason: 'not-finalizable' };
    }
    const conversationUrl = page?.url?.() || session.conversationUrl || session.originalUrl || null;
    updateSession(session.sessionId, {
        status: 'complete',
        conversationUrl,
        answer: answerText,
        warnings,
        completedAt: new Date().toISOString(),
    });
    const port = deps?.getPort?.() || 9222;
    const result = await poolTab(vendor || session.vendor || 'chatgpt', session.targetId, conversationUrl, {
        port,
        owner: 'web-ai',
        sessionType: 'send-poll',
        sessionId: session.sessionId,
    });
    return { finalized: true, pool: result };
}
