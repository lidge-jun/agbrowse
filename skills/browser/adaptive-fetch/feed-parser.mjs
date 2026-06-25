// @ts-check

// Parity catalog 203.4 (P2): RSS/Atom/JSON-feed parser → evidence. agbrowse only
// *discovers* feed URLs; this parses feed items (title/date/author/summary/tags/media)
// into evidence. Reverse port of cli-jaw adaptive-fetch/feed-parser.ts. Pure.

import { normalizeWhitespace } from './transforms.mjs';

/**
 * @typedef {Object} ParsedFeedItem
 * @property {string} title
 * @property {string} date
 * @property {string} url
 * @property {string} summary
 * @property {string} author
 * @property {string[]} tags
 * @property {string} mediaUrl
 */

/**
 * @typedef {Object} ParsedFeed
 * @property {'feed-json'|'rss-atom'} kind
 * @property {string} title
 * @property {string} description
 * @property {string} url
 * @property {ParsedFeedItem[]} items
 */

/** @typedef {Record<string, unknown>|unknown[]} Json */

/**
 * @param {string} rawText
 * @param {Json|null} json
 * @returns {ParsedFeed|null}
 */
export function parsePublicFeed(rawText, json) {
    if (json) return parseJsonFeed(json);
    if (!/<(?:rss|feed|rdf:RDF|item|entry)\b/i.test(rawText)) return null;
    const itemBlocks = (xmlBlocks(rawText, 'item').length ? xmlBlocks(rawText, 'item') : xmlBlocks(rawText, 'entry')).slice(0, 5);
    const title = xmlTag(rawText, 'title') || 'RSS/Atom feed';
    return {
        kind: 'rss-atom',
        title,
        description: xmlTag(rawText, 'description') || xmlTag(rawText, 'subtitle'),
        url: xmlTag(rawText, 'link') || xmlLinkHref(rawText),
        items: itemBlocks.slice(0, 3).map(parseXmlFeedItem),
    };
}

/**
 * @param {ParsedFeed} feed
 */
export function formatFeedEvidence(feed) {
    const lines = [
        `Feed: ${feed.title}`,
        line('Description', feed.description),
        line('Home', feed.url),
        ...feed.items.flatMap((item, index) => feedItemLines(item, index)),
    ].filter((value) => Boolean(value && normalizeWhitespace(value)));
    return {
        kind: feed.kind,
        title: normalizeWhitespace(feed.title),
        text: normalizeWhitespace(lines.join('\n')),
        metadata: {
            feedKind: feed.kind,
            items: feed.items.length,
            itemUrls: feed.items.map((item) => item.url).filter(Boolean),
            mediaUrls: feed.items.map((item) => item.mediaUrl).filter(Boolean),
        },
    };
}

/**
 * @param {Json} json
 * @returns {ParsedFeed|null}
 */
function parseJsonFeed(json) {
    const obj = asObject(json);
    const items = arr(obj['items']).slice(0, 3).map((value) => {
        const item = asObject(value);
        const author = asObject(item['author']);
        const authors = arr(item['authors'])
            .map((v) => str(asObject(v)['name'] || asObject(v)['url']))
            .filter(Boolean);
        return {
            title: str(item['title']),
            date: str(item['date_published'] || item['date_modified']),
            url: str(item['url'] || item['external_url']),
            summary: clip(stripHtml(str(item['summary'] || item['content_text'] || item['content_html']))),
            author: str(author['name'] || author['url']) || authors.join(', '),
            tags: arr(item['tags']).map(str).filter(Boolean),
            mediaUrl: firstAttachmentUrl(item),
        };
    });
    const title = str(obj['title']);
    if (!title && items.length === 0) return null;
    return {
        kind: 'feed-json',
        title: title || 'Feed',
        description: str(obj['description']),
        url: str(obj['home_page_url'] || obj['feed_url']),
        items,
    };
}

/**
 * @param {string} block
 * @returns {ParsedFeedItem}
 */
function parseXmlFeedItem(block) {
    return {
        title: xmlTag(block, 'title'),
        date: xmlTag(block, 'pubDate') || xmlTag(block, 'published') || xmlTag(block, 'updated'),
        url: xmlTag(block, 'link') || xmlLinkHref(block) || xmlTag(block, 'guid') || xmlTag(block, 'id'),
        summary: clip(stripHtml(xmlTag(block, 'description') || xmlTag(block, 'summary') || xmlTag(block, 'encoded') || xmlTag(block, 'content'))),
        author: xmlTag(block, 'creator') || xmlTag(block, 'author') || xmlTag(block, 'name'),
        tags: [...new Set(xmlTags(block, 'category').map(str).filter(Boolean))],
        mediaUrl: enclosureUrl(block) || mediaUrl(block),
    };
}

/**
 * @param {ParsedFeedItem} item
 * @param {number} index
 * @returns {string[]}
 */
function feedItemLines(item, index) {
    return [
        item.title ? `Item ${index + 1}: ${item.title}` : '',
        line('  Date', item.date),
        line('  URL', item.url),
        line('  Author', item.author),
        line('  Tags', item.tags.join(', ')),
        line('  Media', item.mediaUrl),
        line('  Summary', item.summary),
    ].filter((value) => Boolean(value));
}

/** @param {Record<string, unknown>} item @returns {string} */
function firstAttachmentUrl(item) {
    const attachment = asObject(arr(item['attachments'])[0]);
    return str(attachment['url']);
}

/** @param {string} xml @param {string} tag @returns {string[]} */
function xmlBlocks(xml, tag) {
    const tagPattern = `(?:[\\w.-]+:)?${escapeRegExp(tag)}`;
    return [...xml.matchAll(new RegExp(`<${tagPattern}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagPattern}>`, 'gi'))].map((match) => match[0]);
}

/** @param {string} xml @param {string} tag @returns {string[]} */
function xmlTags(xml, tag) {
    const tagPattern = `(?:[\\w.-]+:)?${escapeRegExp(tag)}`;
    return [...xml.matchAll(new RegExp(`<${tagPattern}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagPattern}>`, 'gi'))].map((match) => cleanXml(match[1] || ''));
}

/** @param {string} xml @param {string} tag @returns {string} */
function xmlTag(xml, tag) {
    return xmlTags(xml, tag)[0] || '';
}

/** @param {string} xml @returns {string} */
function xmlLinkHref(xml) {
    const match = xml.match(/<(?:[\w.-]+:)?link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    return cleanXml(match?.[1] || '');
}

/** @param {string} xml @returns {string} */
function enclosureUrl(xml) {
    const match = xml.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i);
    return cleanXml(match?.[1] || '');
}

/** @param {string} xml @returns {string} */
function mediaUrl(xml) {
    const match = xml.match(/<(?:media|mrss):(?:thumbnail|content)\b[^>]*(?:url|href)=["']([^"']+)["'][^>]*\/?>/i);
    return cleanXml(match?.[1] || '');
}

/** @param {string} label @param {unknown} value @returns {string|null} */
function line(label, value) {
    const text = Array.isArray(value) ? value.map(str).filter(Boolean).join(', ') : str(value);
    return text ? `${label}: ${text}` : null;
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {unknown} value @returns {unknown[]} */
function arr(value) {
    return Array.isArray(value) ? value : [];
}

/** @param {unknown} value @returns {string} */
function str(value) {
    if (value == null) return '';
    return normalizeWhitespace(String(value));
}

/** @param {string} value @returns {string} */
function stripHtml(value) {
    return normalizeWhitespace(decodeXml(value).replace(/<[^>]+>/g, ' '));
}

/** @param {string} value @returns {string} */
function cleanXml(value) {
    return stripHtml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'));
}

/** @param {string} value @returns {string} */
function decodeXml(value) {
    return value
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}

/** @param {string} value @param {number} [max] @returns {string} */
function clip(value, max = 240) {
    return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

/** @param {string} text @returns {string} */
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
