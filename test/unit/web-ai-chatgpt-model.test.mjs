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

    it('allows Chat Power selection when Work slider markers are present in the open shell', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                model: 'pro',
                family: 'gpt-5.6-sol',
                initialSelectedEffort: null,
                powerPickerShell: true,
                workSliderMarkersInPowerShell: true,
                genericEffortTrigger: false,
                genericTriggerMode: 'disabled',
                advanceClock: clock.advance,
            });

            await expect(selectChatGptModel(page, 'pro')).resolves.toMatchObject({
                selected: 'pro',
                effort: null,
            });
            // The open shell still exposes the old Work slider markers, but the
            // Chat Power path must not fail closed as Work.
            expect(page.__state.shellEffortTriggerClicks + page.__state.shellModelTriggerInteractions).toBeGreaterThanOrEqual(0);
        } finally {
            clock.restore();
        }
    });

    it('selects Pro through the current Chat Power effort submenu', async () => {
        // Regression pair for the 260818 live-repro: the Power shell's tier stops are
        // the ONLY effort control that reliably works, and a tier that was never
        // applied must never come back as verified.
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
                modelSelection: { familyLabel: 'o3', verified: true },
            });
            expect(page.__state.shellModelTriggerInteractions).toBeGreaterThan(0);
            expect(page.__state.currentFamily).toBe('o3');
        } finally {
            clock.restore();
        }
    });

    it('does not verify a Power tier from an unrelated checked radio', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                model: 'thinking',
                initialSelectedEffort: 'xhigh',
                powerPickerShell: true,
                powerSelectionNoop: true,
                unrelatedCheckedPowerText: 'Pro',
                advanceClock: clock.advance,
            });

            const result = await selectChatGptModel(page, 'pro');
            expect(result).toMatchObject({
                selected: 'thinking',
                modelSelection: { verified: false },
            });
            expect(result.warnings).toContain('model-selection-unverified');
        } finally {
            clock.restore();
        }
    });

    it('does not accept a one-label unrelated menu as the family portal', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = createFakeModelPage({
                model: 'thinking',
                family: 'gpt-5.6-sol',
                initialSelectedEffort: 'xhigh',
                powerPickerShell: true,
                familyPortalAvailable: false,
                unrelatedFamilyMenuTexts: ['o3'],
                advanceClock: clock.advance,
            });

            await expect(selectChatGptModel(page, undefined, { family: 'o3' }))
                .rejects.toMatchObject({ errorCode: 'provider.model-mismatch' });
            expect(page.__state.currentFamily).toBe('gpt-5.6-sol');
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
            // An effort that was never applied must ALSO report the unverified axis:
            // a model-axis-only "verified" is what let a wrong tier pass silently.
            warnings: [
                expect.stringContaining('reasoning effort medium was not enforced'),
                'effort-selection-unverified',
                expect.stringContaining('effort medium was not applied'),
            ],
        });
        expect(result.usedFallbacks).toContain('reasoning-effort-unavailable-current-effort');
        expect(result.modelSelection.verified).toBe(false);
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
    powerSelectionNoop = false,
    familyPortalAvailable = true,
    unrelatedCheckedPowerText = null,
        workSliderMarkersInPowerShell = false,
    // Live Power shell (260818): the simple view carries "<Tier>, N of 5." AND owns the
    // [role="slider"] whose aria-valuenow is the 0..4 stop. Enabling this models the real
    // control, so the slider-driven success path executes instead of being asserted as a
    // source string.
    powerSliderStops = false,
    // Live (260818): the Effort row is pointer-intercepted, so its detached portal
    // never opens. Modelling that is what makes the slider the ONLY working control,
    // which is the exact condition the old code could not handle.
    powerEffortPortalBlocked = false,
    // Slider accepts focus and arrow keys but never changes its stop.
    powerSliderFrozen = false,
    unrelatedFamilyMenuTexts = [],
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
        shellModelTriggerInteractions: 0,
        genericEffortTriggerClicks: 0,
        // 0..4 Power stop, kept in sync with currentModel/selectedEffort so arrow
        // keys move the real selection the way the live slider does.
        get sliderIndex() {
            if (state.currentModel === 'instant') return 0;
            if (state.currentModel === 'pro') return 4;
            if (state.selectedEffort === 'medium') return 1;
            if (state.selectedEffort === 'xhigh') return 3;
            return 2;
        },
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
            onClick: () => { if (!(powerPickerShell && powerSelectionNoop)) setSimplifiedSelection('instant', null); },
        }),
        createElement({
            text: 'Medium',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'medium'; },
            onClick: () => { if (!(powerPickerShell && powerSelectionNoop)) setSimplifiedSelection('thinking', 'medium'); },
        }),
        createElement({
            text: 'High',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'high'; },
            onClick: () => { if (!(powerPickerShell && powerSelectionNoop)) setSimplifiedSelection('thinking', 'high'); },
        }),
        createElement({
            text: 'Extra High',
            get checked() { return state.currentModel === 'thinking' && state.selectedEffort === 'xhigh'; },
            onClick: () => { if (!(powerPickerShell && powerSelectionNoop)) setSimplifiedSelection('thinking', 'xhigh'); },
        }),
        createElement({
            text: 'Pro',
            get checked() { return state.currentModel === 'pro'; },
            onClick: () => { if (!(powerPickerShell && powerSelectionNoop)) setSimplifiedSelection('pro', null); },
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
    const unrelatedCheckedPowerRow = unrelatedCheckedPowerText
        ? createElement({ text: unrelatedCheckedPowerText, checked: true })
        : null;
    const unrelatedFamilyRows = unrelatedFamilyMenuTexts.map(text => createElement({
        text,
        checked: true,
    }));
    const familyTrigger = createElement({
        text: () => powerPickerShell
            ? `Model\n${familyLabels[state.currentFamily]}`
            : familyLabels[state.currentFamily],
        // Any of the three real interactions opens the submenu, matching
        // openSimplifiedIntelligenceSubmenu's hover -> ArrowRight -> click ladder.
        onHover: () => {
            state.familySubmenuOpen = true;
            if (powerPickerShell) state.shellModelTriggerInteractions += 1;
        },
        onFocus: () => {
            state.familySubmenuOpen = true;
            if (powerPickerShell) state.shellModelTriggerInteractions += 1;
        },
        onClick: () => {
            state.familySubmenuOpen = true;
            if (powerPickerShell) state.shellModelTriggerInteractions += 1;
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
        text: () => `Effort\n${shellTierLabel()}`,
        // Live (260818) the Effort row opens its portal on HOVER; a plain click is
        // pointer-intercepted. The double accepts either interaction and counts both,
        // so the production ladder (advanced -> hover -> keyboard -> forced click) is
        // exercised the same way a real shell would answer it.
        onHover: () => {
            state.shellEffortTriggerClicks += 1;
            openEffortRows('shell');
        },
        onFocus: () => {
            state.shellEffortTriggerClicks += 1;
            openEffortRows('shell');
        },
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
                if (powerSliderStops && (key === 'ArrowLeft' || key === 'ArrowRight') && state.sliderFocused) {
                    // A frozen slider models a shell that accepts the key but does not
                    // move — the only honest answer is "not applied", never a silent pass.
                    if (powerSliderFrozen) return;
                    const next = Math.max(0, Math.min(4, state.sliderIndex + (key === 'ArrowRight' ? 1 : -1)));
                    applyPowerStop(next);
                }
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
        // A blocked Effort row never mounts its portal, exactly like the live shell
        // whose trigger is covered by an overlay.
        if (powerEffortPortalBlocked && source === 'shell') return;
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
        state.effortMenuOpen = false;
        state.effortMenuSource = null;
        state.modelMenuOpen = false;
    }

    // Move the live Power slider to a 0..4 stop. Stops 1..3 are thinking efforts;
    // 0 and 4 are the Instant and Pro tiers, which carry no effort.
    function applyPowerStop(index) {
        if (index === 0) { state.currentModel = 'instant'; state.selectedEffort = null; return; }
        if (index === 4) { state.currentModel = 'pro'; state.selectedEffort = null; return; }
        state.currentModel = 'thinking';
        state.selectedEffort = index === 1 ? 'medium' : index === 2 ? 'high' : 'xhigh';
    }

    // "Medium, 2 of 5." — the string the live simple view renders, 1-based for humans.
    function powerSliderSimpleText() {
        return `${shellTierLabel()}, ${state.sliderIndex + 1} of 5.\nUse Left and Right arrow keys to adjust power.`;
    }

    function modelPillText() {
        // A live Power shell's composer pill shows the TIER label ("Pro", "Extra High"),
        // never the internal model key. openModelMenu only recognizes tier labels, so a
        // slider-backed double must speak the same vocabulary.
        if (powerSliderStops && !composerProPillLabel) return shellTierLabel();
        return composerProPillLabel || (state.selectedEffort
            ? `${activePillTexts?.[state.selectedEffort] || effortTexts[state.selectedEffort] || currentEffortTexts()[state.selectedEffort] || state.currentModel}`
            : state.currentModel);
    }

    function shellTierLabel() {
        if (state.currentModel === 'instant') return 'Instant';
        if (state.currentModel === 'pro') return 'Pro';
        if (state.selectedEffort === 'high') return 'High';
        if (state.selectedEffort === 'xhigh') return 'Extra High';
        return 'Medium';
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
                return [createElement({
                    text: 'Power',
                    // Live, the keyboard target is the Power menuitem (it carries
                    // aria-keyshortcuts="ArrowLeft ArrowRight"), not the slider role.
                    onFocus: () => { state.sliderFocused = true; },
                    onClick: () => { state.sliderFocused = true; },
                })];
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
            if (selector.includes('[aria-checked="true"]') || selector.includes('[data-state="checked"]')) {
                return familyRows.filter(row => row.checked);
            }
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
            if (selector.includes('[aria-checked="true"]') || selector.includes('[data-state="checked"]')) {
                return simplifiedRows.filter(row => row.checked);
            }
                return [];
            },
        });
    }
    function unrelatedFamilyPortalRoot() {
        return createElement({
            text: () => unrelatedFamilyRows.map(row => row.text).join('\n'),
            selectChildren: selector => {
                if (selector === '[role="menuitemradio"], [role="menuitem"]') return unrelatedFamilyRows;
                if (selector === '[role="menuitemradio"]') return unrelatedFamilyRows;
                if (selector.includes('[aria-checked="true"]') || selector.includes('[data-state="checked"]')) {
                    return unrelatedFamilyRows.filter(row => row.checked);
                }
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
        if (workSliderMarkersInPowerShell && (
            selector.includes('composer-model-picker-slider-simple-view')
            || selector.includes('composer-model-picker-slider-advanced-view')
        )) {
            return [createElement({
                text: selector.includes('simple-view') ? 'Pro, 5 of 5.' : 'Model\nGPT-5.6 Sol\nEffort\nPro',
                visible: true,
            })];
        }
        // Live Power shell: the simple view carries the tier string AND owns the slider.
        // The slider selector names the simple view too, so it must be matched FIRST or
        // the tier text would be returned where an aria-valuenow carrier is expected.
        if (powerSliderStops && selector.includes('[role="slider"]')) {
            if (!state.modelMenuOpen) return [];
            return [createElement({
                text: '',
                visible: true,
                attributes: { 'aria-valuenow': () => String(state.sliderIndex), 'aria-valuemin': '0', 'aria-valuemax': '4' },
                onFocus: () => { state.sliderFocused = true; },
            })];
        }
        if (powerSliderStops && selector.includes('composer-model-picker-slider-simple-view')) {
            if (!state.modelMenuOpen) return [];
            return [createElement({ text: () => powerSliderSimpleText(), visible: true })];
        }
        // The slider driver resolves the Power control PAGE-scoped, not through the
        // shell root, so the double must answer that selector too.
        if (powerSliderStops && selector === '[role="menuitem"][aria-label="Power"]') {
            if (!state.modelMenuOpen) return [];
            return [createElement({
                text: 'Power',
                onFocus: () => { state.sliderFocused = true; },
                onClick: () => { state.sliderFocused = true; },
            })];
        }
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
                    ...(state.familySubmenuOpen && familyPortalAvailable ? [familyPortalRoot()] : []),
                    ...(state.familySubmenuOpen && unrelatedFamilyRows.length > 0 ? [unrelatedFamilyPortalRoot()] : []),
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
                    ...(state.familySubmenuOpen && familyPortalAvailable ? [familyPortalRoot()] : []),
                    ...(state.familySubmenuOpen && unrelatedFamilyRows.length > 0 ? [unrelatedFamilyPortalRoot()] : []),
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
            return [unrelatedCheckedPowerRow, ...familyRows, ...modelRows, ...currentEffortRows()]
                .filter(Boolean)
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
        // Live attributes such as aria-valuenow are read through locator.getAttribute;
        // values may be functions so a slider can report its current stop.
        attributes: input.attributes || null,
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
        getAttribute: async name => {
            const attributes = elements[0]?.attributes;
            if (!attributes || !(name in attributes)) return null;
            const value = attributes[name];
            return typeof value === 'function' ? value() : value;
        },
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

describe('Power tier contract (260818 live repair)', () => {
    // Live repro: `--model thinking --effort high` starting from Medium left the tier on
    // Medium yet reported `verified: true`. Two defects had to line up: the slider was
    // unreachable for effort-only moves, and `verified` only checked the model axis,
    // where Medium/High/Extra High all collapse to 'thinking'.
    const src = readFileSync(join(process.cwd(), 'web-ai/chatgpt-model.mjs'), 'utf8');

    it('maps Power slider stops to thinking efforts and fails closed on disagreement', async () => {
        const { effortChoiceFromPowerTierLabel } = await import('../../web-ai/chatgpt-model.mjs');

        expect(effortChoiceFromPowerTierLabel('Medium, 2 of 5.', 1)).toBe('medium');
        expect(effortChoiceFromPowerTierLabel('High, 3 of 5.', 2)).toBe('high');
        expect(effortChoiceFromPowerTierLabel('Extra High, 4 of 5.', 3)).toBe('xhigh');
        // Instant and Pro are not thinking stops.
        expect(effortChoiceFromPowerTierLabel('Instant, 1 of 5.', 0)).toBeNull();
        expect(effortChoiceFromPowerTierLabel('Pro, 5 of 5.', 4)).toBeNull();
        // One source is enough when the other is absent.
        expect(effortChoiceFromPowerTierLabel('High, 3 of 5.', null)).toBe('high');
        expect(effortChoiceFromPowerTierLabel(null, 3)).toBe('xhigh');
        // Disagreement must not be resolved by guessing.
        expect(effortChoiceFromPowerTierLabel('Medium, 2 of 5.', 3)).toBeNull();
        // The real shell string is multi-line; the tier is on the first line.
        expect(effortChoiceFromPowerTierLabel(
            'Extra High, 4 of 5.\nUse Left and Right arrow keys to adjust power.', 3,
        )).toBe('xhigh');
    });

    it('keeps one source of truth for the tier index', async () => {
        const { CHATGPT_POWER_TIER_INDEX } = await import('../../web-ai/chatgpt-model.mjs');
        expect(CHATGPT_POWER_TIER_INDEX).toMatchObject({ instant: 0, thinking: 2, pro: 4 });
        // powerTierIndexForChoice must read the constant, not re-hardcode the numbers.
        expect(src).toContain('return CHATGPT_POWER_TIER_INDEX.instant');
        expect(src).toContain('return CHATGPT_POWER_TIER_INDEX.pro');
    });

    it('drives the Power slider from the effort branch, not only the model-switch branch', () => {
        // The model-equality gate (`currentModel !== requested`) is false for every
        // thinking-effort move, so the effort branch needs its own slider call.
        expect(src).toContain('thinking-effort-power-slider-direct');
        const effortBranch = src.slice(src.indexOf('if (requestedEffort) {'));
        expect(effortBranch).toContain("selectChatGptPowerTierBySlider(page, 'thinking'");
    });

    it('captures the effort observation before the menu is closed', () => {
        // The tier string lives inside the Power shell that closeModelMenu() unmounts.
        // Reading it afterwards would make every effort look unverified.
        const observe = src.indexOf('let observedEffort = null;');
        const close = src.indexOf('await closeModelMenu(page);', observe);
        const verify = src.indexOf('const effortVerified =', observe);
        expect(observe).toBeGreaterThan(-1);
        expect(close).toBeGreaterThan(observe);
        expect(verify).toBeGreaterThan(close);
        // No page read for effort may appear after the close.
        expect(src.slice(close, verify)).not.toContain('readChatGptPowerSliderState');
    });

    it('folds the effort axis into verified so a wrong tier cannot report success', () => {
        expect(src).toContain('const effortVerified = !requestedEffort');
        expect(src).toContain('const verified = after === targetModel');
        expect(src).toContain('&& effortVerified');
        expect(src).toContain("warnings.push('effort-selection-unverified')");
        // An unverified effort must not leak into the reported fields.
        expect(src).toContain('const effortReportable = effortVerified ? selectedEffort : null;');
        expect(src).toContain('effort: effortReportable?.selected || null');
    });

    it('never reports an unopened submenu as opened', () => {
        // The old implementation swallowed a timed-out click and returned true.
        const fn = src.slice(src.indexOf('async function openPowerPickerSubmenu('));
        expect(fn).toContain('await expandPowerPickerAdvanced(page)');
        expect(fn).toContain('if (await isPowerSubmenuPortalOpen(page, heading)) return true;');
        // The old body ended with an unconditional `return true`; the new one ends
        // with `return false` after every rung of the ladder has been tried.
        expect(fn.slice(0, fn.indexOf('\n}'))).toContain('return false;');
    });
});

describe('live Power shell 260818 (behavioral)', () => {
    // These drive the SUCCESS path of the repair through a shell that owns a real
    // 5-stop slider, so the fix is executed rather than asserted as a source string.
    const powerShellPage = (overrides = {}) => createFakeModelPage({
        family: 'gpt-5.6-sol',
        powerPickerShell: true,
        powerSliderStops: true,
        genericEffortTrigger: false,
        genericTriggerMode: 'disabled',
        keyboardOpensEffort: false,
        // The live Effort portal never opens (pointer-intercepted), so the slider is
        // the only control that can move the tier.
        powerEffortPortalBlocked: true,
        // The live composer pill shows the TIER label ("Pro", "Extra High"), which is
        // what openModelMenu matches on; the default double emits the raw model key.
        composerProPillLabel: undefined,
        ...overrides,
    });

    for (const [effort, tier, stop] of [['medium', 'Medium', 1], ['high', 'High', 2], ['xhigh', 'Extra High', 3]]) {
        it(`drives the Power slider to ${tier} for --effort ${effort} when the effort portal never opens`, async () => {
            const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
            const clock = useAdvancingClock();
            try {
                // Start on a DIFFERENT thinking stop. Both normalize to 'thinking', so
                // the model-equality gate is false and the old code never moved the tier.
                const page = powerShellPage({
                    model: 'thinking',
                    initialSelectedEffort: effort === 'medium' ? 'xhigh' : 'medium',
                    advanceClock: clock.advance,
                });

                const result = await selectChatGptModel(page, 'thinking', { effort });

                expect(result).toMatchObject({ selected: 'thinking', effort });
                expect(result.modelSelection.verified).toBe(true);
                expect(result.warnings).not.toContain('effort-selection-unverified');
                expect(page.__state.sliderIndex).toBe(stop);
                expect(page.__state.selectedEffort).toBe(effort);
            } finally {
                clock.restore();
            }
        });
    }

    it('reports verified:false when the slider cannot reach the requested stop', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            // The slider accepts the keys but never moves, and the portal never opens:
            // no path remains by which the requested tier could have been applied.
            const page = powerShellPage({
                model: 'thinking',
                initialSelectedEffort: 'medium',
                powerSliderFrozen: true,
                advanceClock: clock.advance,
            });

            const result = await selectChatGptModel(page, 'thinking', { effort: 'xhigh' });

            // The tier is still Medium, so success must NOT be claimed on either axis.
            expect(page.__state.selectedEffort).toBe('medium');
            expect(result.modelSelection.verified).toBe(false);
            expect(result.effort).toBeNull();
            expect(result.alreadySelected).toBe(false);
            // Nothing moved and the control never answered, so the honest status is
            // 'unavailable'. What matters is that neither success status is claimed.
            expect(result.modelSelection.status).toBe('unavailable');
            expect(['switched', 'already-selected']).not.toContain(result.modelSelection.status);
            expect(result.warnings).toContain('effort-selection-unverified');
        } finally {
            clock.restore();
        }
    });

    it('moves from a thinking stop to Pro and reports no effort', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = powerShellPage({
                model: 'thinking',
                initialSelectedEffort: 'xhigh',
                advanceClock: clock.advance,
            });

            const result = await selectChatGptModel(page, 'pro');

            expect(result).toMatchObject({ selected: 'pro', effort: null });
            expect(result.modelSelection.verified).toBe(true);
            expect(page.__state.sliderIndex).toBe(4);
        } finally {
            clock.restore();
        }
    });

    it('moves from Pro back down to a thinking effort stop', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = powerShellPage({ model: 'pro', initialSelectedEffort: null, advanceClock: clock.advance });

            const result = await selectChatGptModel(page, 'thinking', { effort: 'high' });

            expect(result).toMatchObject({ selected: 'thinking', effort: 'high' });
            expect(result.modelSelection.verified).toBe(true);
            expect(page.__state.sliderIndex).toBe(2);
        } finally {
            clock.restore();
        }
    });

    it('reaches Instant from a thinking stop without a model-option throw', async () => {
        const { selectChatGptModel } = await import('../../web-ai/chatgpt-model.mjs');
        const clock = useAdvancingClock();
        try {
            const page = powerShellPage({ model: 'thinking', initialSelectedEffort: 'medium', advanceClock: clock.advance });

            const result = await selectChatGptModel(page, 'instant');

            expect(result).toMatchObject({ selected: 'instant' });
            expect(page.__state.sliderIndex).toBe(0);
        } finally {
            clock.restore();
        }
    });
});
