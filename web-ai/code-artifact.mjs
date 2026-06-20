// @ts-check
// Code-mode artifact retrieval (Phase 10 of devlog/_fin/260611_webai_gpt_code_mode).
// Retrieves a /mnt/data/*.zip built by ChatGPT's container tools without any
// button click: conversation JSON → sandbox path scan → interpreter/download
// presigned URL → in-page credentialed fetch (estuary URLs are cookie-bound;
// external fetches get 403 — verified 2026-06-11, see 01_prompt_contract.md).

import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/** @typedef {import('playwright-core').Page} Page */

/**
 * @typedef {Object} ZipScanResult
 * @property {string|null} zipPath
 * @property {string[]} candidateMids
 */

/**
 * @typedef {Object} RetrieveResult
 * @property {boolean} ok
 * @property {string|null} reason
 * @property {string|null} zipPath
 * @property {string|null} savedPath
 * @property {number} sizeBytes
 * @property {string[]} files
 * @property {boolean} [hasPlanArtifact]
 * @property {string|null} [mintedMessageId]
 */

const ZIP_PATH_RE_GLOBAL = /\/mnt\/data\/[A-Za-z0-9_\-./]+\.zip/g;

/**
 * Pure scan of a conversation JSON for the newest /mnt/data/*.zip reference
 * and the tool-message ids usable as interpreter/download `message_id`.
 *
 * The path is NOT reliably present in execution_output text (verified empty
 * for container.exec runs) — scan assistant/output content in turn order, ignore
 * command source text, and collect code/execution_output mids as download
 * candidates (no single-mid assumption; callers try each until one mints a URL).
 *
 * @param {{ mapping?: Record<string, { message?: { id?: string, author?: { role?: string }, create_time?: number, update_time?: number, content?: { content_type?: string } } }> }} conversation
 * @returns {ZipScanResult}
 */
export function scanConversationForZip(conversation) {
    /** @type {string|null} */
    let zipPath = null;
    /** @type {string[]} */
    const candidateMids = [];
    for (const message of orderedConversationMessages(conversation)) {
        const contentType = message.content?.content_type || '';
        for (const match of extractZipPathsFromMessage(message)) {
            zipPath = match;
        }
        if (isDownloadCandidateContent(contentType) && message.id) {
            candidateMids.push(message.id);
        }
    }
    return { zipPath, candidateMids };
}

/**
 * @param {{ mapping?: Record<string, { message?: { id?: string, author?: { role?: string }, create_time?: number, update_time?: number, content?: { content_type?: string } } }> }} conversation
 * @returns {{ id?: string, author?: { role?: string }, create_time?: number, update_time?: number, content?: { content_type?: string } }[]}
 */
function orderedConversationMessages(conversation) {
    return Object.values(conversation?.mapping || {})
        .map((node, index) => ({ message: node?.message, index }))
        .filter(item => item.message)
        .sort((a, b) => {
            const at = Number(a.message?.create_time ?? a.message?.update_time);
            const bt = Number(b.message?.create_time ?? b.message?.update_time);
            const aHasTime = Number.isFinite(at);
            const bHasTime = Number.isFinite(bt);
            if (aHasTime && bHasTime && at !== bt) return at - bt;
            if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
            return a.index - b.index;
        })
        .map(item => /** @type {any} */ (item.message));
}

/**
 * @param {{ author?: { role?: string }, content?: { content_type?: string } }} message
 * @returns {string[]}
 */
function extractZipPathsFromMessage(message) {
    const contentType = message.content?.content_type || '';
    if (contentType === 'code') return [];
    if (message.author?.role === 'user') return [];
    const blob = JSON.stringify(message.content || {});
    return blob.match(ZIP_PATH_RE_GLOBAL) || [];
}

/**
 * @param {string} contentType
 */
function isDownloadCandidateContent(contentType) {
    return contentType === 'execution_output' || contentType === 'code';
}

/**
 * Pure scan of a conversation JSON for the newest /mnt/data/*.zip reference
 * and the tool-message ids usable as interpreter/download `message_id`.
 *
 * @param {{ mapping?: Record<string, { message?: { id?: string, author?: { role?: string }, create_time?: number, update_time?: number, content?: { content_type?: string } } }> }} conversation
 * @returns {{ zipPaths: string[], candidateMids: string[] }}
 */
function scanConversation(conversation) {
    /** @type {string[]} */
    const zipPaths = [];
    const seen = new Set();
    /** @type {string[]} */
    const candidateMids = [];
    for (const message of orderedConversationMessages(conversation)) {
        const contentType = message.content?.content_type || '';
        for (const match of extractZipPathsFromMessage(message)) {
            if (!seen.has(match)) { seen.add(match); zipPaths.push(match); }
        }
        if (isDownloadCandidateContent(contentType) && message.id) {
            candidateMids.push(message.id);
        }
    }
    return { zipPaths, candidateMids };
}

/**
 * Multi-zip variant: collect every distinct /mnt/data/*.zip referenced anywhere
 * in the conversation (in first-seen order) plus the same tool-message id
 * candidates. Used when the contract permits more than one archive.
 *
 * @param {{ mapping?: Record<string, { message?: { id?: string, author?: { role?: string }, create_time?: number, update_time?: number, content?: { content_type?: string } } }> }} conversation
 * @returns {{ zipPaths: string[], candidateMids: string[] }}
 */
export function scanConversationForAllZips(conversation) {
    return scanConversation(conversation);
}

/**
 * Minimal zip validation without dependencies: local-file magic at offset 0
 * plus an End-Of-Central-Directory record, whose central directory yields the
 * entry names. Returns null when the buffer is not a readable zip.
 *
 * @param {Buffer} buffer
 * @returns {{ files: string[] } | null}
 */
export function verifyZipBuffer(buffer) {
    const entries = readZipCentralDirectory(buffer);
    if (!entries) return null;
    return { files: entries.map(entry => entry.name) };
}

/**
 * @param {string[]} files
 */
export function hasPlanArtifact(files) {
    return files.some(file => /(?:^|\/)(?:PLAN|00_plan)\.md$/i.test(file));
}

/**
 * Read a small text file from a zip buffer. Supports stored and deflated
 * entries, enough for our generated context manifests.
 *
 * @param {Buffer} buffer
 * @param {string} entryName
 * @returns {string|null}
 */
export function readZipTextEntry(buffer, entryName) {
    const entries = readZipCentralDirectory(buffer);
    const entry = entries?.find(candidate => candidate.name === entryName);
    if (!entry) return null;
    if (entry.localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localHeaderOffset) !== 0x04034b50) return null;
    const nameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
    const extraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > buffer.length) return null;
    const payload = buffer.subarray(dataStart, dataEnd);
    if (entry.method === 0) return payload.toString('utf8');
    if (entry.method === 8) return inflateRawSync(payload).toString('utf8');
    return null;
}

/**
 * @param {Buffer} buffer
 * @returns {{ name: string, method: number, compressedSize: number, localHeaderOffset: number }[] | null}
 */
function readZipCentralDirectory(buffer) {
    if (!buffer || buffer.length < 22) return null;
    if (buffer.readUInt32LE(0) !== 0x04034b50) return null;
    const eocdStart = Math.max(0, buffer.length - 22 - 65535);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= eocdStart; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const entryCount = buffer.readUInt16LE(eocd + 10);
    const cdOffset = buffer.readUInt32LE(eocd + 16);
    /** @type {{ name: string, method: number, compressedSize: number, localHeaderOffset: number }[]} */
    const entries = [];
    let cursor = cdOffset;
    for (let i = 0; i < entryCount; i++) {
        if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) return null;
        const method = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const nameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
        entries.push({
            name: buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength),
            method,
            compressedSize,
            localHeaderOffset,
        });
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}

/**
 * @param {Page} page
 * @param {string} conversationId
 * @returns {Promise<Record<string, unknown>|null>}
 */
export async function fetchConversationJson(page, conversationId) {
    return page.evaluate(async (convId) => {
        const session = await fetch('/api/auth/session').then(r => r.json()).catch(() => null);
        if (!session?.accessToken) return null;
        return fetch('/backend-api/conversation/' + convId, {
            headers: { Authorization: 'Bearer ' + session.accessToken },
        }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    }, conversationId);
}

/**
 * Mint an estuary presigned URL for one (message_id, sandbox_path) pair.
 *
 * @param {Page} page
 * @param {{ conversationId: string, messageId: string, sandboxPath: string }} params
 * @returns {Promise<string|null>}
 */
export async function mintDownloadUrl(page, { conversationId, messageId, sandboxPath }) {
    return page.evaluate(async (args) => {
        const session = await fetch('/api/auth/session').then(r => r.json()).catch(() => null);
        if (!session?.accessToken) return null;
        const url = '/backend-api/conversation/' + args.conversationId
            + '/interpreter/download?message_id=' + args.messageId
            + '&sandbox_path=' + encodeURIComponent(args.sandboxPath);
        const body = await fetch(url, { headers: { Authorization: 'Bearer ' + session.accessToken } })
            .then(r => (r.ok ? r.json() : null)).catch(() => null);
        return body?.download_url || null;
    }, { conversationId, messageId, sandboxPath });
}

/**
 * Fetch a cookie-bound binary inside the page and return it base64-encoded.
 *
 * @param {Page} page
 * @param {string} url
 * @returns {Promise<{ status: number, base64: string }|null>}
 */
export async function fetchBinaryBase64(page, url) {
    return page.evaluate(async (target) => {
        const response = await fetch(target, { credentials: 'include' }).catch(() => null);
        if (!response || !response.ok) return response ? { status: response.status, base64: '' } : null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, /** @type {number[]} */ (/** @type {unknown} */ (bytes.subarray(i, i + CHUNK))));
        }
        return { status: response.status, base64: btoa(binary) };
    }, url);
}

/**
 * End-to-end retrieval: scan the conversation, mint a presigned URL (trying
 * every candidate mid), fetch in-page, verify the zip, and save it.
 *
 * Fail-fast: every failure surfaces a distinct `reason`; there is no silent
 * fallback between stages.
 *
 * @param {Page} page
 * @param {{ conversationId: string, outputPath: string }} params
 * @returns {Promise<RetrieveResult>}
 */
export async function retrieveCodeArtifact(page, { conversationId, outputPath, requirePlan = false } = {}) {
    /** @type {RetrieveResult} */
    const result = { ok: false, reason: null, zipPath: null, savedPath: null, sizeBytes: 0, files: [] };

    const conversation = await fetchConversationJson(page, conversationId);
    if (!conversation) return { ...result, reason: 'code-artifact:conversation-unavailable' };

    const { zipPath, candidateMids } = scanConversationForZip(conversation);
    if (!zipPath) return { ...result, reason: 'code-artifact:missing' };
    if (!candidateMids.length) return { ...result, zipPath, reason: 'code-artifact:no-tool-messages' };

    return downloadAndSaveZip(page, { conversationId, zipPath, candidateMids, outputPath, requirePlan });
}

/**
 * Retrieve EVERY /mnt/data/*.zip in the conversation, saving each under
 * outputDir using its sandbox basename. Per-artifact failures are reported in
 * the artifacts array; the call succeeds when at least one zip was saved.
 *
 * @param {Page} page
 * @param {{ conversationId: string, outputDir: string }} params
 * @returns {Promise<{ ok: boolean, reason: string|null, artifacts: RetrieveResult[] }>}
 */
export async function retrieveAllCodeArtifacts(page, { conversationId, outputDir, requirePlan = false }) {
    const conversation = await fetchConversationJson(page, conversationId);
    if (!conversation) return { ok: false, reason: 'code-artifact:conversation-unavailable', artifacts: [] };

    const { zipPaths, candidateMids } = scanConversationForAllZips(conversation);
    if (!zipPaths.length) return { ok: false, reason: 'code-artifact:missing', artifacts: [] };
    if (!candidateMids.length) return { ok: false, reason: 'code-artifact:no-tool-messages', artifacts: [] };

    /** @type {RetrieveResult[]} */
    const artifacts = [];
    for (const zipPath of zipPaths) {
        const outputPath = join(outputDir, basename(zipPath));
        // eslint-disable-next-line no-await-in-loop -- sequential to reuse one page and avoid presigned-URL races
        artifacts.push(await downloadAndSaveZip(page, { conversationId, zipPath, candidateMids, outputPath, requirePlan }));
    }
    const ok = artifacts.some(a => a.ok);
    return { ok, reason: ok ? null : 'code-artifact:all-failed', artifacts };
}

/**
 * Mint a URL for one sandbox path (trying each candidate mid), fetch in-page,
 * verify, and save. Shared by single- and multi-zip retrieval.
 *
 * Mids are tried NEWEST-first: when a sandbox path like /mnt/data/result.zip is
 * reused across several code runs in one conversation, interpreter/download
 * serves the file snapshot tied to the given message_id — oldest-first selection
 * minted a STALE artifact (2026-06-11 drop10 incident: a drop9 variant was
 * retrieved although the final turn had rebuilt result.zip). Newest-first makes
 * the first successful mint the latest sandbox state; mids whose run deleted or
 * never had the file simply fail to mint and the loop falls back to older ones.
 *
 * @param {Page} page
 * @param {{ conversationId: string, zipPath: string, candidateMids: string[], outputPath: string }} params
 * @returns {Promise<RetrieveResult>}
 */
async function downloadAndSaveZip(page, { conversationId, zipPath, candidateMids, outputPath, requirePlan = false }) {
    /** @type {RetrieveResult} */
    const result = { ok: false, reason: null, zipPath, savedPath: null, sizeBytes: 0, files: [], mintedMessageId: null };

    let payload = null;
    let mintedMessageId = null;
    for (const messageId of [...candidateMids].reverse()) {
        // eslint-disable-next-line no-await-in-loop -- newest-first; stop at first mid that mints a working URL
        const downloadUrl = await mintDownloadUrl(page, { conversationId, messageId, sandboxPath: zipPath });
        if (!downloadUrl) continue;
        // eslint-disable-next-line no-await-in-loop
        const fetched = await fetchBinaryBase64(page, downloadUrl);
        if (fetched?.base64) { payload = fetched; mintedMessageId = messageId; break; }
    }
    if (!payload) return { ...result, reason: 'code-artifact:download-failed' };
    result.mintedMessageId = mintedMessageId;

    const buffer = Buffer.from(payload.base64, 'base64');
    const verified = verifyZipBuffer(buffer);
    if (!verified) return { ...result, sizeBytes: buffer.length, reason: 'code-artifact:invalid-zip' };
    const planArtifact = hasPlanArtifact(verified.files);
    if (requirePlan && !planArtifact) {
        return { ...result, sizeBytes: buffer.length, files: verified.files, hasPlanArtifact: false, reason: 'code-artifact:plan-missing' };
    }

    try {
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, buffer);
    } catch (error) {
        console.error('[code-artifact]', /** @type {Error} */ (error)?.message || error);
        return { ...result, sizeBytes: buffer.length, files: verified.files, hasPlanArtifact: planArtifact, reason: 'code-artifact:write-failed' };
    }
    return { ok: true, reason: null, zipPath, savedPath: outputPath, sizeBytes: buffer.length, files: verified.files, hasPlanArtifact: planArtifact, mintedMessageId };
}
