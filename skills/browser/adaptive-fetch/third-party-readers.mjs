// @ts-check

import { fetchTextCandidate } from './fetcher.mjs';
import { validateFetchUrl } from './safety.mjs';

const JINA_READER_PREFIX = 'https://r.jina.ai/';

/**
 * @param {{ allowThirdPartyReader?: boolean }} [options]
 */
export function shouldUseThirdPartyReader(options = {}) {
    return Boolean(options.allowThirdPartyReader);
}

/**
 * @param {string} rawUrl
 */
export function buildJinaReaderUrl(rawUrl) {
    const target = validateFetchUrl(rawUrl, { allowPrivateNetwork: false });
    return `${JINA_READER_PREFIX}${target.href}`;
}

/**
 * @param {string} rawUrl
 * @param {{ allowThirdPartyReader?: boolean, maxBytes?: number, timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function fetchThirdPartyReaderCandidate(rawUrl, options = {}) {
    if (!shouldUseThirdPartyReader(options)) return null;
    const target = validateFetchUrl(rawUrl, { allowPrivateNetwork: false });
    const readerUrl = buildJinaReaderUrl(target.href);
    const fetched = await fetchTextCandidate(readerUrl, {
        maxBytes: options.maxBytes,
        timeoutMs: options.timeoutMs,
        allowPrivateNetwork: false,
        fetchImpl: options.fetchImpl,
    });
    return {
        ...fetched,
        finalUrl: target.href,
        readerUrl,
        contentType: fetched.contentType || 'text/plain',
        evidence: [...(fetched.evidence || []), 'third-party-reader:jina'],
        warnings: fetched.ok ? fetched.warnings : [...(fetched.warnings || []), 'third-party-reader-failed'],
    };
}

