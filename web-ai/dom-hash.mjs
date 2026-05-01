import { createHash } from 'node:crypto';

export async function domHashAround(page, selectors, options = {}) {
    const maxChars = options.maxChars ?? 8192;
    const html = await page.evaluate((sels) => {
        const node = sels.map(s => document.querySelector(s)).find(Boolean);
        return node ? node.outerHTML : null;
    }, selectors).catch(() => null);
    if (!html) return null;
    return `sha256:${createHash('sha256').update(normalizeDomForHash(html).slice(0, maxChars)).digest('hex').slice(0, 16)}`;
}

export function normalizeDomForHash(html) {
    return String(html)
        .replace(/\sdata-[\w-]+="[^"]*"/g, '')
        .replace(/\saria-[\w-]+="[^"]*"/g, '')
        .replace(/\s(?:style|title|alt|placeholder|value)="[^"]*"/g, '')
        .replace(/>([^<]{1,})</g, '><')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function selectorMatchSummary(page, selectors) {
    const MAX_VISIBILITY_SCAN = 10;
    return Promise.all(selectors.map(async selector => {
        const loc = page.locator(selector);
        const matched = await loc.count().catch(() => 0);
        let visible = false;
        for (let i = 0; i < Math.min(matched, MAX_VISIBILITY_SCAN) && !visible; i += 1) {
            visible = await loc.nth(i).isVisible().catch(() => false);
        }
        return { selector, matched, visible };
    }));
}
