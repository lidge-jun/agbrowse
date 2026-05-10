// @ts-check
import { createTab, isTabAlive, getPageByTargetId, waitForPageByTargetId, listManagedTabs } from '../skills/browser/tab-manager.mjs';
import { updateSession, getSession, incrementRecoveryCount, listSessions } from './session.mjs';
import { waitForConversationReady, isProviderUrl } from './navigation-ready.mjs';

/** @typedef {import('./session-store.mjs').WebAiSession} WebAiSession */

/**
 * @typedef {Object} RecoverDeps
 * @property {() => number} getPort
 * @property {(targetId?: string) => Promise<unknown>} [getPage]
 */

/**
 * @typedef {Object} RecoverResult
 * @property {boolean} recovered
 * @property {'existing-tab' | 'new-tab'} strategy
 * @property {string | null} targetId
 */

/**
 * Recover a session's tab
 * @param {RecoverDeps} deps
 * @param {WebAiSession} session
 * @returns {Promise<RecoverResult>}
 */
export async function recoverSessionTab(deps, session) {
    if (!session) throw new Error('recoverSessionTab: session required');

    const port = deps.getPort();
    const targetUrl = session.conversationUrl || session.originalUrl || 'about:blank';

    // 1. Check if original tab still exists
    const alive = await isTabAlive(port, /** @type {string} */ (session.targetId));

    if (alive) {
        // Tab exists - verify URL by checking the actual page
        const page = await getPageByTargetId(port, /** @type {string} */ (session.targetId));
        if (page) {
            try {
                const currentUrl = page.url();
                if (shouldPreferCurrentProviderUrl(targetUrl, currentUrl)) {
                    await updateSession(session.sessionId, { conversationUrl: currentUrl });
                    return {
                        recovered: true,
                        strategy: 'existing-tab',
                        targetId: session.targetId
                    };
                }
                if (currentUrl !== targetUrl) {
                    await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });
                }
                const finalUrl = page.url();
                await waitForConversationReady(page, finalUrl);
                if (finalUrl !== targetUrl && isProviderUrl(finalUrl)) {
                    await updateSession(session.sessionId, { conversationUrl: finalUrl });
                }
                return {
                    recovered: true,
                    strategy: 'existing-tab',
                    targetId: session.targetId
                };
            } catch {
                // CDP can report the target as alive while Playwright has already
                // closed the page object. Fall through to a fresh tab recovery.
            }
        }
    }

    // 2. Create new tab
    const newTab = await createTab(port, targetUrl);
    let recoveredConversationUrl = session.conversationUrl || targetUrl;
    if (targetUrl !== 'about:blank') {
        const newPage = await waitForPageByTargetId(port, newTab.targetId).catch(() => null);
        if (newPage) {
            await /** @type {any} */ (newPage).waitForLoadState?.('load').catch(() => undefined);
            const finalUrl = /** @type {any} */ (newPage).url();
            await waitForConversationReady(newPage, finalUrl);
            if (finalUrl !== targetUrl && isProviderUrl(finalUrl)) {
                recoveredConversationUrl = finalUrl;
            }
        }
    }

    // 3. Update session binding
    await updateSession(session.sessionId, {
        targetId: newTab.targetId,
        conversationUrl: recoveredConversationUrl,
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
 * @typedef {Object} VerifyResult
 * @property {boolean} valid
 * @property {string | null} [targetId]
 * @property {boolean} needsRecovery
 */

/**
 * Verify session tab is still valid
 * @param {RecoverDeps} deps
 * @param {WebAiSession | null | undefined} session
 * @returns {Promise<VerifyResult>}
 */
export async function verifySessionTab(deps, session) {
    if (!session?.targetId) {
        return { valid: false, needsRecovery: true };
    }

    const alive = await isTabAlive(deps.getPort(), session.targetId);

    if (alive) {
        const page = await getPageByTargetId(deps.getPort(), session.targetId).catch(() => null);
        if (!page) return { valid: false, targetId: session.targetId, needsRecovery: true };
        try {
            page.url();
        } catch {
            return { valid: false, targetId: session.targetId, needsRecovery: true };
        }
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

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isPageDeathError(err) {
    const e = /** @type {{ message?: unknown }} */ (err);
    const msg = String(e?.message || err || '').toLowerCase();
    return (
        msg.includes('target closed') ||
        msg.includes('page closed') ||
        msg.includes('browser has been closed') ||
        msg.includes('crash')
    );
}

/**
 * @template T
 * @typedef {Object} ResolvedPage
 * @property {unknown} page
 * @property {string | null} targetId
 * @property {WebAiSession} session
 */

/**
 * Execute operation with session's bound page
 * GPT Pro recommendation: resolve page directly, don't use active tab routing
 * Catches page death mid-operation and retries once after recovery
 * @template T
 * @param {RecoverDeps} deps
 * @param {string} sessionId
 * @param {(ctx: ResolvedPage<T>) => Promise<T> | T} fn
 * @returns {Promise<T>}
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
            const recoveryTargetUrl = current.conversationUrl || current.originalUrl;
            if ((needsRecovery || forceRecover) && recoveryTargetUrl) {
                const recovery = await recoverSessionTab(deps, current);
                if (!recovery.recovered) {
                    throw new Error(`Session ${sessionId} tab recovery failed`);
                }
                const recovered = /** @type {WebAiSession} */ (getSession(sessionId));
                const page = await getPageByTargetId(port, /** @type {string} */ (recovered.targetId));
                if (!page) throw new Error(`Session ${sessionId} page not found after recovery`);
                return { page, targetId: recovered.targetId, session: recovered };
            }
            throw new Error(`Session ${sessionId} tab is not valid and cannot be recovered`);
        }

        const page = await getPageByTargetId(port, /** @type {string} */ (current.targetId));
        if (!page) throw new Error(`Session ${sessionId} page not found for targetId ${current.targetId}`);
        if (current.conversationUrl && page.url() !== current.conversationUrl) {
            const currentUrl = page.url();
            if (shouldPreferCurrentProviderUrl(current.conversationUrl, currentUrl)) {
                updateSession(sessionId, { conversationUrl: currentUrl });
                const updated = /** @type {WebAiSession} */ (getSession(sessionId));
                return { page, targetId: current.targetId, session: updated };
            }
            await page.goto(current.conversationUrl, { waitUntil: 'load', timeout: 30_000 });
            const finalUrl = page.url();
            await waitForConversationReady(page, finalUrl);
            if (finalUrl !== current.conversationUrl && isProviderUrl(finalUrl)) {
                updateSession(sessionId, { conversationUrl: finalUrl });
                const updated = /** @type {WebAiSession} */ (getSession(sessionId));
                return { page, targetId: current.targetId, session: updated };
            }
        }
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

/**
 * When send records a provider root URL before the SPA assigns a concrete
 * conversation URL, the bound tab may later move from "/" to "/c/..." (or
 * provider equivalent). In that case the live tab is newer truth; do not
 * navigate it back to the stale root.
 * @param {string|null|undefined} savedUrl
 * @param {string|null|undefined} currentUrl
 */
function shouldPreferCurrentProviderUrl(savedUrl, currentUrl) {
    if (!savedUrl || !currentUrl || savedUrl === currentUrl) return false;
    if (!isProviderUrl(savedUrl) || !isProviderUrl(currentUrl)) return false;
    try {
        const saved = new URL(savedUrl);
        const current = new URL(currentUrl);
        if (saved.origin !== current.origin) return false;
        const savedPath = saved.pathname.replace(/\/+$/, '') || '/';
        const currentPath = current.pathname.replace(/\/+$/, '') || '/';
        return savedPath === '/' && currentPath !== '/';
    } catch {
        return false;
    }
}
