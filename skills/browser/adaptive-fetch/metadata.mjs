// @ts-check

import { extractTitleFromHtml, htmlToReadableText, normalizeWhitespace } from './transforms.mjs';

/**
 * @param {string} html
 * @param {string} finalUrl
 */
export function extractMetadataFromHtml(html = '', finalUrl = '') {
    const title = firstNonEmpty(
        getMetaContent(html, 'property', 'og:title'),
        getMetaContent(html, 'name', 'twitter:title'),
        extractTitleFromHtml(html),
    );
    const description = firstNonEmpty(
        getMetaContent(html, 'name', 'description'),
        getMetaContent(html, 'property', 'og:description'),
        getMetaContent(html, 'name', 'twitter:description'),
    );
    const canonicalUrl = resolveMaybeUrl(getLinkHref(html, 'canonical'), finalUrl);
    const jsonLd = extractJsonLdBlocks(html);
    const text = htmlToReadableText(html);
    return {
        source: 'metadata',
        finalUrl,
        title,
        text,
        metadata: {
            canonicalUrl,
            description,
            openGraph: extractOpenGraph(html),
            jsonLd,
        },
        evidence: [
            title ? 'title' : null,
            description ? 'description' : null,
            canonicalUrl ? 'canonical' : null,
            jsonLd.length > 0 ? 'json-ld' : null,
        ].filter(Boolean),
        warnings: [],
    };
}

/**
 * @param {string} html
 */
export function extractJsonLdBlocks(html = '') {
    const blocks = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(html))) {
        const raw = match[1].trim();
        if (!raw) continue;
        try {
            blocks.push(JSON.parse(raw));
        } catch {
            blocks.push({ raw, parseError: true });
        }
    }
    return blocks;
}

/**
 * @param {string} html
 */
function extractOpenGraph(html) {
    /** @type {Record<string, string>} */
    const og = {};
    const re = /<meta\s+[^>]*property=["']og:([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
    let match;
    while ((match = re.exec(html))) og[match[1]] = normalizeWhitespace(match[2]);
    return og;
}

/**
 * @param {string} html
 * @param {'name'|'property'} attr
 * @param {string} key
 */
function getMetaContent(html, attr, key) {
    const re = new RegExp(`<meta\\s+[^>]*${attr}=["']${escapeRegExp(key)}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
    const match = html.match(re);
    return match ? normalizeWhitespace(match[1]) : '';
}

/**
 * @param {string} html
 * @param {string} rel
 */
function getLinkHref(html, rel) {
    const re = new RegExp(`<link\\s+[^>]*rel=["']${escapeRegExp(rel)}["'][^>]*href=["']([^"']*)["'][^>]*>`, 'i');
    const match = html.match(re);
    return match ? normalizeWhitespace(match[1]) : '';
}

/**
 * @param {string} raw
 * @param {string} base
 */
function resolveMaybeUrl(raw, base) {
    if (!raw) return '';
    try {
        return new URL(raw, base || undefined).href;
    } catch {
        return raw;
    }
}

function firstNonEmpty(...values) {
    return values.find(v => typeof v === 'string' && v.trim()) || '';
}

/**
 * @param {string} text
 */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

