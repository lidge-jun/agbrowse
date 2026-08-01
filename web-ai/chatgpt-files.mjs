// @ts-check
import { createHash } from 'node:crypto';
import {
    artifactStillOnDisk,
    commitStagedArtifacts,
    discardStagedArtifacts,
    stageFileArtifact,
    trySaveFileArtifact,
    appendArtifactRecord,
} from './session-artifacts.mjs';
import { readSessionAsync } from './session-store.mjs';

/**
 * Identity of one download candidate within one assistant turn.
 *
 * Keyed on the turn as well as the URL: the same sandbox path in a later turn
 * is a DIFFERENT file, and reusing the earlier artifact for it would return
 * stale bytes as if they were fresh.
 *
 * @param {string} sessionId
 * @param {number} baselineAssistantCount
 * @param {string} sourceUrl
 * @returns {string}
 */
export function candidateKeyFor(sessionId, baselineAssistantCount, sourceUrl) {
    return createHash('sha256')
        .update(`${sessionId}\u0000${baselineAssistantCount}\u0000${String(sourceUrl || '')}`)
        .digest('hex')
        .slice(0, 32);
}

/**
 * Identity of a whole capture batch.
 *
 * @param {string} sessionId
 * @param {number} baselineAssistantCount
 * @param {string[]} candidateKeys
 * @returns {string}
 */
export function transactionKeyFor(sessionId, baselineAssistantCount, candidateKeys) {
    return createHash('sha256')
        .update(`${sessionId}\u0000${baselineAssistantCount}\u0000${[...candidateKeys].sort().join(',')}`)
        .digest('hex')
        .slice(0, 32);
}

/**
 * Redact sensitive parts of a URL for safe diagnostic output.
 * Strips query strings, fragments, credentials, and opaque file IDs.
 * @param {string|URL} url
 * @returns {string}
 */
function safeDiagnosticUrl(url) {
    try {
        const u = typeof url === 'string' ? new URL(url) : url;
        // Strip opaque file IDs from ChatGPT file endpoint paths (e.g. /files/file_abc123/...)
        const safePath = u.pathname.replace(/\/(file[_-])[a-zA-Z0-9]+/g, '/$1[id]');
        return `${u.protocol}//${u.host}${safePath}`;
    } catch {
        // sandbox:/mnt/data/... or malformed — strip after any ? or #
        return String(url || '').split(/[?#]/)[0].replace(/\/(file[_-])[a-zA-Z0-9]+/g, '/$1[id]') || '[invalid-url]';
    }
}

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
    const base = (name.split(/[\\/]/).pop() || '').replace(/\0/g, '').replace(/\.crdownload$/i, '');
    const cleaned = base.replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
    return cleaned === '' || cleaned === '.' || cleaned === '..' ? '' : cleaned;
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
    const outcome = await probeAssistantDownloadableFiles(cdpSession, { baselineAssistantCount });
    return outcome.ok ? outcome.candidates : [];
}

/**
 * Detection with the read failure kept SEPARATE from "no files".
 *
 * `readAssistantDownloadableFiles` collapses both to `[]`, which is fine for
 * the opportunistic path but cannot support a require-all contract: refusing to
 * save is indistinguishable from there being nothing to save.
 *
 * @param {{ send: Function }} cdpSession
 * @param {{ baselineAssistantCount?: number }} [opts]
 * @returns {Promise<{ ok: true, candidates: Array<{ sourceUrl: string, download: string, text: string }> }
 *   | { ok: false, reason: 'cdp-failed'|'malformed' }>}
 */
export async function probeAssistantDownloadableFiles(cdpSession, { baselineAssistantCount = 0 } = {}) {
    let result;
    try {
        ({ result } = await cdpSession.send('Runtime.evaluate', {
            expression: buildDownloadableFileDetectionExpression(baselineAssistantCount),
            returnByValue: true,
        }));
    } catch {
        return { ok: false, reason: 'cdp-failed' };
    }
    const value = result?.value;
    let raw;
    try {
        raw = Array.isArray(value) ? value : JSON.parse(value);
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (!Array.isArray(raw)) return { ok: false, reason: 'malformed' };
    return { ok: true, candidates: dedupeDownloadCandidates(raw) };
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
 * @returns {Promise<{ buffer: Buffer, mimeType: string, contentDisposition: string|null } | { timedOut: true } | { failed: true, status?: number, reason: 'http-error'|'timeout'|'fetch-error' }>}
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
        if (!resp.ok) return { failed: true, status: resp.status, reason: 'http-error' };
        const contentDisposition = resp.headers.get('content-disposition');
        const mimeType = (resp.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
        const buffer = Buffer.from(await resp.arrayBuffer());
        return { buffer, mimeType, contentDisposition };
    } catch (err) {
        if (/** @type {any} */ (err)?.name === 'AbortError') return { timedOut: true };
        return { failed: true, reason: /** @type {any} */ (err)?.name === 'AbortError' ? 'timeout' : 'fetch-error' };
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
 * When `strict` is set the caller ASKED for these files, so every step reports
 * a verdict instead of a warning, and a partial batch is rolled back rather
 * than left half-published.
 *
 * @param {{ send: Function }} cdpSession
 * @param {object} _deps  reserved for parity with sibling capture modules
 * @param {{ sessionId?: string|null, baselineAssistantCount?: number, perDownloadTimeoutMs?: number, strict?: boolean, stillActive?: () => boolean }} [opts]
 * @returns {Promise<{ ok: boolean, detectedCount: number, savedCount: number, files: import('./session-artifacts.mjs').ArtifactDescriptor[], errors: Array<{ reason: string, candidate?: string, message?: string }>, warnings: string[] }>}
 */
export async function saveAssistantDownloadableFiles(cdpSession, _deps, {
    sessionId = null,
    baselineAssistantCount = 0,
    perDownloadTimeoutMs = DEFAULT_PER_DOWNLOAD_TIMEOUT_MS,
    strict = false,
    stillActive,
} = {}) {
    if (strict) {
        return saveAssistantDownloadableFilesStrict(cdpSession, {
            sessionId, baselineAssistantCount, perDownloadTimeoutMs, stillActive,
        });
    }
    const candidates = await readAssistantDownloadableFiles(cdpSession, { baselineAssistantCount });
    if (!candidates.length) return { ok: true, detectedCount: 0, savedCount: 0, files: [], errors: [], warnings: [] };
    if (!sessionId) return { ok: true, detectedCount: candidates.length, savedCount: 0, files: [], errors: [], warnings: ['file-artifact-no-session'] };

    const cookieHeader = await getChatGptCookieHeader(cdpSession);
    /** @type {import('./session-artifacts.mjs').ArtifactDescriptor[]} */
    const files = [];
    const warnings = [];
    let attributionStopped = false;

    for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        if (attributionStopped) {
            warnings.push(`file-artifact-skipped-after-timeout:${safeDiagnosticUrl(c.sourceUrl)}`);
            continue;
        }
        const got = await fetchDownload(c.sourceUrl, cookieHeader, perDownloadTimeoutMs);
        if ('timedOut' in got) {
            attributionStopped = true;
            warnings.push(`file-artifact-timeout:${safeDiagnosticUrl(c.sourceUrl)}`);
            continue;
        }
        if ('failed' in got) {
            warnings.push(`file-artifact-fetch-failed:${safeDiagnosticUrl(c.sourceUrl)}`);
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
    return { ok: true, detectedCount: candidates.length, savedCount: files.length, files, errors: [], warnings };
}

/**
 * The require-all path: detect, download, stage, then publish as one batch.
 *
 * Every failure is terminal here. The opportunistic path may return a partial
 * set with warnings because the caller never asked for the files; a caller that
 * did ask must not be told `complete` when some are missing.
 *
 * @param {{ send: Function }} cdpSession
 * @param {{ sessionId: string|null, baselineAssistantCount: number, perDownloadTimeoutMs: number, stillActive?: () => boolean }} opts
 */
async function saveAssistantDownloadableFilesStrict(cdpSession, {
    sessionId, baselineAssistantCount, perDownloadTimeoutMs, stillActive,
}) {
    /** @param {string} reason @param {string} [candidate] @param {string} [message] */
    const fail = (reason, candidate, message) => ({
        ok: false, detectedCount: 0, savedCount: 0, files: [], warnings: [],
        errors: [{ reason, ...(candidate ? { candidate } : {}), ...(message ? { message } : {}) }],
    });
    if (!sessionId) return fail('no-session');

    const probe = await probeAssistantDownloadableFiles(cdpSession, { baselineAssistantCount });
    if (!probe.ok) return fail(probe.reason === 'cdp-failed' ? 'cdp-unavailable' : 'detection-malformed');
    const candidates = probe.candidates;
    // Asking for files and finding none is an unmet request, not a clean run.
    if (!candidates.length) return fail('no-candidates');

    const keys = candidates.map(c => candidateKeyFor(sessionId, baselineAssistantCount, c.sourceUrl));
    const transactionKey = transactionKeyFor(sessionId, baselineAssistantCount, keys);

    // Reuse anything a previous attempt already saved for these same candidates.
    // Without this, a batch that committed and then lost the race to the hard
    // deadline would be downloaded and stored a second time on the next poll.
    // Read through the awaited lock: `getSession` blocks the event loop, which
    // would suspend the very deadline timer this path is running under.
    const storedSession = await readSessionAsync(sessionId);
    const stored = /** @type {import('./session-artifacts.mjs').ArtifactDescriptor[]} */ (storedSession?.artifacts || []);
    /** @type {Map<string, import('./session-artifacts.mjs').ArtifactDescriptor>} */
    const reusable = new Map();
    for (const descriptor of stored) {
        if (descriptor.kind !== 'file' || !descriptor.candidateKey) continue;
        if (!keys.includes(descriptor.candidateKey)) continue;
        // The session record is a claim; the bytes are the evidence.
        if (artifactStillOnDisk(sessionId, descriptor)) reusable.set(descriptor.candidateKey, descriptor);
    }

    const txId = transactionKey.slice(0, 12);
    /** @type {Array<{ stagedPath: string, descriptor: import('./session-artifacts.mjs').ArtifactDescriptor }>} */
    const staged = [];
    /** @param {string} reason @param {string} [candidate] @param {string} [message] */
    const abort = (reason, candidate, message) => {
        const discarded = discardStagedArtifacts(staged);
        // A failed rollback leads, because it is the condition that needs
        // acting on: the original failure is recoverable by retrying, files
        // left on disk are not.
        const errors = discarded.ok
            ? [{ reason, ...(candidate ? { candidate } : {}), ...(message ? { message } : {}) }]
            : [
                { reason: 'rollback-failed', message: discarded.reason },
                { reason, ...(candidate ? { candidate } : {}), ...(message ? { message } : {}) },
            ];
        return { ok: false, detectedCount: candidates.length, savedCount: 0, files: [], errors, warnings: [] };
    };

    for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        const candidateKey = keys[i];
        if (reusable.has(candidateKey)) continue;
        // Re-checked before every download AND before the write below: the
        // wrapper may have returned while the previous fetch was in flight, and
        // a losing run must not start new work or publish anything.
        if (stillActive?.() === false) return abort('deadline-exceeded', safeDiagnosticUrl(c.sourceUrl));
        const got = await fetchDownload(c.sourceUrl, await getChatGptCookieHeader(cdpSession), perDownloadTimeoutMs);
        if ('timedOut' in got) return abort('fetch-timeout', safeDiagnosticUrl(c.sourceUrl));
        if ('failed' in got) return abort('fetch-failed', safeDiagnosticUrl(c.sourceUrl));
        if (stillActive?.() === false) return abort('deadline-exceeded', safeDiagnosticUrl(c.sourceUrl));
        const filename = resolveDownloadFilename({
            contentDisposition: got.contentDisposition,
            downloadAttr: c.download,
            sourceUrl: c.sourceUrl,
            index: i,
        });
        try {
            staged.push(stageFileArtifact(sessionId, {
                filename, buffer: got.buffer, mimeType: got.mimeType, sourceUrl: c.sourceUrl,
                candidateKey, transactionKey, txId, slot: i,
            }));
        } catch (err) {
            return abort('save-failed', safeDiagnosticUrl(c.sourceUrl), /** @type {any} */ (err)?.message);
        }
    }

    const reused = [...reusable.values()];
    if (!staged.length) {
        // Everything was already on disk from an earlier attempt.
        return { ok: true, detectedCount: candidates.length, savedCount: reused.length, files: reused, errors: [], warnings: [] };
    }
    if (stillActive?.() === false) return abort('deadline-exceeded');
    const committed = await commitStagedArtifacts(sessionId, staged, { stillActive });
    if (!committed.ok) {
        // The commit already undid its own published files; `abort` clears any
        // staging leftovers. A rollback failure inside the commit outranks the
        // commit failure itself.
        if (committed.rollbackFailed) {
            discardStagedArtifacts(staged);
            return {
                ok: false, detectedCount: candidates.length, savedCount: 0, files: [], warnings: [],
                errors: [
                    { reason: 'rollback-failed', message: committed.rollbackFailed },
                    { reason: 'save-failed', message: committed.reason },
                ],
            };
        }
        // A deadline that passed while the commit waited for the lock is not a
        // storage problem: collapsing it into `save-failed` sends the caller to
        // check their disk when the answer is to poll again.
        return committed.reason === 'deadline-exceeded'
            ? abort('deadline-exceeded')
            : abort('save-failed', undefined, committed.reason);
    }
    const files = [...reused, ...committed.files];
    return {
        ok: files.length === candidates.length,
        detectedCount: candidates.length,
        savedCount: files.length,
        files,
        errors: files.length === candidates.length ? [] : [{ reason: 'save-incomplete' }],
        warnings: [],
    };
}
