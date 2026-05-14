// @ts-check

import { closeFetchBrowserPage, getFetchBrowserPage } from './browser-runtime.mjs';
import { classifyAccessBoundary, detectChallengeMarkers } from './challenge-detector.mjs';
import { validateFetchUrl } from './safety.mjs';

/**
 * @param {string} url
 * @param {{ browserDeps?: any, browserSession?: 'none'|'isolated'|'existing', timeoutMs?: number, selector?: string|null, allowPrivateNetwork?: boolean }} [options]
 */
export async function collectBrowserCandidate(url, options = {}) {
    const pageRef = await getFetchBrowserPage({
        browserDeps: options.browserDeps,
        browserSession: options.browserSession || 'isolated',
    });
    const page = pageRef.page;
    /** @type {any[]} */
    const networkCandidates = [];
    const onResponse = async (response) => {
        try {
            const finalUrl = validateFetchUrl(response.url?.() || url, {
                allowPrivateNetwork: options.allowPrivateNetwork,
            }).href;
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
            // Network candidate collection is best-effort and must not fail page text extraction.
        }
    };
    try {
        if (typeof page.on === 'function') page.on('response', onResponse);
        if (typeof page.goto === 'function') {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs || 15000 });
        }
        if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(300).catch(() => undefined);
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
        const markers = detectChallengeMarkers({ url: finalUrl, title, text, status: 200 });
        const boundary = classifyAccessBoundary(markers);
        return {
            source: 'browser',
            label: 'browser-render',
            finalUrl,
            title,
            text,
            contentType: 'text/plain',
            status: 200,
            ok: boundary === null,
            metadata: null,
            evidence: ['browser-render', markers.length ? `boundary:${boundary}` : null].filter(Boolean),
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
