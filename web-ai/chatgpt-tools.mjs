// @ts-check
/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */

const PLUS_BUTTON_SELECTORS = [
    '[data-testid="composer-plus-btn"]',
    'button[aria-label="파일 추가 및 기타"]',
    'button[aria-label*="파일 추가" i]',
    'button[aria-label*="Add" i][aria-haspopup="menu"]',
    'button[aria-label*="Attach" i][aria-haspopup="menu"]',
    'button[data-testid*="plus" i]',
];

const TOOL_ALIASES = new Map([
    ['image', 'image'], ['images', 'image'], ['create-image', 'image'], ['image-create', 'image'], ['이미지', 'image'], ['이미지만들기', 'image'], ['이미지 만들기', 'image'],
    ['deep-research', 'deep-research'], ['research', 'deep-research'], ['deep', 'deep-research'], ['심층리서치', 'deep-research'], ['심층 리서치', 'deep-research'],
    ['web-search', 'web-search'], ['web', 'web-search'], ['search', 'web-search'], ['browse', 'web-search'], ['웹검색', 'web-search'], ['웹 검색', 'web-search'],
    ['agent', 'agent-mode'], ['agent-mode', 'agent-mode'], ['에이전트', 'agent-mode'], ['에이전트 모드', 'agent-mode'],
    ['todo', 'tasks',], ['tasks', 'tasks'], ['task', 'tasks'], ['할일', 'tasks'], ['할 일 만들기', 'tasks'],
]);

/** @type {Record<string, string[]>} */
const TOOL_LABELS = {
    image: ['이미지 만들기', 'Create image'],
    'deep-research': ['심층 리서치', 'Deep research'],
    'web-search': ['웹 검색', 'Web search'],
    'agent-mode': ['에이전트 모드', 'Agent mode'],
    tasks: ['할 일 만들기', 'Create tasks', 'Tasks'],
};

/** @type {Record<string, string[]>} */
const PLUGIN_LABELS = {
    canva: ['Canva'],
    context7: ['Context7'],
    figma: ['Figma'],
    github: ['GitHub'],
    gmail: ['Gmail'],
    'google-drive': ['Google 드라이브', 'Google Drive'],
    drive: ['Google 드라이브', 'Google Drive'],
    'google-contacts': ['Google 주소록', 'Google Contacts'],
    contacts: ['Google 주소록', 'Google Contacts'],
    'google-calendar': ['Google Calendar', 'Google 캘린더'],
    calendar: ['Google Calendar', 'Google 캘린더'],
    'openai-platform': ['OpenAI Platform'],
    supabase: ['Supabase'],
    vercel: ['Vercel'],
};

/**
 * @param {any} input
 * @returns {{ tools: string[], plugins: string[], reasons: string[] }}
 */
export function resolveChatGptComposerToolRequests(input = {}) {
    const tools = new Set();
    const plugins = new Set();
    const reasons = [];
    const explicitTools = normalizeList(input.tools || input.tool || []);
    for (const tool of explicitTools) {
        const normalized = normalizeToolName(tool);
        if (normalized) tools.add(normalized);
    }
    for (const plugin of normalizeList(input.plugins || input.plugin || [])) {
        const normalized = normalizePluginName(plugin);
        if (normalized) plugins.add(normalized);
    }
    if (input.webSearch === true) {
        tools.add('web-search');
        reasons.push('flag:web-search');
    }
    if (input.outputImage !== undefined && input.outputImage !== null && input.outputImage !== '') {
        tools.add('image');
        reasons.push('flag:output-image');
    }
    if (input.research === 'deep') {
        tools.add('deep-research');
        reasons.push('flag:research-deep');
    }
    if (input.autoTools === true) {
        const prompt = [input.prompt, input.goal, input.question, input.context, input.constraints].filter(Boolean).join('\n').toLowerCase();
        if (looksLikeImageGeneration(prompt)) {
            tools.add('image');
            reasons.push('auto:image-intent');
        }
        if (looksLikeDeepResearch(prompt)) {
            tools.add('deep-research');
            reasons.push('auto:deep-research-intent');
        } else if (looksLikeWebSearch(prompt)) {
            tools.add('web-search');
            reasons.push('auto:web-search-intent');
        }
        if (looksLikeGitHub(prompt)) {
            plugins.add('github');
            reasons.push('auto:github-intent');
        }
        if (looksLikeSupabase(prompt)) {
            plugins.add('supabase');
            reasons.push('auto:supabase-intent');
        }
    }
    return { tools: [...tools], plugins: [...plugins], reasons };
}

/**
 * @param {Page} page
 * @param {any} input
 * @returns {Promise<{ requestedTools: string[], requestedPlugins: string[], selectedTools: string[], selectedPlugins: string[], warnings: string[], usedFallbacks: string[], reasons: string[] } | null>}
 */
export async function selectChatGptComposerTools(page, input = {}) {
    const requested = resolveChatGptComposerToolRequests(input);
    if (!requested.tools.length && !requested.plugins.length) return null;
    /** @type {string[]} */
    const selectedTools = [];
    /** @type {string[]} */
    const selectedPlugins = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {string[]} */
    const usedFallbacks = [];

    for (const tool of requested.tools) {
        const labels = TOOL_LABELS[tool] || [tool];
        const ok = await selectMainComposerMenuItem(page, labels, usedFallbacks);
        if (ok) selectedTools.push(tool);
        else warnings.push(`composer tool not selected: ${tool}`);
    }
    for (const plugin of requested.plugins) {
        const labels = PLUGIN_LABELS[plugin] || [plugin];
        const ok = await selectMoreComposerMenuItem(page, labels, usedFallbacks);
        if (ok) selectedPlugins.push(plugin);
        else warnings.push(`composer plugin not selected: ${plugin}`);
    }
    await closeComposerMenus(page);
    return {
        requestedTools: requested.tools,
        requestedPlugins: requested.plugins,
        selectedTools,
        selectedPlugins,
        warnings,
        usedFallbacks,
        reasons: requested.reasons,
    };
}

/** @param {Page} page @param {string[]} labels @param {string[]} usedFallbacks */
async function selectMainComposerMenuItem(page, labels, usedFallbacks) {
    await openComposerPlusMenu(page, usedFallbacks);
    const item = await findVisibleMenuItemByLabels(page, labels);
    if (!item) return false;
    const before = await checkedState(item);
    if (before === 'true') return true;
    return clickMenuItem(page, item);
}

/** @param {Page} page @param {string[]} labels @param {string[]} usedFallbacks */
async function selectMoreComposerMenuItem(page, labels, usedFallbacks) {
    await openComposerPlusMenu(page, usedFallbacks);
    const more = await findVisibleMenuItemByLabels(page, ['더 보기', 'More']);
    if (!more) return false;
    await more.hover({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(250).catch(() => undefined);
    if (!(await anyMenuItemVisible(page, labels))) {
        await more.click({ timeout: 2_000 }).catch(() => undefined);
        await page.waitForTimeout(400).catch(() => undefined);
    }
    const item = await findVisibleMenuItemByLabels(page, labels);
    if (!item) return false;
    if (await checkedState(item) === 'true') return true;
    return clickMenuItem(page, item);
}

/** @param {Page} page @param {string[]} usedFallbacks */
async function openComposerPlusMenu(page, usedFallbacks) {
    if (await isComposerPlusMenuOpen(page)) return;
    for (const selector of PLUS_BUTTON_SELECTORS) {
        const loc = page.locator(selector).first();
        if (!(await loc.isVisible().catch(() => false))) continue;
        await loc.click({ timeout: 3_000 }).catch(async () => {
            const box = await loc.boundingBox().catch(() => null);
            if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        });
        await page.waitForTimeout(400).catch(() => undefined);
        if (await isComposerPlusMenuOpen(page)) return;
    }
    usedFallbacks.push('composer-plus-shortcut');
    await chord(page, process.platform === 'darwin' ? 'Meta+u' : 'Control+u').catch(() => undefined);
    await page.waitForTimeout(400).catch(() => undefined);
}

/** @param {Page} page */
async function isComposerPlusMenuOpen(page) {
    return page.locator('[role="menu"]').evaluateAll((menus) => menus.some(menu => {
        const text = /** @type {HTMLElement} */ (menu).innerText || menu.textContent || '';
        return /사진 및 파일 추가|최근 파일|이미지 만들기|심층 리서치|웹 검색|Add photos|Create image|Deep research|Web search/i.test(text);
    })).catch(() => false);
}

/** @param {Page} page @param {string[]} labels */
async function findVisibleMenuItemByLabels(page, labels) {
    const candidates = await page.locator('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]').all().catch(() => /** @type {Locator[]} */ ([]));
    for (const candidate of candidates) {
        if (!(await candidate.isVisible().catch(() => false))) continue;
        const text = normalizeUiText(await candidate.innerText({ timeout: 500 }).catch(() => ''));
        if (!text) continue;
        if (labels.some(label => textIncludesLabel(text, label))) return candidate;
    }
    return null;
}

/** @param {Page} page @param {string[]} labels */
async function anyMenuItemVisible(page, labels) {
    return Boolean(await findVisibleMenuItemByLabels(page, labels));
}

/** @param {Locator} loc */
async function checkedState(loc) {
    return loc.getAttribute('aria-checked').catch(() => null);
}

/** @param {Page} page @param {Locator} item */
async function clickMenuItem(page, item) {
    const directClicked = await item.click({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
    if (!directClicked) {
        const box = await item.boundingBox().catch(() => null);
        if (!box) return false;
        const fallbackClicked = await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
            .then(() => true)
            .catch(() => false);
        if (!fallbackClicked) return false;
    }
    await page.waitForTimeout(400).catch(() => undefined);
    return true;
}

/** @param {Page} page */
async function closeComposerMenus(page) {
    // ChatGPT uses a second Escape to remove the active composer tool pill
    // (for example, Web search becomes a "Search, click to remove" pill).
    // One Escape is enough to close an open menu without undoing selection.
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(150).catch(() => undefined);
}

/** @param {Page} page @param {string} combo */
async function chord(page, combo) {
    const parts = combo.split('+');
    const key = parts.pop();
    const pressed = [];
    try {
        for (const mod of parts) {
            await page.keyboard.down(mod);
            pressed.push(mod);
        }
        if (key) await page.keyboard.press(key);
    } finally {
        for (const mod of pressed.reverse()) await page.keyboard.up(mod).catch(() => undefined);
    }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeList(value) {
    if (Array.isArray(value)) return value.flatMap(item => normalizeList(item));
    if (value === undefined || value === null || value === false) return [];
    return String(value).split(',').map(part => part.trim()).filter(Boolean);
}

/** @param {unknown} value */
function normalizeToolName(value) {
    const raw = String(value || '').trim();
    const key = normalizeUiText(raw).replace(/\s+/g, '-');
    return TOOL_ALIASES.get(key) || TOOL_ALIASES.get(normalizeUiText(raw)) || null;
}

/** @param {unknown} value */
function normalizePluginName(value) {
    const key = normalizeUiText(value).replace(/\s+/g, '-');
    if (PLUGIN_LABELS[key]) return key;
    const simple = key.replace(/^google-/, '');
    if (PLUGIN_LABELS[simple]) return simple;
    return key || null;
}

/** @param {unknown} text */
function normalizeUiText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** @param {string} haystack @param {string} label */
function textIncludesLabel(haystack, label) {
    const normalized = normalizeUiText(label);
    return normalized && haystack.includes(normalized);
}

/** @param {string} prompt */
function looksLikeImageGeneration(prompt) {
    return /\b(generate|create|draw|make)\b.*\b(image|picture|illustration|diagram|logo|poster)\b|이미지(?:를|가|로|의)?\s*(만들|생성|제작)|그림(?:을|이|으로|의)?\s*(그려|생성)|일러스트(?:를|가|로|의)?\s*(만들|생성|제작)/i.test(prompt);
}

/** @param {string} prompt */
function looksLikeDeepResearch(prompt) {
    return /deep research|심층\s*리서치|심층\s*조사|장문\s*조사|출처.*종합|literature review|market research/i.test(prompt);
}

/** @param {string} prompt */
function looksLikeWebSearch(prompt) {
    return /현재|최신|오늘|요즘|뉴스|가격|시세|공식|검색|웹\s*검색|find current|latest|today|news|price|official status|cite sources/i.test(prompt);
}

/** @param {string} prompt */
function looksLikeGitHub(prompt) {
    return /github|깃허브|repo|repository|레포|pull request|pr\b|issue\b|branch\b/i.test(prompt);
}

/** @param {string} prompt */
function looksLikeSupabase(prompt) {
    return /supabase|수파베이스|rls\b|edge function|migration|postgres/i.test(prompt);
}
