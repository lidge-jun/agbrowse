// @ts-check

const DEFAULT_BACKEND = 'unknown';

/**
 * @typedef {{
 *   url: string,
 *   title: string,
 *   snippet: string,
 *   date: string | null,
 *   rank: number,
 *   raw: Record<string, unknown>
 * }} NormalizedSearchResult
 */

/**
 * @param {unknown} input
 * @param {{ backend?: string, query?: string }} [options]
 */
export function normalizeSearchResults(input, options = {}) {
    const backend = normalizeString(options.backend)
        || normalizeString(/** @type {any} */ (input)?.backend)
        || DEFAULT_BACKEND;
    const query = normalizeString(options.query)
        || normalizeString(/** @type {any} */ (input)?.query)
        || '';
    const rows = extractRows(input);
    /** @type {NormalizedSearchResult[]} */
    const results = [];
    /** @type {Array<{ rank: number, reason: string, raw: unknown }>} */
    const dropped = [];
    const seen = new Set();

    rows.forEach((row, index) => {
        const rank = index + 1;
        const raw = isRecord(row) ? row : { value: row };
        const url = normalizeUrl(
            pickString(raw, ['url', 'link', 'href', 'sourceUrl', 'source_url'])
        );
        if (!url) {
            dropped.push({ rank, reason: 'missing-or-invalid-url', raw });
            return;
        }
        if (seen.has(url)) {
            dropped.push({ rank, reason: 'duplicate-url', raw });
            return;
        }
        seen.add(url);
        results.push({
            url,
            title: pickString(raw, ['title', 'name']) || '',
            snippet: pickString(raw, ['snippet', 'text', 'content', 'description', 'summary']) || '',
            date: pickString(raw, ['date', 'publishedDate', 'published_date', 'publishedAt', 'published_at']) || null,
            rank: results.length + 1,
            raw,
        });
    });

    return {
        schemaVersion: 'search-results-v1',
        backend,
        query,
        results,
        dropped,
        resultRole: 'url-candidates',
        evidencePolicy: 'snippets-are-not-final-evidence',
    };
}

/**
 * @param {unknown} input
 * @returns {unknown[]}
 */
function extractRows(input) {
    if (Array.isArray(input)) return input;
    if (!isRecord(input)) return [];
    const candidates = [
        input.results,
        input.data,
        input.items,
        isRecord(input.web) ? input.web.results : undefined,
        input.organic,
    ];
    for (const rows of candidates) {
        if (Array.isArray(rows)) return rows;
    }
    return [];
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} keys
 */
function pickString(row, keys) {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

/**
 * @param {string} value
 */
function normalizeUrl(value) {
    if (!value) return null;
    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 */
function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
