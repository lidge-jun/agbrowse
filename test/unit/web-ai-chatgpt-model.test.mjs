import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const modelSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-model.mjs'), 'utf8');

describe('web-ai ChatGPT model selector policy', () => {
    it('supports the current GPT-5.6 contract tables', () => {
        // Legacy testids preserved as fallback
        expect(modelSrc).toContain("'model-switcher-gpt-5-5-pro-thinking-effort'");
        expect(modelSrc).toContain("'model-switcher-gpt-5-5-thinking-thinking-effort'");
        // Current tier labels
        expect(modelSrc).toContain("'Medium'");
        expect(modelSrc).toContain("'High'");
        expect(modelSrc).toContain("'Extra High'");
        expect(modelSrc).toContain("'Pro'");
        // Legacy labels preserved
        expect(modelSrc).toContain('Heavy');
        expect(modelSrc).toContain('Pro Extended');
        expect(modelSrc).toContain("'즉시'");
        expect(modelSrc).toContain("'중간'");
        expect(modelSrc).toContain("'높음'");
        expect(modelSrc).toContain("'매우 높음'");
        expect(modelSrc).toContain("'Pro 확장'");
        // Composer-scoped menu root
        expect(modelSrc).toContain('chatGptComposerMenuRoot');
        expect(modelSrc).toContain('chatGptLegacyMenuRootOpenedByComposer');
    });

    it('does not touch the model selector without explicit model or effort flags', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = new Proxy({}, {
            get() {
                throw new Error('page should not be touched without model requests');
            },
        });

        await expect(selectChatGptModel(page, undefined, {})).resolves.toBeNull();
    });

    it('normalizes observed ChatGPT effort aliases', async () => {
        const {
            CHATGPT_MODEL_EFFORT_OPTIONS,
            isChatGptEffortSupported,
            normalizeChatGptEffortChoice,
        } = await import('../../web-ai/chatgpt-model.mjs');

        expect(Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.pro.efforts)).toEqual([]);
        expect(Object.keys(CHATGPT_MODEL_EFFORT_OPTIONS.thinking.efforts)).toEqual(['medium', 'high', 'xhigh']);
        // Legacy aliases map to canonical keys
        expect(normalizeChatGptEffortChoice('standard')).toBe('medium');
        expect(normalizeChatGptEffortChoice('regular')).toBe('medium');
        expect(normalizeChatGptEffortChoice('light')).toBe('medium');
        expect(normalizeChatGptEffortChoice('low')).toBe('medium');
        expect(normalizeChatGptEffortChoice('extended')).toBe('high');
        expect(normalizeChatGptEffortChoice('high')).toBe('high');
        expect(normalizeChatGptEffortChoice('heavy')).toBe('xhigh');
        expect(normalizeChatGptEffortChoice('xhigh')).toBe('xhigh');
        expect(normalizeChatGptEffortChoice('medium')).toBe('medium');
        // Pro supports legacy unenforced efforts but not canonical thinking efforts
        expect(isChatGptEffortSupported('pro', 'standard')).toBe(true);
        expect(isChatGptEffortSupported('pro', 'extended')).toBe(true);
        expect(isChatGptEffortSupported('pro', 'heavy')).toBe(false);
        expect(isChatGptEffortSupported('pro', 'medium')).toBe(false);
        // Thinking supports canonical efforts
        expect(isChatGptEffortSupported('thinking', 'medium')).toBe(true);
        expect(isChatGptEffortSupported('thinking', 'high')).toBe(true);
        expect(isChatGptEffortSupported('thinking', 'xhigh')).toBe(true);
    });

    it('selects the GPT-5.6 Intelligence flat radio labels', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'instant', effort: null, selected: 'instant', selectedEffort: null },
            { model: 'thinking', effort: 'medium', selected: 'thinking', selectedEffort: 'medium' },
            { model: 'thinking', effort: 'high', selected: 'thinking', selectedEffort: 'high' },
            { model: 'thinking', effort: 'xhigh', selected: 'thinking', selectedEffort: 'xhigh' },
            { model: 'pro', effort: null, selected: 'pro', selectedEffort: null },
        ];

        for (const testCase of cases) {
            const page = createFakeModelPage({
                model: 'instant',
                initialModelMenuOpen: false,
                closedDropdownButton: true,
                simplifiedIntelligenceMenu: true,
                checkedModelRows: false,
                checkedEffortRows: false,
            });
            const result = await selectChatGptModel(
                page,
                testCase.model,
                testCase.effort ? { effort: testCase.effort } : {},
            );

            expect(result).toMatchObject({
                selected: testCase.selected,
                effort: testCase.selectedEffort,
            });
            if (testCase.effort && testCase.selected === 'thinking') {
                expect(result.usedFallbacks).toContain(`${testCase.selected}-effort-simplified-direct`);
            }
        }
    });

    it('routes legacy Pro effort requests to flat Pro with unenforced warning', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');

        for (const effort of ['standard', 'extended', 'normal', 'regular', 'default']) {
            const page = createFakeModelPage({
                model: 'instant',
                initialModelMenuOpen: false,
                closedDropdownButton: true,
                simplifiedIntelligenceMenu: true,
                checkedModelRows: false,
                checkedEffortRows: false,
            });
            const result = await selectChatGptModel(page, 'pro', { effort });

            expect(result).toMatchObject({
                selected: 'pro',
                effort: null,
            });
            expect(result.warnings.some(w => w.includes('reasoning-effort-unenforced'))).toBe(true);
        }
    });

    it('selects every supported canonical thinking effort through the flat radio UI', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');

        for (const effort of ['medium', 'high', 'xhigh']) {
            const page = createFakeModelPage({
                model: 'instant',
                initialModelMenuOpen: false,
                closedDropdownButton: true,
                simplifiedIntelligenceMenu: true,
                checkedModelRows: false,
                checkedEffortRows: false,
            });
            await expect(selectChatGptModel(page, 'thinking', { effort })).resolves.toMatchObject({
                selected: 'thinking',
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
            effortTexts: canonicalThinkingEffortTexts(),
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'medium' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'medium',
        });
    });

    it('opens the reasoning menu through generic effort controls for every supported effort when exact test ids are absent', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'thinking', efforts: ['medium', 'high', 'xhigh'], effortTexts: canonicalThinkingEffortTexts() },
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
            }
        }
    });

    it('falls through when exact reasoning effort triggers are hidden for every supported effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'thinking', efforts: ['medium', 'high', 'xhigh'], effortTexts: canonicalThinkingEffortTexts() },
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
            effortTexts: {},
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
        });
    });

    it('does not treat a visible effort trigger as the model row when model row test ids disappear', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            exactEffortTrigger: true,
            exactEffortTriggerModel: 'pro',
            missingModelTestIds: ['model-switcher-gpt-5-5-pro'],
            effortTexts: canonicalThinkingEffortTexts(),
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
            effortTexts: canonicalThinkingEffortTexts(),
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
                effortTexts: canonicalThinkingEffortTexts(),
            });

            await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
                selected: 'pro',
                alreadySelected: false,
            });
        }
    });

    it('skips legacy explicit Pro model rows when selecting current Pro by text', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            missingModelTestIds: ['model-switcher-gpt-5-5-pro'],
            strayModelMenuTexts: ['GPT-5.4 Pro'],
            effortTexts: canonicalThinkingEffortTexts(),
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
            alreadySelected: false,
            modelSelection: {
                requestedModel: 'pro',
                resolvedLabel: 'GPT-5.5 Pro',
                normalizedModel: 'pro',
                status: 'switched',
                verified: true,
                source: 'chatgpt-model-picker',
            },
        });
    });

    it('records model selection evidence when the requested model is already selected', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'pro',
            effortTexts: {},
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
            alreadySelected: true,
            modelSelection: {
                requestedModel: 'pro',
                resolvedLabel: 'GPT-5.5 Pro',
                normalizedModel: 'pro',
                strategy: 'select',
                status: 'already-selected',
                verified: true,
            },
        });
    });

    it('selects menuitem-only effort options for every supported effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'thinking', efforts: ['medium', 'high', 'xhigh'], effortTexts: canonicalThinkingEffortTexts() },
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
            effortTexts: canonicalThinkingEffortTexts(),
            genericEffortTexts: {},
        });

        const result = await selectChatGptModel(page, 'pro');

        expect(result).toMatchObject({ selected: 'pro' });
    });

    it('reopens the model menu after effort selection closes it for every supported effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const cases = [
            { model: 'thinking', efforts: ['medium', 'high', 'xhigh'], effortTexts: canonicalThinkingEffortTexts() },
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
                efforts: ['medium', 'high', 'xhigh'],
                effortTexts: canonicalThinkingEffortTexts(),
                genericEffortTexts: {},
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
            model: 'thinking',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            effortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
            genericEffortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'thinking', { effort: 'high' });

        expect(result).toMatchObject({ selected: 'thinking', effort: 'high' });
    });

    it('accepts plan-base Thinking menus for canonical efforts', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        for (const effort of ['medium', 'high', 'xhigh']) {
            const page = createFakeModelPage({
                model: 'thinking',
                exactEffortTrigger: false,
                genericEffortTrigger: true,
                effortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
                genericEffortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
            });

            const result = await selectChatGptModel(page, 'thinking', { effort });

            expect(result).toMatchObject({ selected: 'thinking', effort });
        }
    });

    it('probes plan-base Thinking menus with the requested canonical effort', async () => {
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        for (const effort of ['medium', 'high', 'xhigh']) {
            const page = createFakeModelPage({
                model: 'thinking',
                exactEffortTrigger: false,
                genericEffortTrigger: true,
                effortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
                genericEffortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
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
            model: 'thinking',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            effortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
            genericEffortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'thinking', { effort: 'medium' });

        expect(result).toMatchObject({ selected: 'thinking', effort: 'medium' });
    });

    it('does not reuse a rejected labels-only generic menu as a later row-bound success', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            effortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
            genericEffortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
            keyboardOpensEffort: false,
        });

        const result = await selectChatGptModel(page, 'thinking', { effort: 'medium' });

        expect(result).toMatchObject({
            selected: 'thinking',
            effort: null,
            requestedEffort: 'medium',
            warnings: [expect.stringContaining('reasoning effort medium was not enforced')],
        });
        expect(result.usedFallbacks).toContain('reasoning-effort-unavailable-current-effort');
    });

    it('opens visible-text-only effort controls without data-testid or aria-label hooks', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            exactEffortTrigger: false,
            genericEffortTrigger: true,
            genericTriggerMode: 'text',
            effortTexts: canonicalThinkingEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'thinking', { effort: 'high' });

        expect(result).toMatchObject({ selected: 'thinking', effort: 'high' });
    });

    it('verifies selected effort from the active model pill when checked effort rows disappear', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: canonicalThinkingEffortTexts(),
            checkedEffortRows: false,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'xhigh' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'xhigh',
        });
    });

    it('verifies selected effort from a role-button composer pill', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: canonicalThinkingEffortTexts(),
            checkedEffortRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'medium' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'medium',
        });
    });

    it('ignores checked labels-only effort rows when verifying the selected model', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            effortTexts: canonicalLabelsOnlyThinkingEffortTexts(),
            activePillTexts: { xhigh: 'Extra High' },
            checkedModelRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'xhigh' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'xhigh',
        });
    });

    it('does not read a standalone Heavy effort pill as the Pro model on split-pill hero UI', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialModelMenuOpen: false,
            closedDropdownButton: true,
            simplifiedIntelligenceMenu: true,
            checkedModelRows: false,
            checkedEffortRows: false,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'xhigh' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'xhigh',
        });
    });

    it('reads the Extra High composer pill as Thinking xhigh', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialModelMenuOpen: false,
            initialSelectedEffort: 'xhigh',
            activePillTexts: { xhigh: 'Extra High' },
            checkedModelRows: false,
            checkedEffortRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, 'thinking', { effort: 'xhigh' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'xhigh',
            warnings: [],
        });
    });

    it('does not treat Thinking as already selected Pro when switching from thinking to pro', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialModelMenuOpen: false,
            closedDropdownButton: true,
            simplifiedIntelligenceMenu: true,
            checkedModelRows: false,
            checkedEffortRows: false,
        });

        await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
            selected: 'pro',
            alreadySelected: false,
        });
    });

    it('falls back to the current ChatGPT model when the model picker disappears and no effort is requested', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                initialModelMenuOpen: false,
                modelPickerUnavailable: true,
                advanceClock: clock.advance,
            });

            const result = await selectChatGptModel(page, 'thinking');

        expect(result).toMatchObject({
            requested: 'thinking',
            selected: null,
            alreadySelected: true,
            warnings: [expect.stringContaining('requested thinking was not enforced')],
        });
        expect(result.usedFallbacks).toContain('model-selector-unavailable-current-model');
        } finally {
            clock.restore();
        }
    });

    it('keeps sending when the model picker disappears with reasoning effort and reports the unenforced canonical effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                initialModelMenuOpen: false,
                modelPickerUnavailable: true,
                advanceClock: clock.advance,
            });

            const result = await selectChatGptModel(page, 'thinking', { effort: 'medium' });

            expect(result).toMatchObject({
                requested: 'thinking',
                selected: null,
                effort: null,
                requestedEffort: 'medium',
                warnings: [expect.stringContaining('requested effort medium was not enforced')],
            });
            expect(result.usedFallbacks).toContain('model-selector-unavailable-current-model');
        } finally {
            clock.restore();
        }
    });

    it('opens the current hero effort pill before selecting a requested effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialModelMenuOpen: false,
            initialSelectedEffort: 'high',
            activePillTexts: { high: 'High' },
            effortTexts: canonicalThinkingEffortTexts(),
        });

        const result = await selectChatGptModel(page, 'thinking', { effort: 'medium' });

        expect(result).toMatchObject({
            selected: 'thinking',
            effort: 'medium',
            requestedEffort: 'medium',
        });
        expect(result.usedFallbacks).toContain('composer-model-pill');
    });

    it('wires ChatGPT family and effort options through the CLI surface', () => {
        const cliSrc = readFileSync(join(process.cwd(), 'web-ai', 'cli.mjs'), 'utf8');
        const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');

        expect(cliSrc).toContain("effort: { type: 'string' }");
        expect(cliSrc).toContain("'reasoning-effort': { type: 'string' }");
        expect(cliSrc).toContain('reasoningEffort: values.effort');
        // #87: family must be declared by the parser, carried into the input, and
        // handed to model selection alongside effort.
        expect(cliSrc).toContain("family: { type: 'string' }");
        expect(cliSrc).toContain('family: values.family');
        expect(chatgptSrc).toMatch(/selectChatGptModel\(page, input\.model, \{[\s\S]*?family: input\.family,[\s\S]*?effort: input\.reasoningEffort,[\s\S]*?\}\)/);
        expect(chatgptSrc).toContain('updateSession(session.sessionId, { modelSelection: selectedModel.modelSelection });');
        expect(chatgptSrc).toContain('...(selectedModel?.warnings || [])');
    });
});

// Legacy effort text helpers — used by tests that exercise old-key normalization
// and the legacy effort trigger/submenu paths.
function thinkingEffortTexts() {
    return {
        medium: 'GPT-5.5 Thinking Medium',
        high: 'GPT-5.5 Thinking High',
        xhigh: 'GPT-5.5 Thinking Extra High',
    };
}

// Canonical effort helpers for the GPT-5.6 contract.
function canonicalThinkingEffortTexts() {
    return {
        medium: 'Medium',
        high: 'High',
        xhigh: 'Extra High',
    };
}

function canonicalLabelsOnlyThinkingEffortTexts() {
    return {
        medium: 'Medium',
        high: 'High',
        xhigh: 'Extra High',
    };
}

function useAdvancingClock() {
    let now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    return {
        advance: ms => { now += Number(ms) || 0; },
        restore: () => spy.mockRestore(),
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
    modelPickerUnavailable = false,
    simplifiedIntelligenceMenu = false,
    advanceClock = null,
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
    const legacyModelRows = [
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
    const simplifiedRows = [
        createElement({
            text: 'Instant',
            get checked() { return state.currentModel === 'instant'; },
            onClick: () => setSimplifiedSelection('instant', null),
        }),
        createElement({
            text: 'Medium',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'medium'; },
            onClick: () => setSimplifiedSelection('thinking', 'medium'),
        }),
        createElement({
            text: 'High',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'high'; },
            onClick: () => setSimplifiedSelection('thinking', 'high'),
        }),
        createElement({
            text: 'Extra High',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'xhigh'; },
            onClick: () => setSimplifiedSelection('thinking', 'xhigh'),
        }),
        createElement({
            text: 'Pro',
            get checked() { return state.currentModel === 'pro'; },
            onClick: () => setSimplifiedSelection('pro', null),
        }),
    ];
    const modelRows = simplifiedIntelligenceMenu ? simplifiedRows : legacyModelRows;
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
        waitForTimeout: async ms => { if (advanceClock) advanceClock(ms); },
        evaluate: async (_fn, arg) => {
            if (arg === exactTrigger.testId && state.exactEffortTrigger) return exactTrigger.rect;
            return null;
        },
        locator: selector => {
            const loc = makeLocator(selectElements(selector), selector);
            loc._page = { locator: s => { const l = makeLocator(selectElements(s), s); l._page = loc._page; return l; } };
            return loc;
        },
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

    function setSimplifiedSelection(nextModel, nextEffort) {
        state.currentModel = nextModel;
        state.selectedEffort = nextEffort;
        state.modelMenuOpen = false;
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
        if (modelPickerUnavailable) return [];
        if (selector === 'button, [role="button"], [role="menuitem"]') return state.modelMenuOpen && !state.effortMenuOpen && state.genericEffortTrigger && genericTriggerMode === 'text' ? [...composerPills(), genericTrigger] : composerPills();
        if (selector.includes('__composer-pill') && !selector.includes('aria-haspopup')) return roleButtonPill ? composerPills() : [];
        if (selector === 'button[aria-haspopup="menu"]') return composerPills();
        if (selector === 'button') return roleButtonPill ? [] : [dropdownButton, ...composerPills(), closedHeroPill].filter(element => element.visible && (element !== closedHeroPill || closedHeroEffortPill));
        // Composer-scoped Intelligence picker content root
        if (selector.includes('composer-intelligence-picker-content')) {
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) {
                return [createElement({ text: simplifiedRows.map(row => row.text).join('\n'), visible: true })];
            }
            return [];
        }
        if (selector === '[role="menu"]') {
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) return [createElement({ text: `Intelligence\n${simplifiedRows.map(row => row.text).join('\n')}\nGPT-5.5`, visible: true })];
            if (state.effortMenuOpen) return [createElement({ text: Object.values(currentEffortTexts()).join('\n') })];
            if (!simplifiedIntelligenceMenu && state.modelMenuOpen) {
                // Legacy open menu with testid model rows
                return [createElement({ text: modelRows.map(r => r.text).join('\n'), visible: true })];
            }
            return [];
        }
        if (selector === '[data-testid^="model-switcher-"]') return state.modelMenuOpen ? modelRows.filter(element => element.testId) : (closedHeroEffortPill ? [closedHeroPill] : []);
        if (selector === '[data-testid^="model-switcher-gpt-"]') return state.modelMenuOpen ? modelRows.filter(element => element.testId) : (closedHeroEffortPill ? [closedHeroPill] : []);
        if (selector === '[role="menuitemradio"], [role="menuitem"]') {
            if (state.effortMenuOpen) return currentEffortRows();
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) return [...strayModelMenuItems, ...simplifiedRows];
            return [...strayModelMenuItems, ...modelRows];
        }
        if (selector === '[role="menuitemradio"]') {
            if (state.effortMenuOpen && effortOptionRole === 'menuitemradio') return currentEffortRows();
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) return simplifiedRows;
            return [];
        }
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
        first: () => { const c = makeLocator(elements.slice(0, 1), selector); c._page = loc._page; return c; },
        last: () => { const c = makeLocator(elements.slice(-1), selector); c._page = loc._page; return c; },
        nth: index => { const c = makeLocator(elements.slice(index, index + 1), selector); c._page = loc._page; return c; },
        filter: ({ hasText } = {}) => { const c = makeLocator(elements.filter(element => {
            if (!hasText) return true;
            if (hasText instanceof RegExp) return hasText.test(element.text);
            return element.text.includes(String(hasText));
        }), selector); c._page = loc._page; return c; },
        count: async () => elements.length,
        all: async () => elements.map(element => {
            const child = makeLocator([element], selector);
            child._page = loc._page;
            return child;
        }),
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
        // Scoped locator: delegate to the page's selectElements for sub-queries.
        // This allows composer-scoped menu root patterns to work.
        locator: childSelector => {
            if (loc._page) return loc._page.locator(childSelector);
            return makeLocator([], childSelector);
        },
    };
    return loc;
}

describe('selectChatGptModel hardening (32.2 source contract)', () => {
    const src = readFileSync(join(process.cwd(), 'web-ai/chatgpt-model.mjs'), 'utf8');

    it('waits for the model pill to mount before reading it (Oracle #271 parity)', () => {
        expect(src).toContain('async function waitForModelPillEvidence(');
        expect(src).toContain('let currentEvidence = await waitForModelPillEvidence(page, requested || null)');
        expect(src).toContain('MODEL_PILL_SETTLE_MS = 8_000');
    });

    it('bounds model-option selection with retries and surfaces an unverified warning', () => {
        expect(src).toContain('MODEL_SELECT_MAX_ATTEMPTS = 3');
        expect(src).toMatch(/while \(currentModel !== requested && attempt < MODEL_SELECT_MAX_ATTEMPTS\)/);
        expect(src).toContain("warnings.push('model-selection-unverified')");
    });
});
