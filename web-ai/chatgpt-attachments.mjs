// @ts-check
/// <reference types="playwright-core" />
import { basename } from 'node:path';
import { statSync } from 'node:fs';
import {
    IMAGE_ATTACHMENT_EXTENSIONS,
    UPLOAD_BUTTON_SELECTORS,
    findFirstFileInput,
    isImageAttachmentPath,
    scoreFileInputCandidate,
    setFilesViaUploadSurface,
    resolveAttachmentUploadTimeoutMs,
} from './chatgpt-upload-surface.mjs';

/** @typedef {import('playwright-core').Page} Page */

/**
 * @typedef {Object} AttachmentFile
 * @property {string} path
 * @property {string} basename
 * @property {number} sizeBytes
 */

/**
 * @typedef {Object} PreflightOk
 * @property {true} ok
 * @property {string[]} softWarnings
 * @property {string} basename
 * @property {number} sizeBytes
 * @property {string} extension
 */

/**
 * @typedef {Object} PreflightFail
 * @property {false} ok
 * @property {string} rejectedReason
 * @property {string[]} softWarnings
 * @property {string} basename
 * @property {number} sizeBytes
 * @property {string} extension
 */

/** @typedef {PreflightOk | PreflightFail} PreflightResult */

/**
 * @typedef {Object} AttachmentSuccess
 * @property {true} ok
 * @property {string} stage
 * @property {boolean} [chipVisible]
 * @property {number} [fileCount]
 * @property {string[]} usedFallbacks
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} AttachmentFailure
 * @property {false} ok
 * @property {string} stage
 * @property {string} error
 * @property {string[]} usedFallbacks
 */

/** @typedef {AttachmentSuccess | AttachmentFailure} AttachmentResult */

/**
 * @typedef {Object} AttachmentTarget
 * @property {string} [selector]
 */

/**
 * @typedef {Object} AttachLocalFileOptions
 * @property {AttachmentTarget|null} [uploadTarget]
 * @property {number|string|null} [maxUploadBytes]
 * @property {number|string|null} [maxImageBytes]
 * @property {number|string|null} [attachmentUploadTimeoutMs]
 */

const HARD_LIMIT_BYTES = 512 * 1024 * 1024;
const IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;
const SOFT_SPREADSHEET_BYTES = 50 * 1024 * 1024;

/** @type {Set<string>} */
const UNSUPPORTED_EXTENSIONS = new Set(['.gdoc', '.gsheet', '.gslides']);
/** @type {Set<string>} */
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx']);

export { UPLOAD_BUTTON_SELECTORS, isImageAttachmentPath, scoreFileInputCandidate };

/**
 * @param {string[]} fileNames
 * @returns {string}
 */
export function buildAttachmentReadyExpression(fileNames = []) {
    return `(() => {
        const expected = ${JSON.stringify(fileNames.map(String))};
        const composer = document.querySelector('form:has(textarea), form:has([contenteditable="true"]), main form') || document.querySelector('main') || document.body;
        const chipSelectors = [
            '[data-testid*="attachment" i]',
            '[data-testid*="file" i]',
            '[aria-label*="attachment" i]',
            '[aria-label*="file" i]',
            'button[aria-label*="Remove file" i]',
            'button[aria-label*="Remove attachment" i]',
            '.group\\\\/file-tile'
        ];
        const promptNodes = new Set(Array.from(composer.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]')));
        const candidates = Array.from(composer.querySelectorAll(chipSelectors.join(',')))
            .filter(node => !Array.from(promptNodes).some(prompt => prompt.contains(node) || node.contains(prompt)));
        const haystackFor = node => {
            const parts = [];
            let current = node;
            for (let i = 0; current && i < 3; i += 1, current = current.parentElement) {
                parts.push(current.textContent || '');
                for (const attr of ['aria-label', 'title', 'data-testid']) parts.push(current.getAttribute?.(attr) || '');
            }
            return parts.join(' ').toLowerCase();
        };
        const haystacks = candidates.map(haystackFor);
        const matched = expected.filter(name => {
            const lower = String(name).toLowerCase();
            const stem = lower.replace(/\\.[^.]+$/, '');
            return haystacks.some(text => text.includes(lower) || (stem.length > 2 && text.includes(stem)));
        });
        const removeCount = candidates.filter(node => /remove (file|attachment)/i.test(node.getAttribute?.('aria-label') || node.textContent || '')).length;
        const progressCount = composer.querySelectorAll('[role="progressbar"], [aria-label*="uploading" i], [aria-label*="processing" i], [data-testid*="upload-progress" i]').length;
        return {
            ok: progressCount === 0 && (matched.length === expected.length || (expected.length > 0 && removeCount >= expected.length)),
            matched,
            chipCount: candidates.length,
            removeCount,
            progressCount
        };
    })()`;
}

const ATTACHMENT_CHIP_SELECTORS = [
    '[role="group"][aria-label$=".txt" i]',
    '[role="group"][aria-label$=".pdf" i]',
    '[role="group"][aria-label$=".docx" i]',
    '[role="group"][aria-label$=".csv" i]',
    '[role="group"][aria-label$=".xlsx" i]',
    '.group\\/file-tile',
    '[data-testid*="attachment" i]',
    '[aria-label*="attachment" i]',
    '[aria-label*="file" i]',
    '[data-testid*="file" i]',
    'button[aria-label*="Remove" i]',
];

const UPLOAD_PROGRESS_SELECTORS = [
    '[role="progressbar"]',
    '[aria-label*="uploading" i]',
    '[aria-label*="processing" i]',
    '[data-testid*="upload-progress" i]',
];

/**
 * @param {string} filePath
 * @returns {AttachmentFile}
 */
export function fileInfoFromPath(filePath) {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error(`not a regular file: ${filePath}`);
    return { path: filePath, basename: basename(filePath), sizeBytes: stat.size };
}

/**
 * @param {AttachmentFile} file
 * @param {{ maxUploadBytes?: number|string|null, maxImageBytes?: number|string|null }} [options]
 * @returns {PreflightResult}
 */
export function preflightAttachment(file, options = {}) {
    const extension = extractExtension(file.basename);
    const maxUploadBytes = resolveUploadFileSizeCap(options.maxUploadBytes, HARD_LIMIT_BYTES);
    const maxImageBytes = resolveUploadFileSizeCap(options.maxImageBytes, IMAGE_LIMIT_BYTES);
    /** @type {string[]} */
    const softWarnings = [];
    if (UNSUPPORTED_EXTENSIONS.has(extension)) {
        return { ok: false, rejectedReason: `unsupported extension: ${extension}`, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
    }
    if (file.sizeBytes > maxUploadBytes) {
        return { ok: false, rejectedReason: `file exceeds upload cap (${file.sizeBytes} bytes, cap ${maxUploadBytes})`, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
    }
    if (IMAGE_ATTACHMENT_EXTENSIONS.has(extension) && file.sizeBytes > maxImageBytes) {
        return { ok: false, rejectedReason: `image exceeds upload cap (${file.sizeBytes} bytes, cap ${maxImageBytes})`, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
    }
    if (SPREADSHEET_EXTENSIONS.has(extension) && file.sizeBytes > SOFT_SPREADSHEET_BYTES) {
        softWarnings.push(`spreadsheet over 50MB may be soft-blocked by ChatGPT (${file.sizeBytes})`);
    }
    return { ok: true, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function resolveUploadFileSizeCap(value, fallback = HARD_LIMIT_BYTES) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {string[]|AttachmentFile[]|null|undefined} fileNames
 * @returns {number}
 */
export function sendButtonTimeoutMs(fileNames = []) {
    return Array.isArray(fileNames) && fileNames.length > 0 ? 45_000 : 20_000;
}

/**
 * @param {Page} page
 * @param {AttachmentFile} file
 * @param {AttachLocalFileOptions} [options]
 * @returns {Promise<AttachmentResult>}
 */
export async function attachLocalFileLive(page, file, options = {}) {
    /** @type {string[]} */
    const usedFallbacks = [];
    /** @type {string[]} */
    const warnings = [];
    const preflight = preflightAttachment(file, {
        maxUploadBytes: options.maxUploadBytes,
        maxImageBytes: options.maxImageBytes,
    });
    if (preflight.ok !== true) {
        return { ok: false, stage: 'attachment-preflight', error: preflight.rejectedReason || 'preflight rejected', usedFallbacks };
    }
    warnings.push(...preflight.softWarnings);
    const uploadTimeoutMs = resolveAttachmentUploadTimeoutMs(options.attachmentUploadTimeoutMs);

    const inputSel = await findFirstFileInput(page, file);
    if (inputSel) {
        try {
            await page.locator(inputSel).first().setInputFiles(file.path, { timeout: uploadTimeoutMs });
        } catch (e) {
            return { ok: false, stage: 'attachment-upload', error: `setInputFiles failed: ${/** @type {{message?: string}} */ (e)?.message}`, usedFallbacks };
        }
    } else {
        const surfaceUpload = await setFilesViaUploadSurface(page, file.path, file, usedFallbacks, options.uploadTarget, { uploadTimeoutMs });
        if (surfaceUpload.ok !== true) {
            return { ok: false, stage: 'attachment-upload', error: surfaceUpload.error, usedFallbacks };
        }
    }
    const accepted = await waitForAttachmentAcceptedLive(page, { timeoutMs: 45_000, fileNames: [file.basename] });
    if (!accepted.ok) return accepted;
    return {
        ok: true,
        stage: 'attachment-uploaded',
        chipVisible: accepted.chipVisible,
        fileCount: accepted.fileCount,
        usedFallbacks: [...usedFallbacks, ...accepted.usedFallbacks],
        warnings: [...warnings, ...accepted.warnings],
    };
}

/**
 * Attach several local files at once — including mixed types (zip + image +
 * doc) — through a single composer file input. ChatGPT's general attachment
 * input has no `accept` and `multiple`, so a batch containing any non-image
 * file routes there automatically (image-only inputs score -Infinity for
 * non-images); an all-image batch may use an image input. Verified live
 * 2026-06-11: zip + png + txt accepted together.
 *
 * @param {Page} page
 * @param {AttachmentFile[]} files
 * @param {AttachLocalFileOptions} [options]
 * @returns {Promise<AttachmentResult>}
 */
export async function attachLocalFilesLive(page, files, options = {}) {
    /** @type {string[]} */
    const usedFallbacks = [];
    /** @type {string[]} */
    const warnings = [];
    if (!Array.isArray(files) || files.length === 0) {
        return { ok: false, stage: 'attachment-preflight', error: 'no files to attach', usedFallbacks };
    }
    if (files.length === 1) return attachLocalFileLive(page, files[0], options);

    for (const file of files) {
        const preflight = preflightAttachment(file, {
            maxUploadBytes: options.maxUploadBytes,
            maxImageBytes: options.maxImageBytes,
        });
        if (preflight.ok !== true) {
            return { ok: false, stage: 'attachment-preflight', error: `${file.basename}: ${preflight.rejectedReason || 'preflight rejected'}`, usedFallbacks };
        }
        warnings.push(...preflight.softWarnings);
    }

    // Batch is "image" only when every file is an image; one non-image forces
    // the general (no-accept) input that takes all types.
    const batchIsImage = files.every(file => isImageAttachmentPath(file.basename || file.path || ''));
    const probeFile = { ...files[0], basename: batchIsImage ? files[0].basename : 'batch.bin' };
    const uploadTimeoutMs = resolveAttachmentUploadTimeoutMs(options.attachmentUploadTimeoutMs);

    const inputSel = await findFirstFileInput(page, probeFile);
    if (inputSel) {
        try {
            await page.locator(inputSel).first().setInputFiles(files.map(file => file.path), { timeout: uploadTimeoutMs });
        } catch (e) {
            return { ok: false, stage: 'attachment-upload', error: `setInputFiles failed: ${/** @type {{message?: string}} */ (e)?.message}`, usedFallbacks };
        }
    } else {
        const surfaceUpload = await setFilesViaUploadSurface(page, files.map(file => file.path), probeFile, usedFallbacks, options.uploadTarget, { uploadTimeoutMs });
        if (surfaceUpload.ok !== true) {
            return { ok: false, stage: 'attachment-upload', error: surfaceUpload.error, usedFallbacks };
        }
    }
    const accepted = await waitForAttachmentAcceptedLive(page, { timeoutMs: 60_000, fileNames: files.map(file => file.basename) });
    if (!accepted.ok) return accepted;
    return {
        ok: true,
        stage: 'attachment-uploaded',
        chipVisible: accepted.chipVisible,
        fileCount: accepted.fileCount,
        usedFallbacks: [...usedFallbacks, ...accepted.usedFallbacks],
        warnings: [...warnings, ...accepted.warnings],
    };
}

/**
 * @param {Page} page
 * @param {{ timeoutMs?: number, fileNames?: string[] }} [opts]
 * @returns {Promise<AttachmentResult>}
 */
export async function waitForAttachmentAcceptedLive(page, opts = {}) {
    const deadline = Date.now() + (opts.timeoutMs || 45_000);
    while (Date.now() < deadline) {
        if (typeof page.evaluate === 'function' && opts.fileNames?.length) {
            const readiness = await page.evaluate(buildAttachmentReadyExpression(opts.fileNames)).catch(() => null);
            if (readiness?.ok) {
                return {
                    ok: true,
                    stage: 'attachment-verified',
                    chipVisible: true,
                    fileCount: readiness.chipCount || readiness.removeCount || opts.fileNames.length,
                    usedFallbacks: readiness.matched?.length ? [] : ['attachment-count-fallback'],
                    warnings: [],
                };
            }
        }
        let chipCount = 0;
        for (const sel of ATTACHMENT_CHIP_SELECTORS) {
            chipCount += await page.locator(sel).count().catch(() => 0);
        }
        let progressCount = 0;
        for (const sel of UPLOAD_PROGRESS_SELECTORS) {
            progressCount += await page.locator(sel).count().catch(() => 0);
        }
        if (chipCount > 0 && progressCount === 0) {
            return { ok: true, stage: 'attachment-verified', chipVisible: true, fileCount: chipCount, usedFallbacks: [], warnings: [] };
        }
        await page.waitForTimeout(500).catch(() => undefined);
    }
    return { ok: false, stage: 'attachment-upload', error: 'attachment never showed visible chip', usedFallbacks: [] };
}

/**
 * @param {Page} page
 * @param {AttachmentFile|null} [expectedFile]
 * @returns {Promise<AttachmentResult>}
 */
export async function verifySentTurnAttachmentLive(page, expectedFile = null) {
    const turn = page.locator('[data-turn="user"], [data-message-author-role="user"]').last();
    if ((await turn.count().catch(() => 0)) === 0) {
        return { ok: false, stage: 'attachment-upload', error: 'no sent turn visible after send', usedFallbacks: [] };
    }
    const text = await turn.innerText().catch(() => '');
    if (expectedFile?.basename && text.includes(stripExtension(expectedFile.basename))) {
        return { ok: true, stage: 'attachment-verified', chipVisible: true, fileCount: 1, usedFallbacks: [], warnings: [] };
    }
    if (expectedFile?.basename && text.includes(expectedFile.basename)) {
        return { ok: true, stage: 'attachment-verified', chipVisible: true, fileCount: 1, usedFallbacks: [], warnings: [] };
    }
    const evidence = await turn.locator('[data-testid*="attachment" i], [data-testid*="file" i], img, [role="img"]').count().catch(() => 0);
    if (evidence === 0) {
        return { ok: false, stage: 'attachment-upload', error: 'sent turn has no attachment evidence', usedFallbacks: [] };
    }
    return { ok: true, stage: 'attachment-verified', chipVisible: true, fileCount: evidence, usedFallbacks: [], warnings: [] };
}

/**
 * @param {string} name
 * @returns {string}
 */
function extractExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? '' : name.slice(idx).toLowerCase();
}

/**
 * @param {string} name
 * @returns {string}
 */
function stripExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? name : name.slice(0, idx);
}
