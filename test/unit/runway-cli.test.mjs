import { describe, expect, it } from 'vitest';
import {
    buildRunwaySelectorContract,
    detectRunwaySurface,
    inspectRunwayPage,
    runRunwayCli,
} from '../../skills/browser/runway.mjs';
import {
    inspectRunwayCompletionState,
    waitForRunwayCompletion,
} from '../../skills/browser/runway-monitor.mjs';

function makeDomSummary(overrides = {}) {
    return {
        textSample: 'Runway Unlimited View generation cost Audio settings Generate',
        selectors: {
            '[data-testid="mira-app-sidebar"]': true,
            '[data-testid="credit-info-button"]': true,
            'input[placeholder="Describe your creation or search apps"]': false,
            'div[aria-label="Prompt"]': true,
            'input[type="file"]': true,
            '[data-testid="select-base-model"]': true,
            '#related-apps-trigger': true,
            'button[title="Click to rename"]': true,
        },
        counts: { buttons: 7, inputs: 3, fileInputs: 1, textareas: 0 },
        quota: {
            creditInfoText: 'Unlimited',
            hasUnlimitedText: true,
            hasGenerationCostText: true,
        },
        auth: {
            hasLoginText: false,
            hasSignUpText: false,
        },
        actions: {
            hasGenerateButton: true,
            hasRunAllButton: false,
            buttonTexts: ['Generate', 'View generation cost'],
        },
        ...overrides,
    };
}

describe('runway CLI helpers', () => {
    it('returns Apps and Custom/tools as the focused selector contract', () => {
        const contract = buildRunwaySelectorContract('all');
        expect(contract.focus).toEqual(['apps', 'custom-tools']);
        expect(contract.surfaces.apps.deepAutomation).toBe(true);
        expect(contract.surfaces['custom-tools'].selectors.some(item => item.name === 'generate' && item.blocked)).toBe(true);
        expect(contract.safety.mutationAllowed).toBe(false);
    });

    it('detects Runway surfaces from URL and visible text', () => {
        expect(detectRunwaySurface('https://app.runwayml.com/ai-tools/generate?mode=apps')).toBe('apps');
        expect(detectRunwaySurface('https://app.runwayml.com/ai-tools/generate?mode=tools')).toBe('custom-tools');
        expect(detectRunwaySurface('', 'View generation cost Audio settings')).toBe('custom-tools');
        expect(detectRunwaySurface('', 'Describe your creation or search apps')).toBe('apps');
    });

    it('inspects a page without allowing submit-like controls', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => makeDomSummary(),
        };
        const result = await inspectRunwayPage(page, { surface: 'auto' });
        expect(result.ok).toBe(true);
        expect(result.surfaceDetected).toBe('custom-tools');
        expect(result.deepAutomationTarget).toBe(true);
        expect(result.quota.hasUnlimitedText).toBe(true);
        expect(result.auth.likelyGuest).toBe(false);
        expect(result.actions.hasGenerateButton).toBe(true);
        expect(result.safety.mutationAllowed).toBe(false);
        expect(result.selectors.present['div[aria-label="Prompt"]']).toBe(true);
    });

    it('prints selector JSON without requiring a browser page', async () => {
        const lines = [];
        await runRunwayCli(['selectors', '--surface', 'apps', '--json'], {
            write: text => lines.push(text),
        });
        const parsed = JSON.parse(lines.join('\n'));
        expect(parsed.surfaces.apps.url).toContain('mode=apps');
        expect(parsed.surfaces['custom-tools']).toBeUndefined();
    });

    it('open navigates only to supported deep Runway surfaces and keeps mutation blocked', async () => {
        const calls = [];
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=apps',
            title: async () => 'Runway',
            goto: async (url, options) => calls.push({ url, options }),
            waitForLoadState: async () => undefined,
            evaluate: async () => makeDomSummary({
                textSample: 'Runway Unlimited Describe your creation or search apps',
                quota: {
                    creditInfoText: 'Unlimited',
                    hasUnlimitedText: true,
                    hasGenerationCostText: false,
                },
            }),
        };
        const lines = [];
        await runRunwayCli(['open', '--surface', 'apps', '--json'], {
            getPage: async () => page,
            write: text => lines.push(text),
        });
        const parsed = JSON.parse(lines.join('\n'));
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('mode=apps');
        expect(parsed.command).toBe('open');
        expect(parsed.safety.mutationAllowed).toBe(false);
    });

    it('detects Runway queue gate as a terminal poll signal', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: "You're on a roll! Please wait for your last generation to complete, or switch to Credits Mode.",
                outputItemCount: 12,
                outputLabels: ['Kling O3 4K - sample.mp4'],
                activeLabels: ['loading animation'],
                progressTexts: ['55%'],
                queueGateText: 'You are on a roll / wait for last generation / Credits Mode',
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: false,
            }),
        };
        const result = await inspectRunwayCompletionState(page, { queueLimit: 2, afterCount: 12 });
        expect(result.state).toBe('queue_full');
        expect(result.terminal).toBe(true);
        expect(result.completionSignal).toBe('queue-gate');
        expect(result.queue.full).toBe(true);
        expect(result.submitEvidence.acceptedAfterBaseline).toBe(false);
    });

    it('does not infer Runway queue state from a non-Runway tab', async () => {
        const page = {
            url: () => 'https://grok.com/c/example',
            title: async () => 'Grok',
            evaluate: async () => ({
                textSample: '100% unrelated page text',
                outputItemCount: 0,
                outputLabels: ['https://example.com/x%2Fy%20100%25.png'],
                activeLabels: ['https://example.com/ads%20100%25'],
                progressTexts: ['100%'],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: false,
                generateDisabled: false,
            }),
        };
        const result = await inspectRunwayCompletionState(page, { queueLimit: 2 });
        expect(result.isRunwayTab).toBe(false);
        expect(result.state).toBe('not_runway');
        expect(result.completionSignal).toBe('not-runway-tab');
        expect(result.queue.full).toBe(false);
    });

    it('poll waits until active generation signals disappear', async () => {
        const states = [
            {
                textSample: 'Generating...',
                outputItemCount: 12,
                outputLabels: ['Kling O3 4K - sample.mp4'],
                activeLabels: ['Generating...'],
                progressTexts: ['18%'],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: true,
            },
            {
                textSample: 'FLUX.2 Max - sample.png Use frame',
                outputItemCount: 13,
                outputLabels: ['FLUX.2 Max - sample.png', 'Use frame'],
                activeLabels: [],
                progressTexts: [],
                queueGateText: null,
                readyText: 'You are ready to generate.',
                hasGenerateButton: true,
                generateDisabled: false,
            },
        ];
        let index = 0;
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => states[Math.min(index++, states.length - 1)],
        };
        const result = await waitForRunwayCompletion(page, {
            timeoutMs: 100,
            intervalMs: 1,
            queueLimit: 2,
            afterCount: 12,
            sleep: async () => undefined,
        });
        expect(result.polls).toBe(2);
        expect(result.state).toBe('idle');
        expect(result.terminal).toBe(true);
        expect(result.submitEvidence.acceptedAfterBaseline).toBe(true);
    });

    it('prints runway poll JSON with the 10 minute default timeout', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: 'Ready',
                outputItemCount: 0,
                outputLabels: [],
                activeLabels: [],
                progressTexts: [],
                queueGateText: null,
                readyText: 'You are ready to generate.',
                hasGenerateButton: true,
                generateDisabled: false,
            }),
        };
        const lines = [];
        await runRunwayCli(['poll', '--json'], {
            getPage: async () => page,
            write: text => lines.push(text),
            sleep: async () => undefined,
        });
        const parsed = JSON.parse(lines.join('\n'));
        expect(parsed.timeoutMs).toBe(600000);
        expect(parsed.queue.limit).toBe(2);
        expect(parsed.state).toBe('idle');
    });
});
