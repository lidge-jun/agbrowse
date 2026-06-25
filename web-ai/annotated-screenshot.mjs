// @ts-check

// Parity catalog 201 #3 (P1): annotated / set-of-mark screenshot — capture a page
// screenshot, resolve highlight ref bounding boxes, hash the image bytes, and return a
// visual-grounding descriptor. agbrowse used inline boundingBox only. Reverse port of
// cli-jaw web-ai/annotated-screenshot.ts. The overlay draw + dimension read are stubs
// (pending a sharp/canvas dep), matching the cli-jaw source; hashImageBytes +
// summarizeScreenshotForDoctor are pure.

import { createHash } from 'node:crypto';
import { WebAiError } from './errors.mjs';

/**
 * @typedef {{ provider?: string|null, highlightRefs?: string[], highlightColor?: string, padding?: number, maxDimension?: number, quality?: number }} AnnotatedScreenshotOptions
 * @typedef {{ screenshotId: string, provider: string|null, url: string|null, imageHash: string, format: 'png', width: number, height: number, highlightCount: number, timestamp: string }} AnnotatedScreenshotResult
 */

/**
 * @param {any} page
 * @param {AnnotatedScreenshotOptions} [options]
 * @returns {Promise<AnnotatedScreenshotResult>}
 */
export async function buildAnnotatedScreenshot(page, {
    provider = null,
    highlightRefs = [],
    highlightColor = 'rgba(255, 0, 0, 0.3)',
    padding = 4,
    maxDimension = 2048,
    quality = 90,
} = {}) {
    if (!page?.screenshot || typeof page.screenshot !== 'function') {
        throw new WebAiError({
            errorCode: 'screenshot.unavailable',
            stage: 'visual-fallback',
            retryHint: 'pin-playwright-or-add-cdp-fallback',
            message: 'page.screenshot() is not available in this Playwright runtime',
        });
    }

    const boxes = await resolveHighlightBoxes(page, highlightRefs);
    const screenshot = await page.screenshot({
        type: 'png',
        quality,
        fullPage: false,
        maxDimension,
    }).catch((/** @type {unknown} */ err) => {
        throw new WebAiError({
            errorCode: 'screenshot.capture-failed',
            stage: 'visual-fallback',
            retryHint: 'retry-or-skip-visual',
            message: (/** @type {{message?: string}} */ (err))?.message || 'screenshot capture failed',
            evidence: { err },
        });
    });

    const annotated = boxes.length > 0
        ? await drawHighlightOverlay(screenshot, boxes, { highlightColor, padding })
        : screenshot;

    const imageHash = hashImageBytes(annotated);
    const dimensions = await readImageDimensions(annotated);

    return {
        screenshotId: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        provider,
        url: page.url?.() || null,
        imageHash,
        format: 'png',
        width: dimensions.width,
        height: dimensions.height,
        highlightCount: boxes.length,
        timestamp: new Date().toISOString(),
    };
}

/**
 * @param {any} page
 * @param {string[]} refs
 * @returns {Promise<Array<{ x: number, y: number, width: number, height: number }>>}
 */
async function resolveHighlightBoxes(page, refs) {
    if (!refs.length) return [];
    return page.evaluate((/** @type {string[]} */ refList) => {
        const boxes = [];
        for (const ref of refList) {
            const el = globalThis.document.querySelector(`[data-web-ai-ref="${ref}"]`);
            if (!el) continue;
            const rect = el.getBoundingClientRect();
            boxes.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
        return boxes;
    }, refs).catch(() => []);
}

/**
 * @param {Buffer} image
 * @param {Array<{ x: number, y: number, width: number, height: number }>} boxes
 * @param {{ highlightColor: string, padding: number }} _opts
 * @returns {Promise<Buffer>}
 */
async function drawHighlightOverlay(image, boxes, _opts) {
    void boxes;
    // TODO: integrate with sharp or canvas library for actual overlay drawing
    return image;
}

/**
 * @param {Buffer} image
 * @returns {Promise<{ width: number, height: number }>}
 */
async function readImageDimensions(image) {
    void image;
    // TODO: integrate with sharp or image-size library
    return { width: 0, height: 0 };
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
export function hashImageBytes(buffer) {
    return `sha256:${createHash('sha256').update(buffer).digest('hex').slice(0, 16)}`;
}

/**
 * @param {AnnotatedScreenshotResult|null|undefined} result
 */
export function summarizeScreenshotForDoctor(result) {
    return {
        enabled: true,
        screenshotId: result?.screenshotId || null,
        imageHash: result?.imageHash || null,
        width: result?.width || 0,
        height: result?.height || 0,
        highlightCount: result?.highlightCount || 0,
    };
}
