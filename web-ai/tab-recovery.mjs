import { createTab, isTabAlive, getPageByTargetId, listManagedTabs } from '../skills/browser/tab-manager.mjs';
import { updateSession, getSession, incrementRecoveryCount, listSessions } from './session.mjs';

/**
 * Recover a session's tab
 * @param {Object} deps - Dependencies { getPort, getPage }
 * @param {Object} session - Session record
 * @returns {Promise<{recovered: boolean, strategy, targetId}>}
 */
export async function recoverSessionTab(deps, session) {
    if (!session) throw new Error('recoverSessionTab: session required');

    const port = deps.getPort();

    // 1. Check if original tab still exists
    const alive = await isTabAlive(port, session.targetId);

    if (alive) {
        // Tab exists - verify URL by checking the actual page
        const page = await getPageByTargetId(port, session.targetId);
        if (page) {
            const currentUrl = page.url();
            if (currentUrl !== session.conversationUrl) {
                // Navigate to correct URL
                await page.goto(session.conversationUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            }
            return {
                recovered: true,
                strategy: 'existing-tab',
                targetId: session.targetId
            };
        }
    }

    // 2. Create new tab
    const newTab = await createTab(port, session.conversationUrl || 'about:blank');

    // 3. Update session binding
    await updateSession(session.sessionId, {
        targetId: newTab.targetId,
        tabState: {
            ...session.tabState,
            recoveryCount: (session.tabState?.recoveryCount || 0) + 1,
            lastActiveAt: new Date().toISOString(),
        }
    });

    return {
        recovered: true,
        strategy: 'new-tab',
        targetId: newTab.targetId
    };
}

/**
 * Verify session tab is still valid
 * @param {Object} deps - Dependencies
 * @param {Object} session - Session record
 * @returns {Promise<{valid: boolean, targetId, needsRecovery}>}
 */
export async function verifySessionTab(deps, session) {
    if (!session?.targetId) {
        return { valid: false, needsRecovery: true };
    }

    const alive = await isTabAlive(deps.getPort(), session.targetId);

    if (alive) {
        return { valid: true, targetId: session.targetId, needsRecovery: false };
    }

    return { valid: false, targetId: session.targetId, needsRecovery: true };
}

/**
 * Detect orphaned sessions (bound tab closed/destroyed)
 * @param {number} port - Browser CDP port
 * @returns {Promise<{checked: number, orphaned: number}>}
 */
export async function reconcileSessionTabs(port) {
    const [liveTabs, activeSessions] = await Promise.all([
        listManagedTabs(port),
        listSessions({ active: true })
    ]);

    const liveTargetIds = new Set(liveTabs.map(t => t.targetId));
    let orphaned = 0;

    for (const session of activeSessions) {
        if (!session.targetId) continue;

        if (!liveTargetIds.has(session.targetId)) {
            const now = new Date().toISOString();
            await updateSession(session.sessionId, {
                status: 'error',
                lastError: {
                    errorCode: 'tab.target-lost',
                    message: `Tab ${session.targetId} was closed or destroyed`
                },
                tabState: {
                    ...session.tabState,
                    state: 'lost',
                    lostAt: now
                }
            });
            orphaned++;
        }
    }

    return { checked: activeSessions.length, orphaned };
}

function isPageDeathError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return (
        msg.includes('target closed') ||
        msg.includes('page closed') ||
        msg.includes('browser has been closed') ||
        msg.includes('crash')
    );
}

/**
 * Execute operation with session's bound page
 * GPT Pro recommendation: resolve page directly, don't use active tab routing
 * Catches page death mid-operation and retries once after recovery
 * @param {Object} deps - Dependencies { getPort }
 * @param {string} sessionId - Session ID
 * @param {Function} fn - Callback({ page, targetId, session })
 * @returns {Promise<any>}
 */
export async function withSessionPage(deps, sessionId, fn) {
    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const port = deps.getPort();

    async function resolvePage(forceRecover = false) {
        const current = getSession(sessionId);
        if (!current) throw new Error(`Session not found: ${sessionId}`);

        const { valid, needsRecovery } = await verifySessionTab(deps, current);

        if (!valid || forceRecover) {
            if (needsRecovery && current.conversationUrl) {
                const recovery = await recoverSessionTab(deps, current);
                if (!recovery.recovered) {
                    throw new Error(`Session ${sessionId} tab recovery failed`);
                }
                const recovered = getSession(sessionId);
                const page = await getPageByTargetId(port, recovered.targetId);
                if (!page) throw new Error(`Session ${sessionId} page not found after recovery`);
                return { page, targetId: recovered.targetId, session: recovered };
            }
            throw new Error(`Session ${sessionId} tab is not valid and cannot be recovered`);
        }

        const page = await getPageByTargetId(port, current.targetId);
        if (!page) throw new Error(`Session ${sessionId} page not found for targetId ${current.targetId}`);
        return { page, targetId: current.targetId, session: current };
    }

    const first = await resolvePage();
    try {
        return await fn(first);
    } catch (err) {
        if (!isPageDeathError(err)) throw err;
        const recovered = await resolvePage(true);
        return fn(recovered);
    }
}
