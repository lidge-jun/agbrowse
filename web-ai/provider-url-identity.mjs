// @ts-check

const PERPLEXITY_UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PERPLEXITY_RAW_CONVERSATION_RE = new RegExp(
    '^https://(?:www\\.)?perplexity\\.ai' + `/search/${PERPLEXITY_UUID_SOURCE}/?$`,
    'i',
);
const PERPLEXITY_RAW_PROVIDER_RE = /^https:\/\/(?:www\.)?perplexity\.ai(?:[/?#]|$)/i;

/**
 * Preserve the existing ChatGPT concrete-conversation grammar, including
 * query-bearing `/c/<id>` URLs.
 * @param {string|null|undefined} value
 */
export function isSafeChatGptConversationUrl(value) {
    if (typeof value !== 'string' || value === '') return false;
    if (value.includes('..') || value.includes('\\') || value.includes('\0')) return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.protocol !== 'https:') return false;
    if (url.hostname !== 'chatgpt.com' && url.hostname !== 'chat.openai.com') return false;
    return /\/c\/[A-Za-z0-9_-]+/.test(url.pathname);
}

/** @param {string|null|undefined} value */
export function isSafePerplexityConversationUrl(value) {
    if (typeof value !== 'string' || !PERPLEXITY_RAW_CONVERSATION_RE.test(value)) return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    return url.protocol === 'https:'
        && !url.username
        && !url.password
        && !url.port
        && !url.search
        && !url.hash;
}

/** @param {string} vendor @param {string|null|undefined} value */
export function isSafeProviderConversationUrl(vendor, value) {
    if (vendor === 'chatgpt') return isSafeChatGptConversationUrl(value);
    if (vendor === 'perplexity') return isSafePerplexityConversationUrl(value);
    return false;
}

/** @param {string|null|undefined} value */
export function perplexityConversationId(value) {
    if (!isSafePerplexityConversationUrl(value)) return null;
    return new URL(/** @type {string} */ (value)).pathname.replace(/\/+$/, '').split('/').at(-1)?.toLowerCase() || null;
}

/** @param {string|null|undefined} value */
export function chatGptConversationId(value) {
    if (!isSafeChatGptConversationUrl(value)) return null;
    const match = new URL(/** @type {string} */ (value)).pathname.match(/\/c\/([A-Za-z0-9_-]+)/);
    return match?.[1] || null;
}

/** @param {string} vendor @param {string|null|undefined} value */
export function isProviderOriginUrl(vendor, value) {
    if (typeof value !== 'string') return false;
    if (vendor === 'perplexity') {
        if (!PERPLEXITY_RAW_PROVIDER_RE.test(value)) return false;
        let url;
        try { url = new URL(value); } catch { return false; }
        return url.protocol === 'https:' && !url.username && !url.password && !url.port;
    }
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    if (vendor === 'chatgpt') return url.hostname === 'chatgpt.com' || url.hostname === 'chat.openai.com';
    if (vendor === 'gemini') return url.hostname === 'gemini.google.com';
    if (vendor === 'grok') return url.hostname === 'grok.com' || url.hostname === 'www.grok.com';
    return false;
}

/** @param {string} vendor @param {string|null|undefined} value */
export function canonicalProviderOrigin(vendor, value) {
    if (!isProviderOriginUrl(vendor, value)) return null;
    if (vendor === 'perplexity') return 'https://www.perplexity.ai';
    const url = new URL(/** @type {string} */ (value));
    return url.origin;
}

/**
 * Compare stored and live URLs without confusing Perplexity bare/www aliases
 * or distinct conversation UUIDs.
 * @param {string|null|undefined} storedUrl
 * @param {string|null|undefined} liveUrl
 * @param {string} [vendor]
 */
export function providerUrlsCompatible(storedUrl, liveUrl, vendor = '') {
    if (!storedUrl || !liveUrl) return false;
    if (!vendor && isProviderOriginUrl('perplexity', storedUrl) && isProviderOriginUrl('perplexity', liveUrl)) vendor = 'perplexity';
    if (storedUrl === liveUrl) return true;
    if (vendor === 'perplexity') {
        const a = perplexityConversationId(storedUrl);
        const b = perplexityConversationId(liveUrl);
        if (a || b) return Boolean(a && b && a === b);
        if (!isProviderOriginUrl('perplexity', storedUrl) || !isProviderOriginUrl('perplexity', liveUrl)) return false;
        try {
            const aPath = normalizeProviderPath(new URL(storedUrl).pathname);
            const bPath = normalizeProviderPath(new URL(liveUrl).pathname);
            return aPath === bPath;
        } catch { return false; }
    }
    try {
        const a = new URL(storedUrl);
        const b = new URL(liveUrl);
        if (a.hostname !== b.hostname) return false;
        const aPath = a.pathname.replace(/\/+$/, '') || '/';
        const bPath = b.pathname.replace(/\/+$/, '') || '/';
        return aPath === bPath || aPath === '/' || bPath.startsWith(`${aPath}/`);
    } catch { return false; }
}

/** @param {string} pathname */
export function normalizeProviderPath(pathname) {
    const normalized = String(pathname || '/').replace(/\/+$/, '');
    return normalized || '/';
}
