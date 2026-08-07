// @ts-check

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const DURABLE_CONVERSATION_PATH = /(?:^|\/)c\/([A-Za-z0-9-]+)(?=\/|$)/;

/**
 * Extract a durable ChatGPT conversation id from a parsed path.
 *
 * @param {string|null|undefined} candidate
 * @returns {string|null}
 */
export function extractDurableConversationId(candidate) {
    if (typeof candidate !== 'string' || candidate === '') return null;

    try {
        const url = new URL(candidate);
        const components = candidate.match(/^https:\/\/([^/?#]*)([^?#]*)/);
        const authority = components?.[1] || '';
        const pathname = components?.[2] || '';
        if (authority.includes('..') || authority.includes('\\') || authority.includes('\0')) return null;
        if (pathname.includes('..') || pathname.includes('\\') || pathname.includes('\0')) return null;
        if (url.protocol !== 'https:') return null;
        if (url.port !== '' || authority.toLowerCase() !== url.hostname) return null;
        if (!CHATGPT_HOSTS.has(url.hostname)) return null;
        return url.pathname.match(DURABLE_CONVERSATION_PATH)?.[1] || null;
    } catch {
        return null;
    }
}

/**
 * @param {string|null|undefined} candidate
 * @returns {boolean}
 */
export function isDurableConversationUrl(candidate) {
    return extractDurableConversationId(candidate) !== null;
}
