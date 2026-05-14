// @ts-check

import { extractMetadataFromHtml } from './metadata.mjs';
import { htmlToReadableText, isHtmlContentType, normalizeWhitespace } from './transforms.mjs';

/**
 * @param {any} fetched
 * @param {{ source?: string, label?: string }} [context]
 */
export function fromFetchResult(fetched, context = {}) {
    const source = context.source || 'fetch';
    const isHtml = isHtmlContentType(fetched.contentType || '');
    const metadata = isHtml ? extractMetadataFromHtml(fetched.text || '', fetched.finalUrl || '') : null;
    const text = isHtml ? metadata.text : normalizeWhitespace(fetched.text || '');
    return {
        source,
        label: context.label || source,
        finalUrl: fetched.finalUrl || '',
        title: metadata?.title || '',
        text,
        contentType: fetched.contentType || '',
        status: Number(fetched.status || 0),
        ok: Boolean(fetched.ok),
        metadata: metadata?.metadata || null,
        evidence: [...(fetched.evidence || []), ...(metadata?.evidence || [])],
        warnings: fetched.warnings || [],
        rawTextLength: String(fetched.text || '').length,
    };
}

/**
 * @param {any} result
 */
export function fromMetadataResult(result) {
    return normalizeReaderCandidate({
        source: 'metadata',
        label: 'metadata',
        finalUrl: result.finalUrl,
        title: result.title,
        text: result.text,
        contentType: 'text/html',
        status: 200,
        ok: true,
        metadata: result.metadata || null,
        evidence: result.evidence || [],
        warnings: result.warnings || [],
    });
}

/**
 * @param {any} result
 */
export function fromPublicEndpointResult(result) {
    return normalizeReaderCandidate({ ...result, source: 'public_endpoint', label: result.label || 'public_endpoint' });
}

/**
 * @param {any} result
 */
export function fromBrowserResult(result) {
    return normalizeReaderCandidate({ ...result, source: 'browser', label: result.label || 'browser' });
}

/**
 * @param {any} result
 */
export function fromNetworkCandidate(result) {
    return normalizeReaderCandidate({ ...result, source: 'network_api', label: result.label || 'network_api' });
}

/**
 * @param {any[]} results
 */
export function normalizeReaderCandidates(results = []) {
    return results.map(normalizeReaderCandidate).filter(candidate => candidate.finalUrl || candidate.text);
}

/**
 * @param {any} result
 */
export function normalizeReaderCandidate(result = {}) {
    return {
        source: result.source || 'reader',
        label: result.label || result.source || 'reader',
        finalUrl: result.finalUrl || '',
        title: normalizeWhitespace(result.title || ''),
        text: normalizeWhitespace(result.text || ''),
        contentType: result.contentType || '',
        status: Number(result.status || 0),
        ok: result.ok !== false,
        metadata: result.metadata || null,
        evidence: Array.isArray(result.evidence) ? result.evidence.filter(Boolean) : [],
        warnings: Array.isArray(result.warnings) ? result.warnings.filter(Boolean) : [],
        rawTextLength: Number(result.rawTextLength || String(result.text || '').length),
    };
}

/**
 * @param {string} html
 * @param {string} finalUrl
 */
export function fromHtmlText(html, finalUrl) {
    return normalizeReaderCandidate({
        source: 'reader',
        finalUrl,
        title: '',
        text: htmlToReadableText(html),
        contentType: 'text/html',
        status: 200,
        ok: true,
    });
}

