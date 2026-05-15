// @ts-check

import net from 'node:net';
import dns from 'node:dns/promises';

export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;
export const DEFAULT_REDIRECT_LIMIT = 5;

const SENSITIVE_QUERY_KEYS = new Set([
    'access_token',
    'api_key',
    'apikey',
    'auth',
    'auth_token',
    'authorization',
    'awsaccesskeyid',
    'client_secret',
    'code',
    'credential',
    'credentials',
    'key',
    'password',
    'passwd',
    'secret',
    'session',
    'session_id',
    'sig',
    'signature',
    'token',
    'x_amz_security_token',
    'x_amz_signature',
    'jwt',
]);

const SENSITIVE_HEADER_KEYS = new Set([
    'authorization',
    'cookie',
    'proxy-authorization',
    'set-cookie',
    'x-api-key',
    'x-auth-token',
]);

const SPECIAL_USE_IPV6_CIDRS = [
    ['::', 128],
    ['::1', 128],
    ['::ffff:0:0', 96],
    ['64:ff9b::', 96],
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['100:0:0:1::', 64],
    ['2001::', 23],
    ['2001:2::', 48],
    ['2001:10::', 28],
    ['2001:20::', 28],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['2620:4f:8000::', 48],
    ['3fff::', 20],
    ['5f00::', 16],
    ['fc00::', 7],
    ['fe80::', 10],
    ['fec0::', 10],
    ['ff00::', 8],
];

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
    const mapped = ipv4FromMappedIpv6(normalized);
    if (mapped) return true;
    return SPECIAL_USE_IPV6_CIDRS.some(([base, bits]) => ipv6CidrContains(String(base), Number(bits), normalized));
}

/**
 * @param {string} ip
 */
function ipv4FromMappedIpv6(ip) {
    const dotted = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (dotted) return dotted[1];
    const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (!hex) return '';
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    if (![high, low].every(Number.isFinite)) return '';
    return [
        (high >> 8) & 255,
        high & 255,
        (low >> 8) & 255,
        low & 255,
    ].join('.');
}

/**
 * @param {string} base
 * @param {number} bits
 * @param {string} ip
 */
function ipv6CidrContains(base, bits, ip) {
    const baseValue = ipv6ToBigInt(base);
    const ipValue = ipv6ToBigInt(ip);
    if (baseValue === null || ipValue === null || bits < 0 || bits > 128) return true;
    if (bits === 0) return true;
    const shift = BigInt(128 - bits);
    return (baseValue >> shift) === (ipValue >> shift);
}

/**
 * @param {string} ip
 * @returns {bigint|null}
 */
function ipv6ToBigInt(ip) {
    const text = ip.toLowerCase();
    if (text.includes('.')) return null;
    const parts = text.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(':') : [];
    const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    const groups = [...head, ...Array(missing).fill('0'), ...tail];
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const group of groups) {
        if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
        const number = parseInt(group, 16);
        if (!Number.isInteger(number) || number < 0 || number > 0xffff) return null;
        value = (value << 16n) + BigInt(number);
    }
    return value;
}

/**
 * @param {string} hostname
 * @returns {Promise<void>}
 */
export async function dnsRebindingGuard(hostname) {
    const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (net.isIP(host)) return;
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
        throw new AdaptiveFetchInputError(`private or local host is not allowed: ${hostname}`, {
            code: 'private-network', url: hostname,
        });
    }
    const results = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)]);
    const addresses = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    if (addresses.length === 0) return;
    for (const addr of addresses) {
        const version = net.isIP(addr);
        const isPrivate = version === 4 ? isPrivateIpv4(addr) : version === 6 ? isPrivateIpv6(addr) : false;
        if (isPrivate) {
            throw new AdaptiveFetchInputError(
                `DNS rebinding: ${hostname} resolves to private IP ${addr}`,
                { code: 'dns-rebinding', url: hostname },
            );
        }
    }
}

/**
 * @param {string|URL} rawUrl
 */
export function hasSensitiveQueryParams(rawUrl) {
    const parsed = rawUrl instanceof URL ? rawUrl : new URL(String(rawUrl));
    for (const key of parsed.searchParams.keys()) {
        if (isSensitiveQueryKey(key)) return true;
    }
    return false;
}

/**
 * @param {string|URL} rawUrl
 */
export function validateThirdPartyReaderTarget(rawUrl) {
    const parsed = validateFetchUrl(String(rawUrl), { allowPrivateNetwork: false });
    if (hasSensitiveQueryParams(parsed)) {
        throw new AdaptiveFetchInputError('third-party reader target contains sensitive query parameters', {
            code: 'sensitive-query',
            url: redactTraceValue(parsed.href),
        });
    }
    return parsed;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function redactTraceValue(value) {
    if (typeof value !== 'string') return value === undefined || value === null ? '' : String(value);
    let text = value;
    try {
        const parsed = new URL(text);
        for (const key of [...parsed.searchParams.keys()]) {
            if (isSensitiveQueryKey(key)) parsed.searchParams.set(key, '[redacted]');
        }
        parsed.username = parsed.username ? '[redacted]' : '';
        parsed.password = parsed.password ? '[redacted]' : '';
        text = parsed.href;
    } catch {
        // Not a URL; apply token-pattern redaction below.
    }
    return text
        .replace(/(bearer\s+)[a-z0-9._~+/=-]+/ig, '$1[redacted]')
        .replace(/\b(access_token|api_key|apikey|auth|auth_token|password|passwd|secret|session|session_id|sig|signature|token|jwt|x-amz-security-token|x-amz-signature|awsaccesskeyid|client_secret)=([^&\s]+)/ig, '$1=[redacted]');
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

/**
 * @param {string} key
 */
function isSensitiveQueryKey(key) {
    const normalized = String(key)
        .toLowerCase()
        .replace(/\[\]$/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return SENSITIVE_QUERY_KEYS.has(normalized)
        || /\b(token|secret|password|passwd|signature|credential|session|jwt|authorization)\b/.test(normalized)
        || /(^|_)api_?key($|_)/.test(normalized)
        || /(^|_)access_?key_?id($|_)/.test(normalized)
        || /(^|_)auth(_|$)/.test(normalized)
        || /(^|_)sig($|_)/.test(normalized);
}
