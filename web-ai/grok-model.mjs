// @ts-check
/// <reference types="playwright-core" />
import { WebAiError } from './errors.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */
/** @typedef {'auto'|'fast'|'expert'|'grok-4.3'|'heavy'} GrokModelChoice */
/**
 * @typedef {{
 *   requested: string,
 *   selected: string|null,
 *   alreadySelected: boolean,
 *   usedFallbacks: string[],
 * }} GrokModelSelectResult
 *
 * @typedef {{
 *   state: 'ok'|'warn'|'fail'|'unknown',
 *   evidence: Record<string, unknown>,
 *   next: 'send'|'model-fallback',
 * }} GrokModelProbe
 */

/** @type {Record<string, string>} */
export const GROK_MODEL_ALIASES = {
    auto: 'auto',
    automatic: 'auto',
    fast: 'fast',
    quick: 'fast',
    expert: 'expert',
    thinking: 'expert',
    think: 'expert',
    'grok-4.3': 'grok-4.3',
    grok43: 'grok-4.3',
    'grok-43': 'grok-4.3',
    beta: 'grok-4.3',
    heavy: 'heavy',
};

const MODEL_BUTTONS = [
    'button[aria-label="Model select"]',
    'button[aria-label*="Model select" i]',
];

/** @type {Record<string, string[]>} */
const MODEL_OPTIONS = {
    auto: ['Auto'],
    fast: ['Fast'],
    expert: ['Expert'],
    'grok-4.3': ['Grok 4.3'],
    heavy: ['Heavy'],
};

/**
 * @param {unknown} model
 * @returns {string|null}
 */
export function normalizeGrokModelChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return GROK_MODEL_ALIASES[key] || null;
}

/**
 * @param {Page} page
 * @param {unknown} model
 * @returns {Promise<GrokModelSelectResult|null>}
 */
export async function selectGrokModel(page, model) {
    const requested = normalizeGrokModelChoice(model);
    if (!requested) {
        if (model) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'grok', retryHint: 'model-fallback', message: `unsupported Grok model selection: ${model}`, evidence: { model } });
        return null;
    }
    /** @type {string[]} */ const usedFallbacks = [];
    const before = await readGrokModel(page);
    if (before === requested) return { requested, selected: before, alreadySelected: true, usedFallbacks };
    await openGrokModelMenu(page, usedFallbacks);
    const option = await findGrokModelOption(page, requested);
    if (!option) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'grok', retryHint: 'model-fallback', message: `Grok model option not found: ${requested}`, evidence: { requested } });
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(700).catch(() => undefined);
    const after = await readGrokModel(page);
    if (after !== requested) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'grok', retryHint: 'model-fallback', message: `Grok model verification failed: expected ${requested}, got ${after || 'none'}`, evidence: { requested, got: after || null } });
    return { requested, selected: after, alreadySelected: false, usedFallbacks };
}

/**
 * @param {Page} page
 * @param {string[]} usedFallbacks
 */
async function openGrokModelMenu(page, usedFallbacks) {
    const modelItems = page.locator('[role="menuitem"]').filter({ hasText: /^Auto\b|^Fast\b|^Expert\b|^Grok 4\.3\b|^Heavy\b/i });
    if (await modelItems.first().isVisible().catch(() => false)) return;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        for (const selector of MODEL_BUTTONS) {
            const loc = page.locator(selector).first();
            if (!await loc.isVisible().catch(() => false)) continue;
            await loc.click({ timeout: 5_000 });
            await page.waitForTimeout(350).catch(() => undefined);
            if (await modelItems.first().isVisible().catch(() => false)) return;
        }
        await page.waitForTimeout(150).catch(() => undefined);
    }
    usedFallbacks.push('model-menu-text-button');
    const textButton = page.locator('button').filter({ hasText: /^Auto$|^Fast$|^Expert$|^Grok 4\.3|^Heavy$/i }).first();
    if (await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(350).catch(() => undefined);
        if (await page.locator('[role="menuitem"]').first().isVisible().catch(() => false)) return;
    }
    throw new WebAiError({
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        vendor: 'grok',
        retryHint: 'model-fallback',
        message: `Grok model selector not found. Tried: ${MODEL_BUTTONS.join(', ')}`,
        selectorsTried: [...MODEL_BUTTONS],
    });
}

/**
 * @param {Page} page
 * @param {string} choice
 * @returns {Promise<Locator|null>}
 */
async function findGrokModelOption(page, choice) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const candidates = await page.locator('[role="menuitem"], button').all().catch(() => []);
        for (const label of MODEL_OPTIONS[choice]) {
            const pattern = new RegExp(`^${escapeRegExp(label)}\\b`, 'i');
            for (const candidate of candidates) {
                if (!await candidate.isVisible().catch(() => false)) continue;
                const text = (await candidate.innerText({ timeout: 500 }).catch(() => '')).trim().replace(/\s+/g, ' ');
                if (pattern.test(text)) return candidate;
            }
        }
        await page.waitForTimeout(150).catch(() => undefined);
    }
    return null;
}

/**
 * @param {Page} page
 * @param {unknown} model
 * @returns {Promise<GrokModelProbe>}
 */
export async function grokModelCapabilityProbe(page, model) {
    const requested = normalizeGrokModelChoice(model);
    if (!model) return { state: 'unknown', evidence: { requested: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    const active = await readGrokModel(page).catch(() => null);
    if (active === requested) return { state: 'ok', evidence: { active, requested, selectable: true }, next: 'send' };
    /** @type {string[]} */ const usedFallbacks = [];
    try {
        await openGrokModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'warn', evidence: { active, requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = await findGrokModelOption(page, requested).catch(() => null);
    await closeGrokModelMenu(page);
    return option
        ? { state: 'warn', evidence: { active, requested, selectable: true, usedFallbacks }, next: 'model-fallback' }
        : { state: 'fail', evidence: { active, requested, selectable: false, usedFallbacks }, next: 'model-fallback' };
}

/** @param {Page} page */
async function closeGrokModelMenu(page) {
    for (let i = 0; i < 3; i += 1) {
        const menuVisible = await page.locator('[role="menuitem"]')
            .filter({ hasText: /^Auto\b|^Fast\b|^Expert\b|^Grok 4\.3\b|^Heavy\b/i }).first().isVisible().catch(() => false);
        if (!menuVisible) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

/**
 * @param {Page} page
 * @returns {Promise<string|null>}
 */
async function readGrokModel(page) {
    for (const selector of MODEL_BUTTONS) {
        const loc = page.locator(selector).first();
        if (!await loc.isVisible().catch(() => false)) continue;
        return normalizeGrokModelChoice(await loc.innerText({ timeout: 1_000 }).catch(() => ''));
    }
    return null;
}

/** @param {string} value */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
