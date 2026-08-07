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

    it('selects Pro through the current Chat Power effort submenu', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                model: 'thinking',
                family: 'gpt-5.6-sol',
                initialSelectedEffort: 'xhigh',
                powerPickerShell: true,
                genericEffortTrigger: false,
                genericTriggerMode: 'disabled',
                advanceClock: clock.advance,
            });

            await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
                selected: 'pro',
                effort: null,
            });
            expect(page.__state.shellEffortTriggerClicks).toBeGreaterThan(0);
            expect(page.__state.genericEffortTriggerClicks).toBe(0);
        } finally {
            clock.restore();
        }
    });

    it('selects o3 through the current Chat Power model submenu', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                model: 'thinking',
                family: 'gpt-5.6-sol',
                initialSelectedEffort: 'xhigh',
                powerPickerShell: true,
                genericEffortTrigger: false,
                genericTriggerMode: 'disabled',
                advanceClock: clock.advance,
            });

            await expect(selectChatGptModel(page, undefined, { family: 'o3' })).resolves.toMatchObject({
                family: 'o3',
            });
            expect(page.__state.shellModelTriggerClicks).toBeGreaterThan(0);
            expect(page.__state.currentFamily).toBe('o3');
        } finally {
            clock.restore();
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

    it.each(['thinking', 'instant'])('preserves the current %s tier when selecting the Sol family', async model => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model,
            family: 'gpt-5.5',
            initialSelectedEffort: model === 'thinking' ? 'medium' : null,
            simplifiedIntelligenceMenu: true,
            checkedModelRows: false,
            checkedEffortRows: false,
        });

        await expect(selectChatGptModel(page, undefined, { family: 'gpt-5.6-sol' })).resolves.toMatchObject({
            selected: model,
            modelSelection: { familyLabel: 'GPT-5.6 Sol', verified: true },
        });
    });

    it.each(['Pro', 'Standard Pro', 'Extended Pro'])('vetoes Sol when the final composer pill is %s', async composerProPillLabel => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            family: 'gpt-5.5',
            composerProPillLabel,
            simplifiedIntelligenceMenu: true,
            checkedModelRows: false,
            checkedEffortRows: false,
            roleButtonPill: true,
        });

        await expect(selectChatGptModel(page, undefined, { family: 'gpt-5.6-sol' })).rejects.toMatchObject({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            evidence: { activeComposerLabel: composerProPillLabel },
        });
    });

    it('applies effort-only to the currently checked thinking tier', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({
            model: 'thinking',
            initialSelectedEffort: 'medium',
            effortTexts: canonicalThinkingEffortTexts(),
        });

        await expect(selectChatGptModel(page, undefined, { effort: 'high' })).resolves.toMatchObject({
            selected: 'thinking',
            effort: 'high',
        });
    });

    it('rejects effort-only when the current tier is Pro', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({ model: 'pro', simplifiedIntelligenceMenu: true });

        await expect(selectChatGptModel(page, undefined, { effort: 'extended' })).rejects.toMatchObject({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            evidence: { model: 'pro', effort: 'high' },
        });
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

    it('wires ChatGPT effort options through the CLI surface', () => {
        const cliSrc = readFileSync(join(process.cwd(), 'web-ai', 'cli.mjs'), 'utf8');
        const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');

        expect(cliSrc).toContain("effort: { type: 'string' }");
        expect(cliSrc).toContain("'reasoning-effort': { type: 'string' }");
        expect(cliSrc).toContain('reasoningEffort: values.effort');
        expect(cliSrc).toContain("family: { type: 'string' }");
        expect(cliSrc).toContain('family: values.family');
        expect(chatgptSrc).toContain('family: input.family');
        expect(chatgptSrc).toContain('updateSession(session.sessionId, { modelSelection: selectedModel.modelSelection });');
        expect(chatgptSrc).toContain('...(selectedModel?.warnings || [])');
    });
});


// #87: `--family` reached the selector but never the capability probe, so a
// probe `ok` was mistaken for proof that the requested family was enforced.
describe('capability probe family contract (#87)', () => {
    it.each(['gpt-5.4', 'gpt-5.3'])('rejects retired Chat family %s before touching the menu', async family => {
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({ powerPickerShell: true, advanceClock: clock.advance });
            let touched = 0;
            const watched = new Proxy(page, {
                get(target, prop, receiver) {
                    if (prop === 'locator' || prop === 'keyboard') touched += 1;
                    const value = Reflect.get(target, prop, receiver);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });

            await expect(chatGptModelCapabilityProbe(watched, 'thinking', { family }))
                .resolves.toMatchObject({ state: 'fail', evidence: { family } });
            expect(touched).toBe(0);
        } finally {
            clock.restore();
        }
    });

    it('fails an unsupported family before touching the menu', async () => {
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({ simplifiedIntelligenceMenu: true });
        let touched = 0;
        const watched = new Proxy(page, {
            get(target, prop, receiver) {
                if (prop === 'locator' || prop === 'keyboard') touched += 1;
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        await expect(chatGptModelCapabilityProbe(watched, 'thinking', { family: 'gpt-5.6-luna' }))
            .resolves.toMatchObject({ state: 'fail', evidence: { family: 'gpt-5.6-luna' } });
        expect(touched).toBe(0);
    });

    it('fails an explicit unsupported model even when the family is valid', async () => {
        // Otherwise a valid family masks an invalid model — the same silent
        // drop #87 exists to stop, moved to the model axis.
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({ simplifiedIntelligenceMenu: true });
        let touched = 0;
        const watched = new Proxy(page, {
            get(target, prop, receiver) {
                if (prop === 'locator' || prop === 'keyboard') touched += 1;
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        await expect(chatGptModelCapabilityProbe(watched, 'bogus-model', { family: 'gpt-5.6-sol' }))
            .resolves.toMatchObject({ state: 'fail', evidence: { requested: 'bogus-model' } });
        expect(touched).toBe(0);
    });

    it('reports the family in evidence and leaves the selection untouched', async () => {
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({ simplifiedIntelligenceMenu: true, family: 'gpt-5.5' });

        const result = await chatGptModelCapabilityProbe(page, 'thinking', { family: 'gpt-5.6-sol' });

        expect(result).toMatchObject({ evidence: { family: 'gpt-5.6-sol' } });
        expect(result.state).not.toBe('fail');
        // The probe answers "can this be selected", not "select it".
        expect(page.__state.currentFamily).toBe('gpt-5.5');
    });

    it('fails when the requested family row is present but not selectable', async () => {
        // Label equality alone would report `ok` for a hidden row, recreating
        // the false success this contract exists to remove.
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({ simplifiedIntelligenceMenu: true, hiddenFamilyRows: true });

        await expect(chatGptModelCapabilityProbe(page, 'thinking', { family: 'gpt-5.6-sol' }))
            .resolves.toMatchObject({ state: 'fail' });
    });

    it('will not certify an effort tier it never selected', async () => {
        // Without a model the effort applies to whatever tier is active, and
        // this probe does not select the family, so `ok` would overclaim.
        const { chatGptModelCapabilityProbe } = await import('../../web-ai/chatgpt-model.mjs');
        const page = createFakeModelPage({ simplifiedIntelligenceMenu: true });

        const result = await chatGptModelCapabilityProbe(page, undefined, {
            family: 'gpt-5.6-sol',
            effort: 'high',
        });

        expect(result.state).toBe('warn');
        expect(result.evidence).toMatchObject({ effortTierUnproven: true, family: 'gpt-5.6-sol' });
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
    family = 'gpt-5.5',
    composerProPillLabel = null,
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
    powerPickerShell = false,
    advanceClock = null,
    hiddenFamilyRows = false,
} = {}) {
    const missingModelTestIdSet = new Set(missingModelTestIds);
    const state = {
        modelMenuOpen: initialModelMenuOpen,
        effortMenuOpen: false,
        // The real family submenu only exists after its trigger is hovered,
        // focus+ArrowRight'd, or clicked. Modelling it as "always open once the
        // model menu is open" made family assertions pass even when the code
        // never opened the submenu at all.
        familySubmenuOpen: false,
        currentModel: model,
        currentFamily: family,
        selectedEffort: initialSelectedEffort,
        effortMenuSource: null,
        exactEffortTrigger,
        exactEffortTriggerVisible,
        genericEffortTrigger,
        shellEffortTriggerClicks: 0,
        shellModelTriggerClicks: 0,
        genericEffortTriggerClicks: 0,
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
    const legacyFamilyLabels = {
        'gpt-5.6-sol': 'GPT-5.6 Sol',
        'gpt-5.5': 'GPT-5.5',
        'gpt-5.4': 'GPT-5.4',
        'gpt-5.3': 'GPT-5.3',
        o3: 'o3',
    };
    const familyLabels = powerPickerShell ? {
        'gpt-5.6-sol': 'GPT-5.6 Sol',
        'gpt-5.5': 'GPT-5.5',
        o3: 'o3',
    } : legacyFamilyLabels;
    const familyRows = Object.entries(familyLabels).map(([key, text]) => createElement({
        text,
        get checked() { return state.currentFamily === key; },
        onClick: () => { state.currentFamily = key; },
        // A row can be present in the DOM yet not selectable. Probes that only
        // match the label would report success for exactly this shape.
        visible: !hiddenFamilyRows,
    }));
    const familyTrigger = createElement({
        text: () => powerPickerShell
            ? `Model\n${familyLabels[state.currentFamily]}`
            : familyLabels[state.currentFamily],
        // Any of the three real interactions opens the submenu, matching
        // openSimplifiedIntelligenceSubmenu's hover -> ArrowRight -> click ladder.
        onHover: () => { state.familySubmenuOpen = true; },
        onFocus: () => { state.familySubmenuOpen = true; },
        onClick: () => {
            state.familySubmenuOpen = true;
            if (powerPickerShell) state.shellModelTriggerClicks += 1;
        },
    });
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
        onClick: () => {
            state.genericEffortTriggerClicks += 1;
            openEffortRows('generic');
        },
    });
    const shellEffortTrigger = createElement({
        text: () => `Effort\n${modelPillText()}`,
        onClick: () => {
            state.shellEffortTriggerClicks += 1;
            openEffortRows('shell');
        },
    });
    const dropdownButton = createElement({
        text: 'ChatGPT',
        testId: 'model-switcher-dropdown-button',
        onClick: () => { state.modelMenuOpen = true; },
        visible: closedDropdownButton,
    });
    const modelPill = createElement({
        text: () => modelPillText(),
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
        // Test-only handle so assertions can prove the probe left the
        // selection alone.
        __state: state,
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

    function modelPillText() {
        return composerProPillLabel || (state.selectedEffort
            ? `${activePillTexts?.[state.selectedEffort] || effortTexts[state.selectedEffort] || currentEffortTexts()[state.selectedEffort] || state.currentModel}`
            : state.currentModel);
    }

    function currentEffortTexts() {
        if (state.effortMenuSource === 'generic' && genericEffortTexts) return genericEffortTexts;
        return effortTexts;
    }

    function currentEffortRows() {
        if (state.effortMenuSource === 'shell') return simplifiedRows;
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

    function powerShellRoot() {
        return createElement({
            text: () => `Power\n${familyTrigger.text}\n${shellEffortTrigger.text}`,
            selectChildren: selector => {
            if (selector.includes('[role="menuitem"][aria-label="Power"]')) {
                return [createElement({ text: 'Power' })];
            }
            if (selector === '[role="menuitem"][data-has-submenu]') {
                return [familyTrigger, shellEffortTrigger];
            }
            if (selector === '[role="menuitemradio"], [role="menuitem"]') {
                return [familyTrigger, shellEffortTrigger];
            }
            if (selector === '[role="menuitemradio"]') return [];
                return [];
            },
        });
    }
    function familyPortalRoot() {
        return createElement({
            text: () => familyRows.map(row => row.text).join('\n'),
            selectChildren: selector => {
            if (selector === '[role="menuitemradio"], [role="menuitem"]') return familyRows;
            if (selector === '[role="menuitemradio"]') return familyRows;
                return [];
            },
        });
    }
    function effortPortalRoot() {
        return createElement({
            text: () => simplifiedRows.map(row => row.text).join('\n'),
            selectChildren: selector => {
            if (selector === '[role="menuitemradio"], [role="menuitem"]') return simplifiedRows;
            if (selector === '[role="menuitemradio"]') return simplifiedRows;
                return [];
            },
        });
    }

    function selectElements(selector) {
        if (modelPickerUnavailable) return [];
        if (selector === 'button, [role="button"], [role="menuitem"]') return state.modelMenuOpen && !state.effortMenuOpen && state.genericEffortTrigger && genericTriggerMode === 'text' ? [...composerPills(), genericTrigger] : composerPills();
        if (selector.includes('[role="button"].__composer-pill')) return roleButtonPill ? composerPills() : [];
        if (selector.includes('__composer-pill') && !selector.includes('aria-haspopup')) return roleButtonPill ? composerPills() : [];
        if (selector === 'button[aria-haspopup="menu"]') return composerPills();
        if (selector === 'button') return roleButtonPill ? [] : [dropdownButton, ...composerPills(), closedHeroPill].filter(element => element.visible && (element !== closedHeroPill || closedHeroEffortPill));
        if (powerPickerShell && selector.includes('[role="menu"]') && selector.includes('aria-label="Power"')) {
            return state.modelMenuOpen ? [powerShellRoot()] : [];
        }
        // Composer-scoped Intelligence picker content root
        if (selector.includes('composer-intelligence-picker-content')) {
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) {
                return [createElement({ text: simplifiedRows.map(row => row.text).join('\n'), visible: true })];
            }
            return [];
        }
        if (selector === '[role="menu"]') {
            if (powerPickerShell && state.modelMenuOpen) {
                return [
                    powerShellRoot(),
                    ...(state.familySubmenuOpen ? [familyPortalRoot()] : []),
                    ...(state.effortMenuOpen ? [effortPortalRoot()] : []),
                ];
            }
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) return [createElement({ text: `Intelligence\n${simplifiedRows.map(row => row.text).join('\n')}\nGPT-5.5`, visible: true })];
            if (state.effortMenuOpen) return [createElement({ text: Object.values(currentEffortTexts()).join('\n') })];
            if (!simplifiedIntelligenceMenu && state.modelMenuOpen) {
                // Legacy open menu with testid model rows
                return [createElement({ text: modelRows.map(r => r.text).join('\n'), visible: true })];
            }
            return [];
        }
        if (selector === '[role="menu"][data-state="open"]') {
            if (powerPickerShell && state.modelMenuOpen) {
                return [
                    powerShellRoot(),
                    ...(state.familySubmenuOpen ? [familyPortalRoot()] : []),
                    ...(state.effortMenuOpen ? [effortPortalRoot()] : []),
                ];
            }
            // The family submenu is a distinct surface: it only exists once its
            // trigger has been interacted with. Gating it here is what makes the
            // family assertions fail if the selector code stops opening it.
            return state.modelMenuOpen && state.familySubmenuOpen
                ? [createElement({ text: familyRows.map(row => row.text).join('\n') })]
                : [];
        }
        if (selector === '[role="menuitem"][data-has-submenu]') {
            if (powerPickerShell && state.modelMenuOpen) return [familyTrigger, shellEffortTrigger];
            return state.modelMenuOpen ? [familyTrigger] : [];
        }
        if (selector === '[data-testid^="model-switcher-"]') return state.modelMenuOpen ? modelRows.filter(element => element.testId) : (closedHeroEffortPill ? [closedHeroPill] : []);
        if (selector === '[data-testid^="model-switcher-gpt-"]') return state.modelMenuOpen ? modelRows.filter(element => element.testId) : (closedHeroEffortPill ? [closedHeroPill] : []);
        if (selector === '[role="menuitemradio"], [role="menuitem"]') {
            if (powerPickerShell && state.modelMenuOpen) {
                if (state.effortMenuOpen) return simplifiedRows;
                if (state.familySubmenuOpen) return familyRows;
                return [familyTrigger, shellEffortTrigger];
            }
            if (state.effortMenuOpen) return currentEffortRows();
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) return [...strayModelMenuItems, ...simplifiedRows];
            return [...strayModelMenuItems, ...modelRows];
        }
        if (selector === '[role="menuitemradio"]') {
            if (powerPickerShell && state.modelMenuOpen) {
                if (state.effortMenuOpen) return simplifiedRows;
                if (state.familySubmenuOpen) return familyRows;
                return [];
            }
            if (state.effortMenuOpen && effortOptionRole === 'menuitemradio') return currentEffortRows();
            if (simplifiedIntelligenceMenu && state.modelMenuOpen) {
                return state.familySubmenuOpen ? [...familyRows, ...simplifiedRows] : [...simplifiedRows];
            }
            return [];
        }
        if (selector === '[role="menuitem"]') {
            if (powerPickerShell && state.modelMenuOpen) {
                if (state.effortMenuOpen) return simplifiedRows;
                if (state.familySubmenuOpen) return familyRows;
                return [familyTrigger, shellEffortTrigger];
            }
            return state.effortMenuOpen && effortOptionRole === 'menuitem' ? currentEffortRows() : [];
        }
        if (selector.includes('aria-checked="true"') || selector.includes('data-state="checked"')) {
            const checkedTestId = selector.match(/data-testid="([^"]+)"/)?.[1];
            return [...familyRows, ...modelRows, ...currentEffortRows()]
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
        onHover: input.onHover || (() => undefined),
        onFocus: input.onFocus || (() => undefined),
        selectChildren: input.selectChildren || null,
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
        hover: async () => elements[0]?.onHover?.(),
        focus: async () => elements[0]?.onFocus?.(),
        boundingBox: async () => elements[0]?.rect || null,
        innerText: async () => elements[0]?.text || '',
        evaluateAll: async (fn, arg) => fn(elements.map(element => ({
            innerText: element.text,
            textContent: element.text,
            getAttribute: name => {
                if (name === 'data-testid') return element.testId;
                if (name === 'aria-checked') return element.checked ? 'true' : 'false';
                if (name === 'data-state') return element.checked ? 'checked' : 'unchecked';
                return null;
            },
        })), arg),
        // Root-owned locators model portal/shell ownership. Legacy fixtures can
        // still delegate to the page because their older menu root is flat.
        locator: childSelector => {
            const owned = elements.flatMap(element => element.selectChildren?.(childSelector) || []);
            if (owned.length > 0 || elements.some(element => element.selectChildren)) {
                const child = makeLocator(owned, childSelector);
                child._page = loc._page;
                return child;
            }
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
