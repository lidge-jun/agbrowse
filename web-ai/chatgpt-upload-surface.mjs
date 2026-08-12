// @ts-check
/// <reference types="playwright-core" />
import { basename, resolve as resolvePath } from 'node:path';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */

/**
 * @typedef {Object} AttachmentProbeFile
 * @property {string} path
 * @property {string} basename
 */

/**
 * @typedef {Object} AttachmentTarget
 * @property {string} [selector]
 */

/**
 * @typedef {Object} UploadSurfaceOptions
 * @property {number|string|null} [uploadTimeoutMs]
 * @property {number} [totalBytes]
 */

/**
 * @typedef {Object} UploadSurfaceResultOk
 * @property {true} ok
 * @property {string} method
 * @property {string} [selector]
 */

/**
 * @typedef {Object} UploadSurfaceResultFail
 * @property {false} ok
 * @property {string} error
 */

/** @typedef {UploadSurfaceResultOk | UploadSurfaceResultFail} UploadSurfaceResult */

export const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);
export const DEFAULT_ATTACHMENT_UPLOAD_TIMEOUT_MS = 60_000;
/**
 * Playwright treats connectOverCDP browsers as remote and streams file bytes
 * over the driver websocket with a hard ~50MB per-file limit
 * (microsoft/playwright#34192). agbrowse always drives a LOCAL Chrome, so raw
 * CDP `DOM.setFileInputFiles` with local absolute paths transfers zero bytes
 * and has no size limit. Above this threshold we inject via CDP first.
 */
export const CDP_INJECTION_THRESHOLD_BYTES = 45 * 1024 * 1024;
const PLAYWRIGHT_TRANSFER_LIMIT_PATTERN = /50 ?mb|larger than/i;
const ACCEPTANCE_BYTES_PER_SECOND = 250 * 1024;      // conservative ~2 Mbps upstream
const HANDOFF_BYTES_PER_SECOND = 5 * 1024 * 1024;    // driver-websocket streaming
const SEND_READY_BYTES_PER_SECOND = 1024 * 1024;
const ACCEPTANCE_CEILING_MS = 900_000;
const HANDOFF_CEILING_MS = 300_000;
const SEND_READY_CEILING_MS = 300_000;

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampMs(value, min, max) {
    return Math.floor(Math.min(Math.max(value, min), max));
}

/**
 * Size-aware timeout budgets for one attachment batch. Explicit
 * `attachmentUploadTimeoutMs` (option or env, PR #82 semantics) wins for the
 * browser handoff; acceptance and send-readiness scale with total bytes so a
 * 100MB upload is no longer judged by a fixed 45/60s window.
 *
 * @param {Array<{ sizeBytes?: number }>} [files]
 * @param {{ attachmentUploadTimeoutMs?: number|string|null }} [options]
 * @returns {{ totalBytes: number, handoffMs: number, acceptanceMs: number, sendReadyMs: number }}
 */
export function computeAttachmentTimeouts(files = [], options = {}) {
    const list = Array.isArray(files) ? files : [];
    const totalBytes = list.reduce((sum, file) => sum + (Number(file?.sizeBytes) || 0), 0);
    const explicit = options.attachmentUploadTimeoutMs ?? process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS;
    const explicitMs = (explicit === undefined || explicit === null || explicit === '') ? NaN : Number(explicit);
    const handoffMs = Number.isFinite(explicitMs) && explicitMs > 0
        ? Math.round(explicitMs)
        : clampMs(
            DEFAULT_ATTACHMENT_UPLOAD_TIMEOUT_MS + (totalBytes / HANDOFF_BYTES_PER_SECOND) * 1000,
            DEFAULT_ATTACHMENT_UPLOAD_TIMEOUT_MS,
            HANDOFF_CEILING_MS,
        );
    const acceptanceBaseMs = list.length > 1 ? 60_000 : 45_000;
    let acceptanceMs = clampMs(
        acceptanceBaseMs + (totalBytes / ACCEPTANCE_BYTES_PER_SECOND) * 1000,
        acceptanceBaseMs,
        ACCEPTANCE_CEILING_MS,
    );
    const acceptanceFloorMs = Number(process.env.AGBROWSE_ATTACHMENT_ACCEPT_TIMEOUT_MS);
    if (Number.isFinite(acceptanceFloorMs) && acceptanceFloorMs > 0) {
        acceptanceMs = Math.max(acceptanceMs, Math.round(acceptanceFloorMs));
    }
    const sendReadyMs = list.length === 0
        ? 20_000
        : clampMs(45_000 + (totalBytes / SEND_READY_BYTES_PER_SECOND) * 1000, 45_000, SEND_READY_CEILING_MS);
    return { totalBytes, handoffMs, acceptanceMs, sendReadyMs };
}

/**
 * Inject local file paths into a file input through raw CDP
 * `DOM.setFileInputFiles`. Zero-byte transfer, no Playwright 50MB limit.
 * Degrades to `{ ok: false }` on fake/unit-test pages without a CDP session.
 *
 * @param {Page} page
 * @param {string} inputSel
 * @param {string|string[]} filePaths
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function setInputFilesViaCdp(page, inputSel, filePaths) {
    const context = typeof (/** @type {any} */ (page)?.context) === 'function'
        ? (/** @type {any} */ (page)).context()
        : null;
    if (!context || typeof context.newCDPSession !== 'function') {
        return { ok: false, error: 'cdp session unavailable on this page' };
    }
    /** @type {{ send: Function, detach?: Function }|null} */
    let session = null;
    try {
        const cdp = await context.newCDPSession(page);
        session = cdp;
        const files = (Array.isArray(filePaths) ? filePaths : [filePaths]).map(path => resolvePath(String(path)));
        const doc = await cdp.send('DOM.getDocument');
        const rootNodeId = doc?.root?.nodeId;
        if (!rootNodeId) return { ok: false, error: 'cdp DOM.getDocument returned no root node' };
        const node = await cdp.send('DOM.querySelector', { nodeId: rootNodeId, selector: inputSel });
        if (!node?.nodeId) return { ok: false, error: `cdp querySelector found no node for ${inputSel}` };
        await cdp.send('DOM.setFileInputFiles', { files, nodeId: node.nodeId });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: `cdp setFileInputFiles failed: ${/** @type {{message?: string}} */ (e)?.message || e}` };
    } finally {
        await session?.detach?.().catch(() => undefined);
    }
}

/**
 * Set files on a discovered input with the 50MB-safe strategy: CDP-first for
 * large batches, Playwright `setInputFiles` otherwise, each falling back to
 * the other. Records the effective method in `usedFallbacks`.
 *
 * @param {Page} page
 * @param {string} inputSel
 * @param {string|string[]} filePaths
 * @param {{ timeoutMs?: number|string|null, totalBytes?: number, usedFallbacks?: string[] }} [options]
 * @returns {Promise<{ ok: true, method: string } | { ok: false, error: string }>}
 */
export async function setInputFilesResilient(page, inputSel, filePaths, options = {}) {
    const timeoutMs = resolveAttachmentUploadTimeoutMs(options.timeoutMs);
    const totalBytes = Number(options.totalBytes) || 0;
    const usedFallbacks = Array.isArray(options.usedFallbacks) ? options.usedFallbacks : [];
    const cdpFirst = totalBytes >= CDP_INJECTION_THRESHOLD_BYTES;
    if (cdpFirst) {
        const viaCdp = await setInputFilesViaCdp(page, inputSel, filePaths);
        if (viaCdp.ok === true) {
            usedFallbacks.push('attachment-cdp-set-file-input');
            return { ok: true, method: 'cdp' };
        }
        usedFallbacks.push(`attachment-cdp-injection-unavailable:${viaCdp.error}`);
    }
    try {
        await page.locator(inputSel).first().setInputFiles(filePaths, { timeout: timeoutMs });
        return { ok: true, method: 'input' };
    } catch (e) {
        const message = String(/** @type {{message?: string}} */ (e)?.message || e);
        if (!cdpFirst && PLAYWRIGHT_TRANSFER_LIMIT_PATTERN.test(message)) {
            const viaCdp = await setInputFilesViaCdp(page, inputSel, filePaths);
            if (viaCdp.ok === true) {
                usedFallbacks.push('attachment-cdp-set-file-input');
                return { ok: true, method: 'cdp' };
            }
            return { ok: false, error: `setInputFiles failed: ${message}; cdp fallback failed: ${viaCdp.error}` };
        }
        return { ok: false, error: `setInputFiles failed: ${message}` };
    }
}

export const UPLOAD_BUTTON_SELECTORS = [
    '[data-testid="composer-plus-btn"]',
    'button[aria-label="Add files and more"]',
    'button[aria-label="파일 추가 및 기타"]',
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[aria-label*="Add" i]',
    'button[data-testid*="plus" i]',
    'button:has-text("Upload")',
];

const FILE_INPUT_SELECTORS = [
    'main input[type="file"]',
    'form input[type="file"]',
    'input[type="file"][multiple]',
    'input[type="file"]',
];

const UPLOAD_MENU_ITEM_LABELS = [
    'Add photos & files',
    'Add photos and files',
    'Upload from computer',
    '사진 및 파일 추가',
    '사진과 파일 추가',
    '파일 추가',
];

const UPLOAD_MENU_ITEM_EXCLUDED_LABELS = [
    'Add files and more',
    '파일 추가 및 기타',
];

const MENU_CANDIDATE_SELECTOR = [
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[role="menuitemcheckbox"]',
    '[role="option"]',
    'button',
    'a',
    'div[role="button"]',
].join(', ');

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isImageAttachmentPath(filePath) {
    return IMAGE_ATTACHMENT_EXTENSIONS.has(extractExtension(basename(filePath)));
}

/**
 * @param {{ selector?: string, accept?: string|null, multiple?: boolean, visible?: boolean, inComposer?: boolean }} inputMetadata
 * @param {{ isImageAttachment?: boolean }} options
 * @returns {number}
 */
export function scoreFileInputCandidate(inputMetadata = {}, options = {}) {
    const accept = String(inputMetadata.accept || '').toLowerCase();
    const acceptsOnlyImages = accept && accept.split(',').every(part => part.trim().startsWith('image/'));
    if (acceptsOnlyImages && options.isImageAttachment !== true) return Number.NEGATIVE_INFINITY;
    let score = 0;
    if (inputMetadata.inComposer) score += 20;
    if (inputMetadata.visible) score += 10;
    if (inputMetadata.multiple) score += 5;
    if (acceptsOnlyImages && options.isImageAttachment === true) score += 3;
    return score;
}

/**
 * @param {Page} page
 * @param {AttachmentProbeFile} file
 * @returns {Promise<string|null>}
 */
export async function findFirstFileInput(page, file) {
    let best = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const sel of FILE_INPUT_SELECTORS) {
        const loc = page.locator(sel).first();
        if ((await page.locator(sel).count().catch(() => 0)) === 0) continue;
        const accept = typeof loc.getAttribute === 'function'
            ? await loc.getAttribute('accept').catch(() => null)
            : null;
        const multipleAttr = typeof loc.getAttribute === 'function'
            ? await loc.getAttribute('multiple').catch(() => null)
            : null;
        const visible = typeof loc.isVisible === 'function'
            ? await loc.isVisible().catch(() => false)
            : false;
        const score = scoreFileInputCandidate({
            selector: sel,
            accept,
            multiple: multipleAttr !== null || sel.includes('multiple'),
            visible,
            inComposer: sel.startsWith('main') || sel.startsWith('form'),
        }, { isImageAttachment: isImageAttachmentPath(file?.basename || file?.path || '') });
        if (score > bestScore) {
            best = sel;
            bestScore = score;
        }
    }
    return bestScore === Number.NEGATIVE_INFINITY ? null : best;
}

/**
 * @param {Page} page
 * @param {string|string[]} filePaths
 * @param {AttachmentProbeFile} probeFile
 * @param {string[]} usedFallbacks
 * @param {AttachmentTarget|null} [uploadTarget]
 * @param {UploadSurfaceOptions} [options]
 * @returns {Promise<UploadSurfaceResult>}
 */
export async function setFilesViaUploadSurface(page, filePaths, probeFile, usedFallbacks, uploadTarget = null, options = {}) {
    const selectors = uploadTarget?.selector ? [uploadTarget.selector] : UPLOAD_BUTTON_SELECTORS;
    const uploadTimeoutMs = resolveAttachmentUploadTimeoutMs(options.uploadTimeoutMs);
    const totalBytes = Number(options.totalBytes) || 0;
    let lastError = 'upload surface did not expose a file input or chooser';
    for (const selector of selectors) {
        const clicked = await clickUploadButton(page, selector, usedFallbacks);
        if (!clicked) continue;
        await page.waitForTimeout(300).catch(() => undefined);

        const directInput = await setFilesOnDiscoveredInput(page, filePaths, probeFile, selector, uploadTimeoutMs, totalBytes, usedFallbacks);
        if (directInput.ok === true) return directInput;
        lastError = directInput.error;

        const menuItem = await findVisibleUploadMenuItem(page);
        if (menuItem) {
            const menuResult = await clickUploadMenuItemAndSetFiles(page, menuItem, filePaths, probeFile, uploadTimeoutMs, totalBytes, usedFallbacks);
            if (menuResult.ok === true) return menuResult;
            lastError = menuResult.error;
        }

        usedFallbacks.push(`upload-surface-no-file-input:${selector}`);
        await page.keyboard?.press?.('Escape').catch(() => undefined);
        await page.waitForTimeout(100).catch(() => undefined);
    }
    return { ok: false, error: lastError };
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function resolveAttachmentUploadTimeoutMs(value, fallback = DEFAULT_ATTACHMENT_UPLOAD_TIMEOUT_MS) {
    const configured = value ?? process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS;
    if (configured === undefined || configured === null || configured === '') return fallback;
    const parsed = Number(configured);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * @param {Page} page
 * @param {string|string[]} filePaths
 * @param {AttachmentProbeFile} probeFile
 * @param {string} openerSelector
 * @param {number} uploadTimeoutMs
 * @param {number} [totalBytes]
 * @param {string[]} [usedFallbacks]
 * @returns {Promise<UploadSurfaceResult>}
 */
async function setFilesOnDiscoveredInput(page, filePaths, probeFile, openerSelector, uploadTimeoutMs, totalBytes = 0, usedFallbacks = []) {
    const inputSel = await findFirstFileInput(page, probeFile);
    if (!inputSel) return { ok: false, error: 'composer file input not found' };
    const injected = await setInputFilesResilient(page, inputSel, filePaths, { timeoutMs: uploadTimeoutMs, totalBytes, usedFallbacks });
    if (injected.ok === true) return { ok: true, method: injected.method, selector: inputSel };
    return { ok: false, error: `setInputFiles after ${openerSelector} failed: ${injected.error}` };
}

/**
 * @param {Page} page
 * @param {Locator} menuItem
 * @param {string|string[]} filePaths
 * @param {AttachmentProbeFile} probeFile
 * @param {number} uploadTimeoutMs
 * @param {number} [totalBytes]
 * @param {string[]} [usedFallbacks]
 * @returns {Promise<UploadSurfaceResult>}
 */
async function clickUploadMenuItemAndSetFiles(page, menuItem, filePaths, probeFile, uploadTimeoutMs, totalBytes = 0, usedFallbacks = []) {
    const chooserPromise = waitForFileChooser(page);
    const clicked = await menuItem.click({ timeout: 3_000 })
        .then(() => true)
        .catch(async () => {
            const box = await menuItem.boundingBox?.().catch(() => null);
            if (!box) return false;
            return page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
                .then(() => true)
                .catch(() => false);
        });
    if (!clicked) return { ok: false, error: 'upload menu item click failed' };

    const chooser = await chooserPromise;
    if (chooser) {
        try {
            await chooser.setFiles(filePaths, { timeout: uploadTimeoutMs });
            return { ok: true, method: 'filechooser' };
        } catch (e) {
            return { ok: false, error: `filechooser.setFiles failed: ${/** @type {{message?: string}} */ (e)?.message}` };
        }
    }

    await page.waitForTimeout(300).catch(() => undefined);
    return setFilesOnDiscoveredInput(page, filePaths, probeFile, 'upload-menu-item', uploadTimeoutMs, totalBytes, usedFallbacks);
}

/**
 * @param {Page} page
 * @returns {Promise<{ setFiles: (files: string|string[], options?: { timeout?: number }) => Promise<void> }|null>}
 */
async function waitForFileChooser(page) {
    if (typeof page.waitForEvent !== 'function') return null;
    return page.waitForEvent('filechooser', { timeout: 750 }).catch(() => null);
}

/**
 * @param {Page} page
 * @returns {Promise<Locator|null>}
 */
async function findVisibleUploadMenuItem(page) {
    const candidates = await page.locator(MENU_CANDIDATE_SELECTOR).all().catch(() => /** @type {Locator[]} */ ([]));
    for (const candidate of candidates) {
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const text = normalizeUiText(await candidate.innerText({ timeout: 500 }).catch(() => ''));
        if (!text) continue;
        if (UPLOAD_MENU_ITEM_EXCLUDED_LABELS.some(label => textIncludesLabel(text, label))) continue;
        if (UPLOAD_MENU_ITEM_LABELS.some(label => textIncludesLabel(text, label))) return candidate;
    }
    return null;
}

/**
 * @param {Page} page
 * @param {string} selector
 * @param {string[]} usedFallbacks
 * @returns {Promise<boolean>}
 */
async function clickUploadButton(page, selector, usedFallbacks) {
    const loc = page.locator(selector).first();
    const visible = await loc.isVisible().catch(() => false);
    const enabled = typeof loc.isEnabled === 'function'
        ? await loc.isEnabled().catch(() => false)
        : true;
    if (!visible || !enabled) return false;
    try {
        await loc.click({ timeout: 3_000 });
        return true;
    } catch (e) {
        usedFallbacks.push(`upload-button-click-failed:${selector}:${/** @type {{message?: string}} */ (e)?.message}`);
        return false;
    }
}

/** @param {unknown} text */
function normalizeUiText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} haystack @param {string} label */
function textIncludesLabel(haystack, label) {
    const normalized = normalizeUiText(label);
    return normalized && haystack.includes(normalized);
}

/**
 * @param {string} name
 * @returns {string}
 */
function extractExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? '' : name.slice(idx).toLowerCase();
}
