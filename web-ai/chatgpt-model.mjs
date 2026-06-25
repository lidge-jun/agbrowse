// @ts-check
import { WebAiError } from './errors.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */
/** @typedef {'instant'|'thinking'|'pro'} ModelChoice */
/** @typedef {'light'|'standard'|'extended'|'heavy'} EffortChoice */
/** @typedef {{ testIds: string[], labels: string[] }} ModelOptionConfig */
/** @typedef {{ triggerTestIds: string[], efforts: Readonly<Record<string, string>> }} EffortConfig */
/** @typedef {{ x: number, y: number, width: number, height: number }} BoundingBox */
/** @typedef {'already-selected'|'switched'|'switched-best-effort'|'unavailable'} ModelSelectionEvidenceStatus */
/**
 * @typedef {Object} BrowserModelSelectionEvidence
 * @property {string|null} requestedModel
 * @property {string|null} resolvedLabel
 * @property {ModelChoice|null} normalizedModel
 * @property {'select'} strategy
 * @property {ModelSelectionEvidenceStatus} status
 * @property {boolean} verified
 * @property {'chatgpt-model-picker'} source
 * @property {string} capturedAt
 */

export const CHATGPT_MODEL_SELECTOR_BUTTONS = [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Model selector"]',
    'button[aria-label*="model selector" i]',
];

const CHATGPT_COMPOSER_MODEL_PILL_SELECTORS = [
    'button.__composer-pill[aria-haspopup="menu"]',
    '[role="button"].__composer-pill[aria-haspopup="menu"]',
    'button.__composer-pill',
    '[role="button"].__composer-pill',
];

const CHATGPT_MODEL_MENU_ITEM_SELECTOR = '[data-testid^="model-switcher-gpt-"]';
const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b|Medium\b|High\b|Extra High\b|Pro Standard\b|Pro Extended\b|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)/i;
const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Standard Pro', 'Extended Pro'];
const CHATGPT_EFFORT_TRIGGER_SELECTORS = [
    '[data-testid="composer-intelligence-pro-thinking-effort-trigger"]',
    '[data-testid*="thinking-effort"]',
    '[data-testid*="reasoning-effort"]',
    '[data-testid*="effort"]',
    '[aria-label*="Effort" i]',
    '[aria-label*="Reasoning" i]',
    '[role="menuitem"][aria-label*="Effort" i]',
    '[role="menuitem"][aria-label*="Reasoning" i]',
];

/** @type {Readonly<Record<ModelChoice, ModelOptionConfig>>} */
export const CHATGPT_MODEL_OPTIONS = {
    instant: { testIds: ['model-switcher-gpt-5-5', 'model-switcher-gpt-5-3'], labels: ['Instant', '즉시'] },
    thinking: { testIds: ['model-switcher-gpt-5-5-thinking', 'model-switcher-gpt-5-5-thinking-thinking-effort'], labels: ['Thinking', 'Medium', 'High', 'Extra High', '중간', '높음', '매우 높음'] },
    pro: { testIds: ['model-switcher-gpt-5-5-pro', 'model-switcher-gpt-5-5-pro-thinking-effort'], labels: ['Pro', 'Heavy', 'Pro Standard', 'Pro Extended', 'Pro 확장', '프로 확장'] },
};

/** @type {Readonly<Record<string, EffortConfig>>} */
export const CHATGPT_MODEL_EFFORT_OPTIONS = {
    thinking: {
        triggerTestIds: ['model-switcher-gpt-5-5-thinking-thinking-effort'],
        efforts: {
            light: 'Light',
            standard: 'Standard',
            extended: 'Extended',
            heavy: 'Heavy',
        },
    },
    pro: {
        triggerTestIds: ['model-switcher-gpt-5-5-pro-thinking-effort'],
        efforts: {
            standard: 'Standard',
            extended: 'Extended',
        },
    },
};

/** @type {Readonly<Record<ModelChoice, { defaultLabels: readonly string[], efforts: Readonly<Record<string, readonly string[]>> }>>} */
const CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS = {
    instant: {
        defaultLabels: ['Instant', '즉시'],
        efforts: {
            light: ['Instant', '즉시'],
        },
    },
    thinking: {
        defaultLabels: ['Medium', '중간'],
        efforts: {
            light: ['Instant', '즉시'],
            standard: ['Medium', '중간'],
            extended: ['High', '높음'],
            heavy: ['Extra High', '매우 높음'],
        },
    },
    pro: {
        defaultLabels: ['Pro Extended', 'Pro 확장', '프로 확장'],
        efforts: {
            standard: ['Pro Extended', 'Pro 확장', '프로 확장'],
            extended: ['Pro Extended', 'Pro 확장', '프로 확장'],
        },
    },
};

/** @type {Readonly<Record<string, ModelChoice>>} */
const MODEL_ALIASES = {
    instant: 'instant',
    fast: 'instant',
    'gpt-5-3': 'instant',
    'gpt-5.3': 'instant',
    thinking: 'thinking',
    think: 'thinking',
    'gpt-5-5-thinking': 'thinking',
    'gpt-5.5-thinking': 'thinking',
    pro: 'pro',
    'gpt-5-5-pro': 'pro',
    'gpt-5.5-pro': 'pro',
};

/** @type {Readonly<Record<string, EffortChoice>>} */
const EFFORT_ALIASES = {
    light: 'light',
    low: 'light',
    standard: 'standard',
    normal: 'standard',
    regular: 'standard',
    default: 'standard',
    extended: 'extended',
    high: 'extended',
    heavy: 'heavy',
};

/**
 * @param {unknown} model
 * @returns {ModelChoice | null}
 */
export function normalizeChatGptModelChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return MODEL_ALIASES[key] || null;
}

/**
 * @param {unknown} effort
 * @returns {EffortChoice | null}
 */
export function normalizeChatGptEffortChoice(effort) {
    const key = String(effort || '').trim().toLowerCase();
    if (!key) return null;
    return EFFORT_ALIASES[key] || null;
}

/**
 * @param {unknown} model
 * @param {unknown} effort
 * @returns {boolean}
 */
export function isChatGptEffortSupported(model, effort) {
    const requestedModel = normalizeChatGptModelChoice(model) || /** @type {string} */ (model);
    const requestedEffort = normalizeChatGptEffortChoice(effort) || /** @type {string} */ (effort);
    return Boolean(CHATGPT_MODEL_EFFORT_OPTIONS[requestedModel]?.efforts?.[requestedEffort]);
}

/**
 * @typedef {Object} SelectModelOptions
 * @property {string} [effort]
 * @property {string} [reasoningEffort]
 */

/**
 * @typedef {Object} SelectModelResult
 * @property {ModelChoice | string | null} requested
 * @property {ModelChoice | null} selected
 * @property {boolean} alreadySelected
 * @property {string | null} effort
 * @property {EffortChoice | null} requestedEffort
 * @property {string[]} usedFallbacks
 * @property {string[]} warnings
 * @property {BrowserModelSelectionEvidence} modelSelection
 */

/**
 * @param {Page} page
 * @param {unknown} model
 * @param {SelectModelOptions} [options]
 * @returns {Promise<SelectModelResult | null>}
 */
const MODEL_PILL_SETTLE_MS = 8_000;
const MODEL_SELECT_MAX_ATTEMPTS = 3;

/**
 * Wait for the ChatGPT model pill to mount before reading it. ChatGPT renders
 * the picker pill 1-4s after the page is interactive (later on a cold profile),
 * so a single read can miss it. Re-reads until evidence has a resolved choice
 * or the deadline elapses; never throws. (Mirrors Oracle #271 / 0.15.1.)
 * @param {any} page
 * @param {string|null} requested
 * @param {number} [deadlineMs]
 * @returns {Promise<any>}
 */
async function waitForModelPillEvidence(page, requested, deadlineMs = MODEL_PILL_SETTLE_MS) {
    const deadline = Date.now() + deadlineMs;
    let evidence = await readCheckedModelEvidence(page, requested);
    while (!evidence?.choice && Date.now() < deadline) {
        await page.waitForTimeout(400).catch(() => undefined);
        evidence = await readCheckedModelEvidence(page, requested);
    }
    return evidence;
}

export async function selectChatGptModel(page, model, options = {}) {
    const requested = normalizeChatGptModelChoice(model);
    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
    if (!requested) {
        if (model) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT model selection: ${model}`, evidence: { model } });
        if (!requestedEffort) return null;
    }
    if ((options.effort || options.reasoningEffort) && !requestedEffort) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `unsupported ChatGPT reasoning effort: ${options.effort || options.reasoningEffort}`, evidence: { effort: options.effort || options.reasoningEffort } });
    }
    /** @type {string[]} */
    const usedFallbacks = [];
    /** @type {string[]} */
    const warnings = [];
    try {
        await openModelMenu(page, usedFallbacks);
    } catch (err) {
        if (!isSelectionUnavailable(err)) throw err;
        const warning = buildModelSelectionWarning(requested, requestedEffort, err);
        return {
            requested: requested || null,
            selected: null,
            alreadySelected: true,
            effort: null,
            requestedEffort: requestedEffort || null,
            usedFallbacks: [...usedFallbacks, 'model-selector-unavailable-current-model'],
            warnings: [warning],
            modelSelection: createModelSelectionEvidence({
                requestedModel: requested || String(model || '') || null,
                resolvedLabel: null,
                normalizedModel: null,
                status: 'unavailable',
                verified: false,
            }),
        };
    }
    let currentEvidence = await waitForModelPillEvidence(page, requested || null);
    let currentModel = currentEvidence?.choice || null;
    const targetModel = requested || currentModel;
    let modelChanged = false;
    if (!targetModel) {
        await closeModelMenu(page);
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: 'ChatGPT model must be selected before setting reasoning effort', evidence: { effort: requestedEffort } });
    }
    if (requested && currentModel !== requested) {
        // Bounded retry: ChatGPT occasionally drops the first option click (menu
        // re-render race), leaving the model unchanged. Re-click and re-verify up
        // to MODEL_SELECT_MAX_ATTEMPTS; a genuinely missing option still fails fast.
        let attempt = 0;
        while (currentModel !== requested && attempt < MODEL_SELECT_MAX_ATTEMPTS) {
            attempt += 1;
            const option = await findModelOption(page, requested);
            if (!option) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT model option not found: ${requested}`, evidence: { requested } });
            await option.click({ timeout: 5_000 });
            await page.waitForTimeout(750).catch(() => undefined);
            await openModelMenu(page, usedFallbacks);
            currentEvidence = await readCheckedModelEvidence(page, requested);
            currentModel = currentEvidence?.choice || null;
            modelChanged = true;
        }
        // Explicit model requested but unverified after retries — surface it.
        // Effort selection (below) still fails closed on mismatch.
        if (currentModel !== requested && !warnings.includes('model-selection-unverified')) {
            warnings.push('model-selection-unverified');
        }
    }
    /** @type {{ requested: string, selected: string|null, changed: boolean } | null} */
    let selectedEffort = null;
    if (requestedEffort) {
        const simplifiedSelected = currentEvidence?.label
            ? effortChoiceFromSimplifiedText(currentEvidence.label, /** @type {string} */ (targetModel), requestedEffort)
            : null;
        if (simplifiedSelected === requestedEffort) {
            selectedEffort = { requested: requestedEffort, selected: requestedEffort, changed: modelChanged };
            usedFallbacks.push(`${targetModel}-effort-simplified-direct`);
        } else {
            try {
                selectedEffort = await selectChatGptEffort(page, /** @type {string} */ (targetModel), requestedEffort, usedFallbacks);
                await openModelMenu(page, usedFallbacks);
            } catch (err) {
                if (!isSelectionUnavailable(err)) throw err;
                usedFallbacks.push('reasoning-effort-unavailable-current-effort');
                warnings.push(`reasoning effort ${requestedEffort} was not enforced: ${errorMessage(err)}`);
                await closeModelMenu(page);
            }
        }
    }
    const afterEvidence = await readCheckedModelEvidence(page, targetModel);
    const after = afterEvidence?.choice || null;
    await closeModelMenu(page);
    if (after !== targetModel) {
        usedFallbacks.push('model-verification-unavailable-current-model');
        warnings.push(`model ${targetModel} was not verified; current detected model is ${after || 'unknown'}`);
    }
    const verified = after === targetModel;
    return {
        requested: requested || targetModel,
        selected: after,
        alreadySelected: !modelChanged && !selectedEffort?.changed,
        effort: selectedEffort?.selected || null,
        requestedEffort: requestedEffort || null,
        usedFallbacks,
        warnings,
        modelSelection: createModelSelectionEvidence({
            requestedModel: requested || targetModel || null,
            resolvedLabel: afterEvidence?.label || after || null,
            normalizedModel: after,
            status: verified ? (modelChanged ? 'switched' : 'already-selected') : (modelChanged ? 'switched-best-effort' : 'unavailable'),
            verified,
        }),
    };
}

/**
 * @param {{
 *   requestedModel: string|null,
 *   resolvedLabel: string|null,
 *   normalizedModel: ModelChoice|null,
 *   status: ModelSelectionEvidenceStatus,
 *   verified: boolean,
 * }} input
 * @returns {BrowserModelSelectionEvidence}
 */
function createModelSelectionEvidence(input) {
    return {
        requestedModel: input.requestedModel,
        resolvedLabel: input.resolvedLabel,
        normalizedModel: input.normalizedModel,
        strategy: 'select',
        status: input.status,
        verified: input.verified,
        source: 'chatgpt-model-picker',
        capturedAt: new Date().toISOString(),
    };
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isSelectionUnavailable(err) {
    const error = /** @type {Partial<WebAiError>} */ (err);
    return error instanceof WebAiError
        && error.errorCode === 'provider.model-mismatch'
        && error.stage === 'provider-select-mode';
}

/**
 * @param {ModelChoice | null} requested
 * @param {EffortChoice | null} requestedEffort
 * @param {unknown} err
 * @returns {string}
 */
function buildModelSelectionWarning(requested, requestedEffort, err) {
    const modelText = requested
        ? `requested ${requested} was not enforced`
        : 'model selector unavailable';
    const effortText = requestedEffort
        ? `; requested effort ${requestedEffort} was not enforced`
        : '';
    return `${modelText}${effortText}, continuing with current ChatGPT model: ${errorMessage(err)}`;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
    return /** @type {{ message?: string }} */ (err)?.message || String(err);
}

/** @param {Page} page */
async function closeModelMenu(page) {
    for (let i = 0; i < 3; i += 1) {
        if (!(await isModelMenuOpen(page))) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

/**
 * @param {Page} page
 * @param {string[]} usedFallbacks
 */
async function openModelMenu(page, usedFallbacks) {
    if (await isModelMenuOpen(page)) return;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        for (const selector of CHATGPT_MODEL_SELECTOR_BUTTONS) {
            const loc = page.locator(selector).first();
            if (!(await loc.isVisible().catch(() => false))) continue;
            await loc.click({ timeout: 5_000 });
            await page.waitForTimeout(400).catch(() => undefined);
            if (await isModelMenuOpen(page)) return;
        }
        const composerPill = await findComposerModelPill(page);
        if (composerPill) {
            usedFallbacks.push('composer-model-pill');
            await composerPill.click({ timeout: 5_000 });
            await page.waitForTimeout(400).catch(() => undefined);
            if (await isModelMenuOpen(page)) return;
        }
        await page.waitForTimeout(250).catch(() => undefined);
    }
    usedFallbacks.push('model-menu-text-button');
    const textButton = await findModelTextButton(page);
    if (textButton && await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(400).catch(() => undefined);
        if (await isModelMenuOpen(page)) return;
    }
    throw new WebAiError({
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        vendor: 'chatgpt',
        retryHint: 'model-fallback',
        message: `ChatGPT model selector not found. Tried: ${[...CHATGPT_MODEL_SELECTOR_BUTTONS, ...CHATGPT_COMPOSER_MODEL_PILL_SELECTORS].join(', ')}`,
        selectorsTried: [...CHATGPT_MODEL_SELECTOR_BUTTONS, ...CHATGPT_COMPOSER_MODEL_PILL_SELECTORS],
    });
}

/**
 * @param {Page} page
 * @returns {Promise<Locator | null>}
 */
async function findComposerModelPill(page) {
    /** @type {Locator | null} */
    let standaloneEffort = null;
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = await loc.innerText({ timeout: 1_000 }).catch(() => '');
            const trimmed = text.trim();
            if (!isModelPillText(trimmed)) continue;
            if (isStandaloneEffortLabel(trimmed)) {
                if (!standaloneEffort) standaloneEffort = loc;
                continue;
            }
            return loc;
        }
    }
    return standaloneEffort || findModelTextButton(page);
}

/**
 * @param {Page} page
 * @returns {Promise<Locator | null>}
 */
async function findModelTextButton(page) {
    /** @type {Locator | null} */
    let standaloneEffort = null;
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!isModelPillText(text)) continue;
        if (isStandaloneEffortLabel(text)) {
            if (!standaloneEffort) standaloneEffort = loc;
            continue;
        }
        return loc;
    }
    return standaloneEffort;
}

/**
 * @param {Page} page
 * @param {ModelChoice} choice
 * @returns {Promise<Locator | null>}
 */
async function findModelOption(page, choice) {
    const option = CHATGPT_MODEL_OPTIONS[choice];
    await openSimplifiedIntelligenceSubmenu(page).catch(() => undefined);
    for (const testId of option.testIds) {
        const loc = page.locator(`[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        if (!(await isModelOptionCandidate(loc, choice))) continue;
        return loc;
    }
    for (const label of option.labels) {
        const candidates = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: modelLabelPattern(choice, label) });
        const count = await candidates.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
            const loc = candidates.nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            if (!(await isModelOptionCandidate(loc, choice))) continue;
            return loc;
        }
    }
    const simplified = await findOptionByExactLabels(page, simplifiedDefaultLabels(choice));
    if (simplified && await isSimplifiedIntelligenceMenuOpen(page, choice, null)) return simplified;
    if (simplified && await isModelOptionCandidate(simplified, choice)) return simplified;
    return null;
}

/**
 * New ChatGPT picker can open to a one-row "GPT-5.5" family menu before the
 * Intelligence rows. Enter that submenu before looking for Instant/Medium/Pro
 * labels.
 *
 * @param {Page} page
 * @returns {Promise<void>}
 */
async function openSimplifiedIntelligenceSubmenu(page) {
    if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
    const candidates = page.locator('[role="menuitem"], [role="button"], button').filter({ hasText: /^GPT[-\s]?5\.5$/i });
    const count = await candidates.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
        const loc = candidates.nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.hover({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
        if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
        await loc.focus({ timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press('ArrowRight').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
        if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
        await loc.click({ timeout: 1_000 }).catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
        if (await isSimplifiedIntelligenceMenuOpen(page, null, null)) return;
    }
}

/**
 * @param {Locator} loc
 * @param {ModelChoice} choice
 * @returns {Promise<boolean>}
 */
async function isModelOptionCandidate(loc, choice) {
    const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
    if (!text) return false;
    if (isStandaloneEffortLabel(text) || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return false;
    if (choice === 'pro' && isLegacyProModelLabel(text)) return false;
    return modelChoiceFromText(text) === choice;
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {string} effort
 * @param {string[]} usedFallbacks
 * @returns {Promise<{ requested: string, selected: string|null, changed: boolean }>}
 */
async function selectChatGptEffort(page, model, effort, usedFallbacks) {
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config?.efforts?.[effort]) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort ${effort} is not available for ${model}`, evidence: { model, effort, supported: Object.keys(config?.efforts || {}) } });
    }
    await openEffortMenu(page, model, effort, usedFallbacks);
    const before = await readCheckedEffort(page, model, effort);
    if (before === effort) return { requested: effort, selected: before, changed: false };
    const option = await findEffortOption(page, model, effort);
    if (!option) {
        const label = config.efforts[effort];
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort option not found: ${model}/${effort}`, evidence: { model, effort, label } });
    }
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(500).catch(() => undefined);
    await openEffortMenu(page, model, effort, usedFallbacks);
    const after = await readCheckedEffort(page, model, effort);
    if (after !== effort) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort verification failed: expected ${effort}, got ${after || 'none'}`, evidence: { model, effort, got: after || null } });
    }
    return { requested: effort, selected: after, changed: true };
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {string} effort
 * @returns {Promise<Locator | null>}
 */
async function findEffortOption(page, model, effort) {
    const label = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts?.[effort];
    if (!label) return null;
    const simplified = await findOptionByExactLabels(page, simplifiedEffortLabels(model, effort));
    if (simplified) return simplified;
    const candidates = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: effortLabelPattern(label) });
    const modelSpecific = candidates.filter({ hasText: modelLabelPattern(/** @type {ModelChoice} */ (model), CHATGPT_MODEL_OPTIONS[/** @type {ModelChoice} */ (model)]?.labels?.[0] || '') }).last();
    if (await modelSpecific.isVisible().catch(() => false)) return modelSpecific;
    const option = candidates.last();
    return (await option.isVisible().catch(() => false)) ? option : null;
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {string} effort
 * @param {string[]} usedFallbacks
 */
async function openEffortMenu(page, model, effort, usedFallbacks) {
    if (await isEffortMenuOpen(page, model, { effort })) return;
    if (!(await isModelMenuOpen(page))) await openModelMenu(page, usedFallbacks);
    const simplifiedDirect = await findOptionByExactLabels(page, simplifiedEffortLabels(model, effort));
    if (simplifiedDirect && await simplifiedDirect.isVisible().catch(() => false)) {
        usedFallbacks.push(`${model}-effort-simplified-direct`);
        return;
    }
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    const row = await findModelOption(page, /** @type {ModelChoice} */ (model));
    const rowBox = row ? await row.boundingBox().catch(() => null) : null;
    if (rowBox) {
        await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2).catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
    } else if (row) {
        await row.hover({ timeout: 2_000 }).catch(() => undefined);
    }
    for (const testId of config.triggerTestIds) {
        const trigger = page.locator(`[data-testid="${testId}"]`).first();
        if (!(await trigger.count().then(count => count > 0).catch(() => false))) continue;
        if (await trigger.isVisible().catch(() => false)) {
            await trigger.click({ timeout: 2_000 }).catch(() => undefined);
            await page.waitForTimeout(300).catch(() => undefined);
            if (await isEffortMenuOpen(page, model, { effort })) return;
            await dismissEffortMenuAndReopenModel(page, usedFallbacks);
        }
    }
    for (const selector of CHATGPT_EFFORT_TRIGGER_SELECTORS) {
        const trigger = page.locator(selector).last();
        if (!(await trigger.isVisible().catch(() => false))) continue;
        await trigger.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort, allowUnlabeled: false })) {
            usedFallbacks.push(`${model}-effort-generic-trigger`);
            return;
        }
        await dismissEffortMenuAndReopenModel(page, usedFallbacks);
    }
    const textTrigger = page.locator('button, [role="button"], [role="menuitem"]').filter({ hasText: /^(Effort|Reasoning effort)$/i }).last();
    if (await textTrigger.isVisible().catch(() => false)) {
        await textTrigger.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort, allowUnlabeled: false })) {
            usedFallbacks.push(`${model}-effort-text-trigger`);
            return;
        }
        await dismissEffortMenuAndReopenModel(page, usedFallbacks);
    }
    if (row) {
        await row.focus({ timeout: 1_000 }).catch(() => undefined);
        await page.keyboard.press('ArrowRight').catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort })) {
            usedFallbacks.push(`${model}-effort-keyboard-open`);
            return;
        }
    }
    const fallbackBox = await findEffortTriggerBoxNearModelRow(page, model);
    if (fallbackBox) {
        await page.mouse.move(fallbackBox.x + fallbackBox.width / 2, fallbackBox.y + fallbackBox.height / 2).catch(() => undefined);
        await page.waitForTimeout(100).catch(() => undefined);
        await page.mouse.click(fallbackBox.x + fallbackBox.width / 2, fallbackBox.y + fallbackBox.height / 2).catch(() => undefined);
        await page.waitForTimeout(300).catch(() => undefined);
        if (await isEffortMenuOpen(page, model, { effort })) {
            usedFallbacks.push(`${model}-effort-row-button`);
            return;
        }
    }
    usedFallbacks.push(`${model}-effort-trigger`);
    throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort selector not found for ${model}`, selectorsTried: config.triggerTestIds.map(testId => `[data-testid="${testId}"]`), evidence: { model } });
}

/**
 * @param {Page} page
 * @param {string[]} usedFallbacks
 */
async function dismissEffortMenuAndReopenModel(page, usedFallbacks) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200).catch(() => undefined);
    await openModelMenu(page, usedFallbacks);
}

/**
 * @param {Page} page
 * @param {string} model
 * @returns {Promise<BoundingBox | null>}
 */
async function findEffortTriggerBoxNearModelRow(page, model) {
    const labels = CHATGPT_MODEL_OPTIONS[/** @type {ModelChoice} */ (model)]?.labels || [];
    return page.evaluate(({ expectedLabels, modelChoice, triggerSelectors }) => {
        const rows = Array.from(document.querySelectorAll('[role="menuitemradio"][data-testid^="model-switcher-"], [role="menuitemradio"]'));
        const row = rows.find((candidate) => {
            const text = (/** @type {HTMLElement} */ (candidate).innerText || candidate.textContent || '').trim();
            return matchesModelText(text, modelChoice, expectedLabels);
        });
        if (!row) return null;
        const rowRect = row.getBoundingClientRect();
        const selectorButtons = Array.from(document.querySelectorAll(triggerSelectors.join(',')));
        const textButtons = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"]'))
            .filter(candidate => /^(Effort|Reasoning effort)$/i.test((/** @type {HTMLElement} */ (candidate).innerText || candidate.textContent || '').trim()));
        const effortButtons = [...selectorButtons, ...textButtons];
        const button = effortButtons.find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const rowCenterY = rowRect.y + rowRect.height / 2;
            return rect.width > 0 && rect.height > 0 && rowCenterY >= rect.y && rowCenterY <= rect.y + rect.height;
        });
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        /**
         * @param {string} text
         * @param {string} choice
         * @param {string[]} labelsForChoice
         */
        function matchesModelText(text, choice, labelsForChoice) {
            if (choice === 'instant') return /\b(Instant|Fast)\b|즉시/i.test(text);
            if (choice === 'thinking') return /\b(Thinking|Think)\b|중간|높음|매우 높음/i.test(text);
            if (choice === 'pro') return /\b(Pro|Heavy)\b|Pro 확장|프로 확장/i.test(text);
            return labelsForChoice.some(label => new RegExp(`(^|\\s)${label}\\b`, 'i').test(text));
        }
    }, { expectedLabels: labels, modelChoice: model, triggerSelectors: CHATGPT_EFFORT_TRIGGER_SELECTORS }).catch(() => null);
}

/**
 * @param {Page} page
 * @param {string} model
 * @returns {Promise<EffortChoice | null>}
 */
async function readCheckedEffort(page, model, preferredEffort = null) {
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]')
        .all()
        .catch(() => /** @type {Locator[]} */ ([]));
    for (const row of checkedRows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        const simplified = effortChoiceFromSimplifiedText(text, model, preferredEffort);
        if (simplified) return simplified;
    }
    for (const [effort, label] of Object.entries(config?.efforts || {})) {
        const checked = await page.locator(`[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]`)
            .filter({ hasText: effortLabelPattern(label) })
            .last()
            .isVisible()
            .catch(() => false);
        if (checked) return /** @type {EffortChoice} */ (effort);
    }
    const active = await readActiveEffortPill(page);
    for (const [effort, label] of Object.entries(config?.efforts || {})) {
        if (effortLabelPattern(label).test(active)) return /** @type {EffortChoice} */ (effort);
    }
    return null;
}

/**
 * @param {Page} page
 * @param {string} model
 * @param {{ allowUnlabeled?: boolean, effort?: string | null }} [options]
 * @returns {Promise<boolean>}
 */
async function isEffortMenuOpen(page, model, options = {}) {
    const allowUnlabeled = options.allowUnlabeled !== false;
    const requestedEffort = options.effort || null;
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config) return false;
    if (await isSimplifiedIntelligenceMenuOpen(page, model, requestedEffort)) return true;
    const labels = Object.values(config.efforts);
    const requiredLabels = requiredEffortMenuLabels(model, requestedEffort);
    const unexpectedLabels = Object.entries(CHATGPT_MODEL_EFFORT_OPTIONS)
        .filter(([choice]) => choice !== model)
        .flatMap(([, option]) => Object.values(option.efforts))
        .filter(label => !labels.includes(label));
    return page.locator('[role="menu"]').evaluateAll((menus, { expectedLabels, requiredLabels, unexpectedLabels, modelChoice, allowUnlabeled }) => {
        return menus.some(menu => {
            const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
            if (!menuTextMatchesModel(text, modelChoice, allowUnlabeled)) return false;
            const unexpectedMatches = unexpectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (unexpectedMatches.length > 0) return false;
            const requiredMatches = requiredLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (requiredMatches.length < requiredLabels.length) return false;
            const matches = expectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            const minimumMatches = requiredLabels.length || (expectedLabels.length <= 2 ? expectedLabels.length : Math.min(3, expectedLabels.length));
            return matches.length >= minimumMatches;
        });
        /**
         * @param {string} text
         * @param {string} choice
         * @param {boolean} permitUnlabeled
         */
        function menuTextMatchesModel(text, choice, permitUnlabeled) {
            const hasThinking = /\b(Thinking|Think)\b/i.test(text);
            const hasPro = /\bPro\b/i.test(text);
            if (!hasThinking && !hasPro) return permitUnlabeled;
            if (choice === 'thinking') return hasThinking && !hasPro;
            if (choice === 'pro') return hasPro && !hasThinking;
            return true;
        }
    }, { expectedLabels: labels, requiredLabels, unexpectedLabels, modelChoice: model, allowUnlabeled }).catch(() => false);
}

/**
 * @param {string} model
 * @param {string | null} [effort]
 * @returns {string[]}
 */
function requiredEffortMenuLabels(model, effort) {
    const efforts = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts || {};
    if (model === 'thinking') {
        const base = [efforts.standard, efforts.extended].filter(Boolean);
        if (effort === 'light' || effort === 'heavy') {
            return [...new Set([...base, efforts[effort]].filter(Boolean))];
        }
        if (effort === 'standard' || effort === 'extended') return base;
    }
    if (model === 'pro') return Object.values(efforts);
    if (effort && efforts[effort]) return [efforts[effort]];
    return Object.values(efforts);
}

/**
 * @param {Page} page
 * @param {ModelChoice | null} [expectedModel]
 * @returns {Promise<ModelChoice | null>}
 */
async function readCheckedModel(page, expectedModel = null) {
    const evidence = await readCheckedModelEvidence(page, expectedModel);
    return evidence?.choice || null;
}

/**
 * @param {Page} page
 * @param {ModelChoice | null} [expectedModel]
 * @returns {Promise<{ choice: ModelChoice, label: string } | null>}
 */
async function readCheckedModelEvidence(page, expectedModel = null) {
    for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
        for (const testId of option.testIds) {
            const row = page.locator(`[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], [data-testid="${testId}"][aria-checked="true"]`).first();
            const checked = await row.isVisible().catch(() => false);
            if (checked) {
                const label = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
                return { choice: /** @type {ModelChoice} */ (choice), label: label || String(choice) };
            }
        }
    }
    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]').all().catch(() => /** @type {Locator[]} */ ([]));
    for (const row of checkedRows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (isStandaloneEffortLabel(text)) continue;
        const choice = modelChoiceFromText(text);
        if (choice) return { choice, label: text || String(choice) };
    }
    const active = await readActiveModelPill(page, { allowStandaloneHeavy: expectedModel === 'pro' });
    const choice = modelChoiceFromText(active);
    return choice ? { choice, label: active || String(choice) } : null;
}

/**
 * @param {Page} page
 * @param {{ allowStandaloneHeavy?: boolean }} [options]
 * @returns {Promise<string>}
 */
async function readActiveModelPill(page, options = {}) {
    const allowStandaloneHeavy = options.allowStandaloneHeavy === true;
    let standaloneHeavy = '';
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (!isModelPillText(text)) continue;
            if (isStandaloneEffortLabel(text)) {
                if (allowStandaloneHeavy && /^Heavy$/i.test(text) && !standaloneHeavy) standaloneHeavy = text;
                continue;
            }
            return text;
        }
    }
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!isModelPillText(text)) continue;
        if (isStandaloneEffortLabel(text)) {
            if (allowStandaloneHeavy && /^Heavy$/i.test(text) && !standaloneHeavy) standaloneHeavy = text;
            continue;
        }
        return text;
    }
    return standaloneHeavy;
}

/**
 * @param {Page} page
 * @returns {Promise<string>}
 */
async function readActiveEffortPill(page) {
    const labels = [...new Set([
        ...Object.values(CHATGPT_MODEL_EFFORT_OPTIONS).flatMap(option => Object.values(option.efforts)),
        ...Object.values(CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS).flatMap(option => Object.values(option.efforts).flat()),
    ])];
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (labels.some(label => effortLabelPattern(label).test(text))) return text;
        }
    }
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (labels.some(label => effortLabelPattern(label).test(text))) return text;
    }
    return '';
}

/**
 * @param {Page} page
 * @returns {Promise<boolean>}
 */
async function isModelMenuOpen(page) {
    const legacyOpen = await page.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR)
        .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN })
        .evaluateAll((items) => items.some(item => {
            const text = (/** @type {HTMLElement} */ (item).innerText || item.textContent || '').trim();
            const testId = item.getAttribute?.('data-testid') || '';
            if (!text) return false;
            if (testId.includes('effort') && /^(Light|Standard|Extended|Heavy|Standard Pro|Extended Pro)$/i.test(text)) return false;
            return /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b|Medium\b|High\b|Extra High\b|Pro Standard\b|Pro Extended\b|즉시|중간|높음|매우 높음|Pro 확장|프로 확장)/i.test(text);
        }))
        .catch(() => false);
    if (legacyOpen || await isSimplifiedIntelligenceMenuOpen(page, null, null)) return true;
    return page.locator('[role="menuitem"], [role="button"], button')
        .filter({ hasText: /^GPT[-\s]?5\.5$/i })
        .first()
        .isVisible()
        .catch(() => false);
}

/**
 * @param {ModelChoice} choice
 * @param {string} label
 * @returns {RegExp}
 */
function modelLabelPattern(choice, label) {
    if (choice === 'instant') return /\b(Instant|Fast)\b|즉시/i;
    if (choice === 'thinking') return /\b(Thinking|Think|Medium|High|Extra High)\b|중간|높음|매우 높음/i;
    if (choice === 'pro') return /\b(Pro|Heavy|Pro Standard|Pro Extended)\b|Pro 확장|프로 확장/i;
    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
}

/**
 * @param {string} label
 * @returns {RegExp}
 */
function effortLabelPattern(label) {
    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
}

/**
 * @param {string} text
 * @returns {ModelChoice | null}
 */
function modelChoiceFromText(text) {
    if (/\b(Instant|Fast)\b|즉시/i.test(text)) return 'instant';
    if (isLegacyProModelLabel(text)) return null;
    if (/\b(Pro Standard|Pro Extended)\b|Pro 확장|프로 확장/i.test(text)) return 'pro';
    if (/\b(Medium|High|Extra High)\b|중간|높음|매우 높음/i.test(text)) return 'thinking';
    if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
    if (/\b(Pro|Heavy)\b/i.test(text)) return 'pro';
    return null;
}

/**
 * @param {Page} page
 * @param {readonly string[]} labels
 * @returns {Promise<Locator | null>}
 */
async function findOptionByExactLabels(page, labels) {
    for (const label of labels) {
        const candidates = await page.locator('[role="menuitemradio"], [role="menuitem"]').all().catch(() => /** @type {Locator[]} */ ([]));
        for (const loc of candidates) {
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
            if (menuTextHasExactLine(text, label)) return loc;
        }
    }
    return null;
}

/**
 * @param {Page} page
 * @param {ModelChoice | string | null} model
 * @param {string | null} effort
 * @returns {Promise<boolean>}
 */
async function isSimplifiedIntelligenceMenuOpen(page, model, effort) {
    const requiredLabels = effort && model
        ? simplifiedEffortLabels(model, effort)
        : ['Instant', 'Medium', 'High', 'Extra High', '즉시', '중간', '높음', '매우 높음'];
    if (requiredLabels.length === 0) return false;
    return page.locator('[role="menu"]').evaluateAll((menus, labels) => menus.some(menu => {
        const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
        if (!/\bIntelligence\b|지능/i.test(text)) return false;
        return labels.some(label => menuTextHasExactLine(text, label));
    }), requiredLabels).catch(() => false);
}

/**
 * @param {ModelChoice | string} model
 * @returns {readonly string[]}
 */
function simplifiedDefaultLabels(model) {
    return CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS[/** @type {ModelChoice} */ (model)]?.defaultLabels || [];
}

/**
 * @param {ModelChoice | string} model
 * @param {string} effort
 * @returns {readonly string[]}
 */
function simplifiedEffortLabels(model, effort) {
    return CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS[/** @type {ModelChoice} */ (model)]?.efforts?.[effort] || [];
}

/**
 * @param {string} text
 * @param {string} model
 * @returns {EffortChoice | null}
 */
function effortChoiceFromSimplifiedText(text, model, preferredEffort = null) {
    const options = CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS[/** @type {ModelChoice} */ (model)]?.efforts || {};
    const preferredLabels = preferredEffort ? options[preferredEffort] || [] : [];
    if (preferredLabels.some(label => menuTextHasExactLine(text, label))) return /** @type {EffortChoice} */ (preferredEffort);
    for (const [effort, labels] of Object.entries(options)) {
        if (labels.some(label => menuTextHasExactLine(text, label))) return /** @type {EffortChoice} */ (effort);
    }
    return null;
}

/**
 * @param {string} text
 * @param {string} label
 * @returns {boolean}
 */
function menuTextHasExactLine(text, label) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => normalizeModelPickerText(line))
        .includes(normalizeModelPickerText(label));
}

/**
 * @param {unknown} text
 * @returns {string}
 */
function normalizeModelPickerText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Reject legacy explicit GPT-5.x Pro model rows without blocking current Pro labels.
 * @param {unknown} text
 * @returns {boolean}
 */
function isLegacyProModelLabel(text) {
    const normalized = normalizeModelPickerText(text);
    return [
        'gpt 5 pro',
        'gpt 5 0 pro',
        'gpt 5 1 pro',
        'gpt 5 2 pro',
        'gpt 5 3 pro',
        'gpt 5 4 pro',
    ].some(label => normalized.includes(label));
}

/** @param {string} text @returns {boolean} */
function isModelPillText(text) {
    return CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text)
        || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)
        || isStandaloneEffortLabel(text);
}

/** @param {unknown} text @returns {boolean} */
function isStandaloneEffortLabel(text) {
    return /^(Light|Standard|Extended|Heavy)$/i.test(String(text || '').trim());
}

/** @param {unknown} value @returns {string} */
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @typedef {Object} CapabilityProbeOptions
 * @property {string} [effort]
 * @property {string} [reasoningEffort]
 */

/**
 * @typedef {Object} CapabilityProbeResult
 * @property {'ok'|'warn'|'fail'|'unknown'} state
 * @property {Record<string, unknown>} evidence
 * @property {string} next
 */

/**
 * @param {Page} page
 * @param {unknown} model
 * @param {CapabilityProbeOptions} [options]
 * @returns {Promise<CapabilityProbeResult>}
 */
export async function chatGptModelCapabilityProbe(page, model, options = {}) {
    const requested = normalizeChatGptModelChoice(model);
    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
    if (!model && !(options.effort || options.reasoningEffort)) return { state: 'unknown', evidence: { requested: null, effort: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    if ((options.effort || options.reasoningEffort) && !requestedEffort) return { state: 'fail', evidence: { requested, effort: options.effort || options.reasoningEffort }, next: 'model-fallback' };
    if (requestedEffort && !isChatGptEffortSupported(requested, requestedEffort)) return { state: 'fail', evidence: { requested, effort: requestedEffort }, next: 'model-fallback' };
    /** @type {string[]} */
    const usedFallbacks = [];
    try {
        await openModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'fail', evidence: { requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = await findModelOption(page, requested).catch(() => null);
    /** @type {Locator | null} */
    let effortOption = null;
    if (option && requestedEffort) {
        try {
            await openEffortMenu(page, requested, requestedEffort, usedFallbacks);
            effortOption = await findEffortOption(page, requested, requestedEffort);
        } catch {
            effortOption = null;
        }
    }
    let menuClosed = false;
    try {
        await closeModelMenu(page);
        menuClosed = !(await isModelMenuOpen(page));
    } catch {
        menuClosed = false;
    }
    const selectable = Boolean(option) && (!requestedEffort || Boolean(effortOption));
    const state = selectable ? (menuClosed ? 'ok' : 'warn') : 'fail';
    return { state, evidence: { requested, effort: requestedEffort || null, menuClosed, usedFallbacks }, next: state === 'ok' ? 'send' : 'model-fallback' };
}
