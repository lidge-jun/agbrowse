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
        const body = await readTextWithLimit(response, maxBytes);
        if (!body.ok) {
            return blockedResult(current, response.status, contentType, headers, 'body-exceeds-max-bytes');
        }
        const text = body.text;
        return {
            ok: response.ok,
            status: response.status,
            finalUrl: current,
            contentType,
            text,
            headers: redactHeaders(headers),
            evidence: [`http-${response.status}`, contentType || 'unknown-content-type', body.streamed ? 'stream-limited' : null].filter(Boolean),
            warnings: body.warning ? [body.warning] : [],
        };
    }
    return blockedResult(current, 0, '', {}, 'redirect-limit-exceeded');
}

/**
 * @param {Response} response
 * @param {number} maxBytes
 */
async function readTextWithLimit(response, maxBytes) {
    const body = response.body;
    if (!body || typeof body.getReader !== 'function') {
        const text = await response.text();
        return {
            ok: Buffer.byteLength(text, 'utf8') <= maxBytes,
            text,
            streamed: false,
            warning: 'body-read-without-stream-limit',
        };
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const chunks = [];
    let bytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength || 0;
        if (bytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return { ok: false, text: '', streamed: true, warning: null };
        }
        chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return { ok: true, text: chunks.join(''), streamed: true, warning: null };
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
