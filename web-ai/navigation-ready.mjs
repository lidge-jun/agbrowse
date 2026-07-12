// @ts-check
import { isProviderOriginUrl, normalizeProviderPath, perplexityConversationId } from './provider-url-identity.mjs';
const CONVERSATION_URL_PATTERN = /\/c\/[a-f0-9-]+/;
const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';

const PROVIDER_HOSTS = new Set([
    'chatgpt.com', 'chat.openai.com',
    'gemini.google.com',
    'grok.com',
    'perplexity.ai',
]);

/**
 * @param {any} page
 * @param {string|null|undefined} url
 * @param {string|null|undefined} [vendor]
 */
export async function waitForConversationReady(page, url, vendor) {
    if (vendor === 'perplexity') {
        await page.locator('#ask-input').first().waitFor({ state: 'visible', timeout: 10_000 });
        return;
    }
    const finalUrl = page.url();
    const checkUrl = finalUrl || url;
    if (CONVERSATION_URL_PATTERN.test(checkUrl || '')) {
        await page.locator(ASSISTANT_SELECTOR).first()
            .waitFor({ state: 'attached', timeout: 10_000 })
            .catch(() => undefined);
    }
    let previous = -1;
    let stableReads = 0;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        const count = await page.locator(ASSISTANT_SELECTOR).count().catch(() => 0);
        if (count === previous) stableReads++;
        else stableReads = 0;
        previous = count;
        if (stableReads >= 2) return;
        await page.waitForTimeout(500).catch(() => undefined);
    }
}

/**
 * @param {any} page
 * @param {{ timeoutMs?: number, state?: 'commit'|'domcontentloaded'|'load'|'networkidle' }} [options]
 * @returns {Promise<string>}
 */
export async function waitForPageUrl(page, options = {}) {
    const currentUrl = page?.url?.() || '';
    if (currentUrl) return currentUrl;
    await page?.waitForLoadState?.(options.state || 'domcontentloaded', {
        timeout: options.timeoutMs || 10_000,
    }).catch(() => undefined);
    return page?.url?.() || '';
}

/**
 * A stale CDP target can appear in `/json/list` but leave Playwright page APIs
 * wedged after reconnect. Treat it as non-reusable so send/query creates a
 * fresh tab instead of hanging before the provider timeout can apply.
 *
 * @param {any} page
 * @param {string|null|undefined} requestedUrl
 * @param {{ urlTimeoutMs?: number, probeTimeoutMs?: number, vendor?: string }} [options]
 * @returns {Promise<boolean>}
 */
export async function isProviderPageDriveable(page, requestedUrl, options = {}) {
    const vendor = options.vendor || inferVendor(requestedUrl);
    const currentUrl = await waitForPageUrl(page, { timeoutMs: options.urlTimeoutMs || 2_000 });
    if (shouldNavigateToRequestedProviderUrl(currentUrl, requestedUrl, vendor)) return false;
    if (typeof page?.title !== 'function') return true;
    return withTimeout(
        page.title().then(() => true).catch(() => false),
        options.probeTimeoutMs || 2_000,
        false,
    );
}

/**
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isProviderUrl(url) {
    if (!url) return false;
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return PROVIDER_HOSTS.has(host);
    } catch { return false; }
}

/**
 * @param {string|null|undefined} currentUrl
 * @param {string|null|undefined} requestedUrl
 * @returns {boolean}
 */
export function shouldNavigateToRequestedProviderUrl(currentUrl, requestedUrl, vendor = inferVendor(requestedUrl)) {
    if (!requestedUrl) return false;
    if (!currentUrl || currentUrl === 'about:blank') return true;
    if (vendor === 'perplexity' && isProviderOriginUrl(vendor, currentUrl) && isProviderOriginUrl(vendor, requestedUrl)) {
        const currentId = perplexityConversationId(currentUrl);
        const requestedId = perplexityConversationId(requestedUrl);
        if (currentId || requestedId) return currentId !== requestedId;
        return normalizeProviderPath(new URL(currentUrl).pathname) !== normalizeProviderPath(new URL(requestedUrl).pathname);
    }
    try {
        const current = new URL(currentUrl);
        const requested = new URL(requestedUrl);
        if (current.href === requested.href) return false;
        if (current.origin !== requested.origin) return true;
        const currentPath = normalizeProviderPath(current.pathname);
        const requestedPath = normalizeProviderPath(requested.pathname);
        if (currentPath !== requestedPath) return true;
        return Boolean(requested.search) && current.search !== requested.search;
    } catch {
        return true;
    }
}

/** @param {string|null|undefined} value */
function inferVendor(value) {
    if (!value) return '';
    try {
        const host = new URL(value).hostname.replace(/^www\./, '');
        if (host === 'perplexity.ai') return 'perplexity';
        if (host === 'chatgpt.com' || host === 'chat.openai.com') return 'chatgpt';
        if (host === 'gemini.google.com') return 'gemini';
        if (host === 'grok.com') return 'grok';
    } catch { /* invalid */ }
    return '';
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {T} fallback
 * @returns {Promise<T>}
 */
async function withTimeout(promise, timeoutMs, fallback) {
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    try {
        return await Promise.race([
            promise,
            new Promise(resolve => {
                timer = setTimeout(() => resolve(fallback), Math.max(1, timeoutMs));
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
