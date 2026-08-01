// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { updateSession, getSession } from './session.mjs';
import { appendSessionArtifacts } from './session-store.mjs';

/**
 * Resolved per call, not at import. A frozen constant took whatever
 * `BROWSER_AGENT_HOME` held when the module was first imported, so a test that
 * points the variable at a temp directory in its body still wrote artifacts
 * under the developer's real `~/.browser-agent` — static imports run first.
 *
 * @returns {string}
 */
function browserAgentHome() {
    return process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
}

/**
 * @typedef {Object} ArtifactDescriptor
 * @property {'transcript'|'report'|'image'|'file'|'diagnostics'} kind
 * @property {string} label
 * @property {string} path
 * @property {string} [mimeType]
 * @property {number} [sizeBytes]
 * @property {string} [sourceUrl]
 * @property {string} [screenshotPath]
 * @property {string} sha256
 * @property {{ type: string, ok: boolean }} [validation]
 * @property {string} [candidateKey] stable identity of the source candidate
 * @property {string} [transactionKey] identity of the batch that saved it
 * @property {string} savedAt
 */

/**
 * @typedef {{ ok: true, descriptor: ArtifactDescriptor } | { ok: false, stage: string, error: string }} ArtifactSaveResult
 */

/** @param {string|Buffer} data */
function computeSha256(data) {
    return createHash('sha256').update(data).digest('hex');
}

/**
 * Sanitize a path segment to prevent directory traversal.
 * @param {string} segment
 * @returns {string}
 */
function sanitizeSegment(segment) {
    return segment.replace(/[\/\\:*?"<>|.]/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

/**
 * Resolve the artifacts directory for a session.
 * Directory is created lazily on first write, not eagerly.
 * @param {string} sessionId
 * @returns {string}
 */
export function resolveArtifactsDir(sessionId) {
    const safe = sanitizeSegment(sessionId);
    return join(browserAgentHome(), 'sessions', safe, 'artifacts');
}

/**
 * Ensure the artifacts directory exists.
 * @param {string} dir
 */
function ensureDir(dir) {
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

/**
 * Save a transcript artifact.
 * @param {string} sessionId
 * @param {string} markdown
 * @returns {ArtifactDescriptor}
 */
export function saveTranscript(sessionId, markdown) {
    const dir = resolveArtifactsDir(sessionId);
    ensureDir(dir);
    const filename = 'transcript.md';
    const fullPath = join(dir, filename);
    writeFileSync(fullPath, markdown, 'utf8');
    return {
        kind: 'transcript',
        label: 'Conversation transcript',
        path: filename,
        mimeType: 'text/markdown',
        sizeBytes: Buffer.byteLength(markdown, 'utf8'),
        sha256: computeSha256(markdown),
        validation: { type: 'text', ok: markdown.trim().length > 0 },
        savedAt: new Date().toISOString(),
    };
}

/**
 * Save a transcript artifact and convert filesystem failures into a result.
 * @param {string} sessionId
 * @param {string} markdown
 * @returns {ArtifactSaveResult}
 */
export function trySaveTranscript(sessionId, markdown) {
    try {
        return { ok: true, descriptor: saveTranscript(sessionId, markdown) };
    } catch (err) {
        return {
            ok: false,
            stage: 'artifact-transcript',
            error: /** @type {Error} */ (err)?.message || String(err),
        };
    }
}

/**
 * Save a Deep Research report artifact.
 * @param {string} sessionId
 * @param {{ text: string, sources?: string[] }} report
 * @returns {ArtifactDescriptor}
 */
export function saveReport(sessionId, { text, sources }) {
    const dir = resolveArtifactsDir(sessionId);
    ensureDir(dir);
    const filename = 'report.md';
    let content = text;
    if (sources?.length) {
        content += '\n\n## Sources\n' + sources.map((s, i) => `${i + 1}. ${s}`).join('\n');
    }
    const fullPath = join(dir, filename);
    writeFileSync(fullPath, content, 'utf8');
    return {
        kind: 'report',
        label: 'Deep Research report',
        path: filename,
        mimeType: 'text/markdown',
        sizeBytes: Buffer.byteLength(content, 'utf8'),
        sha256: computeSha256(content),
        validation: { type: 'text', ok: content.trim().length > 0 },
        savedAt: new Date().toISOString(),
    };
}

/**
 * Save a Deep Research report artifact and convert failures into a result.
 * @param {string} sessionId
 * @param {{ text: string, sources?: string[] }} report
 * @returns {ArtifactSaveResult}
 */
export function trySaveReport(sessionId, report) {
    try {
        return { ok: true, descriptor: saveReport(sessionId, report) };
    } catch (err) {
        return {
            ok: false,
            stage: 'artifact-report',
            error: /** @type {Error} */ (err)?.message || String(err),
        };
    }
}

/**
 * Save an image artifact to the session artifacts directory.
 * @param {string} sessionId
 * @param {{ filename: string, buffer: Buffer, mimeType: string, sourceUrl?: string }} image
 * @returns {ArtifactDescriptor}
 */
export function saveImageArtifact(sessionId, { filename, buffer, mimeType, sourceUrl }) {
    const dir = resolveArtifactsDir(sessionId);
    ensureDir(dir);
    const safeName = sanitizeSegment(basename(filename, '.' + filename.split('.').pop())) +
        '.' + (mimeType.split('/')[1] || 'png');
    const fullPath = join(dir, safeName);
    writeFileSync(fullPath, buffer);
    return {
        kind: 'image',
        label: filename,
        path: safeName,
        mimeType,
        sizeBytes: buffer.length,
        sourceUrl: sourceUrl || undefined,
        sha256: computeSha256(buffer),
        validation: { type: 'image', ok: buffer.length > 0 },
        savedAt: new Date().toISOString(),
    };
}

/**
 * Save an image artifact and convert failures into a result.
 * @param {string} sessionId
 * @param {{ filename: string, buffer: Buffer, mimeType: string, sourceUrl?: string }} image
 * @returns {ArtifactSaveResult}
 */
export function trySaveImageArtifact(sessionId, image) {
    try {
        return { ok: true, descriptor: saveImageArtifact(sessionId, image) };
    } catch (err) {
        return {
            ok: false,
            stage: 'artifact-image',
            error: /** @type {Error} */ (err)?.message || String(err),
        };
    }
}

/**
 * Build a safe artifact basename for a generic file: strip any directory,
 * preserve the resolved filename's extension when present, else fall back to the
 * MIME subtype. The stem is path-traversal sanitized.
 * @param {string} filename
 * @param {string} mimeType
 * @returns {string}
 */
function safeFileArtifactName(filename, mimeType) {
    const base = basename(String(filename || ''));
    const dot = base.lastIndexOf('.');
    const stem = sanitizeSegment(dot > 0 ? base.slice(0, dot) : base);
    const rawExt = dot > 0 ? base.slice(dot + 1) : '';
    const ext = sanitizeSegment(rawExt || (mimeType ? (mimeType.split('/')[1] || '').split(';')[0] : ''));
    return ext && ext !== 'unknown' ? `${stem}.${ext}` : stem;
}

/**
 * Save a generic downloadable-file artifact (CSV/PDF/ZIP/...), separate from
 * image artifacts. Preserves the resolved filename's extension.
 * @param {string} sessionId
 * @param {{ filename: string, buffer: Buffer, mimeType: string, sourceUrl?: string }} file
 * @returns {ArtifactDescriptor}
 */
export function saveFileArtifact(sessionId, { filename, buffer, mimeType, sourceUrl }) {
    const dir = resolveArtifactsDir(sessionId);
    ensureDir(dir);
    const safeName = safeFileArtifactName(filename, mimeType);
    const fullPath = join(dir, safeName);
    writeFileSync(fullPath, buffer);
    return {
        kind: 'file',
        label: filename,
        path: safeName,
        mimeType,
        sizeBytes: buffer.length,
        sourceUrl: sourceUrl || undefined,
        sha256: computeSha256(buffer),
        validation: { type: buffer.length > 0 ? 'generic' : 'empty', ok: buffer.length > 0 },
        savedAt: new Date().toISOString(),
    };
}

/**
 * A name inside `dir` that does not collide with an existing file.
 *
 * `saveFileArtifact` writes a deterministic basename, so a second capture of
 * the same filename OVERWRITES the first. That is tolerable when every write is
 * committed, but a transaction that may roll back cannot use it: deleting the
 * file it wrote would also delete whatever was there before.
 *
 * @param {string} dir
 * @param {string} safeName
 * @returns {string}
 */
function publishStaged(dir, stagedPath, safeName) {
    /** @param {string} name */
    const claim = (name) => {
        // `link` fails when the destination exists; `rename` would REPLACE it.
        // Checking with `existsSync` first and then renaming is a race: two
        // processes can both see the name free and the second overwrites the
        // first, leaving bytes that no longer match the descriptor's hash.
        linkSync(stagedPath, join(dir, name));
        try {
            rmSync(stagedPath, { force: true });
        } catch (err) {
            // The link exists but the caller never learns its name, so it would
            // never be rolled back. Undo it here; if that also fails, say so
            // rather than leaving an orphan nobody knows about.
            try {
                rmSync(join(dir, name), { force: true });
            } catch {
                const orphan = new Error(`rollback-failed:${name}`);
                /** @type {any} */ (orphan).code = 'EROLLBACK';
                throw orphan;
            }
            throw err;
        }
        return name;
    };
    try {
        return claim(safeName);
    } catch (err) {
        if (/** @type {any} */ (err)?.code !== 'EEXIST') throw err;
    }
    const dot = safeName.lastIndexOf('.');
    const stem = dot > 0 ? safeName.slice(0, dot) : safeName;
    const ext = dot > 0 ? safeName.slice(dot) : '';
    for (let n = 2; n < 1_000; n += 1) {
        try {
            return claim(`${stem}-${n}${ext}`);
        } catch (err) {
            if (/** @type {any} */ (err)?.code !== 'EEXIST') throw err;
        }
    }
    return claim(`${stem}-${attemptNonce()}${ext}`);
}

/**
 * A suffix unique to ONE staging attempt.
 *
 * @returns {string}
 */
function attemptNonce() {
    return `${process.pid.toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Stage a file artifact WITHOUT publishing it.
 *
 * Written under a transaction-owned temporary name, so nothing an earlier run
 * saved is touched until every file in the batch has succeeded.
 *
 * @param {string} sessionId
 * @param {{ filename: string, buffer: Buffer, mimeType: string, sourceUrl?: string, candidateKey?: string, transactionKey?: string, txId: string, slot: number }} file
 * @returns {{ stagedPath: string, descriptor: ArtifactDescriptor }}
 */
export function stageFileArtifact(sessionId, { filename, buffer, mimeType, sourceUrl, candidateKey, transactionKey, txId, slot = 0 }) {
    const dir = resolveArtifactsDir(sessionId);
    ensureDir(dir);
    const safeName = safeFileArtifactName(filename, mimeType);
    // Owned by ONE attempt, not just one batch. `slot` separates two candidates
    // that resolve to the same filename; the nonce separates two runs of the
    // same batch, since `txId` is derived from the session and turn and a
    // concurrent poll and watch would otherwise stage over each other — the
    // loser's commit then renames a file that is already gone.
    const stagedName = `.staging-${txId}-${attemptNonce()}-${slot}-${safeName}`;
    const stagedPath = join(dir, stagedName);
    writeFileSync(stagedPath, buffer);
    return {
        stagedPath,
        descriptor: {
            kind: 'file',
            label: filename,
            // Provisional. `commitStagedArtifacts` rewrites it to the published
            // name, which is only known once the whole batch has staged.
            path: safeName,
            mimeType,
            sizeBytes: buffer.length,
            sourceUrl: sourceUrl || undefined,
            sha256: computeSha256(buffer),
            validation: { type: buffer.length > 0 ? 'generic' : 'empty', ok: buffer.length > 0 },
            savedAt: new Date().toISOString(),
            ...(candidateKey ? { candidateKey } : {}),
            ...(transactionKey ? { transactionKey } : {}),
        },
    };
}

/**
 * Remove files this transaction published, and nothing else.
 *
 * Reports its own failure instead of swallowing it: a rollback that leaves
 * files behind is exactly the state a caller must be told about, and every
 * path is attempted so one bad delete cannot strand the rest.
 *
 * @param {string[]} paths
 * @returns {{ ok: boolean, reason?: string }}
 */
function removePublished(paths) {
    /** @type {string[]} */
    const failures = [];
    for (const path of paths) {
        try {
            rmSync(path, { force: true });
        } catch (err) {
            failures.push(`${basename(path)}:${/** @type {any} */ (err)?.message || 'unknown'}`);
        }
    }
    return failures.length ? { ok: false, reason: failures.join(', ') } : { ok: true };
}

/**
 * Publish a staged batch and record it in ONE session update.
 *
 * Recording per file (as the previous flow did) leaves the session describing a
 * partial batch when a later file fails.
 *
 * @param {string} sessionId
 * @param {Array<{ stagedPath: string, descriptor: ArtifactDescriptor }>} staged
 * @returns {{ ok: true, files: ArtifactDescriptor[] } | { ok: false, reason: string, rollbackFailed?: string }}
 */
export function commitStagedArtifacts(sessionId, staged) {
    const dir = resolveArtifactsDir(sessionId);
    /** @type {ArtifactDescriptor[]} */
    const published = [];
    /** @type {string[]} */
    const publishedPaths = [];
    /** @param {string} reason */
    const undo = (reason) => {
        const removed = removePublished(publishedPaths);
        return removed.ok
            ? { ok: /** @type {const} */ (false), reason }
            : { ok: /** @type {const} */ (false), reason, rollbackFailed: removed.reason };
    };
    // The session write is INSIDE the try: it takes a store lock that can throw,
    // and leaving it outside published the files while recording nothing.
    try {
        for (const entry of staged) {
            const finalName = publishStaged(dir, entry.stagedPath, entry.descriptor.path);
            publishedPaths.push(join(dir, finalName));
            published.push({ ...entry.descriptor, path: finalName });
        }
        // Appended inside the store lock. Reading `artifacts` here and patching
        // `[...previous, ...published]` would let a concurrent commit that read
        // the same snapshot erase these descriptors when it writes second.
        const updated = appendSessionArtifacts(sessionId, published);
        if (!updated) return undo('session-update-failed');
    } catch (err) {
        return undo(`commit-failed:${/** @type {any} */ (err)?.message || 'unknown'}`);
    }
    return { ok: true, files: published };
}

/**
 * Discard staged files that were never published.
 *
 * @param {Array<{ stagedPath: string }>} staged
 * @returns {{ ok: boolean, reason?: string }}
 */
export function discardStagedArtifacts(staged) {
    /** @type {string[]} */
    const failures = [];
    for (const entry of staged) {
        try {
            rmSync(entry.stagedPath, { force: true });
        } catch (err) {
            // Keep going: returning here would strand the remaining staged
            // files, which is worse than the failure being reported.
            failures.push(`${basename(entry.stagedPath)}:${/** @type {any} */ (err)?.message || 'unknown'}`);
        }
    }
    return failures.length ? { ok: false, reason: failures.join(', ') } : { ok: true };
}

/**
 * Whether a recorded artifact is still backed by the bytes it claims.
 *
 * A session record alone is not evidence: the file may have been deleted or
 * replaced since, and counting it as saved would let the strict contract pass
 * with nothing on disk.
 *
 * @param {string} sessionId
 * @param {ArtifactDescriptor} descriptor
 * @returns {boolean}
 */
export function artifactStillOnDisk(sessionId, descriptor) {
    if (!descriptor || descriptor.validation?.ok !== true) return false;
    const dir = resolveArtifactsDir(sessionId);
    const fullPath = join(dir, basename(String(descriptor.path || '')));
    if (!existsSync(fullPath)) return false;
    try {
        return computeSha256(readFileSync(fullPath)) === descriptor.sha256;
    } catch {
        return false;
    }
}

/**
 * Save a file artifact and convert failures into a result.
 * @param {string} sessionId
 * @param {{ filename: string, buffer: Buffer, mimeType: string, sourceUrl?: string }} file
 * @returns {ArtifactSaveResult}
 */
export function trySaveFileArtifact(sessionId, file) {
    try {
        return { ok: true, descriptor: saveFileArtifact(sessionId, file) };
    } catch (err) {
        return {
            ok: false,
            stage: 'artifact-file',
            error: /** @type {Error} */ (err)?.message || String(err),
        };
    }
}

/**
 * Save a failure-diagnostics artifact (DOM snapshot JSON + optional screenshot
 * PNG) under the session artifacts dir. Same-context captures overwrite (latest
 * failure wins). Returns a `kind:'diagnostics'` descriptor (with screenshotPath
 * when a screenshot was provided).
 * @param {string} sessionId
 * @param {{ context?: string, domJson?: unknown, screenshotBuffer?: Buffer|null }} diag
 * @returns {ArtifactDescriptor}
 */
export function saveDiagnosticsArtifact(sessionId, { context, domJson, screenshotBuffer }) {
    const dir = resolveArtifactsDir(sessionId);
    ensureDir(dir);
    const stem = `diagnostics-${sanitizeSegment(context || 'failure')}`;
    const jsonPath = `${stem}.json`;
    const content = JSON.stringify(domJson ?? {}, null, 2);
    writeFileSync(join(dir, jsonPath), content);
    /** @type {ArtifactDescriptor} */
    const descriptor = {
        kind: 'diagnostics',
        label: context || 'failure',
        path: jsonPath,
        mimeType: 'application/json',
        sha256: computeSha256(content),
        validation: { type: 'text', ok: content.trim().length > 0 },
        savedAt: new Date().toISOString(),
    };
    if (screenshotBuffer) {
        const pngPath = `${stem}.png`;
        writeFileSync(join(dir, pngPath), screenshotBuffer);
        descriptor.screenshotPath = pngPath;
    }
    return descriptor;
}

/**
 * Save a diagnostics artifact and convert failures into a result.
 * @param {string} sessionId
 * @param {{ context?: string, domJson?: unknown, screenshotBuffer?: Buffer|null }} diag
 * @returns {ArtifactSaveResult}
 */
export function trySaveDiagnosticsArtifact(sessionId, diag) {
    try {
        return { ok: true, descriptor: saveDiagnosticsArtifact(sessionId, diag) };
    } catch (err) {
        return {
            ok: false,
            stage: 'artifact-diagnostics',
            error: /** @type {Error} */ (err)?.message || String(err),
        };
    }
}

/**
 * Append an artifact descriptor to a session's artifacts array.
 * @param {string} sessionId
 * @param {ArtifactDescriptor} descriptor
 * @returns {import('./session-store.mjs').WebAiSession|null}
 */
export function appendArtifactRecord(sessionId, descriptor) {
    const session = getSession(sessionId);
    if (!session) return null;
    const artifacts = /** @type {ArtifactDescriptor[]} */ (session.artifacts || []);
    const withoutDuplicate = artifacts.filter((artifact) => !(artifact.kind === descriptor.kind && artifact.path === descriptor.path));
    return updateSession(sessionId, { artifacts: [...withoutDuplicate, descriptor] });
}
