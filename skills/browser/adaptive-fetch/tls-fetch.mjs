// @ts-check

// Parity catalog 203.1 (P1): TLS-impersonation fetch rung. cli-jaw's adaptive-fetch
// ladder spoofs the JA3/TLS fingerprint via curl-impersonate (chrome131/safari18/
// firefox133); agbrowse's anti-bot was header-only (waf-profiles), a real transport-
// layer gap. Reverse port of cli-jaw src/browser/adaptive-fetch/tls-fetch.ts.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateFetchUrl } from './safety.mjs';

const execFileAsync = promisify(execFile);

const PROFILES = /** @type {const} */ (['chrome131', 'safari18_0', 'firefox133']);

/** @type {string|null|undefined} */
let cachedBinary;

/**
 * Locate a curl-impersonate binary on PATH (cached). Returns null when none is installed.
 * @returns {Promise<string|null>}
 */
export async function detectCurlImpersonate() {
    if (cachedBinary !== undefined) return cachedBinary;
    for (const name of ['curl-impersonate-chrome', 'curl-impersonate', 'curl_chrome131']) {
        try {
            await execFileAsync('which', [name]);
            cachedBinary = name;
            return name;
        } catch { /* not found */ }
    }
    cachedBinary = null;
    return null;
}

/**
 * Deterministically pick an impersonation profile from the hostname so retries against
 * the same host stay consistent.
 * @param {string} url
 * @returns {typeof PROFILES[number]}
 */
export function selectProfile(url) {
    let hash = 0;
    const hostname = new URL(url).hostname;
    for (let i = 0; i < hostname.length; i++) hash = ((hash << 5) - hash + hostname.charCodeAt(i)) | 0;
    return PROFILES[Math.abs(hash) % PROFILES.length] ?? PROFILES[0];
}

/**
 * @typedef {Object} TlsFetchResult
 * @property {boolean} ok
 * @property {number} status
 * @property {Record<string,string>} headers
 * @property {string} body
 * @property {string} finalUrl
 * @property {typeof PROFILES[number]} profile
 */

/**
 * Fetch a URL through curl-impersonate (TLS/JA3 spoof). Returns null when the binary is
 * absent or the request fails. SSRF-guarded on both the initial and post-redirect URL.
 * @param {string} rawUrl
 * @param {{ timeoutMs?: number, maxBytes?: number, proxy?: string }} [options]
 * @returns {Promise<TlsFetchResult|null>}
 */
export async function tlsFetch(rawUrl, options = {}) {
    const binary = await detectCurlImpersonate();
    if (!binary) return null;

    const safeUrl = validateFetchUrl(rawUrl);
    const profile = selectProfile(safeUrl.href);
    const timeout = Math.ceil((options.timeoutMs || 15_000) / 1000);

    const EFFECTIVE_URL_SENTINEL = '\n__EFFECTIVE_URL__=';
    try {
        const args = [
            '--impersonate', profile,
            '--max-time', String(timeout),
            '--max-filesize', String(options.maxBytes || 5_000_000),
            '-L', '-s',
            '-i',
            '--write-out', EFFECTIVE_URL_SENTINEL + '%{url_effective}',
        ];
        if (options.proxy) args.push('--proxy', options.proxy);
        args.push(safeUrl.href);
        const { stdout } = await execFileAsync(binary, args, { timeout: (timeout + 5) * 1000, maxBuffer: 10_000_000 });

        let effectiveUrl = safeUrl.href;
        let rawOutput = stdout;
        const sentinelIdx = stdout.lastIndexOf(EFFECTIVE_URL_SENTINEL);
        if (sentinelIdx >= 0) {
            effectiveUrl = stdout.slice(sentinelIdx + EFFECTIVE_URL_SENTINEL.length).trim();
            rawOutput = stdout.slice(0, sentinelIdx);
        }

        const lastResponseSep = findLastResponseSeparator(rawOutput);
        const headerText = lastResponseSep.headerText;
        const body = lastResponseSep.body;
        const statusMatch = headerText.match(/HTTP\/\S+\s+(\d+)/);
        const status = statusMatch ? Number(statusMatch[1]) : 200;
        /** @type {Record<string,string>} */
        const headers = {};
        for (const line of headerText.split('\r\n').slice(1)) {
            const idx = line.indexOf(':');
            if (idx > 0) headers[line.slice(0, idx).toLowerCase().trim()] = line.slice(idx + 1).trim();
        }

        try {
            validateFetchUrl(effectiveUrl, { allowPrivateNetwork: false });
        } catch {
            return null;
        }

        return { ok: status >= 200 && status < 400, status, headers, body, finalUrl: effectiveUrl, profile };
    } catch {
        return null;
    }
}

/**
 * @typedef {Object} TlsFetchCandidate
 * @property {boolean} ok
 * @property {number} status
 * @property {string} finalUrl
 * @property {string} contentType
 * @property {string} text
 * @property {Record<string,string>} headers
 * @property {string[]} evidence
 * @property {string[]} warnings
 * @property {typeof PROFILES[number]} profile
 */

/**
 * Ladder-shaped adapter: returns a fetchTextCandidate-compatible result (plus `profile`)
 * so the fetch ladder can drop a TLS-impersonation result straight into its candidate flow.
 * @param {string} rawUrl
 * @param {{ timeoutMs?: number, maxBytes?: number, proxy?: string }} [options]
 * @returns {Promise<TlsFetchCandidate|null>}
 */
export async function tlsFetchCandidate(rawUrl, options = {}) {
    const result = await tlsFetch(rawUrl, options);
    if (!result) return null;
    return {
        ok: result.ok,
        status: result.status,
        finalUrl: result.finalUrl,
        contentType: result.headers['content-type'] || '',
        text: result.body,
        headers: result.headers,
        evidence: [`tls-fetch:${result.profile}`],
        warnings: [],
        profile: result.profile,
    };
}

/**
 * When curl -L -i follows redirects, each hop's headers+body are concatenated.
 * This finds the LAST HTTP response boundary so we parse the final response's
 * headers and body, not an intermediate 3xx.
 * @param {string} raw
 * @returns {{ headerText: string, body: string }}
 */
function findLastResponseSeparator(raw) {
    let lastSep = -1;
    let searchFrom = 0;
    while (true) {
        const idx = raw.indexOf('\r\n\r\n', searchFrom);
        if (idx < 0) break;
        const after = raw.slice(idx + 4);
        if (after.startsWith('HTTP/')) {
            lastSep = idx;
            searchFrom = idx + 4;
        } else {
            return { headerText: raw.slice(lastSep >= 0 ? lastSep + 4 : 0, idx), body: after };
        }
    }
    if (lastSep >= 0) {
        const finalPart = raw.slice(lastSep + 4);
        const sep2 = finalPart.indexOf('\r\n\r\n');
        if (sep2 >= 0) return { headerText: finalPart.slice(0, sep2), body: finalPart.slice(sep2 + 4) };
    }
    return { headerText: '', body: raw };
}
