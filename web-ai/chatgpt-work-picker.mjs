// @ts-check
// ChatGPT Work picker mutation helpers (04 section 3).
// Owns all Work picker state transitions. Does NOT touch chatgpt-model.mjs
// (Chat Intelligence picker) or chatgpt-composer.mjs global fallbacks.

import { WebAiError } from './errors.mjs';
import { monotonicNowMs, withPollDeadline } from './poll-deadline.mjs';
import {
    STOP_BUTTON_SELECTOR,
    CONVERSATION_TURN_SELECTOR,
} from './chatgpt-composer.mjs';
import {
    detectChatGptComposerSurface,
    detectChatGptWorkAvailability,
    workSurfaceUnsupportedError,
} from './product-surfaces.mjs';
import { probeStopButton, scopeToMainRegion } from './chatgpt-response-dom.mjs';

/** @typedef {import('playwright-core').Page} Page */

// ─── Power mapping (04 section 3.1, WP1 live probe) ────────────────────
// Public Power 1..6 maps to DOM aria-valuenow 0..5.

/**
 * @typedef {{
 *   power: number,
 *   domValue: number,
 *   compactLabel: string,
 *   model: string,
 *   effort: string,
 * }} PowerMapping
 */

/** @type {readonly PowerMapping[]} */
export const WORK_POWER_MAP = Object.freeze([
    { power: 1, domValue: 0, compactLabel: '5.6 Terra Light', model: 'GPT-5.6 Terra', effort: 'Light' },
    { power: 2, domValue: 1, compactLabel: '5.6 Sol Light', model: 'GPT-5.6 Sol', effort: 'Light' },
    { power: 3, domValue: 2, compactLabel: '5.6 Sol Medium', model: 'GPT-5.6 Sol', effort: 'Medium' },
    { power: 4, domValue: 3, compactLabel: '5.6 Sol High', model: 'GPT-5.6 Sol', effort: 'High' },
    { power: 5, domValue: 4, compactLabel: '5.6 Sol Extra High', model: 'GPT-5.6 Sol', effort: 'Extra High' },
    { power: 6, domValue: 5, compactLabel: '5.6 Sol Ultra', model: 'GPT-5.6 Sol', effort: 'Ultra' },
]);

const WORK_SIMPLE_VIEW_SELECTOR = '[data-testid="composer-model-picker-slider-simple-view"]';
const WORK_ADVANCED_VIEW_SELECTOR = '[data-testid="composer-model-picker-slider-advanced-view"]';
// Live 5.6 DOM (2026-07-10 smoke): the value carrier is an aria-hidden Radix
// thumb inside the simple view; the keyboard target is the Power menuitem
// (aria-keyshortcuts="ArrowLeft ArrowRight"), not the slider role itself.
const WORK_SLIDER_SELECTOR = `${WORK_SIMPLE_VIEW_SELECTOR} [role="slider"]`;
const WORK_POWER_CONTROL_SELECTOR = '[role="menuitem"][aria-label="Power"]';
const WORK_FAST_CHECKBOX_SELECTOR = '[role="menuitemcheckbox"][aria-label*="fast mode" i]';

// ─── Input normalizers ──────────────────────────────────────────────────

/**
 * Validate and normalize a public Power integer (1..6).
 * Rejects before any browser mutation.
 * @param {unknown} input
 * @returns {PowerMapping}
 */
export function normalizeWorkPower(input) {
    const n = Number(input);
    if (!Number.isInteger(n) || n < 1 || n > 6) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'provider-work-preflight',
            message: `Power must be an integer 1..6, got: ${JSON.stringify(input)}`,
            retryHint: 'fix-power',
        });
    }
    return /** @type {PowerMapping} */ (WORK_POWER_MAP[n - 1]);
}

/**
 * Normalize speed input. Unspecified (null/undefined) means no speed mutation.
 * @param {unknown} input
 * @returns {'standard'|'fast'|null}
 */
export function normalizeWorkSpeed(input) {
    if (input == null || input === '') return null;
    const s = String(input).toLowerCase().trim();
    if (s === 'standard') return 'standard';
    if (s === 'fast') return 'fast';
    throw new WebAiError({
        errorCode: 'internal.unhandled',
        stage: 'provider-work-preflight',
        message: `Speed must be "standard" or "fast", got: ${JSON.stringify(input)}`,
        retryHint: 'fix-speed',
    });
}

/**
 * Normalize model string from Advanced view state (read-only, no public schema).
 * @param {string|null|undefined} label
 * @returns {string|null}
 */
export function normalizeWorkModel(label) {
    if (!label) return null;
    const t = label.trim();
    if (/^gpt-5\.6\s+sol$/i.test(t)) return 'GPT-5.6 Sol';
    if (/^gpt-5\.6\s+terra$/i.test(t)) return 'GPT-5.6 Terra';
    if (/^gpt-5\.6\s+luna$/i.test(t)) return 'GPT-5.6 Luna';
    if (/^gpt-5\.5$/i.test(t)) return 'GPT-5.5';
    return t;
}

/**
 * Normalize effort string from Advanced view state (read-only, no public schema).
 * @param {string|null|undefined} label
 * @returns {string|null}
 */
export function normalizeWorkEffort(label) {
    if (!label) return null;
    const t = label.trim();
    const known = ['Light', 'Medium', 'High', 'Extra High', 'Max', 'Ultra'];
    const match = known.find((k) => k.toLowerCase() === t.toLowerCase());
    return match || t;
}

// ─── State readers (no mutations) ───────────────────────────────────────

/**
 * @typedef {{
 *   power: number|null,
 *   domValue: number|null,
 *   domMin: number|null,
 *   domMax: number|null,
 *   valueText: string|null,
 *   compactLabel: string|null,
 *   model: string|null,
 *   effort: string|null,
 *   speed: string|null,
 *   fastChecked: boolean|null,
 *   simpleViewVisible: boolean,
 *   advancedViewVisible: boolean,
 * }} WorkPickerState
 */

/**
 * Read the current Work picker state from the DOM without mutations.
 * @param {any} page
 * @returns {Promise<WorkPickerState>}
 */
export async function readWorkPickerState(page) {
    const simpleVisible = await page.locator(WORK_SIMPLE_VIEW_SELECTOR).first().isVisible().catch(() => false);
    const advancedVisible = await page.locator(WORK_ADVANCED_VIEW_SELECTOR).first().isVisible().catch(() => false);

    const slider = page.locator(WORK_SLIDER_SELECTOR).first();
    // The live 5.6 thumb is aria-hidden (visibility checks lie); presence in
    // the simple view plus readable attributes is the observation contract.
    const sliderPresent = (await page.locator(WORK_SLIDER_SELECTOR).count().catch(() => 0)) > 0;

    let domValue = null;
    let domMin = null;
    let domMax = null;
    let valueText = null;

    if (sliderPresent) {
        const nowStr = await slider.getAttribute('aria-valuenow').catch(() => null);
        const minStr = await slider.getAttribute('aria-valuemin').catch(() => null);
        const maxStr = await slider.getAttribute('aria-valuemax').catch(() => null);
        valueText = await slider.getAttribute('aria-valuetext').catch(() => null);
        domValue = nowStr != null ? Number(nowStr) : null;
        domMin = minStr != null ? Number(minStr) : null;
        domMax = maxStr != null ? Number(maxStr) : null;
    }

    // Derive public power from domValue
    const power = domValue != null ? domValue + 1 : null;

    // Read compact label from valueText (e.g. "5.6 Sol Light, 2 of 6.")
    const compactLabel = valueText ? valueText.replace(/,\s*\d+\s+of\s+\d+\.?$/, '').trim() : null;

    // Read advanced view model/effort/speed
    let model = null;
    let effort = null;
    let speed = null;
    if (advancedVisible) {
        const modelItem = page.locator('[role="menuitem"][aria-label^="Model"]').first();
        const effortItem = page.locator('[role="menuitem"][aria-label^="Effort"]').first();
        const speedItem = page.locator('[role="menuitem"][aria-label^="Speed"]').first();
        const modelLabel = await modelItem.getAttribute('aria-label').catch(() => null);
        const effortLabel = await effortItem.getAttribute('aria-label').catch(() => null);
        const speedLabel = await speedItem.getAttribute('aria-label').catch(() => null);
        model = modelLabel ? normalizeWorkModel(modelLabel.replace(/^Model\s*/i, '')) : null;
        effort = effortLabel ? normalizeWorkEffort(effortLabel.replace(/^Effort\s*/i, '')) : null;
        speed = speedLabel ? speedLabel.replace(/^Speed\s*/i, '').trim().toLowerCase() : null;
    }

    // Read fast checkbox
    const fastEl = page.locator(WORK_FAST_CHECKBOX_SELECTOR).first();
    const fastVisible = await fastEl.isVisible().catch(() => false);
    let fastChecked = null;
    if (fastVisible) {
        const checkedStr = await fastEl.getAttribute('aria-checked').catch(() => null);
        fastChecked = checkedStr === 'true';
    }

    // Derive speed from fast checkbox if not read from advanced
    if (speed == null && fastChecked != null) {
        speed = fastChecked ? 'fast' : 'standard';
    }

    // Try to match the power mapping for model/effort
    if (power != null && model == null) {
        const mapping = WORK_POWER_MAP[power - 1];
        if (mapping) {
            model = model || mapping.model;
            effort = effort || mapping.effort;
        }
    }

    return {
        power,
        domValue,
        domMin,
        domMax,
        valueText,
        compactLabel,
        model,
        effort,
        speed,
        fastChecked,
        simpleViewVisible: simpleVisible,
        advancedViewVisible: advancedVisible,
    };
}

// ─── Surface switching ──────────────────────────────────────────────────

/**
 * Ensure the Work surface is active. If Chat is active, click the Work radio.
 * Fails on ambiguous/legacy or if post-click verification fails.
 * @param {any} page
 * @returns {Promise<{ switched: boolean, detection: import('./product-surfaces.mjs').ComposerSurfaceDetection }>}
 */
export async function ensureWorkSurface(page) {
    const detection = await detectChatGptComposerSurface(page);

    if (detection.surface === 'work') {
        return { switched: false, detection };
    }

    if (detection.surface === 'ambiguous' || detection.ui === 'legacy') {
        const code = detection.ui === 'legacy' ? 'capability.unsupported' : 'provider.work-state-unknown';
        throw new WebAiError({
            errorCode: code,
            stage: 'provider-work-preflight',
            message: `Cannot ensure Work surface: ${detection.ui === 'legacy' ? 'no toggle found (legacy UI)' : 'ambiguous surface state'}`,
            retryHint: detection.ui === 'legacy' ? 'upgrade-chatgpt' : 'reload-page',
            evidence: detection,
        });
    }

    // detection.surface === 'chat' - click the Work radio
    const { CHATGPT_SURFACE_RADIO_SELECTOR } = await import('./chatgpt-model.mjs');
    const radios = page.locator(CHATGPT_SURFACE_RADIO_SELECTOR);
    const count = await radios.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < count; i++) {
        const el = radios.nth(i);
        const text = (await el.textContent().catch(() => '') || '').trim();
        if (/^work$/i.test(text)) {
            await el.click({ timeout: 5000 });
            clicked = true;
            break;
        }
    }

    if (!clicked) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
            message: 'Work radio button not found for click',
            retryHint: 'reload-page',
        });
    }

    // Verify post-click
    const postDetection = await detectChatGptComposerSurface(page);
    if (postDetection.surface !== 'work') {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
            message: `Work surface not active after click (post-state: ${postDetection.surface})`,
            retryHint: 'reload-page',
            evidence: postDetection,
        });
    }

    return { switched: true, detection: postDetection };
}

/**
 * Ensure the CHAT surface is active. Mirror of `ensureWorkSurface`.
 *
 * NEVER called implicitly — only from an explicit caller opt-in, because
 * switching a user's composer out of Work is a visible side effect they must
 * ask for. That opt-in is the whole reason G16 could finally be implemented:
 * the objection was never to the capability, only to doing it silently.
 *
 * @param {any} page
 * @returns {Promise<{ switched: boolean, detection: import('./product-surfaces.mjs').ComposerSurfaceDetection }>}
 */
export async function ensureChatSurface(page) {
    const detection = await detectChatGptComposerSurface(page);

    if (detection.surface === 'chat') return { switched: false, detection };

    // A conversation page has no toggle to click: normalizing there would mean
    // navigating away from the user's conversation, which is a different and
    // much larger action. Fail closed with the existing typed error instead.
    if (detection.ui === 'legacy') {
        throw workSurfaceUnsupportedError({
            surface: detection.surface || 'conversation',
            evidence: detection,
        });
    }

    if (detection.surface === 'ambiguous') {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
            message: 'Cannot ensure Chat surface: ambiguous surface state',
            retryHint: 'reload-page',
            evidence: detection,
        });
    }

    // detection.surface === 'work' — click the Chat radio.
    const { CHATGPT_SURFACE_RADIO_SELECTOR } = await import('./chatgpt-model.mjs');
    const radios = page.locator(CHATGPT_SURFACE_RADIO_SELECTOR);
    const count = await radios.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < count; i++) {
        const el = radios.nth(i);
        const text = (await el.textContent().catch(() => '') || '').trim();
        if (/^chat$/i.test(text)) {
            await el.click({ timeout: 5000 });
            clicked = true;
            break;
        }
    }

    if (!clicked) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
            message: 'Chat radio button not found for click',
            retryHint: 'reload-page',
        });
    }

    const postDetection = await detectChatGptComposerSurface(page);
    if (postDetection.surface !== 'chat') {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
            message: `Chat surface not active after click (post-state: ${postDetection.surface})`,
            retryHint: 'reload-page',
            evidence: postDetection,
        });
    }

    return { switched: true, detection: postDetection };
}

/**
 * Open the Work picker menu. Returns the picker content root locator.
 * Only operates inside the active Work composer.
 * @param {any} page
 * @returns {Promise<any>}
 */
export async function openWorkPicker(page) {
    const { CHATGPT_OPEN_PICKER_CONTENT_SELECTOR } = await import('./chatgpt-model.mjs');
    const pickerContent = page.locator(CHATGPT_OPEN_PICKER_CONTENT_SELECTOR).first();
    const isOpen = await pickerContent.isVisible().catch(() => false);
    if (isOpen) return pickerContent;

    // Click the trigger button inside the Work composer form
    const trigger = page.locator('form button[aria-haspopup="menu"]').first();
    const triggerVisible = await trigger.isVisible().catch(() => false);
    if (!triggerVisible) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Work picker trigger not visible',
            retryHint: 'reload-page',
        });
    }
    await trigger.click({ timeout: 5000 });

    // Wait for picker content to appear
    await pickerContent.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const openNow = await pickerContent.isVisible().catch(() => false);
    if (!openNow) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Work picker did not open after trigger click',
            retryHint: 'reload-page',
        });
    }
    return pickerContent;
}

// ─── Power mutation ─────────────────────────────────────────────────────

/**
 * Set the Work Power slider to the target value using Left/Right arrow keys.
 * Uses bounded arrow transitions only (WP1: Home/End do not change value).
 * @param {any} page
 * @param {PowerMapping} target
 * @returns {Promise<WorkPickerState>}
 */
export async function setWorkPower(page, target) {
    // Live 5.6 contract: the keyboard target is the Power menuitem control
    // (aria-keyshortcuts="ArrowLeft ArrowRight"); the aria-hidden thumb only
    // carries the value. Activate the simple view via the Power control first.
    const powerControl = page.locator(WORK_POWER_CONTROL_SELECTOR).first();
    const controlVisible = await powerControl.isVisible().catch(() => false);
    if (!controlVisible) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Power control not visible in the open Work picker',
            retryHint: 'open-picker',
        });
    }
    const slider = page.locator(WORK_SLIDER_SELECTOR).first();
    if ((await page.locator(WORK_SLIDER_SELECTOR).count().catch(() => 0)) === 0) {
        // Simple view may be inactive after Advanced usage; entering the Power
        // control mounts/focuses the slider (observed live 2026-07-10).
        await powerControl.click({ timeout: 3000 });
        await page.waitForTimeout(300).catch(() => undefined);
    }
    if ((await page.locator(WORK_SLIDER_SELECTOR).count().catch(() => 0)) === 0) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Power slider not present after activating the Power control',
            retryHint: 'open-picker',
        });
    }

    // Read current value
    const nowStr = await slider.getAttribute('aria-valuenow').catch(() => null);
    const current = nowStr != null ? Number(nowStr) : null;
    if (current == null) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Power slider aria-valuenow not readable',
            retryHint: 'reload-page',
        });
    }

    const diff = target.domValue - current;
    if (diff !== 0) {
        await powerControl.focus().catch(() => undefined);
        const key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
        const steps = Math.abs(diff);
        for (let i = 0; i < steps; i++) {
            await powerControl.press(key);
            await page.waitForTimeout(150).catch(() => undefined);
        }
    }

    // Verify
    const state = await readWorkPickerState(page);
    if (state.domValue !== target.domValue) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Power slider did not reach target ${target.domValue} (actual: ${state.domValue})`,
            retryHint: 'retry-power',
            evidence: state,
        });
    }

    return state;
}

// ─── Advanced view ──────────────────────────────────────────────────────

/**
 * Open the Advanced view in the Work picker.
 * @param {any} page
 * @returns {Promise<void>}
 */
export async function openWorkAdvancedView(page) {
    const advancedView = page.locator(WORK_ADVANCED_VIEW_SELECTOR).first();
    const alreadyVisible = await advancedView.isVisible().catch(() => false);
    if (alreadyVisible) return;

    const toggle = page.locator('[role="menuitem"][aria-label*="advanced" i]').first();
    const toggleVisible = await toggle.isVisible().catch(() => false);
    if (!toggleVisible) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Advanced toggle not visible',
            retryHint: 'open-picker',
        });
    }
    await toggle.click({ timeout: 3000 });
}

/**
 * Set an Advanced option (model, effort, or speed) in the Work picker.
 * Opens the submenu, selects the target menuitemradio, verifies post-state.
 * @param {any} page
 * @param {'model'|'effort'|'speed'} category
 * @param {string} targetLabel  Exact label text to match.
 * @returns {Promise<{ changed: boolean, label: string }>}
 */
export async function setWorkAdvancedOption(page, category, targetLabel) {
    const capitalCategory = category.charAt(0).toUpperCase() + category.slice(1);
    const menuItem = page.locator(`[role="menuitem"][aria-label^="${capitalCategory}"]`).first();
    const visible = await menuItem.isVisible().catch(() => false);
    if (!visible) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Advanced ${category} menu item not visible`,
            retryHint: 'open-advanced',
        });
    }

    // Check if already selected
    const currentLabel = await menuItem.getAttribute('aria-label').catch(() => '');
    const currentValue = (currentLabel || '').replace(new RegExp(`^${capitalCategory}\\s*`, 'i'), '').trim();
    if (currentValue.toLowerCase() === targetLabel.toLowerCase()) {
        return { changed: false, label: currentValue };
    }

    // Open submenu
    await menuItem.click({ timeout: 3000 });

    // Find and click the target radio
    const submenuRadios = page.locator('[role="menuitemradio"]');
    const radioCount = await submenuRadios.count().catch(() => 0);
    let clicked = false;
    for (let i = 0; i < radioCount; i++) {
        const radio = submenuRadios.nth(i);
        const text = (await radio.textContent().catch(() => '') || '').trim();
        if (text.toLowerCase().startsWith(targetLabel.toLowerCase())) {
            await radio.click({ timeout: 3000 });
            clicked = true;
            break;
        }
    }

    if (!clicked) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Advanced ${category} option "${targetLabel}" not found`,
            retryHint: 'check-options',
        });
    }

    // Verify post-state
    const postLabel = await menuItem.getAttribute('aria-label').catch(() => '');
    const postValue = (postLabel || '').replace(new RegExp(`^${capitalCategory}\\s*`, 'i'), '').trim();
    if (postValue.toLowerCase() !== targetLabel.toLowerCase()) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Advanced ${category} did not change to "${targetLabel}" (post-state: "${postValue}")`,
            retryHint: 'retry-advanced',
            evidence: { category, targetLabel, postValue },
        });
    }

    return { changed: true, label: postValue };
}

// ─── Speed mutation ─────────────────────────────────────────────────────

/**
 * Set speed if specified. Null/undefined = no mutation (preserve current UI).
 * @param {any} page
 * @param {'standard'|'fast'|null} targetSpeed
 * @returns {Promise<{ mutated: boolean, speed: string|null }>}
 */
async function setWorkSpeed(page, targetSpeed) {
    if (targetSpeed == null) {
        return { mutated: false, speed: null };
    }

    const fastCheckbox = page.locator(WORK_FAST_CHECKBOX_SELECTOR).first();
    const visible = await fastCheckbox.isVisible().catch(() => false);
    if (!visible) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: 'Fast mode checkbox not visible',
            retryHint: 'open-picker',
        });
    }

    const checkedStr = await fastCheckbox.getAttribute('aria-checked').catch(() => null);
    const isFast = checkedStr === 'true';
    const wantFast = targetSpeed === 'fast';

    if (isFast === wantFast) {
        return { mutated: false, speed: targetSpeed };
    }

    await fastCheckbox.click({ timeout: 3000 });

    // Verify
    const postChecked = await fastCheckbox.getAttribute('aria-checked').catch(() => null);
    const postFast = postChecked === 'true';
    if (postFast !== wantFast) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Speed did not change to ${targetSpeed} (post-state: ${postFast ? 'fast' : 'standard'})`,
            retryHint: 'retry-speed',
        });
    }

    return { mutated: true, speed: targetSpeed };
}

// ─── Verification and evidence ──────────────────────────────────────────

/**
 * Verify that the current Work picker state matches the expected Power mapping.
 * @param {WorkPickerState} state
 * @param {PowerMapping} expected
 * @returns {{ verified: boolean, mismatches: string[] }}
 */
export function verifyWorkSelection(state, expected) {
    const mismatches = [];
    if (state.power !== expected.power) {
        mismatches.push(`power: expected ${expected.power}, got ${state.power}`);
    }
    if (state.domValue !== expected.domValue) {
        mismatches.push(`domValue: expected ${expected.domValue}, got ${state.domValue}`);
    }
    return { verified: mismatches.length === 0, mismatches };
}

/**
 * Build structured evidence for a Work selection.
 * @param {WorkPickerState} state
 * @param {PowerMapping} target
 * @param {{ speed: string|null, switched: boolean }} meta
 * @returns {Record<string, unknown>}
 */
export function buildWorkSelectionEvidence(state, target, meta) {
    return {
        surface: 'work',
        power: target.power,
        domValue: target.domValue,
        compactLabel: state.compactLabel || target.compactLabel,
        model: state.model || target.model,
        effort: state.effort || target.effort,
        speed: meta.speed,
        surfaceSwitched: meta.switched,
        verified: true,
        capturedAt: new Date().toISOString(),
        source: 'chatgpt-work-picker',
    };
}

// ─── Work send adapter ──────────────────────────────────────────────────

/**
 * Check whether a stored session should use the Work poll path.
 * @param {Record<string, unknown>|null|undefined} session
 * @returns {boolean}
 */
export function isWorkSession(session) {
    if (!session) return false;
    if (session.responseContract === 'work') return true;
    const summary = /** @type {Record<string, unknown>|undefined} */ (session.envelopeSummary);
    return summary?.surface === 'work';
}

// ─── Work commit verification (04 §4, WP1 R03) ─────────────────────────

const WORK_SEND_BUTTON_SELECTOR = 'form button[data-testid="send-button"]';
const WORK_COMMIT_TIMEOUT_MS = 30_000;
const WORK_COMMIT_POLL_MS = 250;
// Bounded wait for /c/<uuid> URL transition after commit evidence (R02).
// The SPA rewrites location right after submit; 15 s is generous.
const WORK_URL_TRANSITION_TIMEOUT_MS = 15_000;
const WORK_URL_TRANSITION_POLL_MS = 500;

/**
 * Extract a conversation/task ID from a ChatGPT URL path (`/c/<uuid>`).
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function extractTaskId(url) {
    if (!url) return null;
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
}

/**
 * Submit the Work prompt by clicking the scoped send button inside the
 * composer form, then verify that the prompt actually committed by
 * observing WP1 R03 evidence (committed user turn + running indicators).
 *
 * NEVER falls back to keyboard Enter — ProseMirror + IME composition can
 * leak characters (observed stray char in live smoke). Button-only, fail closed.
 *
 * @param {any} page
 * @param {string} prompt
 * @param {{ commitTimeoutMs?: number, baselineUrl?: string|null }} [options]
 * @returns {Promise<{ committed: boolean, taskUrl: string|null, taskId: string|null, turnsCount: number, warnings: string[] }>}
 */
export async function submitWorkPrompt(page, prompt, options = {}) {
    const commitTimeout = options.commitTimeoutMs || WORK_COMMIT_TIMEOUT_MS;
    const baselineUrl = options.baselineUrl ?? (typeof page.url === 'function' ? page.url() : null);

    // 1. Click the scoped send button (button-only, no Enter fallback)
    const sendBtn = page.locator(WORK_SEND_BUTTON_SELECTOR).first();
    const sendVisible = await sendBtn.isVisible().catch(() => false);
    if (!sendVisible) {
        throw new WebAiError({
            errorCode: 'provider.work-submit-unverified',
            stage: 'work-submit',
            message: 'Work send button (data-testid="send-button" inside form) not visible',
            retryHint: 'reload-page',
        });
    }
    const sendEnabled = await sendBtn.isEnabled().catch(() => false);
    if (!sendEnabled) {
        throw new WebAiError({
            errorCode: 'provider.work-submit-unverified',
            stage: 'work-submit',
            message: 'Work send button is disabled — prompt may not have been inserted',
            retryHint: 'check-composer',
        });
    }
    await sendBtn.click({ timeout: 5000 });

    // 2. Wait for commit evidence (WP1 R03):
    //    Committed = user turn visible + running evidence (Thinking OR Stop button)
    //    Session is NOT created until commit evidence appears.
    const deadline = Date.now() + commitTimeout;
    const normalizedPrompt = prompt.toLowerCase().replace(/\s+/g, ' ').trim();
    const promptPrefix = normalizedPrompt.slice(0, Math.min(normalizedPrompt.length, 120));
    // Sticky across ticks: if the stop button was ever unreadable, neither a
    // later success nor a timeout should claim it was checked.
    /** @type {'visible'|'absent'|'unknown'|null} */
    let lastStopProbe = null;

    while (Date.now() <= deadline) {
        const turnLocators = await page.locator(CONVERSATION_TURN_SELECTOR).all().catch(() => []);
        let hasPromptTurn = false;
        for (const loc of turnLocators) {
            const text = String(await loc.innerText().catch(() => '')).trim();
            const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
            if (promptPrefix.length > 30 && normalized.includes(promptPrefix)) {
                hasPromptTurn = true;
                break;
            }
            if (normalized.includes(normalizedPrompt)) {
                hasPromptTurn = true;
                break;
            }
        }

        // Composer-scoped and main-scoped: a page-wide "Stop"-labelled control
        // (dictation, sidebar) is not running evidence.
        const stopProbe = await probeStopButton(scopeToMainRegion(page));
        const stopVisible = stopProbe === 'visible';
        // Not running evidence — an unreadable probe proves nothing. But record
        // it, so a commit that succeeded on other evidence, or a timeout, says
        // whether the stop button was ever actually checked.
        if (stopProbe === 'unknown') lastStopProbe = 'unknown';
        const thinkingEl = page.getByText?.('Thinking', { exact: false });
        const thinkingVisible = thinkingEl
            ? await thinkingEl.first().isVisible().catch(() => false)
            : false;
        const hasRunningEvidence = stopVisible || thinkingVisible;
        const hasTurns = turnLocators.length > 0;

        if ((hasPromptTurn || hasTurns) && hasRunningEvidence) {
            const currentUrl = typeof page.url === 'function' ? page.url() : null;
            let taskId = extractTaskId(currentUrl);

            // --- Bounded wait for /c/<uuid> URL transition (R02) ---
            // The SPA rewrites location.pathname to /c/<uuid> right after submit.
            // If the URL hasn't transitioned yet, poll up to 15 s.
            if (!taskId) {
                const urlDeadline = Date.now() + WORK_URL_TRANSITION_TIMEOUT_MS;
                while (Date.now() <= urlDeadline) {
                    await page.waitForTimeout?.(WORK_URL_TRANSITION_POLL_MS);
                    const url = typeof page.url === 'function' ? page.url() : null;
                    taskId = extractTaskId(url);
                    if (taskId) break;
                }
            }

            const resolvedUrl = typeof page.url === 'function' ? page.url() : null;
            const warnings = [];

            // If URL never transitioned, record warning and store null -- never
            // persist the bare origin as taskUrl/conversationUrl (root cause of
            // the wrong-tab rebind bug).
            if (!taskId) {
                warnings.push('work-task-url-unresolved');
                return {
                    committed: true,
                    taskUrl: null,
                    taskId: null,
                    turnsCount: turnLocators.length,
                    warnings: withStopProbeWarning(warnings, lastStopProbe),
                };
            }

            return {
                committed: true,
                taskUrl: resolvedUrl,
                taskId: taskId,
                turnsCount: turnLocators.length,
                warnings: withStopProbeWarning(warnings, lastStopProbe),
            };
        }

        await page.waitForTimeout?.(WORK_COMMIT_POLL_MS);
    }

    // Commit evidence never appeared — fail closed
    throw new WebAiError({
        errorCode: 'provider.work-submit-unverified',
        stage: 'work-submit',
        message: 'Work prompt did not commit: no user turn + running evidence observed before timeout',
        retryHint: 'retry-work-send',
        evidence: {
            commitTimeoutMs: commitTimeout,
            baselineUrl,
            currentUrl: typeof page.url === 'function' ? page.url() : null,
            stopProbe: lastStopProbe,
        },
    });
}


/**
 * Detect work sessions with a bare-origin conversationUrl -- the broken shape
 * from the pre-fix submit path where the URL was captured before the SPA
 * transition. For surface=work sessions, "https://chatgpt.com/" (no /c/<uuid>)
 * is never a valid task URL.
 * @param {Record<string, unknown>|null|undefined} session
 * @returns {boolean}
 */
export function isBareOriginConversationUrl(session) {
    if (!session || !isWorkSession(session)) return false;
    const url = /** @type {string|null|undefined} */ (session.conversationUrl);
    if (!url) return false;
    try {
        const u = new URL(url);
        const path = u.pathname.replace(/\/+$/, '') || '/';
        return path === '/';
    } catch {
        return false;
    }
}

// ─── Work poll adapter (04 §5) ──────────────────────────────────────────

const WORK_POLL_INTERVAL_MS = 2000;
const WORK_POLL_HEARTBEAT_SEC = 30;

/**
 * Poll a Work session until complete, timeout, or unknown (fail closed).
 *
 * Loops `readWorkTaskState` against the session's page until one of:
 *   - `complete`: persist answer + status, return answer artifact
 *   - deadline reached: persist timeout, return timeout result
 *   - `unknown`: immediately throw `provider.work-state-unknown`
 *
 * Return shape matches Chat `pollWebAi` for consumer compatibility:
 * `{ ok, status, vendor, answerText, conversationUrl, sessionId, warnings }`
 *
 * @param {any} deps
 * @param {any} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function pollWorkSession(deps, input = {}) {
    // Thin wrapper over a hard deadline. The loop below checks the clock only
    // BETWEEN awaited browser probes, so one never-settling probe defeated
    // `--timeout` outright — measured still-pending at 152ms against a 50ms
    // budget. A stalled probe cannot be cancelled; the race is what stops the
    // CALLER waiting on it.
    const { resolvePollTimeoutSec: resolveBudgetSec } = await import('./session.mjs');
    const startedAt = Date.now();
    const monotonicStart = monotonicNowMs();
    const wrapperVendor = input.vendor || 'chatgpt';
    const wrapperSessionId = input.session || input.sessionId;
    // No store read before the race is armed. The blocking `getSession` waits
    // in a way that stops the event loop; even the async read costs
    // real wall time, and a contended store made the poll seconds late on a 1s
    // budget — the same unbounded failure the race exists to prevent. The
    // budget therefore comes from the caller's own timeout when given, and the
    // stored deadline is consulted inside the run.
    const wrapperTimeoutMs = resolveBudgetSec(input, null, wrapperVendor) * 1000;
    /** @type {{ page: any, session: any }} */
    const ctx = { page: null, session: null };
    return withPollDeadline(
        (hardDeadline, token) => runPollWorkSession(deps, input, ctx, token),
        {
            startedAt,
            monotonicStartMs: monotonicStart,
            timeoutMs: wrapperTimeoutMs,
            // The SAME builder the loop's own timeout uses: a second envelope
            // here is how `surface` and `responseContract` would go missing.
            onExpired: () => buildWorkTimeoutResult(wrapperVendor, wrapperSessionId, ctx),
        },
    );
}

/**
 * The Work timeout envelope. Shared by the loop's natural timeout and the
 * outer race so the two cannot drift apart in shape.
 *
 * @param {string} vendor
 * @param {string|undefined} sessionId
 * @param {{ page: any }} ctx
 */
function buildWorkTimeoutResult(vendor, sessionId, { page, session }) {
    return {
        ok: false,
        status: 'timeout',
        vendor,
        sessionId: sessionId || null,
        answerText: null,
        conversationUrl: typeof page?.url === 'function' ? page.url() : (session?.conversationUrl || null),
        surface: 'work',
        responseContract: 'work',
        warnings: ['work-poll-timeout'],
    };
}

/**
 * @param {any} deps
 * @param {any} input
 * @param {{ page: any }} ctx
 * @returns {Promise<Record<string, unknown>>}
 */
async function runPollWorkSession(deps, input = {}, ctx = { page: null, session: null }, runToken = null) {
    // False once the caller has been answered — see gemini-live.mjs.
    const stillActive = () => !(runToken?.expired === true);
    const { getSession, updateSession, resolvePollTimeoutSec } = await import('./session.mjs');

    const vendor = input.vendor || 'chatgpt';
    const sessionId = input.session || input.sessionId;
    // Read ASYNCHRONOUSLY, inside the race. The blocking `getSession` waits
    // in a way that stops the event loop: the deadline timer
    // cannot fire while it waits, so a contended store defeated the bound no
    // matter how the race was set up.
    const { readSessionAsync } = await import('./session-store.mjs');
    const session = sessionId ? await readSessionAsync(sessionId).catch(() => null) : null;
    ctx.session = session;

    // Not floored at a whole second: this becomes a hard deadline below, and
    // rounding a sub-second remainder up is how a poll outlives the session it
    // belongs to. `resolvePollTimeoutSec` already refuses to return zero.
    const timeoutSec = resolvePollTimeoutSec(input, session, vendor);
    const deadline = Date.now() + timeoutSec * 1000;
    // The outer race was armed before this session could be read — reading it
    // first is what put a blocking store lock inside the bound. Hand the real
    // deadline back now that it is known; `tighten` only ever shortens, so a
    // stored deadline cannot be used to extend the caller's own timeout.
    //
    // `deadline` is ABSOLUTE and already measured from after the read. Passing
    // the duration instead re-anchored it at the wrapper's start and charged
    // the read twice, discarding that much of the stored budget.
    runToken?.tighten?.(deadline);
    const startedAt = Date.now();
    let lastHeartbeat = 0;

    const page = await deps.getPage();
    ctx.page = page;

    // If the session's original target is gone, fail closed
    // (04 section 6: no auto-reattach for running tasks in v1)
    if (session?.targetId) {
        const currentTargetId = await deps.getTargetId?.().catch(() => null);
        if (currentTargetId && currentTargetId !== session.targetId) {
            throw new WebAiError({
                errorCode: 'provider.work-reattach-unverified',
                stage: 'work-poll',
                message: `Work session target mismatch: expected ${session.targetId}, got ${currentTargetId}. Running-task reattach is not supported in v1.`,
                retryHint: 'reattach-session',
                evidence: { sessionId, expectedTargetId: session.targetId, actualTargetId: currentTargetId },
            });
        }
    }

    // Repair guard (round-2): detect sessions persisted with bare-origin
    // conversationUrl (e.g. "https://chatgpt.com/") from the pre-fix submit
    // path. These sessions need taskUrl-based resolution, not a tab URL match
    // against the generic origin -- that would read the wrong tab.
    if (session && isBareOriginConversationUrl(session)) {
        throw new WebAiError({
            errorCode: 'provider.work-reattach-unverified',
            stage: 'work-poll',
            message: `Work session ${sessionId} has bare-origin conversationUrl (${session.conversationUrl}); refusing to poll wrong tab. The session was created before the URL-transition fix.`,
            retryHint: 'resend-work',
            evidence: { sessionId, conversationUrl: session.conversationUrl, surface: 'work' },
        });
    }

    while (Date.now() <= deadline) {
        const state = await readWorkTaskState(page);

        if (state.status === 'unknown') {
            // Gated: a run whose caller already got `timeout` must not start a
            // new session write when its probe finally settles.
            if (sessionId && stillActive()) {
                updateSession(sessionId, {
                    status: 'error',
                    lastError: {
                        errorCode: 'provider.work-state-unknown',
                        message: 'Work task in unrecognized state',
                        evidence: state.evidence,
                    },
                });
            }
            throw new WebAiError({
                errorCode: 'provider.work-state-unknown',
                stage: 'work-poll',
                message: 'Work task in unrecognized state (no running or complete evidence); failing closed',
                retryHint: 'check-browser',
                evidence: state.evidence,
            });
        }

        if (state.status === 'complete') {
            const taskUrl = typeof page.url === 'function' ? page.url() : null;
            const taskId = extractTaskId(taskUrl);
            if (sessionId && stillActive()) {
                updateSession(sessionId, {
                    status: 'complete',
                    answer: state.answerText,
                    completedAt: new Date().toISOString(),
                    conversationUrl: taskUrl || session?.conversationUrl,
                    envelopeSummary: {
                        ...(session?.envelopeSummary || {}),
                        taskId,
                        taskUrl,
                    },
                });
            }
            return {
                ok: true,
                status: 'complete',
                vendor,
                sessionId: sessionId || null,
                answerText: state.answerText,
                conversationUrl: taskUrl,
                surface: 'work',
                responseContract: 'work',
                warnings: [],
            };
        }

        // state.status === 'running' — keep polling with heartbeat
        const now = Date.now();
        if (now - lastHeartbeat >= WORK_POLL_HEARTBEAT_SEC * 1000) {
            const elapsed = Math.round((now - startedAt) / 1000);
            process.stderr.write(`[work-poll] ${elapsed}s — running...\n`);
            lastHeartbeat = now;
        }

        // Capped by what is left. The loop condition is checked before this
        // wait, so on a deadline with under 2s remaining the wait itself is
        // the overrun.
        await page.waitForTimeout?.(Math.max(1, Math.min(WORK_POLL_INTERVAL_MS, deadline - Date.now())));
    }

    // Deadline reached — timeout
    if (sessionId) {
        const { markSessionTimeout } = await import('./session.mjs');
        if (stillActive()) markSessionTimeout(sessionId, {
            lastError: { errorCode: 'provider.poll-timeout', message: 'Work poll deadline reached' },
            warning: 'work-poll-timeout',
        });
    }
    return buildWorkTimeoutResult(vendor, sessionId, ctx);
}

/**
 * @typedef {'running'|'complete'|'unknown'} WorkTaskStatus
 */

/**
 * Carry a sticky "the stop button was never actually checked" note onto EVERY
 * success envelope. Applying it to only one of the two return paths let the
 * unresolved-URL case report a clean commit.
 *
 * @param {string[]} warnings
 * @param {'visible'|'absent'|'unknown'|null} stopProbe
 * @returns {string[]}
 */
function withStopProbeWarning(warnings, stopProbe) {
    return stopProbe === 'unknown' ? [...warnings, 'work-stop-probe-unverified'] : warnings;
}

/**
 * Read Work task state from the page.
 * @param {any} page
 * @returns {Promise<{ surface: 'work', status: WorkTaskStatus, answerText: string|null, evidence: Record<string, unknown> }>}
 */
export async function readWorkTaskState(page) {
    // Scope all indicators to the main conversation region: page-wide text
    // matching is poisoned by sidebar history titles (live 2026-07-10: a
    // conversation named "SMOKE_C3_THINKING_OK" matched getByText('Thinking')
    // and pinned the classifier to running forever).
    const mainRegion = scopeToMainRegion(page);
    const stopProbe = await probeStopButton(mainRegion);
    const stopVisible = stopProbe === 'visible';

    const thinkingEl = mainRegion?.getByText?.('Thinking', { exact: true });
    const thinkingVisible = thinkingEl ? await thinkingEl.first().isVisible().catch(() => false) : false;

    if (stopVisible || thinkingVisible) {
        return {
            surface: 'work',
            status: 'running',
            answerText: null,
            evidence: { stopVisible, stopProbe, thinkingVisible, capturedAt: new Date().toISOString() },
        };
    }

    // Ordering matters: the Copy check below would otherwise call this complete.
    // Copy is visible on EARLIER assistant turns too, so an unreadable stop
    // probe plus a leftover Copy button reads as "finished" while the current
    // response is still being written.
    if (stopProbe === 'unknown') {
        return {
            surface: 'work',
            status: 'unknown',
            answerText: null,
            evidence: { stopVisible: null, stopProbe, thinkingVisible, capturedAt: new Date().toISOString() },
        };
    }

    // Check for completed response (assistant text + no Stop)
    // Look for response actions (Copy, Share) as completion evidence
    const copyBtn = mainRegion.locator('button[aria-label*="Copy" i]').first();
    const copyVisible = await copyBtn.isVisible().catch(() => false);

    if (copyVisible) {
        // Try to read answer text
        const assistantTurns = mainRegion.locator('[data-message-author-role="assistant"]');
        const count = await assistantTurns.count().catch(() => 0);
        let answerText = null;
        if (count > 0) {
            answerText = await assistantTurns.last().textContent().catch(() => null);
        }

        return {
            surface: 'work',
            status: 'complete',
            answerText: answerText ? answerText.trim() : null,
            evidence: { copyVisible, stopVisible: false, stopProbe, assistantTurnCount: count, capturedAt: new Date().toISOString() },
        };
    }

    // Unknown state - fail closed
    return {
        surface: 'work',
        status: 'unknown',
        answerText: null,
        evidence: { stopVisible, stopProbe, thinkingVisible, copyVisible, capturedAt: new Date().toISOString() },
    };
}

/**
 * Full Work send orchestration:
 *  detect -> ensureWorkSurface -> open picker -> set power -> set speed -> verify -> return evidence
 *
 * This is the pre-submit configuration step. The actual composer write + submit
 * is handled by the caller (MCP handler / CLI).
 *
 * @param {any} page
 * @param {{ power: number, speed?: string|null }} options
 * @returns {Promise<{ switched: boolean, pickerState: WorkPickerState, target: PowerMapping, speedResult: { mutated: boolean, speed: string|null }, evidence: Record<string, unknown> }>}
 */
export async function configureWorkSurface(page, options) {
    const target = normalizeWorkPower(options.power);
    const speed = normalizeWorkSpeed(options.speed);

    // Ensure Work surface is active
    const { switched, detection } = await ensureWorkSurface(page);

    // Open picker
    await openWorkPicker(page);

    // Set power
    const postPowerState = await setWorkPower(page, target);

    // Set speed (null = no mutation)
    const speedResult = await setWorkSpeed(page, speed);

    // Final read and verify
    const finalState = await readWorkPickerState(page);
    const verification = verifyWorkSelection(finalState, target);
    if (!verification.verified) {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Work selection verification failed: ${verification.mismatches.join('; ')}`,
            retryHint: 'retry-work-send',
            evidence: { finalState, target, verification },
        });
    }

    // Pre-submit re-detection to catch drift
    const preSubmitDetection = await detectChatGptComposerSurface(page);
    if (preSubmitDetection.surface !== 'work') {
        throw new WebAiError({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-select',
            message: `Surface drifted away from Work before submit (now: ${preSubmitDetection.surface})`,
            retryHint: 'retry-work-send',
            evidence: preSubmitDetection,
        });
    }

    const evidence = buildWorkSelectionEvidence(finalState, target, {
        speed: speedResult.speed,
        switched,
    });

    return { switched, pickerState: finalState, target, speedResult, evidence };
}
