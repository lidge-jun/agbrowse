// @ts-check
/// <reference types="playwright-core" />
import { basename } from 'node:path';

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
    let lastError = 'upload surface did not expose a file input or chooser';
    for (const selector of selectors) {
        const clicked = await clickUploadButton(page, selector, usedFallbacks);
        if (!clicked) continue;
        await page.waitForTimeout(300).catch(() => undefined);

        const directInput = await setFilesOnDiscoveredInput(page, filePaths, probeFile, selector, uploadTimeoutMs);
        if (directInput.ok === true) return directInput;
        lastError = directInput.error;

        const menuItem = await findVisibleUploadMenuItem(page);
        if (menuItem) {
            const menuResult = await clickUploadMenuItemAndSetFiles(page, menuItem, filePaths, probeFile, uploadTimeoutMs);
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
 * @returns {Promise<UploadSurfaceResult>}
 */
async function setFilesOnDiscoveredInput(page, filePaths, probeFile, openerSelector, uploadTimeoutMs) {
    const inputSel = await findFirstFileInput(page, probeFile);
    if (!inputSel) return { ok: false, error: 'composer file input not found' };
    try {
        await page.locator(inputSel).first().setInputFiles(filePaths, { timeout: uploadTimeoutMs });
        return { ok: true, method: 'input', selector: inputSel };
    } catch (e) {
        return { ok: false, error: `setInputFiles after ${openerSelector} failed: ${/** @type {{message?: string}} */ (e)?.message}` };
    }
}

/**
 * @param {Page} page
 * @param {Locator} menuItem
 * @param {string|string[]} filePaths
 * @param {AttachmentProbeFile} probeFile
 * @param {number} uploadTimeoutMs
 * @returns {Promise<UploadSurfaceResult>}
 */
async function clickUploadMenuItemAndSetFiles(page, menuItem, filePaths, probeFile, uploadTimeoutMs) {
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
    return setFilesOnDiscoveredInput(page, filePaths, probeFile, 'upload-menu-item', uploadTimeoutMs);
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
