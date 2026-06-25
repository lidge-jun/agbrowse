// @ts-check

// Parity catalog 201 #5 (P2): read-only product-surface detector. Non-mutating awareness
// of which product flows exist (ChatGPT Projects/Library/Apps/Deep-Research/Canvas,
// Gemini Deep-Research/Canvas). Distinct from agbrowse chatgpt-project-sources.mjs, which
// is an upload/mutation flow. Reverse port of cli-jaw web-ai/product-surfaces.ts.
// Detectors intentionally never mutate browser state (mutationAllowed: false).

/**
 * @typedef {'chatgpt-projects'|'chatgpt-library'|'chatgpt-apps'|'chatgpt-deep-research'|'gemini-deep-research'|'canvas'} ProductSurfaceId
 * @typedef {{ id: ProductSurfaceId, available: boolean, evidence: string[], mutationAllowed: false }} ProductSurfaceStatus
 */

/**
 * @param {any} page
 * @returns {Promise<ProductSurfaceStatus[]>}
 */
export async function detectChatGptProductSurfaces(page) {
    return [
        await detectByText(page, 'chatgpt-projects', ['Projects', 'New project']),
        await detectByText(page, 'chatgpt-library', ['Library', 'Add from library']),
        await detectByText(page, 'chatgpt-apps', ['Apps', 'Connected apps']),
        await detectByText(page, 'chatgpt-deep-research', ['Deep research', '/Deepresearch']),
        await detectBySelector(page, 'canvas', [
            '[data-testid="canvas-panel"]',
            'aside[data-testid*="canvas" i]',
            'section[aria-label*="Canvas" i]',
        ]),
    ];
}

/**
 * @param {any} page
 * @returns {Promise<ProductSurfaceStatus[]>}
 */
export async function detectGeminiProductSurfaces(page) {
    return [
        await detectByText(page, 'gemini-deep-research', ['Deep Research', 'Start research']),
        await detectBySelector(page, 'canvas', [
            'canvas-panel',
            '[aria-label*="Canvas" i]',
            'div[class*="canvas" i]',
        ]),
    ];
}

/**
 * @param {any} page
 * @param {ProductSurfaceId} id
 * @param {string[]} texts
 * @returns {Promise<ProductSurfaceStatus>}
 */
async function detectByText(page, id, texts) {
    const evidence = [];
    for (const text of texts) {
        const locator = page.getByText?.(text, { exact: false });
        const found = locator ? await locator.first().isVisible().catch(() => false) : false;
        if (found) evidence.push(text);
    }
    return { id, available: evidence.length > 0, evidence, mutationAllowed: false };
}

/**
 * @param {any} page
 * @param {ProductSurfaceId} id
 * @param {string[]} selectors
 * @returns {Promise<ProductSurfaceStatus>}
 */
async function detectBySelector(page, id, selectors) {
    const evidence = [];
    for (const selector of selectors) {
        const found = await page.locator(selector).first().isVisible().catch(() => false);
        if (found) evidence.push(selector);
    }
    return { id, available: evidence.length > 0, evidence, mutationAllowed: false };
}
