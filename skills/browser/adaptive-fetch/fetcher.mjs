// @ts-check

import { DEFAULT_MAX_BYTES, DEFAULT_REDIRECT_LIMIT, DEFAULT_TIMEOUT_MS, redactHeaders, validateFetchUrl } from './safety.mjs';
import { isTextualContentType } from './transforms.mjs';

/**
 * @param {string} rawUrl
 * @param {{ maxBytes?: number, timeoutMs?: number, redirectLimit?: number, allowPrivateNetwork?: boolean, fetchImpl?: typeof fetch }} [options]
 */
export async function fetchTextCandidate(rawUrl, options = {}) {
    const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
    const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    const redirectLimit = Number(options.redirectLimit ?? DEFAULT_REDIRECT_LIMIT);
    const fetchImpl = options.fetchImpl || fetch;
    let current = validateFetchUrl(rawUrl, { allowPrivateNetwork: options.allowPrivateNetwork }).href;
    for (let redirects = 0; redirects <= redirectLimit; redirects += 1) {
        const response = await fetchImpl(current, {
            redirect: 'manual',
            headers: { accept: 'text/html,application/json,application/xml,text/plain,*/*;q=0.8' },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
            const next = new URL(response.headers.get('location') || '', current);
            current = validateFetchUrl(next.href, { allowPrivateNetwork: options.allowPrivateNetwork }).href;
            continue;
        }
        const contentType = response.headers.get('content-type') || '';
        const contentLength = Number(response.headers.get('content-length') || 0);
        const headers = Object.fromEntries(response.headers.entries());
        if (!isTextualContentType(contentType)) {
            return blockedResult(current, response.status, contentType, headers, 'unsupported-content-type');
        }
        if (contentLength > maxBytes) {
            return blockedResult(current, response.status, contentType, headers, 'content-length-exceeds-max-bytes');
        }
        const text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > maxBytes) {
            return blockedResult(current, response.status, contentType, headers, 'body-exceeds-max-bytes');
        }
        return {
            ok: response.ok,
            status: response.status,
            finalUrl: current,
            contentType,
            text,
            headers: redactHeaders(headers),
            evidence: [`http-${response.status}`, contentType || 'unknown-content-type'],
            warnings: [],
        };
    }
    return blockedResult(current, 0, '', {}, 'redirect-limit-exceeded');
}

/**
 * @param {string} finalUrl
 * @param {number} status
 * @param {string} contentType
 * @param {Record<string, unknown>} headers
 * @param {string} reason
 */
function blockedResult(finalUrl, status, contentType, headers, reason) {
    return {
        ok: false,
        status,
        finalUrl,
        contentType,
        text: '',
        headers: redactHeaders(headers),
        evidence: [reason],
        warnings: [reason],
    };
}

