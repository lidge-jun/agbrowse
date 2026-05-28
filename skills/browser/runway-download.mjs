// @ts-check

import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';

/**
 * @param {any} deps
 * @param {string} text
 */
function emit(deps, text) {
    if (typeof deps.write === 'function') deps.write(text);
    else console.log(text);
}

/**
 * @param {string} url
 * @param {string} [contentType]
 * @returns {{ type: string, ext: string }}
 */
export function inferRunwayAssetType(url, contentType = '') {
    const lowerType = String(contentType || '').toLowerCase();
    const lowerUrl = String(url || '').toLowerCase();
    if (lowerType.includes('video/') || /\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(lowerUrl)) {
        return { type: 'video', ext: '.mp4' };
    }
    if (lowerType.includes('image/jpeg') || /\.jpe?g(?:[?#]|$)/i.test(lowerUrl)) {
        return { type: 'image', ext: '.jpg' };
    }
    if (lowerType.includes('image/') || /\.(?:png|webp|gif)(?:[?#]|$)/i.test(lowerUrl)) {
        return { type: 'image', ext: '.png' };
    }
    return { type: 'unknown', ext: '' };
}

/**
 * @param {string} outputPath
 * @param {{ ext: string }} asset
 * @returns {string}
 */
export function normalizeRunwayOutputPath(outputPath, asset) {
    if (!asset.ext) return outputPath;
    const currentExt = extname(outputPath).toLowerCase();
    if (!currentExt) return `${outputPath}${asset.ext}`;
    if (currentExt === asset.ext) return outputPath;
    return outputPath.slice(0, -currentExt.length) + asset.ext;
}

/**
 * Extract the most recent output asset URL from the Runway page.
 * @param {any} page
 * @param {number} [index] — 0-based index from most recent
 * @param {{ expectedType?: string }} [options]
 * @returns {Promise<{ url: string | null, type: string, error?: string }>}
 */
export async function extractRunwayOutputUrl(page, index = 0, options = {}) {
    try {
        const result = await page.evaluate((/** @type {{ idx: number, expectedType?: string }} */ opts) => {
            const outputPattern = /(?:result|task_artifact|video-previews|generation|cdn\.runwayml)/i;
            const assets = Array.from(document.querySelectorAll('video[src], video source[src], img[src]'))
                .map(el => ({
                    src: el.getAttribute('src') || '',
                    type: el.tagName.toLowerCase() === 'img' ? 'image' : 'video',
                }))
                .filter(v => v.src && outputPattern.test(v.src));
            const typed = opts.expectedType ? assets.filter(asset => asset.type === opts.expectedType) : assets;
            const all = typed.length ? typed : assets;

            // Most recent first (last matching asset in DOM = most recent).
            const recent = [...all].reverse();
            if (opts.idx >= recent.length) return { url: null, type: 'unknown' };
            return { url: recent[opts.idx].src, type: recent[opts.idx].type };
        }, { idx: index, expectedType: options.expectedType });
        return result;
    } catch (error) {
        return { url: null, type: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Download a Runway output asset to a local file.
 * @param {string} url
 * @param {string} outputPath
 * @returns {Promise<{ ok: boolean, path?: string, size?: number, error?: string }>}
 */
export async function downloadRunwayOutput(url, outputPath) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return { ok: false, error: `HTTP ${response.status}: ${response.statusText}` };
        }
        const contentType = response.headers.get('content-type') || '';
        const asset = inferRunwayAssetType(url, contentType);
        const normalizedPath = normalizeRunwayOutputPath(outputPath, asset);
        const absPath = resolve(normalizedPath);
        const requestedPath = resolve(outputPath);
        await mkdir(dirname(absPath), { recursive: true });
        const buffer = Buffer.from(await response.arrayBuffer());
        await writeFile(absPath, buffer);
        return {
            ok: true,
            path: absPath,
            requestedPath: requestedPath === absPath ? undefined : requestedPath,
            size: buffer.length,
            type: asset.type,
            contentType: contentType || undefined,
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Take a screenshot of the current Runway tab.
 * @param {any} page
 * @param {string} outputPath
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function screenshotRunway(page, outputPath) {
    try {
        const absPath = resolve(outputPath);
        await mkdir(dirname(absPath), { recursive: true });
        await page.screenshot({ path: absPath, fullPage: false });
        return { ok: true, path: absPath };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * @param {string} command — 'download' or 'screenshot'
 * @param {string[]} args
 * @param {any} deps
 */
export async function runRunwayDownloadCli(command, args = [], deps = {}) {
    const { values } = parseArgs({
        args,
        options: {
            index: { type: 'string', default: '0' },
            output: { type: 'string' },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });

    const page = await deps.getPage();

    if (command === 'screenshot') {
        if (!values.output) throw new Error('--output is required for screenshot command');
        const result = await screenshotRunway(page, String(values.output));
        const output = { ok: result.ok, command: 'screenshot', ...result };
        emit(deps, values.json ? JSON.stringify(output, null, 2) : `Screenshot: ${result.ok ? result.path : result.error}`);
        return;
    }

    // download
    const extracted = await extractRunwayOutputUrl(page, Number(values.index) || 0);
    if (!extracted.url) {
        const output = { ok: false, command: 'download', error: extracted.error || 'No output asset found on page' };
        emit(deps, values.json ? JSON.stringify(output, null, 2) : `Download failed: ${output.error}`);
        return;
    }

    if (!values.output) {
        const ext = extracted.type === 'video' ? '.mp4' : '.png';
        const output = {
            ok: true,
            command: 'download',
            url: extracted.url,
            type: extracted.type,
            hint: `Use --output <path${ext}> to save the file`,
        };
        emit(deps, values.json ? JSON.stringify(output, null, 2) : `Asset URL: ${extracted.url}\nType: ${extracted.type}\nUse --output to download.`);
        return;
    }

    const result = await downloadRunwayOutput(extracted.url, String(values.output));
    const output = {
        ok: result.ok,
        command: 'download',
        url: extracted.url,
        type: extracted.type,
        ...result,
    };
    emit(deps, values.json
        ? JSON.stringify(output, null, 2)
        : `Download: ${result.ok ? `${result.path} (${result.size} bytes)` : result.error}`);
}
