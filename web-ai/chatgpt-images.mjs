// @ts-check
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { resolveArtifactsDir, saveImageArtifact, appendArtifactRecord } from './session-artifacts.mjs';

const ESTUARY_PATTERN = /backend-api\/estuary\/content\?id=(file_[A-Za-z0-9_-]+)/;
const ALLOWED_HOST = 'chatgpt.com';

/**
 * @typedef {Object} DetectedImage
 * @property {string} url
 * @property {string} fileId
 * @property {string} alt
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} DownloadedImage
 * @property {string} path
 * @property {string} mimeType
 * @property {number} sizeBytes
 * @property {string} sourceUrl
 * @property {string} fileId
 */

/**
 * Detect generated images in assistant messages after a baseline count.
 * @param {any} cdpSession
 * @param {{ baselineAssistantCount?: number }} [opts]
 * @returns {Promise<DetectedImage[]>}
 */
export async function detectGeneratedImages(cdpSession, { baselineAssistantCount = 0 } = {}) {
    const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: `(() => {
            const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
            const relevant = Array.from(msgs).slice(${baselineAssistantCount});
            const imgs = [];
            for (const msg of relevant) {
                for (const img of msg.querySelectorAll('img')) {
                    const src = img.src || '';
                    const match = src.match(/backend-api\\/estuary\\/content\\?id=(file_[A-Za-z0-9_-]+)/);
                    if (match) {
                        imgs.push({
                            url: src,
                            fileId: match[1],
                            alt: img.alt || '',
                            width: img.naturalWidth || 0,
                            height: img.naturalHeight || 0,
                        });
                    }
                }
            }
            const deduped = new Map();
            for (const img of imgs) {
                const existing = deduped.get(img.fileId);
                if (!existing || (img.width * img.height) > (existing.width * existing.height)) {
                    deduped.set(img.fileId, img);
                }
            }
            return JSON.stringify(Array.from(deduped.values()));
        })()`,
        returnByValue: true,
    });
    if (!result?.value) return [];
    try {
        return JSON.parse(result.value);
    } catch {
        return [];
    }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedImageUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.hostname === ALLOWED_HOST && ESTUARY_PATTERN.test(parsed.pathname + parsed.search);
    } catch {
        return false;
    }
}

/**
 * Derive sibling output paths for multiple images.
 * e.g., "out.png" → ["out.png", "out-2.png", "out-3.png"]
 * @param {string} outputPath
 * @param {number} count
 * @returns {string[]}
 */
function deriveSiblingPaths(outputPath, count) {
    if (count <= 1) return [outputPath];
    const ext = extname(outputPath);
    const base = outputPath.slice(0, -ext.length || undefined);
    return Array.from({ length: count }, (_, i) =>
        i === 0 ? outputPath : `${base}-${i + 1}${ext}`
    );
}

/**
 * Download detected images using ChatGPT cookies.
 * @param {any} cdpSession
 * @param {DetectedImage[]} images
 * @param {{ outputPath?: string|null, sessionId?: string|null }} [opts]
 * @returns {Promise<DownloadedImage[]>}
 */
export async function downloadGeneratedImages(cdpSession, images, { outputPath, sessionId } = {}) {
    if (!images.length) return [];

    const { cookies } = await cdpSession.send('Network.getCookies', {
        urls: ['https://chatgpt.com/'],
    });
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    const results = [];
    const outputPaths = outputPath ? deriveSiblingPaths(outputPath, images.length) : [];

    for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!isAllowedImageUrl(img.url)) continue;

        try {
            const resp = await fetch(img.url, {
                headers: {
                    'Cookie': cookieHeader,
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                },
                redirect: 'manual',
            });

            if (resp.status >= 300 && resp.status < 400) continue;
            if (!resp.ok) continue;

            const contentType = resp.headers.get('content-type') || 'image/png';
            const ext = contentType.includes('jpeg') || contentType.includes('jpg') ? '.jpg'
                : contentType.includes('webp') ? '.webp'
                : contentType.includes('gif') ? '.gif'
                : '.png';

            const buffer = Buffer.from(await resp.arrayBuffer());
            let savePath;

            if (outputPaths[i]) {
                const dir = dirname(outputPaths[i]);
                if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
                writeFileSync(outputPaths[i], buffer);
                savePath = outputPaths[i];
            } else if (sessionId) {
                const desc = saveImageArtifact(sessionId, {
                    filename: `image-${i + 1}${ext}`,
                    buffer,
                    mimeType: contentType,
                    sourceUrl: img.url,
                });
                appendArtifactRecord(sessionId, desc);
                savePath = join(resolveArtifactsDir(sessionId), desc.path);
            } else {
                continue;
            }

            results.push({
                path: savePath,
                mimeType: contentType,
                sizeBytes: buffer.length,
                sourceUrl: img.url,
                fileId: img.fileId,
            });
        } catch {
            continue;
        }
    }
    return results;
}

/**
 * Collect generated images from a ChatGPT response.
 * @param {any} cdpSession
 * @param {{ baselineAssistantCount?: number, outputPath?: string|null, sessionId?: string|null, waitTimeoutMs?: number }} [opts]
 * @returns {Promise<{ images: DetectedImage[], savedPaths: string[], markdownSuffix: string }>}
 */
export async function collectImages(cdpSession, {
    baselineAssistantCount = 0,
    outputPath = null,
    sessionId = null,
    waitTimeoutMs = 60_000,
} = {}) {
    let images = await detectGeneratedImages(cdpSession, { baselineAssistantCount });

    if (!images.length && (outputPath || sessionId)) {
        const deadline = Date.now() + waitTimeoutMs;
        while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 1500));
            images = await detectGeneratedImages(cdpSession, { baselineAssistantCount });
            if (images.length) break;
        }
    }

    if (!images.length) {
        return { images: [], savedPaths: [], markdownSuffix: '' };
    }

    const downloaded = await downloadGeneratedImages(cdpSession, images, { outputPath, sessionId });
    const savedPaths = downloaded.map(d => d.path);
    const markdownSuffix = savedPaths.length
        ? '\n\n' + savedPaths.map((p, i) => `![Generated image ${i + 1}](${p})`).join('\n')
        : '';

    return { images, savedPaths, markdownSuffix };
}
