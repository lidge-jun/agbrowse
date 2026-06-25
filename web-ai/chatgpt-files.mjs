// @ts-check
import { trySaveFileArtifact, appendArtifactRecord } from './session-artifacts.mjs';

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
 * See devlog/_fin/260608_oracle_stability_gap/31_chatgpt_downloadable_artifacts_pabcd.md
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

/* ── Assistant-turn DOM scan ─────────────────────────────────────────── */

// Mirrors chatgpt-images.mjs assistant-turn selectors. Kept in sync; a shared
// selector module is a deliberate future cleanup once a third consumer appears
// (blast-radius limit: this slice stays within chatgpt-files.mjs).
const CONVERSATION_TURN_SELECTOR = 'article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"], section[data-testid^="conversation-turn"]';
const ASSISTANT_ROOT_SELECTOR = '[data-message-author-role="assistant"], [data-turn="assistant"], [data-testid*="assistant" i]';

const FILENAME_FALLBACK_PREFIX = 'chatgpt-file';

/**
 * Build the in-page expression that harvests candidate download anchors from
 * assistant turns after `baselineAssistantCount`. The page only collects raw
 * hrefs; endpoint allowlisting happens in Node via `dedupeDownloadCandidates`.
 * @param {number} [baselineAssistantCount]
 * @returns {string}
 */
export function buildDownloadableFileDetectionExpression(baselineAssistantCount = 0) {
    const minIdx = Number.isFinite(Number(baselineAssistantCount))
        ? Math.max(0, Math.floor(Number(baselineAssistantCount)))
        : 0;
    return `(() => {
        const MIN_ASSISTANT_INDEX = ${minIdx};
        const CONVERSATION_SELECTOR = ${JSON.stringify(CONVERSATION_TURN_SELECTOR)};
        const ASSISTANT_SELECTOR = ${JSON.stringify(ASSISTANT_ROOT_SELECTOR)};
        const isAssistantTurn = (node) => {
            if (!(node instanceof HTMLElement)) return false;
            if (String(node.getAttribute('data-turn') || '').toLowerCase() === 'assistant') return true;
            if (String(node.getAttribute('data-message-author-role') || '').toLowerCase() === 'assistant') return true;
            if (String(node.getAttribute('data-testid') || '').toLowerCase().includes('assistant')) return true;
            return Boolean(node.querySelector(ASSISTANT_SELECTOR));
        };
        const pushUniqueRoot = (roots, node) => {
            if (!(node instanceof HTMLElement)) return;
            if (roots.some(root => root === node || root.contains(node))) return;
            for (let i = roots.length - 1; i >= 0; i -= 1) {
                if (node.contains(roots[i])) roots.splice(i, 1);
            }
            roots.push(node);
        };
        const roots = [];
        for (const node of document.querySelectorAll(CONVERSATION_SELECTOR)) {
            if (isAssistantTurn(node)) pushUniqueRoot(roots, node);
        }
        for (const node of document.querySelectorAll(ASSISTANT_SELECTOR)) {
            if (isAssistantTurn(node)) pushUniqueRoot(roots, node);
        }
        roots.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1);
        const relevant = roots.slice(MIN_ASSISTANT_INDEX);
        const out = [];
        for (const msg of relevant) {
            for (const a of msg.querySelectorAll('a[href], a[download]')) {
                const href = a.getAttribute('href') || '';
                if (!href) continue;
                out.push({
                    href,
                    download: a.getAttribute('download') || '',
                    text: String(a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
                });
            }
        }
        return out;
    })()`;
}

/**
 * Deduplicate raw download candidates by their normalized ChatGPT file URL.
 * Candidates whose href is not an allowed ChatGPT file endpoint are dropped.
 * @param {Array<{ href?: string, download?: string, text?: string }>} candidates
 * @returns {Array<{ sourceUrl: string, download: string, text: string }>}
 */
export function dedupeDownloadCandidates(candidates) {
    const seen = new Set();
    const out = [];
    for (const c of Array.isArray(candidates) ? candidates : []) {
        const sourceUrl = normalizeChatGptFileDownloadUrl(c?.href);
        if (!sourceUrl || seen.has(sourceUrl)) continue;
        seen.add(sourceUrl);
        out.push({ sourceUrl, download: String(c?.download || ''), text: String(c?.text || '') });
    }
    return out;
}

/**
 * Reduce an arbitrary candidate filename to a safe basename (no directory, no
 * traversal, no control/reserved characters).
 * @param {unknown} name
 * @returns {string}
 */
export function sanitizeDownloadFilename(name) {
    if (typeof name !== 'string') return '';
    const base = (name.split(/[\\/]/).pop() || '').replace(/\0/g, '');
    const cleaned = base.replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
    return cleaned === '' || cleaned === '.' ? '' : cleaned;
}

/**
 * Extract a filename from a `Content-Disposition` header (RFC 5987 `filename*`
 * preferred, then plain `filename`). Returns a sanitized basename or `null`.
 * @param {unknown} headerValue
 * @returns {string|null}
 */
export function filenameFromContentDisposition(headerValue) {
    if (typeof headerValue !== 'string' || headerValue === '') return null;
    const star = headerValue.match(/filename\*\s*=\s*(?:UTF-8'[^']*')?([^;]+)/i);
    if (star) {
        try {
            const safe = sanitizeDownloadFilename(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')));
            if (safe) return safe;
        } catch { /* fall through to plain filename */ }
    }
    const plain = headerValue.match(/filename\s*=\s*"?([^";]+)"?/i);
    if (plain) {
        const safe = sanitizeDownloadFilename(plain[1].trim());
        if (safe) return safe;
    }
    return null;
}

/**
 * Derive a basename from a download URL (sandbox `path` param, else the path
 * tail — but never the generic `download`/`content` verbs).
 * @param {unknown} url
 * @returns {string}
 */
function filenameFromUrl(url) {
    if (typeof url !== 'string') return '';
    try {
        const u = new URL(url);
        const sandboxPath = u.searchParams.get('path');
        if (sandboxPath) return sanitizeDownloadFilename(sandboxPath.split('/').pop() || '');
        const last = u.pathname.split('/').filter(Boolean).pop() || '';
        if (last === 'download' || last === 'content') return '';
        return sanitizeDownloadFilename(last);
    } catch {
        return '';
    }
}

/**
 * Resolve the saved filename, preferring Content-Disposition, then the DOM
 * `download` attribute, then the URL basename, then `chatgpt-file-N[.ext]`.
 * @param {{ contentDisposition?: string|null, downloadAttr?: string, sourceUrl?: string, index?: number }} [opts]
 * @returns {string}
 */
export function resolveDownloadFilename({ contentDisposition, downloadAttr, sourceUrl, index = 0 } = {}) {
    const fromCd = filenameFromContentDisposition(contentDisposition);
    if (fromCd) return fromCd;
    const fromAttr = sanitizeDownloadFilename(downloadAttr || '');
    if (fromAttr) return fromAttr;
    const fromUrl = filenameFromUrl(sourceUrl);
    if (fromUrl) return fromUrl;
    // No basename in the URL (e.g. files/<id>/download). The extension is added
    // by the caller from the response Content-Type at save time.
    return `${FILENAME_FALLBACK_PREFIX}-${index + 1}`;
}

/**
 * Scan assistant turns after the baseline and return deduped, allowlisted
 * download candidates. Mirrors chatgpt-images.mjs detection (CDP
 * `Runtime.evaluate`); endpoint filtering is enforced in Node.
 * @param {{ send: Function }} cdpSession
 * @param {{ baselineAssistantCount?: number }} [opts]
 * @returns {Promise<Array<{ sourceUrl: string, download: string, text: string }>>}
 */
export async function readAssistantDownloadableFiles(cdpSession, { baselineAssistantCount = 0 } = {}) {
    const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: buildDownloadableFileDetectionExpression(baselineAssistantCount),
        returnByValue: true,
    });
    const value = result?.value;
    let raw;
    try {
        raw = Array.isArray(value) ? value : JSON.parse(value);
    } catch {
        return [];
    }
    return dedupeDownloadCandidates(Array.isArray(raw) ? raw : []);
}

/* ── Sequential download + save ──────────────────────────────────────── */

const DOWNLOAD_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DEFAULT_PER_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * Read the ChatGPT cookie header for authenticated downloads via CDP.
 * @param {{ send: Function }} cdpSession
 * @returns {Promise<string>}
 */
async function getChatGptCookieHeader(cdpSession) {
    try {
        const { cookies } = await cdpSession.send('Network.getCookies', { urls: ['https://chatgpt.com/'] });
        return (/** @type {{ name: string, value: string }[]} */ (cookies || []))
            .map((c) => `${c.name}=${c.value}`)
            .join('; ');
    } catch {
        return '';
    }
}

/**
 * Fetch one download with a hard timeout. Distinguishes a timeout (so the caller
 * can stop attributing later completions) from an ordinary fetch failure.
 * @param {string} url
 * @param {string} cookieHeader
 * @param {number} timeoutMs
 * @returns {Promise<{ buffer: Buffer, mimeType: string, contentDisposition: string|null } | { timedOut: true } | { failed: true }>}
 */
async function fetchDownload(url, cookieHeader, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            headers: { Cookie: cookieHeader, 'User-Agent': DOWNLOAD_USER_AGENT },
            redirect: 'follow',
            signal: controller.signal,
        });
        if (!resp.ok) return { failed: true };
        const contentDisposition = resp.headers.get('content-disposition');
        const mimeType = (resp.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
        const buffer = Buffer.from(await resp.arrayBuffer());
        return { buffer, mimeType, contentDisposition };
    } catch (err) {
        if (/** @type {any} */ (err)?.name === 'AbortError') return { timedOut: true };
        return { failed: true };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Capture generic downloadable files from the current assistant turn and persist
 * them as `kind:'file'` session artifacts. Downloads run sequentially; once one
 * times out, attribution stops so a late completion is never attached to the
 * next candidate.
 * @param {{ send: Function }} cdpSession
 * @param {object} _deps  reserved for parity with sibling capture modules
 * @param {{ sessionId?: string|null, baselineAssistantCount?: number, perDownloadTimeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, files: import('./session-artifacts.mjs').ArtifactDescriptor[], warnings: string[] }>}
 */
export async function saveAssistantDownloadableFiles(cdpSession, _deps, {
    sessionId = null,
    baselineAssistantCount = 0,
    perDownloadTimeoutMs = DEFAULT_PER_DOWNLOAD_TIMEOUT_MS,
} = {}) {
    const candidates = await readAssistantDownloadableFiles(cdpSession, { baselineAssistantCount });
    if (!candidates.length) return { ok: true, files: [], warnings: [] };
    if (!sessionId) return { ok: true, files: [], warnings: ['file-artifact-no-session'] };

    const cookieHeader = await getChatGptCookieHeader(cdpSession);
    /** @type {import('./session-artifacts.mjs').ArtifactDescriptor[]} */
    const files = [];
    const warnings = [];
    let attributionStopped = false;

    for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        if (attributionStopped) {
            warnings.push(`file-artifact-skipped-after-timeout:${c.sourceUrl}`);
            continue;
        }
        const got = await fetchDownload(c.sourceUrl, cookieHeader, perDownloadTimeoutMs);
        if ('timedOut' in got) {
            attributionStopped = true;
            warnings.push(`file-artifact-timeout:${c.sourceUrl}`);
            continue;
        }
        if ('failed' in got) {
            warnings.push(`file-artifact-fetch-failed:${c.sourceUrl}`);
            continue;
        }
        const filename = resolveDownloadFilename({
            contentDisposition: got.contentDisposition,
            downloadAttr: c.download,
            sourceUrl: c.sourceUrl,
            index: i,
        });
        const res = trySaveFileArtifact(sessionId, {
            filename,
            buffer: got.buffer,
            mimeType: got.mimeType,
            sourceUrl: c.sourceUrl,
        });
        if (!res.ok) {
            warnings.push(`file-artifact-save-failed:${res.stage}`);
            continue;
        }
        appendArtifactRecord(sessionId, res.descriptor);
        files.push(res.descriptor);
    }
    return { ok: true, files, warnings };
}
