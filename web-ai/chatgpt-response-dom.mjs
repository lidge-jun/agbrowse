// @ts-check

export const CHATGPT_ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"]',
];

export const CHATGPT_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
];

/**
 * Browser-context helper. Keep this self-contained so Playwright can serialize
 * it into page.evaluate without relying on module closures.
 * @param {string[]} selectors
 * @returns {string[]}
 */
export function readTopLevelAssistantTexts(selectors) {
    const activeSelectors = Array.isArray(selectors) && selectors.length
        ? selectors
        : [
            '[data-message-author-role="assistant"]',
            '[data-turn="assistant"]',
            'article[data-testid^="conversation-turn"]',
        ];
    const isInsideAnotherMatchedNode = (/** @type {any} */ el, /** @type {any[]} */ matched) =>
        matched.some(other => other !== el && typeof other.contains === 'function' && other.contains(el));

    for (const selector of activeSelectors) {
        const matched = Array.from(document.querySelectorAll(selector));
        const topLevel = matched.filter(el => !isInsideAnotherMatchedNode(el, matched));
        const texts = topLevel
            .map(el => String((/** @type {any} */ (el)).innerText || el.textContent || '').trim())
            .filter(Boolean);
        if (texts.length) return texts;
    }
    return [];
}

/**
 * Fallback path for environments where page.evaluate fails but Playwright
 * locators still work. It applies the same descendant de-duplication rule as
 * readTopLevelAssistantTexts().
 * @param {any} page
 * @param {string[]} selectors
 * @returns {Promise<string[]>}
 */
export async function readTopLevelAssistantTextsFromLocators(page, selectors = CHATGPT_ASSISTANT_SELECTORS) {
    for (const selector of selectors) {
        const locators = await page.locator(selector).all().catch(() => []);
        const texts = [];
        for (const locator of locators) {
            let text = '';
            if (typeof locator.evaluate === 'function') {
                text = await locator.evaluate((/** @type {any} */ node, /** @type {string} */ activeSelector) => {
                    const matched = Array.from(document.querySelectorAll(activeSelector));
                    const nested = matched.some(other =>
                        other !== node && typeof other.contains === 'function' && other.contains(node));
                    if (nested) return '';
                    return String(node.innerText || node.textContent || '').trim();
                }, selector).catch(() => '');
            } else {
                text = await locator.innerText().catch(() => '');
            }
            text = String(text || '').trim();
            if (text) texts.push(text);
        }
        if (texts.length) return texts;
    }
    return [];
}
