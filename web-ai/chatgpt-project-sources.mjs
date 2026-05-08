// @ts-check
import { existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, basename } from 'node:path';

/**
 * @typedef {Object} ProjectSource
 * @property {string} name
 * @property {string} type
 */

/**
 * @typedef {Object} UploadResult
 * @property {string} name
 * @property {string} type
 * @property {boolean} uploaded
 */

const PROJECT_URL_PATTERN = /^https:\/\/chatgpt\.com\/g\/[a-zA-Z0-9_-]+/;

const SOURCE_ENTRY_SELECTORS = [
    '[data-testid="project-source-item"]',
    '[class*="source-item"]',
    '.project-source-entry',
];

const ADD_SOURCE_SELECTORS = [
    'button[data-testid="add-source"]',
    'button:has-text("Add source")',
    'button:has-text("Upload")',
    'button[aria-label*="Add" i]',
];

/**
 * Validate a ChatGPT project URL.
 * @param {string} url
 * @returns {{ ok: boolean, error?: string }}
 */
function validateProjectUrl(url) {
    if (!url) return { ok: false, error: 'project URL is required' };
    if (!PROJECT_URL_PATTERN.test(url)) {
        return { ok: false, error: `not a valid ChatGPT project URL: ${url}` };
    }
    return { ok: true };
}

/**
 * Validate local file paths for upload.
 * @param {string[]} filePaths
 * @returns {{ valid: Array<{ path: string, name: string, size: number }>, errors: string[] }}
 */
function validateFiles(filePaths) {
    /** @type {Array<{ path: string, name: string, size: number }>} */
    const valid = [];
    const errors = [];
    const MAX_SIZE = 512 * 1024 * 1024;

    for (const fp of filePaths) {
        const abs = resolve(fp);
        if (!existsSync(abs)) {
            errors.push(`file not found: ${fp}`);
            continue;
        }
        let real;
        try {
            real = realpathSync(abs);
        } catch {
            errors.push(`cannot resolve realpath: ${fp}`);
            continue;
        }
        const stat = statSync(real);
        if (!stat.isFile()) {
            errors.push(`not a regular file: ${fp}`);
            continue;
        }
        if (stat.size > MAX_SIZE) {
            errors.push(`file too large (${stat.size} bytes, max ${MAX_SIZE}): ${fp}`);
            continue;
        }
        valid.push({ path: real, name: basename(real), size: stat.size });
    }
    return { valid, errors };
}

/**
 * List project sources from a ChatGPT project.
 * @param {any} cdpSession
 * @param {{ projectUrl: string }} opts
 * @returns {Promise<{ ok: boolean, sources: ProjectSource[], warnings: string[] }>}
 */
export async function listProjectSources(cdpSession, { projectUrl }) {
    const urlCheck = validateProjectUrl(projectUrl);
    if (!urlCheck.ok) {
        return { ok: false, sources: [], warnings: [urlCheck.error || 'invalid-url'] };
    }

    try {
        await cdpSession.send('Page.enable');
        await cdpSession.send('Page.navigate', { url: projectUrl });
        await new Promise(r => setTimeout(r, 3000));

        const { result } = await cdpSession.send('Runtime.evaluate', {
            expression: `(() => {
                const selectors = ${JSON.stringify(SOURCE_ENTRY_SELECTORS)};
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length) {
                        return JSON.stringify(Array.from(els).map(el => ({
                            name: el.textContent?.trim() || '',
                            type: el.getAttribute('data-type') || 'file',
                        })));
                    }
                }
                return '[]';
            })()`,
            returnByValue: true,
        });

        const sources = result?.value ? JSON.parse(result.value) : [];
        return { ok: true, sources, warnings: [] };
    } catch (err) {
        return { ok: false, sources: [], warnings: [err?.message || 'list-failed'] };
    }
}

/**
 * Add files as project sources to a ChatGPT project.
 * @param {any} cdpSession
 * @param {{ projectUrl: string, filePaths: string[], dryRun?: boolean }} opts
 * @returns {Promise<{ ok: boolean, uploads: UploadResult[], warnings: string[], errors: string[] }>}
 */
export async function addProjectSource(cdpSession, { projectUrl, filePaths, dryRun = false }) {
    const urlCheck = validateProjectUrl(projectUrl);
    if (!urlCheck.ok) {
        return { ok: false, uploads: [], warnings: [], errors: [urlCheck.error || 'invalid-url'] };
    }

    const { valid, errors } = validateFiles(filePaths);
    if (!valid.length) {
        return { ok: false, uploads: [], warnings: [], errors: errors.length ? errors : ['no valid files'] };
    }

    if (dryRun) {
        return {
            ok: true,
            uploads: valid.map(f => ({ name: f.name, type: 'file', uploaded: false })),
            warnings: ['dry-run-no-upload'],
            errors,
        };
    }

    try {
        await cdpSession.send('Page.enable');
        await cdpSession.send('DOM.enable');
        await cdpSession.send('Page.navigate', { url: projectUrl });
        await new Promise(r => setTimeout(r, 3000));

        const { result: clickResult } = await cdpSession.send('Runtime.evaluate', {
            expression: `(() => {
                const selectors = ${JSON.stringify(ADD_SOURCE_SELECTORS)};
                for (const sel of selectors) {
                    const btn = document.querySelector(sel);
                    if (btn) { btn.click(); return 'clicked'; }
                }
                return 'not-found';
            })()`,
            returnByValue: true,
        });

        if (clickResult?.value !== 'clicked') {
            return { ok: false, uploads: [], warnings: ['add-source-button-not-found'], errors };
        }

        await new Promise(r => setTimeout(r, 1000));

        const { result: fileInputResult } = await cdpSession.send('Runtime.evaluate', {
            expression: `(() => {
                const input = document.querySelector('input[type="file"]');
                return input ? 'found' : 'not-found';
            })()`,
            returnByValue: true,
        });

        if (fileInputResult?.value !== 'found') {
            return { ok: false, uploads: [], warnings: ['file-input-not-found'], errors };
        }

        const { root } = await cdpSession.send('DOM.getDocument');
        const { nodeId } = await cdpSession.send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: 'input[type="file"]',
        });

        await cdpSession.send('DOM.setFileInputFiles', {
            nodeId,
            files: valid.map(f => f.path),
        });

        await new Promise(r => setTimeout(r, 3000));

        return {
            ok: true,
            uploads: valid.map(f => ({ name: f.name, type: 'file', uploaded: true })),
            warnings: [],
            errors,
        };
    } catch (err) {
        return {
            ok: false,
            uploads: [],
            warnings: [err?.message || 'upload-failed'],
            errors,
        };
    }
}
