// @ts-check
/// <reference types="playwright-core" />
import { WebAiError } from './errors.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */
/** @typedef {'flash-lite'|'flash'|'pro'} GeminiModelChoice */
/**
 * @typedef {{
 *   requested: string,
 *   selected: string|null,
 *   alreadySelected: boolean,
 *   usedFallbacks: string[],
 * }} GeminiModelSelectResult
 *
 * @typedef {{
 *   state: 'ok'|'warn'|'fail'|'unknown',
 *   evidence: Record<string, unknown>,
 *   next: 'send'|'model-fallback',
 * }} GeminiModelProbe
 */

/** @type {Record<string, string>} */
export const GEMINI_MODEL_ALIASES = {
    fast: 'flash-lite',
    'flash-lite': 'flash-lite',
    'flash_lite': 'flash-lite',
    'flash lite': 'flash-lite',
    'gemini-fast': 'flash-lite',
    'gemini-flash-lite': 'flash-lite',
    'gemini-flash_lite': 'flash-lite',
    'gemini flash lite': 'flash-lite',
    flash: 'flash',
    'gemini-flash': 'flash',
    thinking: 'pro',
    think: 'pro',
    'gemini-thinking': 'pro',
    pro: 'pro',
    'gemini-pro': 'pro',
};

/** @type {Set<string>} */
export const GEMINI_DEEP_THINK_ALIASES = new Set([
    'deepthink',
    'deep-think',
    'deep_think',
    'deep think',
    'gemini-deepthink',
    'gemini-deep-think',
]);

const MODE_BUTTONS = [
    'button[data-test-id="bard-mode-menu-button"]',
    'button[aria-label="Open mode picker"]',
    'button[aria-label*="mode picker" i]',
];

const MODE_OPTION_SELECTOR = '[data-test-id^="bard-mode-option-"], [role="menuitem"], [role="option"]';

/** @type {Record<string, { testId: string, labels: string[] }>} */
const MODE_OPTIONS = {
    'flash-lite': { testId: 'bard-mode-option-fast', labels: ['Flash-Lite', 'Flash Lite'] },
    flash: { testId: 'bard-mode-option-thinking', labels: ['Flash'] },
    pro: { testId: 'bard-mode-option-pro', labels: ['Pro'] },
};

/**
 * @param {unknown} model
 * @returns {string|null}
 */
export function normalizeGeminiModelChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return GEMINI_MODEL_ALIASES[key] || normalizeGeminiModelLabel(key);
}

/**
 * @param {unknown} model
 * @returns {boolean}
 */
export function isGeminiDeepThinkChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    return GEMINI_DEEP_THINK_ALIASES.has(key);
}

/**
 * @param {Page} page
 * @param {unknown} model
 * @returns {Promise<GeminiModelSelectResult|null>}
 */
export async function selectGeminiModel(page, model) {
    if (isGeminiDeepThinkChoice(model)) return null;
    const requested = normalizeGeminiModelChoice(model);
    if (!requested) {
        if (model) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'gemini', retryHint: 'model-fallback', message: `unsupported Gemini model selection: ${model}`, evidence: { model } });
        return null;
    }
    /** @type {string[]} */ const usedFallbacks = [];
    const before = await readGeminiModel(page);
    if (before === requested) return { requested, selected: before, alreadySelected: true, usedFallbacks };
    await openGeminiModelMenu(page, usedFallbacks);
    const option = await findGeminiModelOption(page, requested);
    if (!option) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'gemini', retryHint: 'model-fallback', message: `Gemini model option not found: ${requested}`, evidence: { requested } });
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(700).catch(() => undefined);
    const after = await readGeminiModel(page);
    if (after !== requested) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'gemini', retryHint: 'model-fallback', message: `Gemini model verification failed: expected ${requested}, got ${after || 'none'}`, evidence: { requested, got: after || null } });
    return { requested, selected: after, alreadySelected: false, usedFallbacks };
}

/**
 * @param {Page} page
 * @param {string[]} usedFallbacks
 */
async function openGeminiModelMenu(page, usedFallbacks) {
    const modeItems = page.locator(MODE_OPTION_SELECTOR)
        .filter({ hasText: /Flash|Pro|Thinking/i });
    if (await modeItems.first().isVisible().catch(() => false)) return;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        for (const selector of MODE_BUTTONS) {
            const loc = page.locator(selector).first();
            if (!await loc.isVisible().catch(() => false)) continue;
            await loc.click({ timeout: 5_000 });
            await page.waitForTimeout(350).catch(() => undefined);
            if (await modeItems.first().isVisible().catch(() => false)) return;
        }
        await page.waitForTimeout(150).catch(() => undefined);
    }
    usedFallbacks.push('mode-menu-text-button');
    const textButton = page.locator('button').filter({ hasText: /Flash|Pro|Thinking/i }).first();
    if (await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(350).catch(() => undefined);
        if (await modeItems.first().isVisible().catch(() => false)) return;
    }
    throw new WebAiError({
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        vendor: 'gemini',
        retryHint: 'model-fallback',
        message: `Gemini mode selector not found. Tried: ${MODE_BUTTONS.join(', ')}`,
        selectorsTried: [...MODE_BUTTONS],
    });
}

/**
 * @param {Page} page
 * @param {string} choice
 * @returns {Promise<Locator|null>}
 */
async function findGeminiModelOption(page, choice) {
    const option = MODE_OPTIONS[choice];
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const byTestId = page.locator(`[data-test-id="${option.testId}"]`).first();
        if (await byTestId.isVisible().catch(() => false)) return byTestId;
        const candidates = await page.locator(MODE_OPTION_SELECTOR).all().catch(() => []);
        for (const label of option.labels) {
            const pattern = geminiModeLabelPattern(label);
            for (const candidate of candidates) {
                if (!await candidate.isVisible().catch(() => false)) continue;
                const text = (await candidate.innerText({ timeout: 500 }).catch(() => '')).trim().replace(/\s+/g, ' ');
                if (pattern.test(text)) return candidate;
            }
            const byText = page.getByText(pattern).first();
            if (await byText.isVisible().catch(() => false)) return byText;
        }
        await page.waitForTimeout(150).catch(() => undefined);
    }
    return null;
}

/**
 * @param {Page} page
 * @param {unknown} model
 * @returns {Promise<GeminiModelProbe>}
 */
export async function geminiModelCapabilityProbe(page, model) {
    if (isGeminiDeepThinkChoice(model)) {
        return { state: 'unknown', evidence: { requested: model, tool: 'deepthink' }, next: 'send' };
    }
    const requested = normalizeGeminiModelChoice(model);
    if (!model) return { state: 'unknown', evidence: { requested: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    const active = await readGeminiModel(page).catch(() => null);
    if (active === requested) return { state: 'ok', evidence: { active, requested, selectable: true }, next: 'send' };
    /** @type {string[]} */ const usedFallbacks = [];
    try {
        await openGeminiModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'warn', evidence: { active, requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = await findGeminiModelOption(page, requested).catch(() => null);
    await closeGeminiModelMenu(page);
    return option
        ? { state: 'warn', evidence: { active, requested, selectable: true, usedFallbacks }, next: 'model-fallback' }
        : { state: 'fail', evidence: { active, requested, selectable: false, usedFallbacks }, next: 'model-fallback' };
}

/** @param {Page} page */
async function closeGeminiModelMenu(page) {
    for (let i = 0; i < 3; i += 1) {
        const menuVisible = await page.locator(MODE_OPTION_SELECTOR)
            .filter({ hasText: /Flash|Pro|Thinking/i }).first().isVisible().catch(() => false);
        if (!menuVisible) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

/**
 * @param {Page} page
 * @returns {Promise<string|null>}
 */
async function readGeminiModel(page) {
    for (const selector of MODE_BUTTONS) {
        const loc = page.locator(selector).first();
        if (!await loc.isVisible().catch(() => false)) continue;
        return normalizeGeminiModelChoice(await loc.innerText({ timeout: 1_000 }).catch(() => ''));
    }
    return null;
}

/**
 * @param {string} label
 * @returns {RegExp}
 */
function geminiModeLabelPattern(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]');
    return new RegExp(`^(?:Gemini\\s*)?(?:\\d+(?:\\.\\d+)?\\s+)?${escaped}\\b`, 'i');
}

/**
 * @param {string} label
 * @returns {GeminiModelChoice|null}
 */
function normalizeGeminiModelLabel(label) {
    const normalized = String(label || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const withoutVendor = normalized.replace(/^gemini\s+/, '');
    const withoutVersion = withoutVendor.replace(/^\d+(?:\.\d+)?\s+/, '');
    if (/^flash lite\b/.test(withoutVersion)) return 'flash-lite';
    if (/^flash\b/.test(withoutVersion)) return 'flash';
    if (/^pro\b/.test(withoutVersion)) return 'pro';
    return null;
}
