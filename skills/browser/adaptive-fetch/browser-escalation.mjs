// @ts-check

import { closeFetchBrowserPage, getFetchBrowserPage } from './browser-runtime.mjs';
import { classifyAccessBoundary, detectChallengeMarkers, detectWafChallenge } from './challenge-detector.mjs';
import { validateFetchUrl } from './safety.mjs';
import { classifyBoundarySignals } from './validators.mjs';

/**
 * @param {string} url
 * @param {{ browserDeps?: any, browserSession?: 'none'|'isolated'|'existing', timeoutMs?: number, selector?: string|null, allowPrivateNetwork?: boolean, challengeInfo?: any }} [options]
 */
export async function collectBrowserCandidate(url, options = {}) {
    const pageRef = await getFetchBrowserPage({
        browserDeps: options.browserDeps,
        browserSession: options.browserSession || 'isolated',
    });
    const page = pageRef.page;
    /** @type {any[]} */
    const networkCandidates = [];
    /** @param {any} response */
    const onResponse = async (response) => {
        try {
            const finalUrl = validateFetchUrl(response.url?.() || url, {
                allowPrivateNetwork: options.allowPrivateNetwork,
            }).href;
            if (isTrackingEndpoint(finalUrl) || isAuthEndpoint(finalUrl)) return;
            const contentType = response.headers?.()['content-type'] || '';
            if (!/\bjson\b/i.test(contentType)) return;
            const text = await response.text();
            if (!text || text.length > 200000) return;
            networkCandidates.push({
                source: 'network_api',
                finalUrl,
                title: '',
                text,
                contentType,
                status: response.status?.() || 0,
                ok: response.ok?.() !== false,
                evidence: ['browser-network-json'],
                warnings: [],
            });
        } catch {
            // Network candidate collection is best-effort; failures (validation,
            // response read, private-URL rejection) are expected and must not
            // block page text extraction. Candidates that fail here are silently
            // dropped — they would score 0 and add noise to the trace.
        }
    };
    try {
        if (typeof page.on === 'function') page.on('response', onResponse);
        let navStatus = 200;
        let navOk = true;
        let navContentType = 'text/plain';
        if (typeof page.goto === 'function') {
            const navResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || 15000 });
            if (navResponse) {
                navStatus = Number(navResponse.status?.() || 0) || 0;
                navOk = navResponse.ok?.() !== false && navStatus > 0 && navStatus < 400;
                navContentType = navResponse.headers?.()?.['content-type'] || 'text/plain';
            }
        }

        const challengeInfo = options.challengeInfo;
        if (challengeInfo?.primary?.behavior?.jsChallengeSolvable) {
            await waitForChallengeResolution(page, 10000);
        } else if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(300).catch(() => undefined);
        }

        const finalUrl = typeof page.url === 'function' ? page.url() : url;
        try {
            validateFetchUrl(finalUrl, { allowPrivateNetwork: options.allowPrivateNetwork });
        } catch (error) {
            return {
                source: 'browser',
                label: 'browser-render',
                finalUrl,
                title: '',
                text: '',
                contentType: 'text/plain',
                status: 0,
                ok: false,
                metadata: null,
                evidence: ['browser-final-url-rejected'],
                warnings: [(/** @type {any} */ (error)).code || 'browser-final-url-rejected'],
                networkCandidates,
            };
        }
        const title = typeof page.title === 'function' ? await page.title() : '';
        const text = await readVisibleText(page, options.selector);
        const markers = detectChallengeMarkers({ url: finalUrl, title, text, status: navStatus });
        const boundary = classifyAccessBoundary(markers);
        const statusBoundary = classifyBoundarySignals({ status: navStatus, text: `${title}\n${text}`, url: finalUrl }).verdict;
        return {
            source: 'browser',
            label: 'browser-render',
            finalUrl,
            title,
            text,
            contentType: navContentType,
            status: navStatus,
            ok: navOk && boundary === null && statusBoundary === null,
            metadata: null,
            evidence: [
                'browser-render',
                navStatus ? `http-${navStatus}` : null,
                boundary ? `boundary:${boundary}` : null,
                statusBoundary ? `status-boundary:${statusBoundary}` : null,
            ].filter(Boolean),
            warnings: markers.map(marker => `marker:${marker.kind}`),
            networkCandidates,
        };
    } finally {
        if (typeof page.off === 'function') page.off('response', onResponse);
        await closeFetchBrowserPage(pageRef);
    }
}

/**
 * @param {any} page
 * @param {string|null|undefined} selector
 */
async function readVisibleText(page, selector) {
    if (selector && typeof page.locator === 'function') {
        const locator = page.locator(selector).first();
        return locator.innerText({ timeout: 2000 }).catch(() => '');
    }
    if (typeof page.evaluate === 'function') {
        return page.evaluate(() => document.body?.innerText || document.documentElement?.innerText || '');
    }
    return '';
}

/**
 * @param {any} browserResult
 */
export function collectNetworkJsonCandidates(browserResult) {
    return Array.isArray(browserResult?.networkCandidates) ? browserResult.networkCandidates : [];
}

/**
 * @param {any} page
 * @param {number} timeoutMs
 */
async function waitForChallengeResolution(page, timeoutMs) {
    if (typeof page.evaluate !== 'function') return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const hasChallenge = await page.evaluate(() => {
            return !!document.querySelector('[id*="challenge"]') ||
                (document.title || '').includes('Just a moment');
        }).catch(() => false);
        if (!hasChallenge) return true;
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(500).catch(() => undefined);
        } else {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    return false;
}

/**
 * @param {string} url
 */
function isTrackingEndpoint(url) {
    return /analytics|tracking|telemetry|beacon|pixel|log\b/i.test(url);
}

/**
 * @param {string} url
 */
function isAuthEndpoint(url) {
    return /\/auth[\/\?]|\/login[\/\?]|\/token[\/\?]|\/session[\/\?]|\/oauth[\/\?]|\/signin[\/\?]/i.test(url);
}
