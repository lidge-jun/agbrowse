// @ts-check
import { isSafePerplexityConversationUrl } from './provider-url-identity.mjs';

/** @typedef {{index:number|null,title:string,url:string}} AnswerCitation */

/**
 * Normalize citation candidates in first visual occurrence order.
 * @param {unknown[]} raw
 * @param {string} baseUrl
 * @returns {AnswerCitation[]}
 */
export function normalizePerplexityCitations(raw, baseUrl) {
    if (!Array.isArray(raw)) return [];
    /** @type {AnswerCitation[]} */ const out = [];
    const seen = new Set();
    for (const candidate of raw) {
        const item = typeof candidate === 'string'
            ? { url: candidate, title: '', index: null }
            : candidate && typeof candidate === 'object'
                ? /** @type {Record<string, unknown>} */ (candidate)
                : null;
        if (!item) continue;
        const href = typeof item.url === 'string' ? item.url : typeof item.href === 'string' ? item.href : '';
        if (!href) continue;
        let url;
        try { url = new URL(href, baseUrl); } catch { continue; }
        if (!['http:', 'https:'].includes(url.protocol)) continue;
        url.hash = '';
        const normalizedUrl = url.toString();
        if (isSafePerplexityConversationUrl(normalizedUrl)) continue;
        if (seen.has(normalizedUrl)) continue;
        seen.add(normalizedUrl);
        const numeric = Number(item.index);
        out.push({
            index: Number.isInteger(numeric) && numeric > 0 ? numeric : null,
            title: typeof item.title === 'string' ? item.title.trim() : '',
            url: normalizedUrl,
        });
    }
    return out;
}

/**
 * Read direct external anchors from a causally-associated sources pane.
 * The caller owns pane association and authenticated closure.
 * @param {import('playwright-core').Locator} pane
 * @param {string} baseUrl
 */
export async function readPerplexityCitationCandidates(pane, baseUrl) {
    const raw = await pane.locator(':scope a[href], :scope [data-source-url]').evaluateAll((nodes) => nodes.map((node) => ({
        url: node.getAttribute('href') || node.getAttribute('data-source-url') || '',
        title: (node.textContent || '').trim(),
        index: node.getAttribute('data-source-index') || node.getAttribute('aria-posinset') || null,
    })));
    return normalizePerplexityCitations(raw, baseUrl);
}

/** @param {AnswerCitation[]} citations */
export function perplexityCitationFingerprint(citations) {
    return citations.map(citation => `${citation.index ?? ''}|${citation.title}|${citation.url}`).join('\n');
}
