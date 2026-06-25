// @ts-check
/// <reference types="playwright-core" />

/**
 * @typedef {{
 *   turnSelectors: string[],
 *   copyButtonSelectors: string[],
 * }} CopySelectors
 */

/**
 * @typedef {{
 *   copyTarget?: { selector?: string }|null,
 *   timeoutMs?: number,
 *   stableTicks?: number,
 * }} CaptureCopyOptions
 */

/**
 * @typedef {{
 *   ok: true,
 *   text: string,
 * } | {
 *   ok: false,
 *   status: string,
 *   error?: string,
 * }} CaptureCopyResult
 */

/** @type {CopySelectors} */
export const CHATGPT_COPY_SELECTORS = {
    turnSelectors: [
        '[data-message-author-role="assistant"]',
        '[data-turn="assistant"]',
        'article[data-testid^="conversation-turn"]:has([data-message-author-role="assistant"])',
    ],
    copyButtonSelectors: [
        'button[data-testid="copy-turn-action-button"]',
        'button[aria-label*="Copy" i]',
    ],
};

/** @type {CopySelectors} */
export const GEMINI_COPY_SELECTORS = {
    turnSelectors: ['model-response', '[data-response-index]'],
    copyButtonSelectors: [
        'button[data-test-id="copy-button"]',
        'button[aria-label="Copy"]',
        'button[aria-label*="Copy" i]',
    ],
};

/** @type {CopySelectors} */
export const GROK_COPY_SELECTORS = {
    turnSelectors: ['[data-testid="assistant-message"]', '[id^="response-"]:has([data-testid="assistant-message"])'],
    copyButtonSelectors: [
        'button[aria-label="Copy"]',
        'button[aria-label*="Copy" i]',
    ],
};

/**
 * @param {import('playwright-core').Page} page
 * @param {CopySelectors} selectors
 * @param {CaptureCopyOptions} [options]
 * @returns {Promise<CaptureCopyResult>}
 */
export async function captureCopiedResponseText(page, selectors, options = {}) {
    const selectorSet = copySelectorsWithTarget(selectors, options.copyTarget ?? null);
    try {
        const result = await page.evaluate?.(
            /**
             * @param {{ selectorSet: CopySelectors, timeoutMs: number, stableTicks: number }} args
             * @returns {Promise<CaptureCopyResult>}
             */
            async ({ selectorSet, timeoutMs, stableTicks }) => {
                const turns = selectorSet.turnSelectors
                    .flatMap((/** @type {string} */ selector) => Array.from(document.querySelectorAll(selector)))
                    .filter((/** @type {Element} */ node, /** @type {number} */ index, /** @type {Element[]} */ arr) => arr.indexOf(node) === index);
                const turn = turns.at(-1);
                if (!turn) return { ok: false, status: 'missing-turn' };

                /** @type {HTMLElement|null} */
                let button = null;
                for (const selector of selectorSet.copyButtonSelectors) {
                    const scoped = /** @type {HTMLElement[]} */ (Array.from(turn.querySelectorAll(selector)));
                    // 203.9: prefer a visible candidate but fall back to the last scoped button
                    // rather than returning missing-button — copy controls are often present but
                    // report offsetParent=null until hover.
                    button = scoped.find((/** @type {HTMLElement} */ candidate) => candidate.offsetParent !== null || candidate.getClientRects().length > 0) || scoped.at(-1) || null;
                    if (button) break;
                }
                if (!button) return { ok: false, status: 'missing-button' };
                const clipboard = navigator.clipboard;
                if (!clipboard) return { ok: false, status: 'missing-clipboard' };

                const originalWriteText = clipboard.writeText ? clipboard.writeText.bind(clipboard) : null;
                const originalWrite = clipboard.write ? clipboard.write.bind(clipboard) : null;
                let intercepted = '';
                let last = '';
                let ticks = 0;
                /** @param {unknown} value */
                const store = (value) => {
                    const text = String(value ?? '');
                    if (text.trim()) intercepted = text;
                };

                const origScrollIntoView = Element.prototype.scrollIntoView;
                const origFocus = HTMLElement.prototype.focus;

                try {
                    if (originalWriteText) {
                        Object.defineProperty(clipboard, 'writeText', {
                            configurable: true,
                            value: async (/** @type {string} */ text) => store(text),
                        });
                    }
                    if (originalWrite) {
                        Object.defineProperty(clipboard, 'write', {
                            configurable: true,
                            value: async (/** @type {ClipboardItem[]} */ items) => {
                                for (const item of items || []) {
                                    const types = item.types || [];
                                    const type = types.includes('text/plain') ? 'text/plain' : types.find((/** @type {string} */ candidate) => candidate.startsWith('text/'));
                                    if (!type) continue;
                                    const blob = await item.getType(type);
                                    store(await blob.text());
                                    break;
                                }
                            },
                        });
                    }

                    Element.prototype.scrollIntoView = function() {};
                    HTMLElement.prototype.focus = function(/** @type {FocusOptions|undefined} */ opts) {
                        return origFocus.call(this, Object.assign({}, opts, { preventScroll: true }));
                    };

                    const init = { bubbles: true, cancelable: true, view: window };
                    button.dispatchEvent(new PointerEvent('pointerdown', init));
                    button.dispatchEvent(new MouseEvent('mousedown', init));
                    button.dispatchEvent(new PointerEvent('pointerup', init));
                    button.dispatchEvent(new MouseEvent('mouseup', init));
                    button.dispatchEvent(new MouseEvent('click', init));
                    // 203.9: also fire the element's real click handler — synthetic events alone
                    // miss React onClick handlers bound via the property, not addEventListener.
                    button.click?.();

                    const deadline = Date.now() + timeoutMs;
                    while (Date.now() < deadline) {
                        if (intercepted.trim()) {
                            if (intercepted === last) ticks += 1;
                            else {
                                last = intercepted;
                                ticks = 1;
                            }
                            if (ticks >= stableTicks) return { ok: true, text: intercepted };
                        }
                        await new Promise((resolve) => setTimeout(resolve, 80));
                    }
                    return intercepted.trim()
                        ? { ok: true, text: intercepted }
                        : { ok: false, status: 'timeout' };
                } finally {
                    Element.prototype.scrollIntoView = origScrollIntoView;
                    HTMLElement.prototype.focus = origFocus;
                    if (originalWriteText) {
                        Object.defineProperty(clipboard, 'writeText', { configurable: true, value: originalWriteText });
                    }
                    if (originalWrite) {
                        Object.defineProperty(clipboard, 'write', { configurable: true, value: originalWrite });
                    }
                }
            },
            {
                selectorSet,
                timeoutMs: Math.max(250, options.timeoutMs ?? 1500),
                stableTicks: Math.max(1, options.stableTicks ?? 3),
            },
        );
        if (result?.ok && typeof result.text === 'string' && result.text.trim()) return { ok: true, text: result.text };
        const status = (result && !result.ok) ? result.status : 'empty';
        const errField = (result && !result.ok && result.error) ? { error: String(result.error) } : {};
        return { ok: false, status, ...errField };
    } catch (e) {
        return { ok: false, status: 'exception', error: e instanceof Error ? e.message : String(e) };
    }
}

/**
 * @param {CopySelectors} selectors
 * @param {{ selector?: string }|null} [copyTarget]
 * @returns {CopySelectors}
 */
function copySelectorsWithTarget(selectors, copyTarget = null) {
    if (!copyTarget?.selector) return selectors;
    const existingSelectors = selectors.copyButtonSelectors || [];
    if (existingSelectors.includes(copyTarget.selector)) {
        return {
            ...selectors,
            copyButtonSelectors: [...new Set(existingSelectors)],
        };
    }
    return {
        ...selectors,
        copyButtonSelectors: [
            copyTarget.selector,
            ...existingSelectors,
        ],
    };
}

/**
 * @param {string|null|undefined} domText
 * @param {{ ok?: boolean, text?: string }} copied
 * @returns {string|undefined}
 */
export function preferCopiedText(domText, copied) {
    const copiedText = String(copied.text || '').trim();
    if (!copied.ok || !copiedText) return undefined;
    const normalizedDom = String(domText || '').trim();
    if (!normalizedDom) return copiedText;
    const minimumReasonableLength = Math.floor(normalizedDom.length * 0.7);
    return copiedText.length >= minimumReasonableLength ? copiedText : undefined;
}
