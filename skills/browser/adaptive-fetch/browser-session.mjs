// @ts-check

import { getFetchBrowserPage, closeFetchBrowserPage } from './browser-runtime.mjs';
import { validateFetchUrl } from './safety.mjs';

/**
 * @param {{ browserDeps?: any }} [options]
 * @returns {boolean}
 */
export function isUserSessionAvailable(options = {}) {
    const deps = options?.browserDeps || {};
    return typeof deps.getPage === 'function';
}

/**
 * @param {any[]} candidates
 * @param {{ browserSession?: string, browserSessionRaw?: string, browserDeps?: any }} options
 * @returns {boolean|'prompt'}
 */
export function shouldTryUserSession(candidates, options) {
    const rawSession = options.browserSessionRaw || options.browserSession;
    if (rawSession === 'user' || rawSession === 'interactive') return true;
    const hasChallenge = candidates.some(c =>
        c.challenge?.type === 'challenge' ||
        c.challenge?.type === 'auth_required' ||
        c.challenge?.type === 'paywall'
    );
    if (hasChallenge && isUserSessionAvailable(options)) return 'prompt';
    return false;
}

/**
 * @param {string} url
 * @param {{ browserDeps?: any, timeoutMs?: number, selector?: string|null, allowPrivateNetwork?: boolean }} options
 * @returns {Promise<{ source: string, finalUrl: string, title: string, text: string, contentType: string, status: number, ok: boolean, session: string, evidence: string[], warnings: string[], safetyFlags: string[] }>}
 */
export async function navigateInUserSession(url, options) {
    const pageRef = await getFetchBrowserPage({
        browserDeps: options.browserDeps,
        browserSession: 'existing',
    });
    try {
        const page = pageRef.page;
        let navStatus = 200;
        let navOk = true;
        if (typeof page.goto === 'function') {
            const response = await page.goto(url, { waitUntil: 'networkidle', timeout: options.timeoutMs || 15000 });
            if (response) {
                navStatus = typeof response.status === 'function' ? response.status() : (response.status || 200);
                navOk = navStatus >= 200 && navStatus < 400;
            }
        }
        const title = typeof page.title === 'function' ? await page.title() : '';
        let text = '';
        if (options.selector && typeof page.locator === 'function') {
            text = await page.locator(options.selector).first().innerText({ timeout: 2000 }).catch(() => '');
        } else if (typeof page.evaluate === 'function') {
            text = await page.evaluate(() => document.body?.innerText || '');
        }
        const finalUrl = typeof page.url === 'function' ? page.url() : url;
        const warnings = [];
        try {
            validateFetchUrl(finalUrl, { allowPrivateNetwork: options.allowPrivateNetwork });
        } catch {
            warnings.push('user-session-redirected-to-private-url');
            return {
                source: 'browser_user',
                finalUrl,
                title,
                text: '',
                contentType: 'text/html',
                status: navStatus,
                ok: false,
                session: 'user',
                evidence: ['user-session-render', 'private-url-rejected'],
                warnings,
                safetyFlags: ['user_session_used'],
            };
        }
        return {
            source: 'browser_user',
            finalUrl,
            title,
            text,
            contentType: 'text/html',
            status: navStatus,
            ok: navOk,
            session: 'user',
            evidence: ['user-session-render'],
            warnings,
            safetyFlags: ['user_session_used'],
        };
    } finally {
        await closeFetchBrowserPage(pageRef);
    }
}
