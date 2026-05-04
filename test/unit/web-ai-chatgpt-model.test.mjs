import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const modelSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-model.mjs'), 'utf8');

describe('web-ai ChatGPT model selector policy', () => {
    it('supports the observed Heavy/Pro effort UI', () => {
        expect(modelSrc).toContain('model-switcher-gpt-5-5-pro-thinking-effort');
        expect(modelSrc).toContain('model-switcher-gpt-5-5-thinking-thinking-effort');
        expect(modelSrc).toContain('Extended Pro');
        expect(modelSrc).toContain('Heavy');
        expect(modelSrc).toContain('readActiveModelPill');
    });

    it('normalizes observed ChatGPT effort aliases', async () => {
        const {
            CHATGPT_MODEL_EFFORT_OPTIONS,
            isChatGptEffortSupported,
            normalizeChatGptEffortChoice,
        } = await import('../../web-ai/chatgpt-model.mjs');

        expect(Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.pro.efforts)).toEqual(['standard', 'extended']);
        expect(Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.thinking.efforts)).toEqual(['light', 'standard', 'extended', 'heavy']);
        expect(normalizeChatGptEffortChoice('regular')).toBe('standard');
        expect(normalizeChatGptEffortChoice('high')).toBe('extended');
        expect(isChatGptEffortSupported('pro', 'standard')).toBe(true);
        expect(isChatGptEffortSupported('pro', 'heavy')).toBe(false);
        expect(isChatGptEffortSupported('thinking', 'heavy')).toBe(true);
    });

    it('selects every supported reasoning effort when ChatGPT puts the model name before the effort label', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');

        for (const effort of ['light', 'standard', 'extended', 'heavy']) {
            const page = createFakeModelPage({
                model: 'thinking',
                effortTexts: {
                    light: 'GPT-5.5 Thinking Light',
                    standard: 'GPT-5.5 Thinking Standard',
                    extended: 'GPT-5.5 Thinking Extended',
                    heavy: 'GPT-5.5 Thinking Heavy',
                },
            });
            await expect(selectChatGptModel(page, 'thinking', { effort })).resolves.toMatchObject({
                selected: 'thinking',
                effort,
            });
        }

        for (const effort of ['standard', 'extended']) {
            const page = createFakeModelPage({
                model: 'pro',
                effortTexts: {
                    standard: 'GPT-5.5 Pro Standard',
                    extended: 'GPT-5.5 Pro Extended',
                },
            });
            await expect(selectChatGptModel(page, 'pro', { effort })).resolves.toMatchObject({
                selected: 'pro',
                effort,
            });
        }
    });

    it('opens the reasoning menu through generic effort controls for every supported effort when exact test ids are absent', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'thinking', efforts: ['light', 'standard', 'extended', 'heavy'], effortTexts: thinkingEffortTexts() },
            { model: 'pro', efforts: ['standard', 'extended'], effortTexts: proEffortTexts() },
        ];

        for (const { model, efforts, effortTexts } of cases) {
            for (const effort of efforts) {
                const page = createFakeModelPage({
                    model,
                    exactEffortTrigger: false,
                    genericEffortTrigger: true,
                    effortTexts,
                });
                const result = await selectChatGptModel(page, model, { effort });

                expect(result).toMatchObject({ selected: model, effort });
                expect(result.usedFallbacks).toContain(`${model}-effort-generic-trigger`);
            }
        }
    });

    it('ignores a reasoning menu for the wrong ChatGPT model before selecting an effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            {
                model: 'thinking',
                efforts: ['light', 'standard', 'extended', 'heavy'],
                effortTexts: thinkingEffortTexts(),
                genericEffortTexts: proEffortTexts(),
            },
            {
                model: 'pro',
                efforts: ['standard', 'extended'],
                effortTexts: proEffortTexts(),
                genericEffortTexts: thinkingEffortTexts(),
            },
        ];

        for (const { model, efforts, effortTexts, genericEffortTexts } of cases) {
            for (const effort of efforts) {
                const page = createFakeModelPage({
                    model,
                    exactEffortTrigger: false,
                    genericEffortTrigger: true,
                    effortTexts,
                    genericEffortTexts,
                });
                const result = await selectChatGptModel(page, model, { effort });

                expect(result).toMatchObject({ selected: model, effort });
                expect(result.usedFallbacks).toContain(`${model}-effort-keyboard-open`);
                expect(result.usedFallbacks).not.toContain(`${model}-effort-generic-trigger`);
            }
        }
    });

    it('rejects labels-only effort menus that expose unsupported effort labels for the requested model', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'pro',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            effortTexts: labelsOnlyProEffortTexts(),
            genericEffortTexts: labelsOnlyThinkingEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'pro', { effort: 'extended' });

        expect(result).toMatchObject({ selected: 'pro', effort: 'extended' });
        expect(result.usedFallbacks).toContain('pro-effort-keyboard-open');
        expect(result.usedFallbacks).not.toContain('pro-effort-generic-trigger');
    });

    it('does not trust overlapping labels-only menus from broad generic effort triggers', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'pro',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            effortTexts: labelsOnlyProEffortTexts(),
            genericEffortTexts: labelsOnlyProEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'pro', { effort: 'standard' });

        expect(result).toMatchObject({ selected: 'pro', effort: 'standard' });
        expect(result.usedFallbacks).toContain('pro-effort-keyboard-open');
        expect(result.usedFallbacks).not.toContain('pro-effort-generic-trigger');
    });

    it('does not reuse a rejected labels-only generic menu as a later row-bound success', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'pro',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            effortTexts: labelsOnlyProEffortTexts(),
            genericEffortTexts: labelsOnlyProEffortTexts(),
            keyboardOpensEffort: false,
        });

        await expect(selectChatGptModel(page, 'pro', { effort: 'standard' })).rejects.toThrow(/reasoning effort selector not found/);
    });

    it('opens visible-text-only effort controls without data-testid or aria-label hooks', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            genericTriggerMode: 'text',
            effortTexts: thinkingEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'thinking', { effort: 'extended' });

        expect(result).toMatchObject({ selected: 'thinking', effort: 'extended' });
        expect(result.usedFallbacks).toContain('thinking-effort-text-trigger');
    });

    it('verifies selected effort from the active model pill when checked effort rows disappear', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: thinkingEffortTexts(),
            checkedEffortRows: false,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'heavy' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'heavy',
        });
    });

    it('verifies selected effort from a role-button composer pill', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: thinkingEffortTexts(),
            checkedEffortRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'standard' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'standard',
        });
    });

    it('wires ChatGPT effort options through the CLI surface', () => {
        const cliSrc = readFileSync(join(process.cwd(), 'web-ai', 'cli.mjs'), 'utf8');
        const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');

        expect(cliSrc).toContain("effort: { type: 'string' }");
        expect(cliSrc).toContain("'reasoning-effort': { type: 'string' }");
        expect(cliSrc).toContain('reasoningEffort: values.effort');
        expect(chatgptSrc).toContain("selectChatGptModel(page, input.model, { effort: input.reasoningEffort })");
    });
});

function thinkingEffortTexts() {
    return {
        light: 'GPT-5.5 Thinking Light',
        standard: 'GPT-5.5 Thinking Standard',
        extended: 'GPT-5.5 Thinking Extended',
        heavy: 'GPT-5.5 Thinking Heavy',
    };
}

function proEffortTexts() {
    return {
        standard: 'GPT-5.5 Pro Standard',
        extended: 'GPT-5.5 Pro Extended',
    };
}

function labelsOnlyThinkingEffortTexts() {
    return {
        light: 'Light',
        standard: 'Standard',
        extended: 'Extended',
        heavy: 'Heavy',
    };
}

function labelsOnlyProEffortTexts() {
    return {
        standard: 'Standard',
        extended: 'Extended',
    };
}

function createFakeModelPage({
    model = 'thinking',
    effortTexts = {},
    genericEffortTexts = null,
    checkedEffortRows = true,
    roleButtonPill = false,
    keyboardOpensEffort = true,
    exactEffortTrigger = false,
    genericEffortTrigger = true,
    genericTriggerMode = 'css',
} = {}) {
    const state = {
        modelMenuOpen: true,
        effortMenuOpen: false,
        currentModel: model,
        selectedEffort: null,
        effortMenuSource: null,
        exactEffortTrigger,
        genericEffortTrigger,
    };
    const modelRows = [
        createElement({
            text: 'GPT-5.3 Instant',
            testId: 'model-switcher-gpt-5-3',
            get checked() { return state.currentModel === 'instant'; },
            onClick: () => { state.currentModel = 'instant'; },
        }),
        createElement({
            text: 'GPT-5.5 Thinking',
            testId: 'model-switcher-gpt-5-5-thinking',
            get checked() { return state.currentModel === 'thinking'; },
            onClick: () => { state.currentModel = 'thinking'; },
        }),
        createElement({
            text: 'GPT-5.5 Pro',
            testId: 'model-switcher-gpt-5-5-pro',
            get checked() { return state.currentModel === 'pro'; },
            onClick: () => { state.currentModel = 'pro'; },
        }),
    ];
    const exactTrigger = createElement({
        text: 'Effort',
        testId: `model-switcher-gpt-5-5-${model}-thinking-effort`,
        onClick: () => openEffortRows('target'),
    });
    const genericTrigger = createElement({
        text: 'Reasoning effort',
        onClick: () => openEffortRows('generic'),
    });
    const modelPill = createElement({
        text: () => state.selectedEffort
            ? `${effortTexts[state.selectedEffort] || currentEffortTexts()[state.selectedEffort] || state.currentModel}`
            : state.currentModel,
        onClick: () => { state.modelMenuOpen = true; },
    });

    return {
        keyboard: {
            press: async key => {
                if (key === 'Escape') {
                    if (state.effortMenuOpen) {
                        state.effortMenuOpen = false;
                        state.effortMenuSource = null;
                    } else {
                        state.modelMenuOpen = false;
                    }
                }
                if (key === 'ArrowRight' && keyboardOpensEffort) openEffortRows('target');
            },
        },
        mouse: {
            move: async () => undefined,
            click: async () => openEffortRows('target'),
        },
        waitForTimeout: async () => undefined,
        evaluate: async () => null,
        locator: selector => makeLocator(selectElements(selector), selector),
    };

    function openEffortRows(source) {
        state.effortMenuOpen = true;
        state.effortMenuSource = source;
    }

    function currentEffortTexts() {
        if (state.effortMenuSource === 'generic' && genericEffortTexts) return genericEffortTexts;
        return effortTexts;
    }

    function currentEffortRows() {
        return Object.entries(currentEffortTexts()).map(([effort, text]) => createElement({
            text,
            get checked() { return checkedEffortRows && state.selectedEffort === effort; },
            onClick: () => {
                state.selectedEffort = effort;
                state.effortMenuOpen = false;
                state.effortMenuSource = null;
            },
        }));
    }

    function selectElements(selector) {
        if (selector === 'button, [role="button"], [role="menuitem"]') return state.genericEffortTrigger && genericTriggerMode === 'text' ? [modelPill, genericTrigger] : [modelPill];
        if (selector.includes('__composer-pill')) return roleButtonPill ? [modelPill] : [];
        if (selector === 'button') return roleButtonPill ? [] : [modelPill];
        if (selector === '[role="menu"]') {
            return state.effortMenuOpen ? [createElement({ text: Object.values(currentEffortTexts()).join('\n') })] : [];
        }
        if (selector === '[data-testid^="model-switcher-"]') return state.modelMenuOpen ? modelRows : [];
        if (selector === '[role="menuitemradio"], [role="menuitem"]') return state.effortMenuOpen ? currentEffortRows() : modelRows;
        if (selector === '[role="menuitemradio"]') return state.effortMenuOpen ? currentEffortRows() : [];
        if (selector.includes('aria-checked="true"') || selector.includes('data-state="checked"')) {
            const checkedTestId = selector.match(/data-testid="([^"]+)"/)?.[1];
            return [...modelRows, ...currentEffortRows()]
                .filter(element => element.checked)
                .filter(element => !checkedTestId || element.testId === checkedTestId);
        }
        const testId = selector.match(/data-testid="([^"]+)"/)?.[1];
        if (testId) {
            if (testId.includes('thinking-effort')) return state.exactEffortTrigger ? [exactTrigger] : [];
            return modelRows.filter(element => element.testId === testId);
        }
        if (/Effort|Reasoning|effort/i.test(selector)) return state.genericEffortTrigger && genericTriggerMode === 'css' ? [genericTrigger] : [];
        return [];
    }
}

function createElement(input = {}) {
    return {
        get text() { return typeof input.text === 'function' ? input.text() : input.text || ''; },
        testId: input.testId || null,
        get checked() { return input.checked ?? false; },
        onClick: input.onClick || (() => undefined),
        visible: input.visible ?? true,
        rect: input.rect || { x: 10, y: 10, width: 120, height: 32 },
    };
}

function makeLocator(elements, selector = '') {
    const loc = {
        first: () => makeLocator(elements.slice(0, 1), selector),
        last: () => makeLocator(elements.slice(-1), selector),
        nth: index => makeLocator(elements.slice(index, index + 1), selector),
        filter: ({ hasText } = {}) => makeLocator(elements.filter(element => {
            if (!hasText) return true;
            if (hasText instanceof RegExp) return hasText.test(element.text);
            return element.text.includes(String(hasText));
        }), selector),
        count: async () => elements.length,
        all: async () => elements.map(element => makeLocator([element], selector)),
        isVisible: async () => Boolean(elements[0]?.visible),
        click: async () => elements[0]?.onClick(),
        hover: async () => undefined,
        focus: async () => undefined,
        boundingBox: async () => elements[0]?.rect || null,
        innerText: async () => elements[0]?.text || '',
        evaluateAll: async (fn, arg) => fn(elements.map(element => ({
            innerText: element.text,
            textContent: element.text,
        })), arg),
    };
    return loc;
}
