// @ts-check
/// <reference types="playwright-core" />

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */

/**
 * @typedef {Object} BrowserCapabilityErrorInput
 * @property {string} [capabilityId]
 * @property {string} [stage]
 * @property {boolean} [mutationAllowed]
 */

export class BrowserCapabilityError extends Error {
    /**
     * @param {string} message
     * @param {BrowserCapabilityErrorInput} input
     */
    constructor(message, input) {
        super(message);
        this.name = 'BrowserCapabilityError';
        /** @type {string|undefined} */
        this.capabilityId = input.capabilityId;
        /** @type {string|undefined} */
        this.stage = input.stage;
        this.mutationAllowed = input.mutationAllowed === true;
    }
}

export class ActionTranscript {
    /** @type {string[]} */
    warnings = [];
    /** @type {string[]} */
    usedFallbacks = [];

    /** @param {string} message */
    warn(message) {
        this.warnings.push(message);
    }

    /** @param {string} name */
    fallback(name) {
        this.usedFallbacks.push(name);
    }

    toJSON() {
        return {
            warnings: [...this.warnings],
            usedFallbacks: [...this.usedFallbacks],
        };
    }
}

/**
 * @typedef {Object} VisibleCandidate
 * @property {string} selector
 * @property {number} index
 * @property {Locator} locator
 * @property {boolean} visible
 */

/**
 * @typedef {Object} FindVisibleOptions
 * @property {number} [timeoutMs]
 * @property {number} [pollIntervalMs]
 * @property {boolean} [allowFirstCandidateFallback]
 */

/**
 * @param {Page} page
 * @param {string[]} selectors
 * @param {FindVisibleOptions} [options]
 * @returns {Promise<VisibleCandidate|null>}
 */
export async function findVisibleCandidate(page, selectors, options = {}) {
    const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
    const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250);
    const deadline = Date.now() + timeoutMs;
    /** @type {VisibleCandidate|null} */
    let firstCandidate = null;

    do {
        for (const selector of selectors) {
            const baseLocator = page.locator(selector);
            const count = await baseLocator.count().catch(() => 0);
            for (let index = 0; index < count; index += 1) {
                const locator = typeof baseLocator.nth === 'function' ? baseLocator.nth(index) : baseLocator.first();
                const visible = await isLocatorVisible(locator);
                /** @type {VisibleCandidate} */
                const candidate = { selector, index, locator, visible };
                firstCandidate ??= candidate;
                if (visible) return candidate;
            }
        }
        if (Date.now() >= deadline) break;
        await page.waitForTimeout?.(pollIntervalMs);
    } while (timeoutMs > 0);

    return options.allowFirstCandidateFallback ? firstCandidate : null;
}

/**
 * @typedef {Object} TextBaseline
 * @property {string[]} selectors
 * @property {string[]} texts
 * @property {number} count
 * @property {string} textHash
 * @property {string} capturedAt
 */

/**
 * @param {Page} page
 * @param {string[]} selectors
 * @returns {Promise<TextBaseline>}
 */
export async function captureTextBaseline(page, selectors) {
    const texts = await readTexts(page, selectors);
    return {
        selectors: [...selectors],
        texts,
        count: texts.length,
        textHash: hashTexts(texts),
        capturedAt: new Date().toISOString(),
    };
}

/**
 * @typedef {Object} StableTextOptions
 * @property {number} timeoutMs
 * @property {number} [stableWindowMs]
 * @property {number} [pollIntervalMs]
 * @property {number} [minCount]
 */

/**
 * @typedef {Object} StableTextResult
 * @property {boolean} ok
 * @property {TextBaseline} baseline
 * @property {string|undefined} latestText
 * @property {string[]} warnings
 */

/**
 * @param {Page} page
 * @param {string[]} selectors
 * @param {TextBaseline} baseline
 * @param {StableTextOptions} options
 * @returns {Promise<StableTextResult>}
 */
export async function waitForStableTextAfterBaseline(page, selectors, baseline, options) {
    const timeoutMs = Math.max(1, options.timeoutMs);
    const stableWindowMs = Math.max(100, options.stableWindowMs ?? 1000);
    const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250);
    const minCount = Math.max(baseline.count + 1, options.minCount ?? 0);
    const deadline = Date.now() + timeoutMs;
    /** @type {string[]} */
    const warnings = [];
    /** @type {string|undefined} */
    let stableText;
    /** @type {number|null} */
    let stableSince = null;

    while (Date.now() < deadline) {
        const texts = await readTexts(page, selectors);
        const latestText = texts.slice(baseline.count).filter(Boolean).at(-1);
        if (texts.length >= minCount && latestText) {
            if (latestText === stableText) {
                if (stableSince !== null && Date.now() - stableSince >= stableWindowMs) {
                    return { ok: true, baseline, latestText, warnings };
                }
            } else {
                stableText = latestText;
                stableSince = Date.now();
            }
        } else {
            stableText = undefined;
            stableSince = null;
        }
        await page.waitForTimeout?.(pollIntervalMs);
    }
    warnings.push('stable-text-timeout');
    return { ok: false, baseline, latestText: stableText, warnings };
}

/**
 * @param {Locator} locator
 * @returns {Promise<boolean>}
 */
export async function isLocatorVisible(locator) {
    const waited = await locator.waitFor?.({ state: 'visible', timeout: 500 }).then(() => true).catch(() => false);
    if (waited) return true;
    const box = await locator.boundingBox?.().catch(() => null);
    if (box && box.width > 0 && box.height > 0) return true;
    return Boolean(await locator.evaluate?.((node) => {
        if (!node || typeof /** @type {Element} */ (node).getBoundingClientRect !== 'function') return false;
        const rect = /** @type {Element} */ (node).getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = globalThis.getComputedStyle?.(/** @type {Element} */ (node));
        return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0');
    }).catch(() => false));
}

/**
 * @param {Page} page
 * @param {string[]} selectors
 * @returns {Promise<string[]>}
 */
async function readTexts(page, selectors) {
    const evaluated = await page.evaluate?.((innerSelectors) => {
        for (const selector of innerSelectors) {
            const texts = Array.from(document.querySelectorAll(selector))
                .map((el) => String(/** @type {HTMLElement} */ (el).innerText || el.textContent || '').trim())
                .filter(Boolean);
            if (texts.length) return texts;
        }
        return [];
    }, selectors).catch(() => []);
    if (Array.isArray(evaluated) && evaluated.length > 0) return evaluated.map(String);

    for (const selector of selectors) {
        const locators = await page.locator(selector).all().catch(() => []);
        /** @type {string[]} */
        const texts = [];
        for (const locator of locators) {
            const text = String(await locator.innerText?.().catch(() => '') || '').trim();
            if (text) texts.push(text);
        }
        if (texts.length) return texts;
    }
    return [];
}

/**
 * @param {string[]} texts
 * @returns {string}
 */
function hashTexts(texts) {
    let hash = 2166136261;
    for (const text of texts) {
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
    }
    return (hash >>> 0).toString(16);
}

import { clickWithPostAssert, fillWithPostAssert } from './post-action-assert.mjs';

/** @typedef {import('./post-action-assert.mjs').ResolvedTarget} ResolvedTarget */
/** @typedef {import('./post-action-assert.mjs').TraceContext} TraceContext */

/**
 * @param {Page} page
 * @param {Locator} locator
 * @param {ResolvedTarget} resolvedTarget
 * @param {TraceContext|null|undefined} traceCtx
 */
export async function clickResolvedTarget(page, locator, resolvedTarget, traceCtx) {
    return clickWithPostAssert(page, locator, resolvedTarget, traceCtx);
}

/**
 * @param {Page} page
 * @param {Locator} locator
 * @param {ResolvedTarget} resolvedTarget
 * @param {string} value
 * @param {TraceContext|null|undefined} traceCtx
 */
export async function fillResolvedTarget(page, locator, resolvedTarget, value, traceCtx) {
    return fillWithPostAssert(page, locator, resolvedTarget, value, traceCtx);
}

/**
 * @param {ResolvedTarget|null|undefined} target
 */
function scrubTargetForTrace(target) {
    if (!target) return null;
    return {
        resolution: target.resolution || null,
        source: target.source || null,
        ref: target.ref || null,
        selector: target.selector || null,
        role: target.role || null,
    };
}
