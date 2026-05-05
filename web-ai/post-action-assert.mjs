// @ts-check
/// <reference types="playwright-core" />

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */

/**
 * @typedef {Object} ResolvedTarget
 * @property {string} [resolution]
 * @property {string} [source]
 * @property {string} [ref]
 * @property {string} [selector]
 * @property {string} [role]
 * @property {boolean} [contentEditable]
 */

/**
 * @typedef {Object} ScrubbedTarget
 * @property {string|null} resolution
 * @property {string|null} source
 * @property {string|null} ref
 * @property {string|null} selector
 * @property {string|null} role
 */

/**
 * @typedef {Object} AssertOk
 * @property {true} ok
 */

/**
 * @typedef {Object} AssertFail
 * @property {false} ok
 * @property {string} reason
 * @property {string} [expected]
 * @property {string|null} [actual]
 * @property {string} [beforeUrl]
 * @property {string} [afterUrl]
 */

/** @typedef {AssertOk | AssertFail} AssertResult */

/**
 * @typedef {Object} TraceRecord
 * @property {string} action
 * @property {ScrubbedTarget|null} target
 * @property {string} status
 * @property {string} [errorCode]
 * @property {AssertFail} [error]
 */

/**
 * @typedef {Object} TraceContext
 * @property {(record: TraceRecord) => void} record
 */

/**
 * @typedef {Object} AssertOptions
 * @property {string} [expectedValue]
 * @property {string} [expectElementVisible]
 */

/**
 * @typedef {Object} ClickOptions
 * @property {boolean} [expectUrlChange]
 * @property {number} [timeoutMs]
 * @property {string} [expectElementVisible]
 */

/**
 * @param {ResolvedTarget|null|undefined} target
 * @returns {ScrubbedTarget|null}
 */
export function scrubTargetForTrace(target) {
    if (!target) return null;
    return {
        resolution: target.resolution || null,
        source: target.source || null,
        ref: target.ref || null,
        selector: target.selector || null,
        role: target.role || null,
    };
}

/**
 * @param {Page} page
 * @param {'fill'|'click'|string} action
 * @param {ResolvedTarget} target
 * @param {AssertOptions} [options]
 * @returns {Promise<AssertResult>}
 */
export async function assertPostAction(page, action, target, options = {}) {
    switch (action) {
        case 'fill': {
            const locator = page.locator(/** @type {string} */ (target.selector));
            const inputValue = typeof locator.inputValue === 'function'
                ? await locator.inputValue().catch(() => null)
                : null;
            const value = inputValue ?? await locator.evaluate(el => /** @type {HTMLInputElement} */ (el).textContent || /** @type {HTMLInputElement} */ (el).value || '').catch(() => '');
            const expected = options.expectedValue;
            if (expected && value !== expected) {
                return { ok: false, reason: 'value-mismatch', expected, actual: value };
            }
            return { ok: true };
        }
        case 'click': {
            if (options.expectElementVisible) {
                const visible = await page.locator(options.expectElementVisible).isVisible().catch(() => false);
                if (!visible) return { ok: false, reason: 'expected-element-not-visible' };
            }
            return { ok: true };
        }
        default:
            return { ok: true };
    }
}

/**
 * @param {Page} page
 * @param {Locator} locator
 * @param {ResolvedTarget} resolvedTarget
 * @param {TraceContext|null|undefined} traceCtx
 * @param {ClickOptions} [options]
 * @returns {Promise<AssertResult>}
 */
export async function clickWithPostAssert(page, locator, resolvedTarget, traceCtx, options = {}) {
    const beforeUrl = page.url();

    try {
        await locator.click();
    } catch (err) {
        if (traceCtx) traceCtx.record({ action: 'click', target: scrubTargetForTrace(resolvedTarget), status: 'error', errorCode: /** @type {{name?: string}} */ (err)?.name });
        throw err;
    }

    if (options.expectUrlChange) {
        try {
            await page.waitForURL(url => String(url) !== beforeUrl, { timeout: options.timeoutMs ?? 3000 });
        } catch {
            const afterUrl = page.url();
            if (afterUrl === beforeUrl) {
                /** @type {AssertFail} */
                const failure = { ok: false, reason: 'url-unchanged', beforeUrl, afterUrl };
                if (traceCtx) traceCtx.record({ action: 'click', target: scrubTargetForTrace(resolvedTarget), status: 'false-heal', error: failure });
                return failure;
            }
        }
    }

    const assertion = await assertPostAction(page, 'click', resolvedTarget, options);
    if (!assertion.ok) {
        if (traceCtx) traceCtx.record({ action: 'click', target: scrubTargetForTrace(resolvedTarget), status: 'false-heal', error: assertion });
        return assertion;
    }

    if (traceCtx) traceCtx.record({ action: 'click', target: scrubTargetForTrace(resolvedTarget), status: 'ok' });
    return { ok: true };
}

/**
 * @param {Page} page
 * @param {Locator} locator
 * @param {ResolvedTarget} resolvedTarget
 * @param {string} value
 * @param {TraceContext|null|undefined} traceCtx
 * @param {AssertOptions} [options]
 * @returns {Promise<AssertResult>}
 */
export async function fillWithPostAssert(page, locator, resolvedTarget, value, traceCtx, options = {}) {
    try {
        await locator.fill(value);
    } catch (fillErr) {
        const role = resolvedTarget.role || '';
        const isContentEditable = role === 'textbox' || resolvedTarget.contentEditable;
        if (isContentEditable) {
            try {
                await locator.click();
                const focused = await page.evaluate((sel) => {
                    const target = sel ? document.querySelector(sel) : null;
                    if (!target) return false;
                    return document.activeElement === target || target.contains(document.activeElement);
                }, resolvedTarget.selector || null).catch(() => false);
                if (!focused) {
                    if (traceCtx) traceCtx.record({ action: 'fill', target: scrubTargetForTrace(resolvedTarget), status: 'error', errorCode: 'focus-mismatch' });
                    throw fillErr;
                }
                const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
                await page.keyboard.press(`${mod}+a`);
                await page.keyboard.insertText(value);
            } catch (kbErr) {
                if (traceCtx) traceCtx.record({ action: 'fill', target: scrubTargetForTrace(resolvedTarget), status: 'error', errorCode: /** @type {{name?: string}} */ (kbErr)?.name });
                throw kbErr;
            }
        } else {
            if (traceCtx) traceCtx.record({ action: 'fill', target: scrubTargetForTrace(resolvedTarget), status: 'error', errorCode: /** @type {{name?: string}} */ (fillErr)?.name });
            throw fillErr;
        }
    }

    const assertion = await assertPostAction(page, 'fill', resolvedTarget, { expectedValue: value });
    if (!assertion.ok) {
        if (traceCtx) traceCtx.record({ action: 'fill', target: scrubTargetForTrace(resolvedTarget), status: 'false-heal', error: assertion });
        return assertion;
    }

    if (traceCtx) traceCtx.record({ action: 'fill', target: scrubTargetForTrace(resolvedTarget), status: 'ok' });
    return { ok: true };
}
