// @ts-check

/**
 * Per-read ceiling for a single assistant-DOM read. Playwright's
 * `page.evaluate()` takes no timeout option, so a stalled or very slow
 * evaluation (large conversation, blocked main thread) can otherwise park the
 * poll loop past its own deadline (#88).
 */
export const ASSISTANT_READ_TIMEOUT_MS = 10_000;

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
 * Sentinel resolved when a bounded read exceeds its budget. Distinct from `[]`
 * so callers can tell "no assistant turns yet" from "the read did not finish".
 */
export const ASSISTANT_READ_TIMED_OUT = Symbol('assistant-read-timed-out');

/**
 * Bound any assistant-DOM read by a deadline. Resolves the task's value, or
 * ASSISTANT_READ_TIMED_OUT when the budget elapses first. The underlying task is
 * never awaited further; its rejection is swallowed so an abandoned read cannot
 * surface as an unhandled rejection.
 * @template T
 * @param {Promise<T>} task
 * @param {number} timeoutMs
 * @returns {Promise<T | typeof ASSISTANT_READ_TIMED_OUT>}
 */
export async function withAssistantReadTimeout(task, timeoutMs) {
    const budget = Number(timeoutMs);
    if (!Number.isFinite(budget) || budget <= 0) return ASSISTANT_READ_TIMED_OUT;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const guard = new Promise((resolve) => {
        timer = setTimeout(() => resolve(ASSISTANT_READ_TIMED_OUT), budget);
        // Do not hold the event loop open purely for this guard.
        if (typeof timer?.unref === 'function') timer.unref();
    });
    try {
        return await Promise.race([
            Promise.resolve(task).catch(() => ASSISTANT_READ_TIMED_OUT),
            guard,
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Resolve the effective per-read budget: the smaller of the remaining command
 * deadline and the per-read ceiling. Returns 0 when the deadline has passed.
 * @param {number} [remainingMs]
 * @param {number} [ceilingMs]
 * @returns {number}
 */
export function resolveAssistantReadBudgetMs(remainingMs, ceilingMs = ASSISTANT_READ_TIMEOUT_MS) {
    const ceiling = Number.isFinite(Number(ceilingMs)) && Number(ceilingMs) > 0
        ? Number(ceilingMs)
        : ASSISTANT_READ_TIMEOUT_MS;
    if (remainingMs == null) return ceiling;
    const remaining = Number(remainingMs);
    if (!Number.isFinite(remaining) || remaining <= 0) return 0;
    return Math.min(ceiling, remaining);
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
 * Browser-context helper: count top-level assistant turns and serialize only the
 * turns at/after `minIndex`. Long conversations otherwise pay `innerText` on
 * every historical turn on every 500ms poll tick even though only the newest
 * answer matters (#88). Keep self-contained for page.evaluate serialization.
 * @param {{ selectors: string[], minIndex: number }} input
 * @returns {{ total: number, texts: string[] }}
 */
export function readAssistantTextsAfterIndex(input) {
    const activeSelectors = Array.isArray(input && input.selectors) && input.selectors.length
        ? input.selectors
        : [
            '[data-message-author-role="assistant"]',
            '[data-turn="assistant"]',
            'article[data-testid^="conversation-turn"]',
        ];
    const rawMin = Number(input && input.minIndex);
    const minIndex = Number.isFinite(rawMin) && rawMin > 0 ? Math.floor(rawMin) : 0;
    const isInsideAnotherMatchedNode = (/** @type {any} */ el, /** @type {any[]} */ matched) =>
        matched.some(other => other !== el && typeof other.contains === 'function' && other.contains(el));

    for (const selector of activeSelectors) {
        const matched = Array.from(document.querySelectorAll(selector));
        const topLevel = matched.filter(el => !isInsideAnotherMatchedNode(el, matched));
        if (!topLevel.length) continue;
        // Read text only for the tail we actually need.
        const texts = topLevel
            .slice(minIndex)
            .map(el => String((/** @type {any} */ (el)).innerText || el.textContent || '').trim())
            .filter(Boolean);
        return { total: topLevel.length, texts };
    }
    return { total: 0, texts: [] };
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
