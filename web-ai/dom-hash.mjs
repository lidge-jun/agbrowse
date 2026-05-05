// @ts-check
/// <reference types="playwright-core" />
import { createHash } from 'node:crypto';

/**
 * @param {import('playwright-core').Page} page
 * @param {string[]} selectors
 * @param {{ maxChars?: number }} [options]
 * @returns {Promise<string|null>}
 */
export async function domHashAround(page, selectors, options = {}) {
    const maxChars = options.maxChars ?? 8192;
    const html = await page.evaluate((/** @type {string[]} */ sels) => {
        for (const s of sels) {
            try { const n = document.querySelector(s); if (n) return n.outerHTML; } catch { /* invalid selector */ }
        }
        return null;
    }, selectors).catch(() => null);
    if (!html) return null;
    return `sha256:${createHash('sha256').update(normalizeDomForHash(html).slice(0, maxChars)).digest('hex').slice(0, 16)}`;
}

/**
 * @param {string} html
 * @returns {string}
 */
export function normalizeDomForHash(html) {
    return String(html)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(\w+)\s[^>]*>/g, '<$1>')
        .replace(/>([^<]+)</g, '><')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * @param {import('playwright-core').Page} page
 * @param {string[]} selectors
 * @returns {Promise<Array<{ selector: string, matched: number, visible: boolean }>>}
 */
export async function selectorMatchSummary(page, selectors) {
    const MAX_VISIBILITY_SCAN = 10;
    return Promise.all(selectors.map(async (selector) => {
        const loc = page.locator(selector);
        const matched = await loc.count().catch(() => 0);
        let visible = false;
        for (let i = 0; i < Math.min(matched, MAX_VISIBILITY_SCAN) && !visible; i += 1) {
            visible = await loc.nth(i).isVisible().catch(() => false);
        }
        return { selector, matched, visible };
    }));
}
