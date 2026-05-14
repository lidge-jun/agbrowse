// @ts-check

import net from 'node:net';

export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_REDIRECT_LIMIT = 5;

const SENSITIVE_QUERY_KEYS = new Set([
    'access_token',
    'api_key',
    'apikey',
    'auth',
    'code',
    'key',
    'password',
    'secret',
    'session',
    'sig',
    'signature',
    'token',
]);

const SENSITIVE_HEADER_KEYS = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
]);

export class AdaptiveFetchInputError extends Error {
    /**
     * @param {string} message
     * @param {{ code?: string, url?: string }} [details]
     */
    constructor(message, details = {}) {
        super(message);
        this.name = 'AdaptiveFetchInputError';
        this.code = details.code || 'invalid-url';
        this.url = details.url || null;
    }
}

/**
 * @param {string} rawUrl
 * @param {{ allowPrivateNetwork?: boolean }} [options]
 */
export function validateFetchUrl(rawUrl, options = {}) {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
        throw new AdaptiveFetchInputError('fetch requires a URL', { code: 'missing-url' });
    }
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    } catch {
        throw new AdaptiveFetchInputError(`invalid URL: ${rawUrl}`, { code: 'invalid-url', url: rawUrl });
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new AdaptiveFetchInputError(`unsupported URL scheme: ${parsed.protocol}`, {
            code: 'unsupported-scheme',
            url: redactTraceValue(parsed.href),
        });
    }
    if (parsed.username || parsed.password) {
        throw new AdaptiveFetchInputError('credential-bearing URLs are not allowed', {
            code: 'credential-url',
            url: redactTraceValue(parsed.href),
        });
    }
    if (!options.allowPrivateNetwork && isPrivateHostname(parsed.hostname)) {
        throw new AdaptiveFetchInputError(`private or local host is not allowed: ${parsed.hostname}`, {
            code: 'private-network',
            url: redactTraceValue(parsed.href),
        });
    }
    return parsed;
}

/**
 * @param {string} hostname
 */
export function isPrivateHostname(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
    const ipVersion = net.isIP(host);
    if (ipVersion === 4) return isPrivateIpv4(host);
    if (ipVersion === 6) return isPrivateIpv6(host);
    return false;
}

/**
 * @param {string} ip
 */
export function isPrivateIpv4(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
}

/**
 * @param {string} ip
 */
export function isPrivateIpv6(ip) {
    const normalized = ip.toLowerCase();
    return normalized === '::'
        || normalized === '::1'
        || normalized.startsWith('fc')
        || normalized.startsWith('fd')
        || normalized.startsWith('fe80:')
        || normalized.startsWith('ff');
}

/**
 * @param {unknown} value
 */
export function redactTraceValue(value) {
    if (typeof value !== 'string') return value;
    let text = value;
    try {
        const parsed = new URL(text);
        for (const key of [...parsed.searchParams.keys()]) {
            if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.set(key, '[redacted]');
        }
        parsed.username = parsed.username ? '[redacted]' : '';
        parsed.password = parsed.password ? '[redacted]' : '';
        text = parsed.href;
    } catch {
        // Not a URL; apply token-pattern redaction below.
    }
    return text
        .replace(/(bearer\s+)[a-z0-9._~+/=-]+/ig, '$1[redacted]')
        .replace(/\b(access_token|api_key|apikey|auth|password|secret|session|token)=([^&\s]+)/ig, '$1=[redacted]');
}

/**
 * @param {Record<string, unknown>} headers
 */
export function redactHeaders(headers = {}) {
    /** @type {Record<string, unknown>} */
    const redacted = {};
    for (const [key, value] of Object.entries(headers)) {
        redacted[key] = SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? '[redacted]' : redactTraceValue(value);
    }
    return redacted;
}

