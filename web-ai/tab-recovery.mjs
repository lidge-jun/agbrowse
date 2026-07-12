// @ts-check
import { createTab, isTabAlive, getPageByTargetId, waitForPageByTargetId, listManagedTabs, closeTab } from '../skills/browser/tab-manager.mjs';
import { updateSession, getSession, incrementRecoveryCount, listSessions } from './session.mjs';
import { waitForConversationReady, isProviderUrl } from './navigation-ready.mjs';
import { WebAiError } from './errors.mjs';
import {
    isSafeChatGptConversationUrl as sharedSafeChatGptConversationUrl,
    isSafePerplexityConversationUrl,
    isSafeProviderConversationUrl,
    providerUrlsCompatible,
} from './provider-url-identity.mjs';
import { isWorkSession as _isWorkSession } from './chatgpt-work-picker.mjs';

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
 * @param {string|null|undefined} vendor
 * @param {string|null|undefined} targetUrl
 * @returns {void}
 */
function assertSafeStoredConversationUrl(vendor, targetUrl) {
    if (!['chatgpt', 'perplexity'].includes(String(vendor || ''))) return;
    if (isSafeProviderConversationUrl(String(vendor), targetUrl)) return;
    throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'target-resolution',
        vendor: String(vendor),
        retryHint: 'pass-session',
        message: 'refusing unsafe stored conversation URL',
        mutationAllowed: false,
        evidence: { targetUrl },
    });
}

/**
 * Recover a session's tab.
 * @param {RecoverDeps} deps
 * @param {WebAiSession} session
 * @returns {Promise<RecoverResult>}
 */
export async function recoverSessionTab(deps, session) {
    if (!session) throw new Error('recoverSessionTab: session required');

    const port = deps.getPort();
    const targetUrl = session.conversationUrl || session.originalUrl || 'about:blank';
    if (targetUrl !== 'about:blank') assertSafeStoredConversationUrl(session.vendor, targetUrl);
    const isRunningWork = _isWorkSession(session) && session.status !== 'complete';

    // Work-session guard (04 section 6, round-2): a running Work session with a
    // bare-origin conversationUrl (e.g. "https://chatgpt.com/") must NOT be
    // recovered by opening that URL -- it would land on a home tab, not the task.
    // Fail closed with a typed error so the poll path can surface it.
    if (isRunningWork && isWorkSessionWithBareOrigin(session)) {
        throw new Error(
            `Work session ${session.sessionId} has bare-origin conversationUrl ` +
            `(${session.conversationUrl}); cannot recover to correct task tab. ` +
            `Error: provider.work-reattach-unverified`
        );
    }

    // 1. Check if original tab still exists
    const alive = await isTabAlive(port, /** @type {string} */ (session.targetId));

    if (alive) {
        // Tab exists - verify URL by checking the actual page
        const page = await getPageByTargetId(port, /** @type {string} */ (session.targetId));
        if (page) {
            try {
                const currentUrl = page.url();

                // Work-session guard: for running Work sessions, verify the tab
                // shows the correct task URL, not a random chatgpt.com home tab.
                if (isRunningWork && !isWorkTabUrlConsistent(session, currentUrl)) {
                    throw new Error(
                        `Work session ${session.sessionId} tab URL (${currentUrl}) ` +
                        `is not consistent with task; failing closed. ` +
                        `Error: provider.work-reattach-unverified`
                    );
                }

                if (shouldPreferCurrentProviderUrl(targetUrl, currentUrl)) {
                    await updateSession(session.sessionId, { conversationUrl: currentUrl });
                    return {
                        recovered: true,
                        strategy: 'existing-tab',
                        targetId: session.targetId
                    };
                }
                if (!urlsCompatible(targetUrl, currentUrl, session.vendor || '')) {
                    assertSafeStoredConversationUrl(session.vendor, targetUrl);
                    await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });
                } else if (currentUrl !== targetUrl) {
                    await updateSession(session.sessionId, { conversationUrl: currentUrl });
                }
                const finalUrl = page.url();
                await waitForConversationReady(page, finalUrl, session.vendor || undefined);
                if (finalUrl !== targetUrl && isProviderUrl(finalUrl)) {
                    await updateSession(session.sessionId, { conversationUrl: finalUrl });
                }
                return {
                    recovered: true,
                    strategy: 'existing-tab',
                    targetId: session.targetId
                };
            } catch (error) {
                if (error instanceof WebAiError && error.errorCode === 'cdp.target-mismatch') throw error;
                // CDP can report the target as alive while Playwright has already
                // closed the page object. Fall through to a fresh tab recovery.
            }
        }
    }

    // 2. Create new tab
    if (targetUrl !== 'about:blank') assertSafeStoredConversationUrl(session.vendor, targetUrl);
    const newTab = await createTab(port, targetUrl);
    let recoveredConversationUrl = session.conversationUrl || targetUrl;
    if (targetUrl !== 'about:blank') {
        const newPage = await waitForPageByTargetId(port, newTab.targetId).catch(() => null);
        if (newPage) {
            await /** @type {any} */ (newPage).waitForLoadState?.('load').catch(() => undefined);
            const finalUrl = /** @type {any} */ (newPage).url();
            await waitForConversationReady(newPage, finalUrl, session.vendor || undefined);
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

// ─── Work-session recovery guards (04 section 6, round-2 fix) ──────────

/**
 * Check whether a URL is a bare ChatGPT origin (home page, not a /c/<id> task).
 * A bare-origin conversationUrl on a running Work session is the root cause of
 * the wrong-tab rebind bug: recovery resolves ANY chatgpt.com tab as a match.
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isBareOriginUrl(url) {
    if (!url) return false;
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/+$/, '') || '/';
        return path === '/' || path === '';
    } catch {
        return false;
    }
}

/**
 * For a RUNNING work session, verify that the tab's current URL is consistent
 * with the session's taskUrl (a /c/<uuid> page). Returns false for:
 *   - generic home page tabs (bare origin)
 *   - tabs showing a DIFFERENT /c/<uuid> conversation
 * Returns true when the tab shows the exact taskUrl or any /c/<uuid> page
 * (in case of minor URL variations). For sessions without taskUrl, any /c/ page
 * is acceptable; bare-origin is not.
 * @param {Record<string, unknown>} session
 * @param {string|null|undefined} tabUrl
 * @returns {boolean}
 */
export function isWorkTabUrlConsistent(session, tabUrl) {
    if (!tabUrl) return false;
    const taskUrl = /** @type {string|null|undefined} */ (
        session.envelopeSummary?.taskUrl || session.conversationUrl
    );

    // Bare-origin tab URL is never valid for a running Work session
    if (isBareOriginUrl(tabUrl)) return false;

    // If we have a taskUrl with /c/<uuid>, the tab must match it
    if (taskUrl && /\/c\/[a-f0-9-]+/.test(taskUrl)) {
        try {
            const taskPath = new URL(taskUrl).pathname;
            const tabPath = new URL(tabUrl).pathname;
            return taskPath === tabPath;
        } catch {
            return false;
        }
    }

    // No specific taskUrl -- accept any /c/<uuid> page, reject bare origin
    return /\/c\/[a-f0-9-]+/.test(tabUrl);
}

/**
 * Detect sessions with bare-origin conversationUrl on surface=work.
 * These are the dangerously broken shape from the round-1 bug.
 * @param {Record<string, unknown>} session
 * @returns {boolean}
 */
export function isWorkSessionWithBareOrigin(session) {
    if (!_isWorkSession(session)) return false;
    return isBareOriginUrl(/** @type {string|null|undefined} */ (session.conversationUrl));
}


/**
 * @template T
 * @typedef {Object} ResolvedPage
 * @property {unknown} page
 * @property {string | null} targetId
 * @property {WebAiSession} session
 */

/**
 * @typedef {Object} ResolveSessionPageOk
 * @property {false} mismatch
 * @property {unknown} page
 * @property {string} targetId
 * @property {WebAiSession} session
 * @property {boolean} recovered
 * @property {'existing-tab' | 'new-tab' | 'recovered'} strategy
 * @property {string[]} warnings
 * @property {string} url
 * @property {string | null} conversationUrl
 */

/**
 * @typedef {Object} ResolveSessionPageMismatch
 * @property {true} mismatch
 * @property {null} page
 * @property {string | null} targetId
 * @property {WebAiSession} session
 * @property {false} recovered
 * @property {'existing-tab' | 'new-tab' | 'recovered'} strategy
 * @property {string[]} warnings
 * @property {string | null} url
 * @property {string | null} conversationUrl
 */

/** @typedef {ResolveSessionPageOk | ResolveSessionPageMismatch} ResolveSessionPageResult */

/**
 * Fail-closed guard for ChatGPT later-session / new-tab recovery targets
 * (32.3). A safe target is an HTTPS ChatGPT URL that references a CONCRETE
 * conversation (`/c/<id>`, incl. under a GPT prefix) — never the provider root,
 * a foreign host, or a traversal/smuggling string. Used by 35.1's new-tab
 * recovery and any later-session send to avoid landing on the wrong thread.
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isSafeChatGptConversationUrl(url) {
    return sharedSafeChatGptConversationUrl(url);
}

/**
 * New-tab conversation recovery (35.1). Opens a saved ChatGPT conversation URL
 * in a FRESH tab — the agreed alternative to oracle's sidebar DOM-search
 * (master plan 36 §2). The 32.3 guard runs FIRST, so an unsafe target never
 * opens a tab. On URL mismatch the stray tab is closed. Never throws.
 * @param {{ getPort: () => number }} deps
 * @param {{ vendor?: string, conversationUrl?: string|null }} [opts]
 * @returns {Promise<{ opened: true, page: any, targetId: string, conversationUrl: string } | { opened: false, reason: string, targetId?: string|null }>}
 */
export async function openConversationInNewTab(deps, { vendor = 'chatgpt', conversationUrl } = {}) {
    if (!isSafeProviderConversationUrl(vendor, conversationUrl)) {
        return { opened: false, reason: 'unsafe-conversation-url' };
    }
    const safeUrl = /** @type {string} */ (conversationUrl);
    const port = deps.getPort();
    let targetId = null;
    try {
        const newTab = await createTab(port, safeUrl);
        targetId = newTab.targetId;
        const newPage = await waitForPageByTargetId(port, targetId).catch(() => null);
        if (!newPage) {
            await closeTab(port, targetId).catch(() => undefined);
            return { opened: false, reason: 'page-unavailable', targetId };
        }
        await waitForConversationReady(newPage, newPage.url(), vendor);
        if (!urlsCompatible(safeUrl, newPage.url(), vendor)) {
            await closeTab(port, targetId).catch(() => undefined);
            return { opened: false, reason: 'conversation-mismatch' };
        }
        return { opened: true, page: newPage, targetId, conversationUrl: newPage.url() };
    } catch (err) {
        if (targetId) await closeTab(port, targetId).catch(() => undefined);
        return { opened: false, reason: `new-tab-failed:${/** @type {any} */ (err)?.message || 'unknown'}` };
    }
}

/**
 * @param {string|null|undefined} storedUrl
 * @param {string|null|undefined} liveUrl
 */
export function urlsCompatible(storedUrl, liveUrl, vendor = '') {
    return providerUrlsCompatible(storedUrl, liveUrl, vendor);
}

/**
 * Resolve the page bound to a session.
 *
 * Returns either a populated `mismatch: false` result (page non-null) or a
 * typed `mismatch: true` result (page null). Mismatch is only reported when
 * `allowNavigate === false` AND either the resolved tab's URL drifted from
 * the session's stored conversation/original URL, or the stored target is
 * closed and a new tab would have to be opened to recover.
 *
 * @param {RecoverDeps} deps
 * @param {string} sessionId
 * @param {{ allowNavigate?: boolean, forceRecover?: boolean }} [options]
 * @returns {Promise<ResolveSessionPageResult>}
 */
export async function resolveSessionPage(deps, sessionId, options = {}) {
    const allowNavigate = options.allowNavigate !== false;
    const forceRecover = options.forceRecover === true;

    const session = getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const port = deps.getPort();
    const current = /** @type {WebAiSession} */ (session);
    const storedUrl = current.conversationUrl || current.originalUrl || null;

    const { valid, needsRecovery } = await verifySessionTab(deps, current);

    if (!valid || forceRecover) {
        if (!allowNavigate) {
            // Stored tab is closed/dead and caller did not authorize navigation.
            return {
                mismatch: true,
                page: null,
                targetId: current.targetId || null,
                session: current,
                recovered: false,
                strategy: needsRecovery ? 'new-tab' : 'recovered',
                warnings: [`session ${sessionId} tab is not valid; pass --navigate to recover`],
                url: null,
                conversationUrl: current.conversationUrl || null,
            };
        }
        const recoveryTargetUrl = storedUrl;
        if ((needsRecovery || forceRecover) && recoveryTargetUrl) {
            const recovery = await recoverSessionTab(deps, current);
            if (!recovery.recovered) {
                throw new Error(`Session ${sessionId} tab recovery failed`);
            }
            const recovered = /** @type {WebAiSession} */ (getSession(sessionId));
            const page = await getPageByTargetId(port, /** @type {string} */ (recovered.targetId));
            if (!page) throw new Error(`Session ${sessionId} page not found after recovery`);
            return {
                mismatch: false,
                page,
                targetId: /** @type {string} */ (recovered.targetId),
                session: recovered,
                recovered: true,
                strategy: recovery.strategy === 'new-tab' ? 'new-tab' : 'recovered',
                warnings: [],
                url: page.url?.() || recoveryTargetUrl,
                conversationUrl: recovered.conversationUrl || null,
            };
        }
        throw new Error(`Session ${sessionId} tab is not valid and cannot be recovered`);
    }

    const page = await getPageByTargetId(port, /** @type {string} */ (current.targetId));
    if (!page) throw new Error(`Session ${sessionId} page not found for targetId ${current.targetId}`);

    if (current.conversationUrl && page.url() !== current.conversationUrl) {
        const liveUrl = page.url();
        if (shouldPreferCurrentProviderUrl(current.conversationUrl, liveUrl)) {
            updateSession(sessionId, { conversationUrl: liveUrl });
            const updated = /** @type {WebAiSession} */ (getSession(sessionId));
            return {
                mismatch: false,
                page,
                targetId: /** @type {string} */ (current.targetId),
                session: updated,
                recovered: false,
                strategy: 'existing-tab',
                warnings: [],
                url: liveUrl,
                conversationUrl: updated.conversationUrl || null,
            };
        }
        if (!allowNavigate) {
            const drifted = !urlsCompatible(current.conversationUrl, liveUrl, current.vendor || '');
            if (drifted) {
                return {
                    mismatch: true,
                    page: null,
                    targetId: /** @type {string} */ (current.targetId),
                    session: current,
                    recovered: false,
                    strategy: 'existing-tab',
                    warnings: [`current tab ${liveUrl} does not match session conversationUrl ${current.conversationUrl}; pass --navigate to switch tabs`],
                    url: liveUrl,
                    conversationUrl: current.conversationUrl,
                };
            }
        } else {
            // Work-session guard (round-2): for running Work sessions, also reject
            // bare-origin conversationUrl via the same mismatch path.
            if (_isWorkSession(current) && current.status !== 'complete' && isWorkSessionWithBareOrigin(current)) {
                return {
                    mismatch: true,
                    page: null,
                    targetId: /** @type {string} */ (current.targetId),
                    session: current,
                    recovered: false,
                    strategy: 'existing-tab',
                    warnings: [`Work session ${sessionId} has bare-origin conversationUrl (${current.conversationUrl}); refusing to navigate. Error: provider.work-reattach-unverified`],
                    url: liveUrl,
                    conversationUrl: current.conversationUrl,
                };
            }
            // 32.3 fail-closed: never navigate a ChatGPT session to a non-concrete
            // target (provider root / foreign host / non-/c/ path) — that would
            // open a new chat or the wrong thread instead of recovering this one.
            if (['chatgpt', 'perplexity'].includes(current.vendor || '') && !isSafeProviderConversationUrl(current.vendor || '', current.conversationUrl)) {
                return {
                    mismatch: true,
                    page: null,
                    targetId: /** @type {string} */ (current.targetId),
                    session: current,
                    recovered: false,
                    strategy: 'existing-tab',
                    warnings: [`refusing to navigate to unsafe ${current.vendor} target ${current.conversationUrl}; not a concrete conversation`],
                    url: liveUrl,
                    conversationUrl: current.conversationUrl,
                };
            }
            assertSafeStoredConversationUrl(current.vendor, current.conversationUrl);
            await page.goto(current.conversationUrl, { waitUntil: 'load', timeout: 30_000 });
            const finalUrl = page.url();
            await waitForConversationReady(page, finalUrl, current.vendor || undefined);
            if (finalUrl !== current.conversationUrl && isProviderUrl(finalUrl)) {
                updateSession(sessionId, { conversationUrl: finalUrl });
                const updated = /** @type {WebAiSession} */ (getSession(sessionId));
                return {
                    mismatch: false,
                    page,
                    targetId: /** @type {string} */ (current.targetId),
                    session: updated,
                    recovered: false,
                    strategy: 'existing-tab',
                    warnings: [],
                    url: finalUrl,
                    conversationUrl: updated.conversationUrl || null,
                };
            }
        }
    }

    return {
        mismatch: false,
        page,
        targetId: /** @type {string} */ (current.targetId),
        session: current,
        recovered: false,
        strategy: 'existing-tab',
        warnings: [],
        url: page.url?.() || current.conversationUrl || current.originalUrl || '',
        conversationUrl: current.conversationUrl || null,
    };
}

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
    const first = await resolveSessionPage(deps, sessionId, { allowNavigate: true });
    if (first.mismatch) throw new Error(`Session ${sessionId} resolver returned mismatch with allowNavigate=true`);
    try {
        return await fn(/** @type {ResolvedPage<T>} */ ({ page: first.page, targetId: first.targetId, session: first.session }));
    } catch (err) {
        if (!isPageDeathError(err)) throw err;
        const recovered = await resolveSessionPage(deps, sessionId, { allowNavigate: true, forceRecover: true });
        if (recovered.mismatch) throw new Error(`Session ${sessionId} recovery resolver returned mismatch with allowNavigate=true`);
        return fn(/** @type {ResolvedPage<T>} */ ({ page: recovered.page, targetId: recovered.targetId, session: recovered.session }));
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

export { isSafePerplexityConversationUrl, isSafeProviderConversationUrl };
