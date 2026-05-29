// @ts-check

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { buildRunwaySafety } from './runway-selectors.mjs';
import { detectRunwaySurface, inspectRunwayPage, normalizeRunwaySurface } from './runway.mjs';
import { inspectRunwayCompletionState, waitForRunwayCompletion } from './runway-monitor.mjs';
import { navigateRunwaySurface } from './runway-url.mjs';

const DEFAULT_WAIT_TIMEOUT_MS = 15000;
const DEFAULT_GENERATE_TIMEOUT_MS = 600000;
const DEFAULT_GENERATE_INTERVAL_MS = 5000;
const FIRST_FRAME_BOOTSTRAP_TIMEOUT_MS = 600000;
const FIRST_FRAME_BOOTSTRAP_INTERVAL_MS = 5000;
const RUNWAY_PROMPT_SELECTOR = [
    'div[aria-label="Prompt"]',
    '[role="textbox"][aria-label="Prompt"]',
    '[contenteditable="true"][aria-label="Prompt"]',
    'textarea[aria-label="Prompt"]',
    'textarea[placeholder*="Describe" i]',
].join(', ');

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function modelSearchKey(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function modelLabelName(value) {
    return clean(value).split(/[•|]/)[0].replace(/\s+-\s+.*$/, '').trim();
}

/**
 * @param {unknown} label
 * @param {unknown} requested
 * @returns {boolean}
 */
function isRunwayModelLabelMatch(label, requested) {
    const requestedKey = modelSearchKey(requested);
    const labelKey = modelSearchKey(label);
    const labelNameKey = modelSearchKey(modelLabelName(label));
    if (!requestedKey || !labelKey) return false;
    if (labelKey === requestedKey || labelNameKey === requestedKey) return true;
    if (requestedKey.length >= 8 && (labelNameKey.includes(requestedKey) || requestedKey.includes(labelNameKey))) {
        return true;
    }
    return false;
}

/**
 * @param {any} deps
 * @param {string} text
 */
function emit(deps, text) {
    if (typeof deps.write === 'function') deps.write(text);
    else console.log(text);
}

/**
 * Runway often leaves parameter popovers marked expanded after a DOM click.
 * Close them before moving focus into the prompt editor.
 * @param {any} page
 */
async function closeRunwayPopovers(page) {
    try {
        const closed = await page.evaluate(() => {
            const expanded = Array.from(document.querySelectorAll('button[aria-expanded="true"], [role="button"][aria-expanded="true"]'));
            for (const button of expanded) {
                /** @type {HTMLElement} */ (button).click();
            }
            return expanded.length;
        });
        if (closed) await page.waitForTimeout(150);
    } catch {
        // Best effort only; the next explicit action will still verify state.
    }
    try {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
    } catch {
        // Best effort: some tests provide partial keyboard mocks.
    }
}

/**
 * Select a model from the base-model-select dropdown.
 * @param {any} page
 * @param {string} modelName
 * @returns {Promise<{ selected: boolean, model: string, error?: string }>}
 */
export async function selectRunwayModel(page, modelName) {
    const current = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="select-base-model"]');
        return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : null;
    });

    if (!modelName || modelName === 'auto') {
        return { selected: true, model: current || 'auto (unchanged)' };
    }

    if (current && isRunwayModelLabelMatch(current, modelName)) {
        return { selected: true, model: current };
    }

    try {
        const selectEl = await page.waitForSelector('[data-testid="select-base-model"]', { timeout: 5000 });
        await selectEl.evaluate((/** @type {HTMLElement} */ el) => {
            el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            el.click();
        });
        await page.waitForTimeout(500);

        const matched = await page.evaluate((/** @type {string} */ target) => {
            const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim();
            const labelName = (/** @type {unknown} */ value) => normalize(value).split(/[•|]/)[0].replace(/\s+-\s+.*$/, '').trim();
            const key = (/** @type {unknown} */ value) => normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
            const matches = (/** @type {unknown} */ value) => {
                const optionKey = key(value);
                const optionNameKey = key(labelName(value));
                if (optionKey === targetKey || optionNameKey === targetKey) return true;
                return targetKey.length >= 8 && (optionNameKey.includes(targetKey) || targetKey.includes(optionNameKey));
            };
            const targetKey = key(target);
            const items = Array.from(document.querySelectorAll(
                '[role="option"], [role="menuitem"], [role="listbox"] button, [class*="dropdown"] button, [class*="model-list"] button, [class*="ModelList"] button'
            ));
            for (const item of items) {
                const text = normalize(item.textContent || item.getAttribute('aria-label') || '');
                if (matches(text)) {
                    /** @type {HTMLElement} */ (item).click();
                    return text;
                }
            }
            return null;
        }, modelName);

        if (!matched) {
            await page.keyboard.press('Escape');
            return { selected: false, model: modelName, error: `Model "${modelName}" not found in dropdown` };
        }

        await page.waitForTimeout(300);
        return { selected: true, model: matched };
    } catch (error) {
        return { selected: false, model: modelName, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Type prompt text into the prompt editor.
 * @param {any} page
 * @param {string} promptText
 * @returns {Promise<{ set: boolean, error?: string }>}
 */
export async function setRunwayPrompt(page, promptText) {
    try {
        /** @type {Array<{ method: string, actual?: string | null, error?: string }>} */
        const attempts = [];
        await closeRunwayPopovers(page);
        const editorHandle = await page.waitForSelector(RUNWAY_PROMPT_SELECTOR, { timeout: 10000 });
        const readPromptText = async () => {
            const actualValue = await page.evaluate((/** @type {string} */ selector) => {
                const editor = document.querySelector(selector);
                const field = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (editor);
                const text = field?.value
                    || /** @type {HTMLElement | null} */ (editor)?.innerText
                    || editor?.textContent
                    || '';
                return String(text).replace(/\s+/g, ' ').trim();
            }, RUNWAY_PROMPT_SELECTOR);
            return typeof actualValue === 'string' ? clean(actualValue) : null;
        };
        const expected = clean(promptText);

        if (typeof page.locator === 'function') {
            try {
                await page.locator(RUNWAY_PROMPT_SELECTOR).first().fill(promptText, { timeout: 5000 });
                await page.waitForTimeout(200);
                const actual = await readPromptText();
                attempts.push({ method: 'locator.fill', actual });
                if (!expected || actual === expected) return { set: true, method: 'locator.fill' };
            } catch (error) {
                attempts.push({ method: 'locator.fill', error: error instanceof Error ? error.message : String(error) });
                // Fall through to ElementHandle/keyboard input for non-Playwright deps.
            }
        }

        if (typeof editorHandle.fill === 'function') {
            try {
                await editorHandle.fill(promptText, { timeout: 5000 });
                await page.waitForTimeout(200);
                const actual = await readPromptText();
                attempts.push({ method: 'element.fill', actual });
                if (!expected || actual === expected) return { set: true, method: 'element.fill' };
            } catch (error) {
                attempts.push({ method: 'element.fill', error: error instanceof Error ? error.message : String(error) });
                // Fall through to keyboard typing for older Playwright handles.
            }
        }

        try {
            await editorHandle.click();
        } catch {
            await editorHandle.evaluate((/** @type {HTMLElement} */ el) => el.click());
        }
        try {
            await editorHandle.focus();
        } catch {
            await page.evaluate((/** @type {string} */ selector) => {
                const editor = document.querySelector(selector);
                if (editor) /** @type {HTMLElement} */ (editor).focus();
            }, RUNWAY_PROMPT_SELECTOR);
        }
        const found = await page.evaluate((/** @type {string} */ selector) => {
            const editor = document.querySelector(selector);
            if (!editor) return false;
            /** @type {HTMLElement} */ (editor).focus();
            return true;
        }, RUNWAY_PROMPT_SELECTOR);
        if (!found) return { set: false, error: 'Prompt editor not found' };
        await page.waitForTimeout(200);

        await page.keyboard.press('Meta+A');
        await page.keyboard.press('Backspace');
        if (promptText) {
            await page.keyboard.type(promptText, { delay: 10 });
        }

        await page.waitForTimeout(200);
        const actual = await readPromptText();
        attempts.push({ method: 'keyboard.type', actual });
        if (expected && actual !== null && actual !== expected) {
            return {
                set: false,
                error: `Prompt verification failed: expected "${expected.slice(0, 80)}", saw "${actual.slice(0, 80)}"`,
                attempts,
            };
        }
        return { set: true, method: 'keyboard.type', attempts };
    } catch (error) {
        return { set: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Select Image/Video/Audio mode in Custom Tools.
 * @param {any} page
 * @param {string} mode
 * @returns {Promise<{ selected: boolean, mode: string, changed?: boolean, skipped?: boolean, error?: string }>}
 */
export async function setRunwayMode(page, mode) {
    const requested = clean(mode).toLowerCase();
    if (!requested || requested === 'auto') {
        return { selected: true, mode: 'auto', skipped: true };
    }
    if (!['image', 'video', 'audio'].includes(requested)) {
        return { selected: false, mode, error: `Unsupported mode: ${mode}` };
    }

    try {
        const result = await page.evaluate((/** @type {string} */ target) => {
            const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const controls = Array.from(document.querySelectorAll('[role="radio"], button, input[type="radio"]'));
            for (const control of controls) {
                const label = normalize(
                    control.textContent
                    || control.getAttribute('aria-label')
                    || control.getAttribute('title')
                    || control.getAttribute('value')
                    || ''
                );
                if (label !== target) continue;
                const selected = control.getAttribute('aria-checked') === 'true'
                    || control.getAttribute('aria-selected') === 'true'
                    || /** @type {HTMLInputElement} */ (control).checked === true;
                if (!selected) {
                    /** @type {HTMLElement} */ (control).click();
                }
                return { found: true, selected: true, changed: !selected };
            }
            return { found: false, selected: false, changed: false };
        }, requested);
        if (!result.found) return { selected: false, mode: requested, error: `Mode "${requested}" control not found` };
        if (result.changed) await page.waitForTimeout(300);
        return { selected: true, mode: requested, changed: Boolean(result.changed) };
    } catch (error) {
        return { selected: false, mode: requested, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Set generation parameters (duration, ratio, resolution, audio).
 * @param {any} page
 * @param {{ duration?: number, ratio?: string, resolution?: string, audio?: boolean }} params
 * @returns {Promise<{ set: string[], skipped: string[], errors: string[] }>}
 */
export async function setRunwayParams(page, params) {
    /** @type {string[]} */ const setParams = [];
    /** @type {string[]} */ const skipped = [];
    /** @type {string[]} */ const errors = [];

    if (params.duration != null) {
        try {
            const alreadySet = await page.evaluate((/** @type {number} */ duration) => {
                const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const matchesDuration = (/** @type {unknown} */ value) => {
                    const label = normalize(value);
                    const escaped = String(duration).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    return new RegExp(`^${escaped}\\s*(?:s|sec|secs|second|seconds)?$`, 'i').test(label);
                };
                const trigger = Array.from(document.querySelectorAll('button'))
                    .find(btn => normalize(btn.getAttribute('aria-label')) === 'duration');
                return Boolean(trigger && matchesDuration(trigger.textContent || trigger.getAttribute('aria-label') || ''));
            }, params.duration);
            const clickDuration = (/** @type {number} */ duration) => {
                const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const matchesDuration = (/** @type {unknown} */ value) => {
                    const label = normalize(value);
                    const escaped = String(duration).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    return new RegExp(`^${escaped}\\s*(?:s|sec|secs|second|seconds)?$`, 'i').test(label);
                };
                const choices = Array.from(document.querySelectorAll('button, [role="option"], [role="menuitem"]'));
                for (const btn of choices) {
                    if (normalize(btn.getAttribute('aria-label')) === 'duration') continue;
                    const label = btn.textContent || btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
                    if (matchesDuration(label)) {
                        /** @type {HTMLElement} */ (btn).click();
                        return true;
                    }
                }
                return false;
            };
            let found = Boolean(alreadySet);
            if (!found) found = await page.evaluate(clickDuration, params.duration);
            if (!found) {
                const opened = await page.evaluate(() => {
                    const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const trigger = buttons.find(btn => {
                        const labels = [
                            btn.textContent,
                            btn.getAttribute('aria-label'),
                            btn.getAttribute('title'),
                        ].map(normalize).filter(Boolean);
                        return labels.includes('duration');
                    });
                    if (!trigger) return false;
                    /** @type {HTMLElement} */ (trigger).click();
                    return true;
                });
                if (opened) {
                    await page.waitForTimeout(250);
                    found = await page.evaluate(clickDuration, params.duration);
                }
            }
            if (found) setParams.push(`duration=${params.duration}`);
            else skipped.push(`duration=${params.duration} (button not found)`);
        } catch (e) {
            errors.push(`duration: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (params.ratio) {
        try {
            let result = await page.evaluate((/** @type {string} */ text) => {
                const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const buttons = Array.from(document.querySelectorAll('button'));
                const trigger = buttons.find(btn => normalize(btn.getAttribute('aria-label')) === 'aspect ratio');
                if (trigger && normalize(trigger.textContent) === normalize(text)) {
                    return { found: true, opened: false };
                }
                for (const btn of buttons) {
                    const label = String(btn.textContent || '').trim();
                    if (normalize(btn.getAttribute('aria-label')) === 'aspect ratio') continue;
                    if (label === text) {
                        /** @type {HTMLElement} */ (btn).click();
                        return { found: true, opened: false };
                    }
                }
                if (trigger) {
                    /** @type {HTMLElement} */ (trigger).click();
                    return { found: false, opened: true };
                }
                return { found: false, opened: false };
            }, params.ratio);
            if (result === true) result = { found: true, opened: false };
            else if (result === false) result = { found: false, opened: false };
            if (!result.found && result.opened) {
                await page.waitForTimeout(250);
                result = await page.evaluate((/** @type {string} */ text) => {
                    const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const buttons = Array.from(document.querySelectorAll('button, [role="option"], [role="menuitem"]'));
                    for (const btn of buttons) {
                        if (normalize(btn.getAttribute('aria-label')) === 'aspect ratio') continue;
                        if (String(btn.textContent || '').trim() === text) {
                            /** @type {HTMLElement} */ (btn).click();
                            return { found: true, opened: false };
                        }
                    }
                    return { found: false, opened: false };
                }, params.ratio);
                if (result === true) result = { found: true, opened: false };
                else if (result === false) result = { found: false, opened: false };
            }
            if (result.found) setParams.push(`ratio=${params.ratio}`);
            else skipped.push(`ratio=${params.ratio} (button not found)`);
        } catch (e) {
            errors.push(`ratio: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (params.resolution) {
        try {
            let result = await page.evaluate((/** @type {string} */ text) => {
                const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                const buttons = Array.from(document.querySelectorAll('button'));
                const trigger = buttons.find(btn => normalize(btn.getAttribute('aria-label')) === 'resolution');
                if (trigger && normalize(trigger.textContent) === normalize(text)) {
                    return { found: true, opened: false };
                }
                for (const btn of buttons) {
                    const label = String(btn.textContent || '').trim();
                    if (normalize(btn.getAttribute('aria-label')) === 'resolution') continue;
                    if (label === text) {
                        /** @type {HTMLElement} */ (btn).click();
                        return { found: true, opened: false };
                    }
                }
                if (trigger) {
                    /** @type {HTMLElement} */ (trigger).click();
                    return { found: false, opened: true };
                }
                return { found: false, opened: false };
            }, params.resolution);
            if (result === true) result = { found: true, opened: false };
            else if (result === false) result = { found: false, opened: false };
            if (!result.found && result.opened) {
                await page.waitForTimeout(250);
                result = await page.evaluate((/** @type {string} */ text) => {
                    const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
                    const buttons = Array.from(document.querySelectorAll('button, [role="option"], [role="menuitem"]'));
                    for (const btn of buttons) {
                        if (normalize(btn.getAttribute('aria-label')) === 'resolution') continue;
                        if (String(btn.textContent || '').trim() === text) {
                            /** @type {HTMLElement} */ (btn).click();
                            return { found: true, opened: false };
                        }
                    }
                    return { found: false, opened: false };
                }, params.resolution);
                if (result === true) result = { found: true, opened: false };
                else if (result === false) result = { found: false, opened: false };
            }
            if (result.found) setParams.push(`resolution=${params.resolution}`);
            else skipped.push(`resolution=${params.resolution} (button not found)`);
        } catch (e) {
            errors.push(`resolution: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    if (params.audio != null) {
        try {
            const toggled = await page.evaluate((/** @type {boolean} */ desired) => {
                const toggle = document.querySelector(
                    '[data-testid="audio-toggle"], input[type="checkbox"][aria-label*="audio" i]'
                );
                if (!toggle) return false;
                const isChecked = /** @type {HTMLInputElement} */ (toggle).checked
                    || toggle.getAttribute('aria-checked') === 'true';
                if (isChecked !== desired) {
                    /** @type {HTMLElement} */ (toggle).click();
                }
                return true;
            }, params.audio);
            if (toggled) setParams.push(`audio=${params.audio}`);
            else skipped.push('audio (toggle not found)');
        } catch (e) {
            errors.push(`audio: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    await closeRunwayPopovers(page);
    return { set: setParams, skipped, errors };
}

/**
 * Upload a file via the browser file input.
 * @param {any} page
 * @param {string} filePath
 * @returns {Promise<{ uploaded: boolean, filename: string, error?: string }>}
 */
export async function uploadRunwayFile(page, filePath) {
    const absPath = resolve(filePath);
    const filename = absPath.split('/').pop() || filePath;

    if (!existsSync(absPath)) {
        return { uploaded: false, filename, error: `File not found: ${absPath}` };
    }

    try {
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 5000, state: 'attached' });
        await fileInput.setInputFiles(absPath);
        await page.waitForTimeout(1000);
        return { uploaded: true, filename };
    } catch (error) {
        return { uploaded: false, filename, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Remove stale custom-tools image references before uploading the intended seed/reference set.
 * @param {any} page
 * @returns {Promise<{ cleared: boolean, removed: number, labels: string[], error?: string }>}
 */
export async function clearRunwayReferences(page) {
    try {
        /** @type {string[]} */
        const labels = [];
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const result = await page.evaluate(() => {
                const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim();
                const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
                const target = buttons.find(btn => {
                    const label = normalize(btn.getAttribute('aria-label') || btn.textContent || '');
                    return /^remove\s+img_\d+/i.test(label);
                });
                if (!target) return { clicked: false, label: null };
                const label = normalize(target.getAttribute('aria-label') || target.textContent || 'Remove IMG reference');
                /** @type {HTMLElement} */ (target).click();
                return { clicked: true, label };
            });
            if (!result.clicked) break;
            labels.push(result.label || `IMG_${labels.length + 1}`);
            await page.waitForTimeout(300);
        }
        return { cleared: true, removed: labels.length, labels };
    } catch (error) {
        return {
            cleared: false,
            removed: 0,
            labels: [],
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Ensure the UI is in Explore mode (Unlimited plan only).
 * @param {any} page
 * @returns {Promise<{ mode: string, switched: boolean, inferred?: boolean, error?: string }>}
 */
export async function ensureExploreMode(page) {
    try {
        const inspectOrSelectExplore = () => {
            const normalize = (/** @type {unknown} */ v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const buttons = Array.from(document.querySelectorAll('button'));
            const visibleText = normalize(document.body?.innerText || '');

            const isActive = (/** @type {Element} */ button) => button.getAttribute('aria-checked') === 'true'
                || button.getAttribute('aria-pressed') === 'true'
                || button.getAttribute('aria-selected') === 'true'
                || button.classList.contains('active')
                || button.closest('[aria-checked="true"], [aria-pressed="true"], [aria-selected="true"]') !== null;

            const creditInfoButton = document.querySelector('[data-testid="credit-info-button"]');
            const creditInfoText = normalize(creditInfoButton?.textContent || '');
            if (/^unlimited$/i.test(creditInfoText)) {
                return { mode: 'Explore', found: true, switched: false, inferred: true };
            }

            const exploreBtn = buttons.find(b => /^explore$/i.test(normalize(b.textContent)));
            if (exploreBtn) {
                const alreadyExplore = isActive(exploreBtn);
                if (!alreadyExplore) {
                    /** @type {HTMLElement} */ (exploreBtn).click();
                }
                return { mode: 'Explore', found: true, switched: !alreadyExplore };
            }

            if (creditInfoButton) {
                /** @type {HTMLElement} */ (creditInfoButton).click();
                return { mode: 'Explore', found: true, switched: false, opened: true };
            }

            const implicitUnlimited = /\bunlimited\b/i.test(visibleText)
                    && !/\bcredits?\s*mode\b/i.test(visibleText)
                    && !/view generation cost/i.test(visibleText);
            if (implicitUnlimited) {
                return { mode: 'Explore', found: false, switched: false, inferred: true };
            }
            return { mode: 'unknown', found: false, switched: false, inferred: false };
        };

        let result = await page.evaluate(inspectOrSelectExplore);
        if (result.opened) {
            await page.waitForTimeout(250);
            result = await page.evaluate(inspectOrSelectExplore);
        }

        if (result.inferred) {
            return { mode: result.mode, switched: false, inferred: true };
        }

        if (!result.found) {
            return { mode: 'unknown', switched: false, error: 'Explore/Credits toggle not found. May not be an Unlimited plan.' };
        }

        if (result.switched) await page.waitForTimeout(500);
        if (result.opened || result.switched) {
            try {
                await page.keyboard.press('Escape');
                await page.waitForTimeout(100);
            } catch {
                // Best effort: close the credit-mode dropdown before prompt input.
            }
        }
        return { mode: result.mode, switched: Boolean(result.switched) };
    } catch (error) {
        return { mode: 'unknown', switched: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Some lower Custom Tools video models require a generated/uploaded first frame
 * before the primary video Generate button is enabled.
 * @param {any} page
 * @param {{ timeoutMs?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<{ needed: boolean, generated?: boolean, ready?: boolean | null, waitedMs?: number, error?: string, state?: object }>}
 */
export async function generateRunwayFirstFrameIfRequired(page, options = {}) {
    const timeoutMs = Math.max(1000, Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : FIRST_FRAME_BOOTSTRAP_TIMEOUT_MS);
    const intervalMs = Math.max(1000, Number.isFinite(options.intervalMs) ? Number(options.intervalMs) : FIRST_FRAME_BOOTSTRAP_INTERVAL_MS);
    const sleep = options.sleep || (ms => page.waitForTimeout(ms));

    const inspect = async () => page.evaluate(() => {
        const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim();
        const bodyText = normalize(document.body?.innerText || '');
        const buttons = Array.from(document.querySelectorAll('button'));
        const generateButtons = buttons
            .map((button, index) => {
                const text = normalize(button.textContent || button.getAttribute('aria-label') || '');
                const rect = button.getBoundingClientRect();
                const visible = Boolean(rect.width || rect.height || button.getClientRects().length);
                const disabled = Boolean(
                    /** @type {HTMLButtonElement} */ (button).disabled
                    || button.getAttribute('aria-disabled') === 'true'
                    || button.getAttribute('data-soft-disabled') === 'true'
                );
                return {
                    button,
                    index,
                    text,
                    disabled,
                    visible,
                    y: Math.round(rect.y),
                };
            })
            .filter(item => /^generate$/i.test(item.text) && item.visible)
            .sort((a, b) => (a.y - b.y) || (a.index - b.index));
        const primary = generateButtons.at(-1) || null;
        const helper = generateButtons.slice(0, -1).find(item => !item.disabled) || null;
        const needsFirstFrame = /first\s+video\s+frame\s*\(required\)/i.test(bodyText);
        const queueText = /\b(?:in queue|queued|generating|processing|you are on a roll|wait for last generation)\b/i.test(bodyText);
        return {
            needsFirstFrame,
            primaryDisabled: primary ? primary.disabled : null,
            primaryReady: primary ? !primary.disabled : null,
            helperAvailable: Boolean(helper),
            queueText,
            generateButtonCount: generateButtons.length,
        };
    });

    let state = await inspect();
    if (!state.needsFirstFrame || state.primaryReady) {
        return { needed: false, ready: state.primaryReady, state };
    }
    if (!state.helperAvailable) {
        return {
            needed: true,
            ready: false,
            state,
            error: 'First video frame is required but no enabled first-frame Generate button was found',
        };
    }

    const clicked = await page.evaluate(() => {
        const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim();
        const buttons = Array.from(document.querySelectorAll('button'));
        const generateButtons = buttons
            .map((button, index) => {
                const text = normalize(button.textContent || button.getAttribute('aria-label') || '');
                const rect = button.getBoundingClientRect();
                const visible = Boolean(rect.width || rect.height || button.getClientRects().length);
                const disabled = Boolean(
                    /** @type {HTMLButtonElement} */ (button).disabled
                    || button.getAttribute('aria-disabled') === 'true'
                    || button.getAttribute('data-soft-disabled') === 'true'
                );
                return { button, index, text, disabled, visible, y: Math.round(rect.y) };
            })
            .filter(item => /^generate$/i.test(item.text) && item.visible)
            .sort((a, b) => (a.y - b.y) || (a.index - b.index));
        const helper = generateButtons.slice(0, -1).find(item => !item.disabled);
        if (!helper) return false;
        /** @type {HTMLElement} */ (helper.button).click();
        return true;
    });

    if (!clicked) {
        return { needed: true, generated: false, ready: false, state, error: 'First-frame Generate click was not accepted' };
    }

    let waitedMs = 0;
    while (waitedMs < timeoutMs) {
        const delayMs = Math.min(intervalMs, timeoutMs - waitedMs);
        await sleep(delayMs);
        waitedMs += delayMs;
        state = await inspect();
        if (state.primaryReady) {
            return { needed: true, generated: true, ready: true, waitedMs, state };
        }
        if (!state.queueText && state.needsFirstFrame && !state.helperAvailable && state.primaryDisabled) {
            return {
                needed: true,
                generated: false,
                ready: false,
                waitedMs,
                state,
                error: 'First-frame generation did not enable the primary Generate button',
            };
        }
    }

    return {
        needed: true,
        generated: false,
        ready: false,
        waitedMs,
        state,
        error: 'Timed out waiting for first-frame generation to enable the primary Generate button',
    };
}

/**
 * Click the Generate button. Level 2 only.
 * @param {any} page
 * @param {{ afterCount?: number | null, expectedType?: string, attempts?: number, settleMs?: number }} [options]
 * @returns {Promise<{ clicked: boolean, accepted?: boolean | null, attempts?: number, state?: string, error?: string }>}
 */
export async function clickRunwayGenerate(page, options = {}) {
    const attempts = Math.max(1, Number.isFinite(options.attempts) ? Number(options.attempts) : 3);
    const settleMs = Math.max(250, Number.isFinite(options.settleMs) ? Number(options.settleMs) : 1500);
    const hasAcceptanceCheck = options.afterCount != null || Boolean(options.expectedType);
    let lastState = null;

    try {
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            await page.waitForSelector('button', { timeout: 5000 });
            const clickResult = await page.evaluate(() => {
                const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim();
                const buttons = Array.from(document.querySelectorAll('button'));
                const candidates = buttons
                    .map((button, index) => {
                        const text = normalize(button.textContent || button.getAttribute('aria-label') || '');
                        const rect = button.getBoundingClientRect();
                        const visible = Boolean(rect.width || rect.height || button.getClientRects().length);
                        return { button, index, text, visible, y: Math.round(rect.y) };
                    })
                    .filter(item => /^generate$/i.test(item.text) && item.visible)
                    .sort((a, b) => (a.y - b.y) || (a.index - b.index));
                const target = candidates.at(-1);
                if (!target) return { clicked: false, error: 'Generate button not found' };
                const genBtn = target.button;
                const disabled = Boolean(
                    genBtn.disabled
                    || genBtn.getAttribute('aria-disabled') === 'true'
                    || genBtn.getAttribute('data-soft-disabled') === 'true'
                );
                if (disabled) return { clicked: false, error: 'Generate button disabled' };
                /** @type {HTMLElement} */ (genBtn).click();
                return { clicked: true };
            });
            if (!clickResult.clicked) {
                return { clicked: false, accepted: false, attempts: attempt, error: clickResult.error || 'Generate button not found or disabled' };
            }

            await page.waitForTimeout(settleMs);
            if (!hasAcceptanceCheck) {
                return { clicked: true, accepted: null, attempts: attempt };
            }

            lastState = await inspectRunwayCompletionState(page, {
                afterCount: options.afterCount,
                expectedType: options.expectedType || null,
            });
            const accepted = lastState.state === 'active'
                || lastState.submitEvidence?.acceptedAfterBaseline === true
                || lastState.submitEvidence?.expectedItemVisible === true;
            if (accepted || lastState.state === 'queue_full') {
                return { clicked: true, accepted, attempts: attempt, state: lastState.state };
            }
        }
        return {
            clicked: false,
            accepted: false,
            attempts,
            state: lastState?.state,
            error: 'Generate click was not accepted by Runway',
        };
    } catch (error) {
        return { clicked: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Full setup: navigate → model → prompt → params → upload → explore mode.
 * Does NOT click Generate.
 * @param {any} page
 * @param {object} options
 * @param {string} [options.surface]
 * @param {string} [options.model]
 * @param {string} options.prompt
 * @param {string} [options.mode]
 * @param {number} [options.duration]
 * @param {string} [options.ratio]
 * @param {string} [options.resolution]
 * @param {boolean} [options.audio]
 * @param {string} [options.seedImage]
 * @param {string} [options.endImage]
 * @param {string[]} [options.referenceImages]
 * @param {boolean} [options.clearReferences]
 * @param {boolean} [options.explore]
 * @param {number} [options.count]
 * @returns {Promise<object>}
 */
export async function setupRunwayGeneration(page, options) {
    const surface = options.surface || 'custom-tools';
    const requestedSurface = normalizeRunwaySurface(surface);
    const errors = [];
    const steps = {};

    // Navigate if needed
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    const currentSurface = detectRunwaySurface(currentUrl, '');
    if (!currentUrl.includes('runwayml.com') || currentSurface !== requestedSurface) {
        await navigateRunwaySurface(page, requestedSurface, {
            timeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
            discoverTeam: true,
        });
        try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch { /* ok */ }
        steps.navigated = true;
    }

    // Select model
    const modelResult = await selectRunwayModel(page, options.model || 'auto');
    steps.model = modelResult;
    if (!modelResult.selected) errors.push(`model: ${modelResult.error}`);

    // Explore mode
    if (options.explore) {
        const exploreResult = await ensureExploreMode(page);
        steps.explore = exploreResult;
        if (exploreResult.error) errors.push(`explore: ${exploreResult.error}`);
    }

    // Select generation mode
    const modeResult = await setRunwayMode(page, options.mode || 'auto');
    steps.mode = modeResult;
    if (!modeResult.selected) errors.push(`mode: ${modeResult.error}`);

    if (options.clearReferences) {
        const clearResult = await clearRunwayReferences(page);
        steps.clearReferences = clearResult;
        if (!clearResult.cleared) errors.push(`clearReferences: ${clearResult.error}`);
    }

    // Set prompt
    const promptResult = await setRunwayPrompt(page, options.prompt);
    steps.prompt = promptResult;
    if (!promptResult.set) errors.push(`prompt: ${promptResult.error}`);

    // Set params
    const paramResult = await setRunwayParams(page, {
        duration: options.duration,
        ratio: options.ratio,
        resolution: options.resolution,
        audio: options.audio,
    });
    steps.params = paramResult;
    if (paramResult.errors.length) errors.push(...paramResult.errors.map(e => `params: ${e}`));

    // Upload seed image
    if (options.seedImage) {
        const uploadResult = await uploadRunwayFile(page, options.seedImage);
        steps.seedImage = uploadResult;
        if (!uploadResult.uploaded) errors.push(`seedImage: ${uploadResult.error}`);
    }

    // Upload end image
    if (options.endImage) {
        const uploadResult = await uploadRunwayFile(page, options.endImage);
        steps.endImage = uploadResult;
        if (!uploadResult.uploaded) errors.push(`endImage: ${uploadResult.error}`);
    }

    // Upload reference images
    if (options.referenceImages?.length) {
        const refResults = [];
        for (const ref of options.referenceImages) {
            refResults.push(await uploadRunwayFile(page, ref));
        }
        steps.referenceImages = refResults;
        const failed = refResults.filter(r => !r.uploaded);
        if (failed.length) errors.push(`referenceImages: ${failed.length} upload(s) failed`);
    }

    const readyCheck = await page.evaluate(() => {
        const normalize = (/** @type {unknown} */ value) => String(value || '').replace(/\s+/g, ' ').trim();
        const btns = Array.from(document.querySelectorAll('button'));
        const candidates = btns
            .map((button, index) => {
                const text = normalize(button.textContent || button.getAttribute('aria-label') || '');
                const rect = button.getBoundingClientRect();
                const visible = Boolean(rect.width || rect.height || button.getClientRects().length);
                return { button, index, text, visible, y: Math.round(rect.y) };
            })
            .filter(item => /^generate$/i.test(item.text) && item.visible)
            .sort((a, b) => (a.y - b.y) || (a.index - b.index));
        const genBtn = candidates.at(-1)?.button || null;
        return {
            hasGenerateButton: Boolean(genBtn),
            generateEnabled: genBtn
                ? !genBtn.disabled
                    && genBtn.getAttribute('aria-disabled') !== 'true'
                    && genBtn.getAttribute('data-soft-disabled') !== 'true'
                : false,
        };
    });

    return {
        ok: errors.length === 0,
        command: 'setup',
        model: modelResult.model,
        modelQuery: options.model || 'auto',
        prompt: options.prompt,
        mode: options.mode || 'auto',
        explore: Boolean(options.explore),
        params: {
            duration: options.duration ?? null,
            ratio: options.ratio ?? null,
            resolution: options.resolution ?? null,
            audio: options.audio ?? null,
        },
        readyToGenerate: readyCheck.generateEnabled,
        safety: buildRunwaySafety(1),
        steps,
        errors,
    };
}

/**
 * Full generation: setup + Generate click + poll + optional download.
 * @param {any} page
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} [options.model]
 * @param {string} [options.mode]
 * @param {string} [options.surface]
 * @param {number} [options.duration]
 * @param {string} [options.ratio]
 * @param {string} [options.resolution]
 * @param {boolean} [options.audio]
 * @param {string} [options.seedImage]
 * @param {string} [options.endImage]
 * @param {string[]} [options.referenceImages]
 * @param {boolean} [options.clearReferences]
 * @param {boolean} [options.explore]
 * @param {string} [options.output]
 * @param {number} [options.timeout]
 * @param {number} [options.interval]
 * @param {number} [options.count]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @returns {Promise<object>}
 */
export async function executeRunwayGeneration(page, options) {
    const expectedType = options.mode === 'video' ? 'video' : undefined;
    // Get baseline output count before generation
    const baseline = await page.evaluate((/** @type {string | undefined} */ type) => {
        const outputPattern = /\.(?:mp4|png|jpe?g)\b|\/(?:result|task_artifact|video-previews)\b|\b(?:use frame|reuse settings|see full prompt)\b/i;
        const typedPattern = type === 'video'
            ? /\.(?:mp4|webm|mov)\b|\/(?:task_artifact|video-previews)\b/i
            : type === 'image'
            ? /\.(?:png|jpe?g|webp)\b|\/result\b/i
            : outputPattern;
        const labels = Array.from(document.querySelectorAll('img[src], video[src], source[src], button, [aria-label]'))
            .map(el => String(el.getAttribute('src') || el.textContent || el.getAttribute('aria-label') || '').trim())
            .filter(l => outputPattern.test(l))
            .filter(l => typedPattern.test(l));
        return labels.length;
    }, expectedType);

    // Setup
    const setupResult = await setupRunwayGeneration(page, options);
    if (!setupResult.ok && setupResult.errors.length > 0) {
        return { ...setupResult, command: 'generate', status: 'setup_failed' };
    }

    let firstFrameBootstrap = null;
    if (expectedType === 'video') {
        firstFrameBootstrap = await generateRunwayFirstFrameIfRequired(page, {
            timeoutMs: Math.min(options.timeout || DEFAULT_GENERATE_TIMEOUT_MS, FIRST_FRAME_BOOTSTRAP_TIMEOUT_MS),
            intervalMs: Math.min(options.interval || DEFAULT_GENERATE_INTERVAL_MS, FIRST_FRAME_BOOTSTRAP_INTERVAL_MS),
            sleep: options.sleep,
        });
        if (firstFrameBootstrap.error) {
            return {
                ok: false,
                command: 'generate',
                status: 'first_frame_failed',
                error: firstFrameBootstrap.error,
                setup: setupResult,
                firstFrameBootstrap,
                safety: buildRunwaySafety(2),
            };
        }
    }

    // Click Generate
    const genResult = await clickRunwayGenerate(page, {
        afterCount: baseline,
        expectedType,
    });
    if (!genResult.clicked) {
        return {
            ok: false,
            command: 'generate',
            status: 'generate_failed',
            error: genResult.error,
            setup: setupResult,
            firstFrameBootstrap,
            safety: buildRunwaySafety(2),
        };
    }

    // Poll for completion
    const pollResult = await waitForRunwayCompletion(page, {
        timeoutMs: options.timeout || DEFAULT_GENERATE_TIMEOUT_MS,
        intervalMs: options.interval || DEFAULT_GENERATE_INTERVAL_MS,
        afterCount: baseline,
        expectedType,
        sleep: options.sleep,
    });

    if (!pollResult.terminal || pollResult.state !== 'idle') {
        return {
            ok: false,
            command: 'generate',
            status: pollResult.state,
            model: setupResult.model,
            prompt: options.prompt,
            explore: Boolean(options.explore),
            outputUrl: null,
            outputType: null,
            outputFile: null,
            download: null,
            firstFrameBootstrap,
            poll: {
                polls: pollResult.polls,
                waitedMs: pollResult.waitedMs,
                timedOut: pollResult.timedOut,
            },
            safety: buildRunwaySafety(2),
        };
    }
    if (expectedType && pollResult.submitEvidence?.acceptedAfterBaseline === false) {
        return {
            ok: false,
            command: 'generate',
            status: `no_new_${expectedType}_output`,
            model: setupResult.model,
            prompt: options.prompt,
            explore: Boolean(options.explore),
            outputUrl: null,
            outputType: null,
            outputFile: null,
            download: null,
            firstFrameBootstrap,
            poll: {
                polls: pollResult.polls,
                waitedMs: pollResult.waitedMs,
                timedOut: pollResult.timedOut,
            },
            safety: buildRunwaySafety(2),
        };
    }

    const { extractRunwayOutputUrl } = await import('./runway-download.mjs');
    const extracted = await extractRunwayOutputUrl(page, 0, { expectedType });
    const outputUrl = extracted.url;

    // Download if --output specified
    let downloadResult = null;
    if (options.output && outputUrl) {
        try {
            const { downloadRunwayOutput } = await import('./runway-download.mjs');
            downloadResult = await downloadRunwayOutput(outputUrl, options.output);
        } catch (e) {
            downloadResult = { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    return {
        ok: pollResult.terminal && pollResult.state === 'idle',
        command: 'generate',
        status: pollResult.state === 'idle' ? 'complete' : pollResult.state,
        model: setupResult.model,
        prompt: options.prompt,
        explore: Boolean(options.explore),
        outputUrl,
        outputType: downloadResult?.type || extracted.type,
        outputFile: downloadResult?.ok ? downloadResult.path : null,
        requestedOutputFile: downloadResult?.requestedPath || null,
        download: downloadResult,
        firstFrameBootstrap,
        poll: {
            polls: pollResult.polls,
            waitedMs: pollResult.waitedMs,
            timedOut: pollResult.timedOut,
        },
        safety: buildRunwaySafety(2),
    };
}

/**
 * @param {string} command — 'setup' or 'generate'
 * @param {string[]} args
 * @param {any} deps
 */
export async function runRunwayGenerateCli(command, args = [], deps = {}) {
    const { values } = parseArgs({
        args,
        options: {
            surface: { type: 'string', default: 'custom-tools' },
            model: { type: 'string', default: 'auto' },
            prompt: { type: 'string' },
            mode: { type: 'string', default: 'auto' },
            duration: { type: 'string' },
            ratio: { type: 'string' },
            resolution: { type: 'string' },
            audio: { type: 'string' },
            'seed-image': { type: 'string' },
            'end-image': { type: 'string' },
            'reference-images': { type: 'string', multiple: true },
            'clear-references': { type: 'boolean', default: false },
            explore: { type: 'boolean', default: false },
            count: { type: 'string' },
            output: { type: 'string' },
            timeout: { type: 'string', default: String(DEFAULT_GENERATE_TIMEOUT_MS) },
            interval: { type: 'string', default: String(DEFAULT_GENERATE_INTERVAL_MS) },
            'allow-mutation': { type: 'boolean', default: false },
            'allow-submit': { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });

    if (!values.prompt) {
        throw new Error('--prompt is required for setup/generate commands');
    }

    // Safety enforcement
    if (command === 'setup' && !values['allow-mutation'] && !values['allow-submit']) {
        throw new Error('setup requires --allow-mutation or --allow-submit flag');
    }
    if (command === 'generate' && !values['allow-submit']) {
        throw new Error('generate requires --allow-submit flag');
    }

    const page = await deps.getPage();
    const options = {
        surface: String(values.surface || 'custom-tools'),
        model: String(values.model || 'auto'),
        prompt: String(values.prompt),
        mode: String(values.mode || 'auto'),
        duration: values.duration ? Number(values.duration) : undefined,
        ratio: values.ratio ? String(values.ratio) : undefined,
        resolution: values.resolution ? String(values.resolution) : undefined,
        audio: values.audio != null ? values.audio !== 'false' : undefined,
        seedImage: values['seed-image'] ? String(values['seed-image']) : undefined,
        endImage: values['end-image'] ? String(values['end-image']) : undefined,
        referenceImages: values['reference-images']?.map(String),
        clearReferences: Boolean(values['clear-references']),
        explore: Boolean(values.explore),
        count: values.count ? Number(values.count) : undefined,
        output: values.output ? String(values.output) : undefined,
        timeout: Number(values.timeout || DEFAULT_GENERATE_TIMEOUT_MS),
        interval: Number(values.interval || DEFAULT_GENERATE_INTERVAL_MS),
        sleep: deps.sleep,
    };

    const result = command === 'generate'
        ? await executeRunwayGeneration(page, options)
        : await setupRunwayGeneration(page, options);

    emit(deps, values.json ? JSON.stringify(result, null, 2) : formatGenerateResult(result));
}

/**
 * @param {string[]} args
 * @param {any} deps
 */
export async function runRunwayUploadCli(args = [], deps = {}) {
    const { values } = parseArgs({
        args,
        options: {
            file: { type: 'string' },
            'allow-mutation': { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });

    if (!values.file) throw new Error('--file is required for upload command');
    if (!values['allow-mutation']) throw new Error('upload requires --allow-mutation flag');

    const page = await deps.getPage();
    const result = await uploadRunwayFile(page, String(values.file));
    const output = {
        ok: result.uploaded,
        command: 'upload',
        ...result,
        safety: buildRunwaySafety(1),
    };
    emit(deps, values.json ? JSON.stringify(output, null, 2) : `Upload: ${result.uploaded ? 'ok' : 'failed'} — ${result.filename}${result.error ? ` (${result.error})` : ''}`);
}

/**
 * @param {any} result
 */
function formatGenerateResult(result) {
    const lines = [
        `Runway ${result.command}`,
        `status: ${result.status || (result.ok ? 'ok' : 'error')}`,
        `model: ${result.model || 'n/a'}`,
        `prompt: ${clean(result.prompt || '').slice(0, 100)}`,
        `explore: ${result.explore ? 'yes' : 'no'}`,
    ];
    if (result.readyToGenerate != null) lines.push(`readyToGenerate: ${result.readyToGenerate}`);
    if (result.outputUrl) lines.push(`outputUrl: ${result.outputUrl}`);
    if (result.outputFile) lines.push(`outputFile: ${result.outputFile}`);
    if (result.poll) {
        lines.push(`polls: ${result.poll.polls}, waitedMs: ${result.poll.waitedMs}, timedOut: ${result.poll.timedOut}`);
    }
    if (result.errors?.length) lines.push(`errors: ${result.errors.join('; ')}`);
    return lines.join('\n');
}
