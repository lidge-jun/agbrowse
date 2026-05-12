// @ts-check
import { getSession } from './session.mjs';
import { readSessionCommandLock } from './session-store.mjs';
import { listActiveCommands } from './active-command-store.mjs';
import { verifySessionTab } from './tab-recovery.mjs';

/**
 * Build a session diagnostic report. Read-only: never reads prompt or answer
 * text, and redacts conversation URLs down to host + pathname.
 *
 * @param {any} deps
 * @param {string} sessionId
 * @param {{ navigate?: boolean }} [options]
 */
export async function buildSessionDoctorReport(deps, sessionId, options = {}) {
    const session = getSession(sessionId);
    if (!session) {
        return {
            ok: false,
            status: 'session-doctor',
            sessionId,
            summary: 'missing session record',
            recommendations: ['Run: agbrowse web-ai sessions list'],
        };
    }
    const port = (typeof deps?.getPort === 'function' ? deps.getPort() : 9222) || 9222;
    const target = await verifySessionTab(deps, session).catch(error => ({
        valid: false,
        needsRecovery: true,
        error: error?.message || String(error),
    }));
    const lock = readSessionCommandLock(sessionId);
    const activeCommands = await listActiveCommands({ browserProfileKey: String(port) })
        .catch(error => [{ status: 'unknown', error: error?.message || String(error) }]);
    const recommendations = recommendSessionActions({ session, target, lock, navigate: options.navigate === true });
    return {
        ok: true,
        status: 'session-doctor',
        sessionId,
        vendor: session.vendor,
        summary: summarizeSession({ session, target, lock }),
        session: sanitizeSession(session),
        target,
        lock,
        activeCommands,
        recommendations,
    };
}

/**
 * @param {any} session
 */
export function sanitizeSession(session) {
    return {
        sessionId: session.sessionId,
        vendor: session.vendor,
        status: session.status,
        deadlineAt: session.deadlineAt || null,
        targetId: session.targetId || null,
        tabId: session.tabId || null,
        originalUrl: redactUrl(session.originalUrl),
        conversationUrl: redactUrl(session.conversationUrl),
        updatedAt: session.updatedAt,
        warnings: session.warnings || [],
        lastError: session.lastError || null,
        tabState: session.tabState || null,
    };
}

/**
 * @param {{ session: any, target: any, lock: any }} args
 */
function summarizeSession({ session, target, lock }) {
    if (lock?.pid && lock?.stale === false) return 'locked by another command';
    if (!target?.valid) return 'target missing or needs recovery';
    return `${session.status} on live target`;
}

/**
 * @param {{ session: any, target: any, lock: any, navigate: boolean }} args
 */
function recommendSessionActions({ session, target, lock, navigate }) {
    const out = [];
    if (lock?.pid && lock?.stale === false) {
        out.push('A command lock is active; wait or inspect the PID before retrying.');
    }
    if (!target?.valid && navigate) {
        out.push(`Run sessions reattach ${session.sessionId} --navigate to recover the tab.`);
    }
    if (!target?.valid && !navigate) {
        out.push(`Run sessions doctor ${session.sessionId} --navigate or poll --session ${session.sessionId} --navigate.`);
    }
    if (session.status === 'timeout') {
        out.push('If the provider tab is still streaming and deadline is future, retry poll/watch with --session.');
    }
    if (out.length === 0) {
        out.push(`Run: agbrowse web-ai poll --vendor ${session.vendor || 'chatgpt'} --session ${session.sessionId} --navigate`);
    }
    return out;
}

/**
 * @param {string|null|undefined} url
 */
function redactUrl(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.hostname}${u.pathname}`;
    } catch {
        return String(url);
    }
}
