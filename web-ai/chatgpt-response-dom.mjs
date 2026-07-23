// @ts-check

export const CHATGPT_ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"]',
];

export const CHATGPT_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'form button[aria-label*="Stop" i]:not([aria-label*="dictat" i]):not([aria-label*="voice" i]):not([aria-label*="read" i])',
];

/**
 * Browser-context helper. Returns whether the current ChatGPT response has
 * positive live-generation evidence.
 * @param {{ assistantSelectors: string[], stopSelectors: string[] }} options
 * @returns {boolean}
 */
export function readChatGptStreamingState({ assistantSelectors, stopSelectors }) {
    const isVisible = (/** @type {Element} */ node) => {
        if (!(node instanceof HTMLElement)) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };
    const norm = (/** @type {unknown} */ value) =>
        String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const hasLiveProgress = (/** @type {ParentNode} */ scope) => {
        let nodes;
        try {
            nodes = scope.querySelectorAll('progress, [role="progressbar"]');
        } catch {
            return false;
        }
        return Array.from(nodes).some(node => {
            if (!isVisible(node)) return false;
            if (node instanceof HTMLProgressElement) {
                if (!node.hasAttribute('value')) return true;
                return Number.isFinite(node.value) && Number.isFinite(node.max)
                    ? node.value < node.max
                    : true;
            }
            const rawNow = node.getAttribute('aria-valuenow');
            if (rawNow == null) return true;
            const now = Number(rawNow);
            const rawMax = node.getAttribute('aria-valuemax');
            const max = rawMax != null && Number.isFinite(Number(rawMax))
                ? Number(rawMax)
                : 100;
            return Number.isFinite(now) ? now < max : true;
        });
    };

    for (const selector of stopSelectors) {
        let nodes;
        try {
            nodes = document.querySelectorAll(selector);
        } catch {
            continue;
        }
        if (Array.from(nodes).some(isVisible)) return true;
    }

    const activeAssistantSelectors = Array.isArray(assistantSelectors) && assistantSelectors.length
        ? assistantSelectors
        : CHATGPT_ASSISTANT_SELECTORS;
    const roleSelectors = [
        '[data-message-author-role="assistant"]',
        '[data-turn="assistant"]',
    ];
    let assistantNodes;
    try {
        assistantNodes = Array.from(document.querySelectorAll(roleSelectors.join(', ')));
    } catch {
        assistantNodes = [];
    }
    const latestAssistant = assistantNodes.at(-1);
    if (latestAssistant) {
        const wrapperSelectors = activeAssistantSelectors.filter(selector =>
            !roleSelectors.includes(selector));
        let progressScope = latestAssistant;
        if (wrapperSelectors.length && typeof latestAssistant.closest === 'function') {
            progressScope = latestAssistant.closest(wrapperSelectors.join(', ')) || latestAssistant;
        }
        if (hasLiveProgress(progressScope)) return true;
    }

    let panels;
    try {
        panels = document.querySelectorAll(
            'aside, [role="complementary"], [role="dialog"], [data-testid*="thinking" i], [data-testid*="reasoning" i], [class*="sidecar" i]',
        );
    } catch {
        return false;
    }
    for (const panel of Array.from(panels)) {
        if (!isVisible(panel)) continue;
        const metadata = norm([
            panel.getAttribute('aria-label'),
            panel.getAttribute('data-testid'),
            panel.getAttribute('class'),
        ].filter(Boolean).join(' '));
        const verifiedThinkingPanel = metadata.includes('thinking')
            || metadata.includes('reasoning')
            || metadata.includes('sidecar');
        if (!verifiedThinkingPanel) continue;
        const rect = panel.getBoundingClientRect();
        const rightSide = rect.left >= window.innerWidth * 0.35
            && rect.width >= 180
            && rect.height >= 120;
        if (!rightSide) continue;
        if (hasLiveProgress(panel)) return true;
        const visibleText = norm(panel.textContent);
        if (/^thought for \d+[a-z]*( seconds?| minutes?)?( edit)?$/i.test(visibleText)) continue;
        if (visibleText.includes('thinking')
            || visibleText.includes('reasoning')
            || visibleText.includes('pro thinking')) return true;
    }
    return false;
}

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
