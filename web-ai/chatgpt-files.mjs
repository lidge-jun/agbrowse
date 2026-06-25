// @ts-check
/**
 * Generic ChatGPT downloadable-file artifact capture.
 *
 * Separate from code-mode ZIP retrieval (`code-artifact.mjs`, which is
 * conversation-JSON + `/mnt/data/*.zip` + plan-file contract oriented) and from
 * generated-image capture (`chatgpt-images.mjs`). This module owns generic
 * assistant-turn downloadable files (CSV/PDF/ZIP/wheel/sdist/...).
 *
 * Trust boundary: the browser DOM (assistant turn) provides untrusted URLs.
 * Only known ChatGPT file endpoints on the ChatGPT origin are accepted; path
 * traversal, foreign hosts, non-HTTPS, ports, and unsafe schemes are rejected.
 * See devlog/_plan/260608_oracle_stability_gap/31_chatgpt_downloadable_artifacts_pabcd.md
 */

/** Hosts that may serve ChatGPT downloadable files. */
const ALLOWED_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

/** Default origin used to resolve relative download hrefs. */
const DEFAULT_ORIGIN = 'https://chatgpt.com';

/** `/backend-api/files/<id>/download` or `/content` (id is opaque, charset-limited). */
const FILES_PATH = /^\/backend-api\/files\/[A-Za-z0-9_-]+\/(download|content)$/;

/**
 * A literal null byte or backslash is never legitimate in a ChatGPT file URL or
 * sandbox path; both are common traversal/smuggling primitives.
 * @param {string} s
 * @returns {boolean}
 */
function hasUnsafeChars(s) {
    return s.includes('\0') || s.includes('\\');
}

/**
 * Percent-decode without throwing on malformed input.
 * @param {string} s
 * @returns {string}
 */
function safeDecode(s) {
    try {
        return decodeURIComponent(s);
    } catch {
        return s;
    }
}

/**
 * True if a `..` path-traversal segment appears in the raw or decoded value.
 * @param {string} s
 * @returns {boolean}
 */
function containsTraversal(s) {
    if (typeof s !== 'string') return true;
    return s.includes('..') || safeDecode(s).includes('..');
}

/**
 * Validate a `/mnt/data/...` sandbox path (decoded value from a `path` query or
 * a `sandbox:` URL). Must live under `/mnt/data/` with no traversal.
 * @param {string} p
 * @returns {boolean}
 */
function isSafeSandboxPath(p) {
    if (typeof p !== 'string' || p === '') return false;
    if (hasUnsafeChars(p) || containsTraversal(p)) return false;
    return p.startsWith('/mnt/data/');
}

/**
 * Validate a parsed ChatGPT URL against the known downloadable-file endpoints.
 * @param {URL} u
 * @returns {boolean}
 */
function isAllowedFileEndpoint(u) {
    const p = u.pathname;
    if (p === '/backend-api/sandbox/download') {
        const pathParam = u.searchParams.get('path');
        return pathParam !== null && isSafeSandboxPath(pathParam);
    }
    if (FILES_PATH.test(p)) return true;
    if (p === '/backend-api/estuary/content') {
        const id = u.searchParams.get('id');
        return id !== null && /^file_[A-Za-z0-9_-]+$/.test(id);
    }
    return false;
}

/**
 * Convert a safe `sandbox:/mnt/data/...` reference into an absolute ChatGPT
 * sandbox download URL. Returns `null` for anything unsafe or non-sandbox.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeChatGptSandboxUrl(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw.toLowerCase().startsWith('sandbox:')) return null;
    const p = raw.slice('sandbox:'.length);
    if (!isSafeSandboxPath(p)) return null;
    const u = new URL('/backend-api/sandbox/download', DEFAULT_ORIGIN);
    u.searchParams.set('path', p);
    return u.toString();
}

/**
 * Normalize and validate a ChatGPT downloadable-file URL from the DOM. Accepts
 * absolute `https://chatgpt.com|chat.openai.com` URLs, root-relative paths
 * (resolved on the ChatGPT origin), and `sandbox:/mnt/data/...` references.
 * Returns the canonical absolute URL string, or `null` if it is not a known,
 * safe ChatGPT file endpoint.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeChatGptFileDownloadUrl(value) {
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (raw === '' || hasUnsafeChars(raw)) return null;
    if (raw.toLowerCase().startsWith('sandbox:')) return normalizeChatGptSandboxUrl(raw);

    let u;
    try {
        u = raw.startsWith('/') ? new URL(raw, DEFAULT_ORIGIN) : new URL(raw);
    } catch {
        return null;
    }
    if (u.protocol !== 'https:') return null;
    if (!ALLOWED_HOSTS.has(u.hostname)) return null;
    if (u.port !== '') return null;
    if (containsTraversal(u.pathname)) return null;
    if (!isAllowedFileEndpoint(u)) return null;
    return u.toString();
}
