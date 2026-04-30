export const CHATGPT_MODEL_SELECTOR_BUTTONS = [
    'button[data-testid="model-switcher-dropdown-button"]',
    'button[aria-label="Model selector"]',
    'button[aria-label*="model selector" i]',
];

const CHATGPT_COMPOSER_MODEL_PILL_SELECTORS = [
    'button.__composer-pill[aria-haspopup="menu"]',
    '[role="button"].__composer-pill[aria-haspopup="menu"]',
];

const CHATGPT_MODEL_MENU_ITEM_SELECTOR = '[data-testid^="model-switcher-"]';
const CHATGPT_MODEL_TEXT_BUTTON_PATTERN = /^(Instant|Fast|Thinking|Pro|Heavy)\b/i;

export const CHATGPT_MODEL_OPTIONS = {
    instant: { testIds: ['model-switcher-gpt-5-3'], labels: ['Instant'] },
    thinking: { testIds: ['model-switcher-gpt-5-5-thinking', 'model-switcher-gpt-5-5-thinking-thinking-effort'], labels: ['Thinking'] },
    pro: { testIds: ['model-switcher-gpt-5-5-pro', 'model-switcher-gpt-5-5-pro-thinking-effort'], labels: ['Pro', 'Heavy'] },
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

export function normalizeChatGptModelChoice(model) {
    const key = String(model || '').trim().toLowerCase();
    if (!key) return null;
    return MODEL_ALIASES[key] || null;
}

export async function selectChatGptModel(page, model) {
    const requested = normalizeChatGptModelChoice(model);
    if (!requested) {
        if (model) throw new Error(`unsupported ChatGPT model selection: ${model}`);
        return null;
    }
    const usedFallbacks = [];
    await openModelMenu(page, usedFallbacks);
    const before = await readCheckedModel(page);
    if (before === requested) {
        await closeModelMenu(page);
        return { requested, selected: before, alreadySelected: true, usedFallbacks };
    }
    const option = await findModelOption(page, requested);
    if (!option) throw new Error(`ChatGPT model option not found: ${requested}`);
    await option.click({ timeout: 5_000 });
    await page.waitForTimeout(750).catch(() => undefined);
    await openModelMenu(page, usedFallbacks);
    const after = await readCheckedModel(page);
    await closeModelMenu(page);
    if (after !== requested) throw new Error(`ChatGPT model verification failed: expected ${requested}, got ${after || 'none'}`);
    return { requested, selected: after, alreadySelected: false, usedFallbacks };
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
    const textButton = page.locator('button').filter({ hasText: /^ChatGPT$|^GPT-|^Instant$|^Fast$|^Thinking$|^Pro$|^Heavy$/i }).first();
    if (await textButton.isVisible().catch(() => false)) {
        await textButton.click({ timeout: 5_000 });
        await page.waitForTimeout(400).catch(() => undefined);
        if (await isModelMenuOpen(page)) return;
    }
    throw new Error(`ChatGPT model selector not found. Tried: ${[...CHATGPT_MODEL_SELECTOR_BUTTONS, ...CHATGPT_COMPOSER_MODEL_PILL_SELECTORS].join(', ')}`);
}

async function findComposerModelPill(page) {
    for (const selector of CHATGPT_COMPOSER_MODEL_PILL_SELECTORS) {
        const candidates = await page.locator(selector).count().catch(() => 0);
        for (let index = candidates - 1; index >= 0; index -= 1) {
            const loc = page.locator(selector).nth(index);
            if (!(await loc.isVisible().catch(() => false))) continue;
            const text = await loc.innerText({ timeout: 1_000 }).catch(() => '');
            if (CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text.trim())) return loc;
        }
    }
    const textButton = page.locator('button').filter({ hasText: CHATGPT_MODEL_TEXT_BUTTON_PATTERN }).last();
    if (await textButton.isVisible().catch(() => false)) return textButton;
    return null;
}

async function findModelOption(page, choice) {
    const option = CHATGPT_MODEL_OPTIONS[choice];
    for (const testId of option.testIds) {
        const loc = page.locator(`[role="menuitemradio"][data-testid="${testId}"], [data-testid="${testId}"]`).first();
        if (await loc.isVisible().catch(() => false)) return loc;
    }
    for (const label of option.labels) {
        const loc = page.locator('[role="menuitemradio"], [role="menuitem"]').filter({ hasText: new RegExp(`^${label}\\b`, 'i') }).first();
        if (await loc.isVisible().catch(() => false)) return loc;
    }
    return null;
}

async function readCheckedModel(page) {
    for (const [choice, option] of Object.entries(CHATGPT_MODEL_OPTIONS)) {
        for (const testId of option.testIds) {
            const checked = await page.locator(`[role="menuitemradio"][data-testid="${testId}"][aria-checked="true"], [data-testid="${testId}"][aria-checked="true"]`).first().isVisible().catch(() => false);
            if (checked) return choice;
        }
    }
    const active = await readActiveModelPill(page);
    if (/^(Instant|Fast)\b/i.test(active)) return 'instant';
    if (/^Thinking\b/i.test(active)) return 'thinking';
    if (/^(Pro|Heavy)\b/i.test(active)) return 'pro';
    return null;
}

async function readActiveModelPill(page) {
    const candidates = await page.locator('button').count().catch(() => 0);
    for (let index = candidates - 1; index >= 0; index -= 1) {
        const loc = page.locator('button').nth(index);
        if (!(await loc.isVisible().catch(() => false))) continue;
        const text = (await loc.innerText({ timeout: 500 }).catch(() => '')).trim();
        if (CHATGPT_MODEL_TEXT_BUTTON_PATTERN.test(text)) return text;
    }
    return '';
}

async function isModelMenuOpen(page) {
    return page.locator(CHATGPT_MODEL_MENU_ITEM_SELECTOR).first().isVisible().catch(() => false);
}
