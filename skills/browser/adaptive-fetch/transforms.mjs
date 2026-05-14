// @ts-check

/**
 * @param {string} html
 */
export function htmlToReadableText(html = '') {
    return decodeHtmlEntities(html)
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map(line => normalizeWhitespace(line))
        .filter(Boolean)
        .join('\n');
}

/**
 * @param {string} html
 */
export function extractTitleFromHtml(html = '') {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? normalizeWhitespace(decodeHtmlEntities(match[1])) : '';
}

/**
 * @param {string[]} urls
 */
export function dedupeCandidateUrls(urls = []) {
    const seen = new Set();
    /** @type {string[]} */
    const out = [];
    for (const raw of urls) {
        try {
            const href = new URL(raw).href;
            if (!seen.has(href)) {
                seen.add(href);
                out.push(href);
            }
        } catch {
            // Ignore invalid candidates; validation happens before network work.
        }
    }
    return out;
}

/**
 * @param {string} text
 */
export function normalizeWhitespace(text = '') {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} contentType
 */
export function isHtmlContentType(contentType = '') {
    return /\btext\/html\b/i.test(contentType);
}

/**
 * @param {string} contentType
 */
export function isTextualContentType(contentType = '') {
    if (!contentType) return true;
    return /^text\//i.test(contentType)
        || /\b(application|.+)\/(json|xml|rss\+xml|atom\+xml|xhtml\+xml|javascript)\b/i.test(contentType);
}

/**
 * @param {string} text
 */
export function decodeHtmlEntities(text = '') {
    return text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'");
}

