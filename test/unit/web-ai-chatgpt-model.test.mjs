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

    it('does not treat the closed model dropdown button as an open model menu', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialModelMenuOpen: false,
            closedDropdownButton: true,
            effortTexts: thinkingEffortTexts(),
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'standard' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'standard',
        });
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

    it('falls through when exact reasoning effort triggers are hidden for every supported effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'thinking', efforts: ['light', 'standard', 'extended', 'heavy'], effortTexts: thinkingEffortTexts() },
            { model: 'pro', efforts: ['standard', 'extended'], effortTexts: proEffortTexts() },
        ];

        for (const { model, efforts, effortTexts } of cases) {
            for (const effort of efforts) {
                const page = createFakeModelPage({
                    model,
                    exactEffortTrigger: true,
                    exactEffortTriggerVisible: false,
                    genericEffortTrigger: true,
                    effortTexts,
                });
                const result = await selectChatGptModel(page, model, { effort });

                expect(result).toMatchObject({ selected: model, effort });
                expect(result.usedFallbacks).toContain(`${model}-effort-generic-trigger`);
            }
        }
    });

    it('does not treat a closed hero effort pill as an open model menu', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'pro',
            initialModelMenuOpen: false,
            closedHeroEffortPill: true,
            checkedModelRows: false,
            effortTexts: proEffortTexts(),
        });

        await expect(selectChatGptModel(page, 'pro', { effort: 'standard' })).resolves.toMatchObject({
            selected: 'pro',
            effort: 'standard',
        });
    });

    it('does not treat a visible effort trigger as the model row when model row test ids disappear', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            exactEffortTrigger: true,
            exactEffortTriggerModel: 'pro',
            missingModelTestIds: ['model-switcher-gpt-5-5-pro'],
            effortTexts: thinkingEffortTexts(),
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
            alreadySelected: false,
        });
    });

    it('does not select a standalone Heavy exact effort trigger as the Pro model', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            exactEffortTrigger: true,
            exactEffortTriggerModel: 'pro',
            exactEffortTriggerText: 'Heavy',
            missingModelTestIds: ['model-switcher-gpt-5-5-pro'],
            effortTexts: thinkingEffortTexts(),
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
            alreadySelected: false,
        });
    });

    it('skips effort-only Pro labels when looking for a model row by text', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');

        for (const strayModelMenuText of ['Heavy', 'Standard Pro', 'Extended Pro']) {
            const page = createFakeModelPage({
                model: 'thinking',
                missingModelTestIds: ['model-switcher-gpt-5-5-pro'],
                strayModelMenuTexts: [strayModelMenuText],
                effortTexts: thinkingEffortTexts(),
            });

            await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
                selected: 'pro',
                alreadySelected: false,
            });
        }
    });

    it('selects menuitem-only effort options for every supported effort', async () => {
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
                    effortOptionRole: 'menuitem',
                    checkedEffortRows: false,
                    effortTexts,
                });
                const result = await selectChatGptModel(page, model, { effort });

                expect(result).toMatchObject({ selected: model, effort });
            }
        }
    });

    it('dismisses a wrong exact-trigger effort menu before trying generic effort controls', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'pro',
            exactEffortTrigger: true,
            genericEffortTrigger: true,
            effortTexts: thinkingEffortTexts(),
            genericEffortTexts: proEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'pro', { effort: 'extended' });

        expect(result).toMatchObject({ selected: 'pro', effort: 'extended' });
        expect(result.usedFallbacks).toContain('pro-effort-generic-trigger');
    });

    it('reopens the model menu after effort selection closes it for every supported effort', async () => {
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
                    closeModelMenuOnEffortSelect: true,
                    effortTexts,
                });
                const result = await selectChatGptModel(page, model, { effort });

                expect(result).toMatchObject({ selected: model, effort });
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

    it('accepts plan-base Thinking standard and extended menus without requiring Pro-only light or heavy labels', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        for (const effort of ['standard', 'extended']) {
            const page = createFakeModelPage({
                model: 'thinking',
                exactEffortTrigger: false,
                genericEffortTrigger: true,
                effortTexts: labelsOnlyProEffortTexts(),
                genericEffortTexts: labelsOnlyProEffortTexts(),
            });

            const result = await selectChatGptModel(page, 'thinking', { effort });

            expect(result).toMatchObject({ selected: 'thinking', effort });
            expect(result.usedFallbacks).toContain('thinking-effort-keyboard-open');
            expect(result.usedFallbacks).not.toContain('thinking-effort-generic-trigger');
        }

        for (const effort of ['light', 'heavy']) {
            const page = createFakeModelPage({
                model: 'thinking',
                exactEffortTrigger: false,
                genericEffortTrigger: true,
                effortTexts: labelsOnlyProEffortTexts(),
                genericEffortTexts: labelsOnlyProEffortTexts(),
            });

            await expect(selectChatGptModel(page, 'thinking', { effort })).rejects.toThrow(/reasoning effort selector not found/);
        }
    });

    it('probes plan-base Thinking standard and extended menus with the requested effort', async () => {
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        for (const effort of ['standard', 'extended']) {
            const page = createFakeModelPage({
                model: 'thinking',
                exactEffortTrigger: false,
                genericEffortTrigger: true,
                effortTexts: labelsOnlyProEffortTexts(),
                genericEffortTexts: labelsOnlyProEffortTexts(),
            });

            await expect(chatGptModelCapabilityProbe(page, 'thinking', { effort })).resolves.toMatchObject({
                state: 'ok',
                evidence: { requested: 'thinking', effort },
            });
        }
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

    it('ignores checked labels-only effort rows when verifying the selected model', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: labelsOnlyThinkingEffortTexts(),
            activePillTexts: { heavy: 'GPT-5.5 Thinking Heavy' },
            checkedModelRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'heavy' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'heavy',
        });
    });

    it('does not read a standalone Heavy effort pill as the Pro model on split-pill hero UI', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: thinkingEffortTexts(),
            activePillTexts: { heavy: 'Heavy' },
            splitModelPillText: 'GPT-5.5 Thinking',
            checkedModelRows: false,
            checkedEffortRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'heavy' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'heavy',
        });
    });

    it('does not treat Thinking Heavy split-pill state as already selected Pro', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialSelectedEffort: 'heavy',
            effortTexts: thinkingEffortTexts(),
            activePillTexts: { heavy: 'Heavy' },
            splitModelPillText: state => state.currentModel === 'pro' ? 'GPT-5.5 Pro' : 'GPT-5.5 Thinking',
            checkedModelRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
            alreadySelected: false,
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
    activePillTexts = null,
    genericEffortTexts = null,
    initialSelectedEffort = null,
    checkedEffortRows = true,
    checkedModelRows = true,
    roleButtonPill = false,
    keyboardOpensEffort = true,
    closeModelMenuOnEffortSelect = false,
    initialModelMenuOpen = true,
    closedDropdownButton = false,
    exactEffortTrigger = false,
    exactEffortTriggerVisible = true,
    genericEffortTrigger = true,
    genericTriggerMode = 'css',
    splitModelPillText = null,
    closedHeroEffortPill = false,
    missingModelTestIds = [],
    exactEffortTriggerModel = model,
    exactEffortTriggerText = 'Effort',
    strayModelMenuTexts = [],
    effortOptionRole = 'menuitemradio',
} = {}) {
    const missingModelTestIdSet = new Set(missingModelTestIds);
    const state = {
        modelMenuOpen: initialModelMenuOpen,
        effortMenuOpen: false,
        currentModel: model,
        selectedEffort: initialSelectedEffort,
        effortMenuSource: null,
        exactEffortTrigger,
        exactEffortTriggerVisible,
        genericEffortTrigger,
    };
    const modelRows = [
        createElement({
            text: 'GPT-5.3 Instant',
            testId: modelRowTestId('model-switcher-gpt-5-3'),
            get checked() { return checkedModelRows && state.currentModel === 'instant'; },
            onClick: () => setModel('instant'),
        }),
        createElement({
            text: 'GPT-5.5 Thinking',
            testId: modelRowTestId('model-switcher-gpt-5-5-thinking'),
            get checked() { return checkedModelRows && state.currentModel === 'thinking'; },
            onClick: () => setModel('thinking'),
        }),
        createElement({
            text: 'GPT-5.5 Pro',
            testId: modelRowTestId('model-switcher-gpt-5-5-pro'),
            get checked() { return checkedModelRows && state.currentModel === 'pro'; },
            onClick: () => setModel('pro'),
        }),
    ];
    const exactTrigger = createElement({
        text: exactEffortTriggerText,
        testId: `model-switcher-gpt-5-5-${exactEffortTriggerModel}-thinking-effort`,
        onClick: () => openEffortRows('target'),
        visible: state.exactEffortTriggerVisible,
    });
    const strayModelMenuItems = strayModelMenuTexts.map(text => createElement({
        text,
        onClick: () => openEffortRows('target'),
    }));
    const genericTrigger = createElement({
        text: 'Reasoning effort',
        onClick: () => openEffortRows('generic'),
    });
    const dropdownButton = createElement({
        text: 'ChatGPT',
        testId: 'model-switcher-dropdown-button',
        onClick: () => { state.modelMenuOpen = true; },
        visible: closedDropdownButton,
    });
    const modelPill = createElement({
        text: () => state.selectedEffort
            ? `${activePillTexts?.[state.selectedEffort] || effortTexts[state.selectedEffort] || currentEffortTexts()[state.selectedEffort] || state.currentModel}`
            : state.currentModel,
        onClick: () => { state.modelMenuOpen = true; },
    });
    const splitModelPill = createElement({
        text: () => typeof splitModelPillText === 'function' ? splitModelPillText(state) : splitModelPillText || state.currentModel,
        onClick: () => { state.modelMenuOpen = true; },
    });
    const closedHeroPill = createElement({
        text: 'Standard Pro',
        testId: 'model-switcher-gpt-5-5-pro-thinking-effort',
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
        evaluate: async (_fn, arg) => {
            if (arg === exactTrigger.testId && state.exactEffortTrigger) return exactTrigger.rect;
            return null;
        },
        locator: selector => makeLocator(selectElements(selector), selector),
    };

    function openEffortRows(source) {
        state.effortMenuOpen = true;
        state.effortMenuSource = source;
    }

    function modelRowTestId(testId) {
        return missingModelTestIdSet.has(testId) ? null : testId;
    }

    function setModel(nextModel) {
        if (state.currentModel !== nextModel) state.selectedEffort = null;
        state.currentModel = nextModel;
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
                if (closeModelMenuOnEffortSelect) state.modelMenuOpen = false;
            },
        }));
    }

    function composerPills() {
        return splitModelPillText ? [splitModelPill, modelPill] : [modelPill];
    }

    function selectElements(selector) {
        if (selector === 'button, [role="button"], [role="menuitem"]') return state.modelMenuOpen && !state.effortMenuOpen && state.genericEffortTrigger && genericTriggerMode === 'text' ? [...composerPills(), genericTrigger] : composerPills();
        if (selector.includes('__composer-pill')) return roleButtonPill ? composerPills() : [];
        if (selector === 'button') return roleButtonPill ? [] : [dropdownButton, ...composerPills(), closedHeroPill].filter(element => element.visible && (element !== closedHeroPill || closedHeroEffortPill));
        if (selector === '[role="menu"]') {
            return state.effortMenuOpen ? [createElement({ text: Object.values(currentEffortTexts()).join('\n') })] : [];
        }
        if (selector === '[data-testid^="model-switcher-"]') return state.modelMenuOpen ? modelRows.filter(element => element.testId) : (closedHeroEffortPill ? [closedHeroPill] : []);
        if (selector === '[data-testid^="model-switcher-gpt-"]') return state.modelMenuOpen ? modelRows.filter(element => element.testId) : (closedHeroEffortPill ? [closedHeroPill] : []);
        if (selector === '[role="menuitemradio"], [role="menuitem"]') return state.effortMenuOpen ? currentEffortRows() : [...strayModelMenuItems, ...modelRows];
        if (selector === '[role="menuitemradio"]') return state.effortMenuOpen && effortOptionRole === 'menuitemradio' ? currentEffortRows() : [];
        if (selector === '[role="menuitem"]') return state.effortMenuOpen && effortOptionRole === 'menuitem' ? currentEffortRows() : [];
        if (selector.includes('aria-checked="true"') || selector.includes('data-state="checked"')) {
            const checkedTestId = selector.match(/data-testid="([^"]+)"/)?.[1];
            return [...modelRows, ...currentEffortRows()]
                .filter(element => element.checked)
                .filter(element => !checkedTestId || element.testId === checkedTestId);
        }
        const testId = selector.match(/data-testid="([^"]+)"/)?.[1];
        if (testId) {
            if (testId === 'model-switcher-dropdown-button') return closedDropdownButton ? [dropdownButton] : [];
            if (testId.includes('thinking-effort')) return state.modelMenuOpen && state.exactEffortTrigger && testId === exactTrigger.testId ? [exactTrigger] : [];
            return state.modelMenuOpen ? modelRows.filter(element => element.testId === testId) : [];
        }
        if (/Effort|Reasoning|effort/i.test(selector)) return state.modelMenuOpen && !state.effortMenuOpen && state.genericEffortTrigger && genericTriggerMode === 'css' ? [genericTrigger] : [];
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
        click: async () => {
            if (elements[0]?.visible === false) throw new Error('element not visible');
            return elements[0]?.onClick();
        },
        hover: async () => undefined,
        focus: async () => undefined,
        boundingBox: async () => elements[0]?.rect || null,
        innerText: async () => elements[0]?.text || '',
        evaluateAll: async (fn, arg) => fn(elements.map(element => ({
            innerText: element.text,
            textContent: element.text,
            getAttribute: name => name === 'data-testid' ? element.testId : null,
        })), arg),
    };
    return loc;
}
