import { basename } from 'node:path';
import { statSync } from 'node:fs';

const HARD_LIMIT_BYTES = 512 * 1024 * 1024;
const IMAGE_LIMIT_BYTES = 20 * 1024 * 1024;
const SOFT_SPREADSHEET_BYTES = 50 * 1024 * 1024;

const UNSUPPORTED_EXTENSIONS = new Set(['.gdoc', '.gsheet', '.gslides']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic']);
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx']);

export const UPLOAD_BUTTON_SELECTORS = [
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

export function fileInfoFromPath(filePath) {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error(`not a regular file: ${filePath}`);
    return { path: filePath, basename: basename(filePath), sizeBytes: stat.size };
}

export function preflightAttachment(file) {
    const extension = extractExtension(file.basename);
    const softWarnings = [];
    if (UNSUPPORTED_EXTENSIONS.has(extension)) {
        return { ok: false, rejectedReason: `unsupported extension: ${extension}`, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
    }
    if (file.sizeBytes > HARD_LIMIT_BYTES) {
        return { ok: false, rejectedReason: `file exceeds 512MB hard limit (${file.sizeBytes})`, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
    }
    if (IMAGE_EXTENSIONS.has(extension) && file.sizeBytes > IMAGE_LIMIT_BYTES) {
        return { ok: false, rejectedReason: `image exceeds 20MB limit (${file.sizeBytes})`, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
    }
    if (SPREADSHEET_EXTENSIONS.has(extension) && file.sizeBytes > SOFT_SPREADSHEET_BYTES) {
        softWarnings.push(`spreadsheet over 50MB may be soft-blocked by ChatGPT (${file.sizeBytes})`);
    }
    return { ok: true, softWarnings, basename: file.basename, sizeBytes: file.sizeBytes, extension };
}

export async function attachLocalFileLive(page, file, options = {}) {
    const usedFallbacks = [];
    const warnings = [];
    const preflight = preflightAttachment(file);
    if (!preflight.ok) {
        return { ok: false, stage: 'attachment-preflight', error: preflight.rejectedReason || 'preflight rejected', usedFallbacks };
    }
    warnings.push(...preflight.softWarnings);

    let inputSel = await findFirstFileInput(page);
    if (!inputSel) {
        await openUploadSurface(page, usedFallbacks, options.uploadTarget);
        inputSel = await findFirstFileInput(page);
    }
    if (!inputSel) {
        return { ok: false, stage: 'attachment-upload', error: 'composer file input not found', usedFallbacks };
    }
    try {
        await page.locator(inputSel).first().setInputFiles(file.path, { timeout: 10_000 });
    } catch (e) {
        return { ok: false, stage: 'attachment-upload', error: `setInputFiles failed: ${e.message}`, usedFallbacks };
    }
    const accepted = await waitForAttachmentAcceptedLive(page, { timeoutMs: 45_000 });
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

export async function waitForAttachmentAcceptedLive(page, opts = {}) {
    const deadline = Date.now() + (opts.timeoutMs || 45_000);
    while (Date.now() < deadline) {
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

async function openUploadSurface(page, usedFallbacks, uploadTarget = null) {
    if (uploadTarget?.selector) {
        const clicked = await clickUploadButton(page, uploadTarget.selector);
        if (clicked) {
            await page.waitForTimeout(500);
            return;
        }
    }
    for (const sel of UPLOAD_BUTTON_SELECTORS) {
        const loc = page.locator(sel).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        try {
            await loc.click({ timeout: 3_000 });
            await page.waitForTimeout(500);
            return;
        } catch (e) {
            usedFallbacks.push(`upload-button-click-failed:${sel}:${e.message}`);
        }
    }
}

async function clickUploadButton(page, selector) {
    const loc = page.locator(selector).first();
    const visible = await loc.isVisible().catch(() => false);
    const enabled = typeof loc.isEnabled === 'function'
        ? await loc.isEnabled().catch(() => false)
        : true;
    if (!visible || !enabled) return false;
    try {
        await loc.click({ timeout: 3_000 });
        return true;
    } catch {
        return false;
    }
}

async function findFirstFileInput(page) {
    for (const sel of FILE_INPUT_SELECTORS) {
        if ((await page.locator(sel).count().catch(() => 0)) > 0) return sel;
    }
    return null;
}

function extractExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? '' : name.slice(idx).toLowerCase();
}

function stripExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? name : name.slice(0, idx);
}
