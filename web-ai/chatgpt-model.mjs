import { WebAiError } from './errors.mjs';

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
const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b)/i;
const CHATGPT_OBSERVED_PRO_PILL_LABELS = ['Standard Pro', 'Extended Pro'];
const CHATGPT_EFFORT_TRIGGER_SELECTORS = [
    '[data-testid*="thinking-effort"]',
    '[data-testid*="reasoning-effort"]',
    '[data-testid*="effort"]',
    '[aria-label*="Effort" i]',
    '[aria-label*="Reasoning" i]',
    '[role="menuitem"][aria-label*="Effort" i]',
    '[role="menuitem"][aria-label*="Reasoning" i]',
];

export const CHATGPT_MODEL_OPTIONS = {
    instant: { testIds: ['model-switcher-gpt-5-3'], labels: ['Instant'] },
    thinking: { testIds: ['model-switcher-gpt-5-5-thinking', 'model-switcher-gpt-5-5-thinking-thinking-effort'], labels: ['Thinking'] },
    pro: { testIds: ['model-switcher-gpt-5-5-pro', 'model-switcher-gpt-5-5-pro-thinking-effort'], labels: ['Pro', 'Heavy'] },
};

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

export function normalizeChatGptModelChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return MODEL_ALIASES[key] || null;
}

export function normalizeChatGptEffortChoice(effort) {
    const key = String(effort || '').trim().toLowerCase();
    if (!key) return null;
    return EFFORT_ALIASES[key] || null;
}

export function isChatGptEffortSupported(model, effort) {
    const requestedModel = normalizeChatGptModelChoice(model) || model;
    const requestedEffort = normalizeChatGptEffortChoice(effort) || effort;
    return Boolean(CHATGPT_MODEL_EFFORT_OPTIONS[requestedModel]?.efforts?.[requestedEffort]);
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
    const usedFallbacks = [];
    await openModelMenu(page, usedFallbacks);
    let currentModel = await readCheckedModel(page, requested || null);
    const targetModel = requested || currentModel;
    let modelChanged = false;
    if (!targetModel) {
        await closeModelMenu(page);
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: 'ChatGPT model must be selected before setting reasoning effort', evidence: { effort: requestedEffort } });
    }
    if (requested && currentModel !== requested) {
        const option = await findModelOption(page, requested);
        if (!option) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT model option not found: ${requested}`, evidence: { requested } });
        await option.click({ timeout: 5_000 });
        await page.waitForTimeout(750).catch(() => undefined);
        await openModelMenu(page, usedFallbacks);
        currentModel = await readCheckedModel(page, requested);
        modelChanged = true;
    }
    let selectedEffort = null;
    if (requestedEffort) {
        selectedEffort = await selectChatGptEffort(page, targetModel, requestedEffort, usedFallbacks);
        await openModelMenu(page, usedFallbacks);
    }
    const after = await readCheckedModel(page, targetModel);
    await closeModelMenu(page);
    if (after !== targetModel) throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT model verification failed: expected ${targetModel}, got ${after || 'none'}`, evidence: { requested: targetModel, got: after || null } });
    return {
        requested: requested || targetModel,
        selected: after,
        alreadySelected: !modelChanged && !selectedEffort?.changed,
        effort: selectedEffort?.selected || null,
        requestedEffort: requestedEffort || null,
        usedFallbacks,
    };
}

async function closeModelMenu(page) {
    for (let i = 0; i < 3; i += 1) {
        if (!(await isModelMenuOpen(page))) return;
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(250).catch(() => undefined);
    }
}

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

async function findComposerModelPill(page) {
    let standaloneHeavy = null;
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = await loc.innerText({ timeout: 1_000 }).catch(() => '');
            const trimmed = text.trim();
            if (!isModelPillText(trimmed)) continue;
            if (isStandaloneEffortLabel(trimmed)) {
                if (/^Heavy$/i.test(trimmed) && !standaloneHeavy) standaloneHeavy = loc;
                continue;
            }
            return loc;
        }
    }
    return standaloneHeavy || findModelTextButton(page);
}

async function findModelTextButton(page) {
    let standaloneHeavy = null;
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (!isModelPillText(text)) continue;
        if (isStandaloneEffortLabel(text)) {
            if (/^Heavy$/i.test(text) && !standaloneHeavy) standaloneHeavy = loc;
            continue;
        }
        return loc;
    }
    return standaloneHeavy;
}

async function findModelOption(page, choice) {
    const option = CHATGPT_MODEL_OPTIONS[choice];
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
    return null;
}

async function isModelOptionCandidate(loc, choice) {
    const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
    if (!text) return false;
    if (isStandaloneEffortLabel(text) || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text)) return false;
    return modelChoiceFromText(text) === choice;
}

async function selectChatGptEffort(page, model, effort, usedFallbacks) {
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config?.efforts?.[effort]) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort ${effort} is not available for ${model}`, evidence: { model, effort, supported: Object.keys(config?.efforts || {}) } });
    }
    await openEffortMenu(page, model, effort, usedFallbacks);
    const before = await readCheckedEffort(page, model);
    if (before === effort) return { requested: effort, selected: before, changed: false };
    const option = await findEffortOption(page, model, effort);
    if (!option) {
        const label = config.efforts[effort];
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort option not found: ${model}/${effort}`, evidence: { model, effort, label } });
    }
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(500).catch(() => undefined);
    await openEffortMenu(page, model, effort, usedFallbacks);
    const after = await readCheckedEffort(page, model);
    if (after !== effort) {
        throw new WebAiError({ errorCode: 'provider.model-mismatch', stage: 'provider-select-mode', vendor: 'chatgpt', retryHint: 'model-fallback', message: `ChatGPT reasoning effort verification failed: expected ${effort}, got ${after || 'none'}`, evidence: { model, effort, got: after || null } });
    }
    return { requested: effort, selected: after, changed: true };
}

async function findEffortOption(page, model, effort) {
    const label = CHATGPT_MODEL_EFFORT_OPTIONS[model]?.efforts?.[effort];
    if (!label) return null;
    const candidates = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: effortLabelPattern(label) });
    const modelSpecific = candidates.filter({ hasText: modelLabelPattern(model, CHATGPT_MODEL_OPTIONS[model]?.labels?.[0] || '') }).last();
    if (await modelSpecific.isVisible().catch(() => false)) return modelSpecific;
    const option = candidates.last();
    return (await option.isVisible().catch(() => false)) ? option : null;
}

async function openEffortMenu(page, model, effort, usedFallbacks) {
    if (await isEffortMenuOpen(page, model, { effort })) return;
    if (!(await isModelMenuOpen(page))) await openModelMenu(page, usedFallbacks);
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    const row = await findModelOption(page, model);
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

async function dismissEffortMenuAndReopenModel(page, usedFallbacks) {
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(200).catch(() => undefined);
    await openModelMenu(page, usedFallbacks);
}

async function findEffortTriggerBoxNearModelRow(page, model) {
    const labels = CHATGPT_MODEL_OPTIONS[model]?.labels || [];
    return page.evaluate(({ expectedLabels, modelChoice, triggerSelectors }) => {
        const rows = Array.from(document.querySelectorAll('[role="menuitemradio"][data-testid^="model-switcher-"], [role="menuitemradio"]'));
        const row = rows.find((candidate) => {
            const text = (candidate.innerText || candidate.textContent || '').trim();
            return matchesModelText(text, modelChoice, expectedLabels);
        });
        if (!row) return null;
        const rowRect = row.getBoundingClientRect();
        const selectorButtons = Array.from(document.querySelectorAll(triggerSelectors.join(',')));
        const textButtons = Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"]'))
            .filter(candidate => /^(Effort|Reasoning effort)$/i.test((candidate.innerText || candidate.textContent || '').trim()));
        const effortButtons = [...selectorButtons, ...textButtons];
        const button = effortButtons.find((candidate) => {
            const rect = candidate.getBoundingClientRect();
            const rowCenterY = rowRect.y + rowRect.height / 2;
            return rect.width > 0 && rect.height > 0 && rowCenterY >= rect.y && rowCenterY <= rect.y + rect.height;
        });
        if (!button) return null;
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        function matchesModelText(text, choice, labelsForChoice) {
            if (choice === 'instant') return /\b(Instant|Fast)\b/i.test(text);
            if (choice === 'thinking') return /\b(Thinking|Think)\b/i.test(text);
            if (choice === 'pro') return /\b(Pro|Heavy)\b/i.test(text);
            return labelsForChoice.some(label => new RegExp(`(^|\\s)${label}\\b`, 'i').test(text));
        }
    }, { expectedLabels: labels, modelChoice: model, triggerSelectors: CHATGPT_EFFORT_TRIGGER_SELECTORS }).catch(() => null);
}

async function readCheckedEffort(page, model) {
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    for (const [effort, label] of Object.entries(config?.efforts || {})) {
        const checked = await page.locator(`[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]`)
            .filter({ hasText: effortLabelPattern(label) })
            .last()
            .isVisible()
            .catch(() => false);
        if (checked) return effort;
    }
    const active = await readActiveEffortPill(page);
    for (const [effort, label] of Object.entries(config?.efforts || {})) {
        if (effortLabelPattern(label).test(active)) return effort;
    }
    return null;
}

async function isEffortMenuOpen(page, model, options = {}) {
    const allowUnlabeled = options.allowUnlabeled !== false;
    const requestedEffort = options.effort || null;
    const config = CHATGPT_MODEL_EFFORT_OPTIONS[model];
    if (!config) return false;
    const labels = Object.values(config.efforts);
    const requiredLabels = requiredEffortMenuLabels(model, requestedEffort);
    const unexpectedLabels = Object.entries(CHATGPT_MODEL_EFFORT_OPTIONS)
        .filter(([choice]) => choice !== model)
        .flatMap(([, option]) => Object.values(option.efforts))
        .filter(label => !labels.includes(label));
    return page.locator('[role="menu"]').evaluateAll((menus, { expectedLabels, requiredLabels, unexpectedLabels, modelChoice, allowUnlabeled }) => {
        return menus.some(menu => {
            const text = menu.innerText || menu.textContent || '';
            if (!menuTextMatchesModel(text, modelChoice, allowUnlabeled)) return false;
            const unexpectedMatches = unexpectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (unexpectedMatches.length > 0) return false;
            const requiredMatches = requiredLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            if (requiredMatches.length < requiredLabels.length) return false;
            const matches = expectedLabels.filter(label => new RegExp(`(^|\\s)${label}(\\s|$)`, 'i').test(text));
            const minimumMatches = requiredLabels.length || (expectedLabels.length <= 2 ? expectedLabels.length : Math.min(3, expectedLabels.length));
            return matches.length >= minimumMatches;
        });
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

async function readCheckedModel(page, expectedModel = null) {
    for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
        for (const testId of option.testIds) {
            const checked = await page.locator(`[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], [data-testid="${testId}"][aria-checked="true"]`).first().isVisible().catch(() => false);
            if (checked) return choice;
        }
    }
    const checkedRows = await page.locator('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"][data-state="checked"]').all().catch(() => []);
    for (const row of checkedRows) {
        const text = (await row.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (isStandaloneEffortLabel(text)) continue;
        const choice = modelChoiceFromText(text);
        if (choice) return choice;
    }
    const active = await readActiveModelPill(page, { allowStandaloneHeavy: expectedModel === 'pro' });
    return modelChoiceFromText(active);
}

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

async function readActiveEffortPill(page) {
    const labels = [...new Set(Object.values(CHATGPT_MODEL_EFFORT_OPTIONS).flatMap(option => Object.values(option.efforts)))];
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

async function isModelMenuOpen(page) {
    return page.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR)
        .filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN })
        .evaluateAll((items) => items.some(item => {
            const text = (item.innerText || item.textContent || '').trim();
            const testId = item.getAttribute?.('data-testid') || '';
            if (!text) return false;
            if (testId.includes('effort') && /^(Light|Standard|Extended|Heavy|Standard Pro|Extended Pro)$/i.test(text)) return false;
            return /^(ChatGPT|GPT[-\s]?\d|((Light|Standard|Extended|Heavy)\s+)?(Instant|Fast|Thinking|Pro|Heavy)\b)/i.test(text);
        }))
        .catch(() => false);
}

function modelLabelPattern(choice, label) {
    if (choice === 'instant') return /\b(Instant|Fast)\b/i;
    if (choice === 'thinking') return /\b(Thinking|Think)\b/i;
    if (choice === 'pro') return /\b(Pro|Heavy)\b/i;
    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
}

function effortLabelPattern(label) {
    return new RegExp(`(^|\\s)${escapeRegExp(label)}\\b`, 'i');
}

function modelChoiceFromText(text) {
    if (/\b(Instant|Fast)\b/i.test(text)) return 'instant';
    if (/\b(Thinking|Think)\b/i.test(text)) return 'thinking';
    if (/\b(Pro|Heavy)\b/i.test(text)) return 'pro';
    return null;
}

function isModelPillText(text) {
    return CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text) || CHATGPT_OBSERVED_PRO_PILL_LABELS.includes(text);
}

function isStandaloneEffortLabel(text) {
    return /^(Light|Standard|Extended|Heavy)$/i.test(String(text || '').trim());
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function chatGptModelCapabilityProbe(page, model, options = {}) {
    const requested = normalizeChatGptModelChoice(model);
    const requestedEffort = normalizeChatGptEffortChoice(options.effort || options.reasoningEffort);
    if (!model && !(options.effort || options.reasoningEffort)) return { state: 'unknown', evidence: { requested: null, effort: null }, next: 'send' };
    if (!requested) return { state: 'fail', evidence: { requested: model }, next: 'model-fallback' };
    if ((options.effort || options.reasoningEffort) && !requestedEffort) return { state: 'fail', evidence: { requested, effort: options.effort || options.reasoningEffort }, next: 'model-fallback' };
    if (requestedEffort && !isChatGptEffortSupported(requested, requestedEffort)) return { state: 'fail', evidence: { requested, effort: requestedEffort }, next: 'model-fallback' };
    const usedFallbacks = [];
    try {
        await openModelMenu(page, usedFallbacks);
    } catch {
        return { state: 'fail', evidence: { requested, menuOpenFailed: true, usedFallbacks }, next: 'model-fallback' };
    }
    const option = await findModelOption(page, requested).catch(() => null);
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
