import { describe, expect, it } from 'vitest';
import {
    buildRunwaySelectorContract,
    detectRunwaySurface,
    inspectRunwayPage,
    inspectRunwayRecents,
    runRunwayCli,
} from '../../skills/browser/runway.mjs';
import {
    buildRunwaySurfaceUrl,
    extractRunwayTeamBase,
} from '../../skills/browser/runway-url.mjs';
import {
    inspectRunwayCompletionState,
    waitForRunwayCompletion,
} from '../../skills/browser/runway-monitor.mjs';
import { buildRunwaySafety } from '../../skills/browser/runway-selectors.mjs';
import {
    buildAnchoredPrompt,
    buildRunwaySequencePlan,
    executeRunwaySequence,
} from '../../skills/browser/runway-sequence.mjs';

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
        model: {
            selected: 'Seedance 2.0',
            catalog: [],
            visibleOptions: [],
        },
        ...overrides,
    };
}

describe('runway CLI helpers', () => {
    it('returns Apps and Custom/tools as the focused selector contract', () => {
        const contract = buildRunwaySelectorContract('all');
        expect(contract.focus).toEqual(['apps', 'custom-tools']);
        expect(contract.modelCatalog.apps).toContain('Nano Banana 2 - Image');
        expect(contract.modelCatalog.apps).toContain('Kling O3 Pro - Video + Audio');
        expect(contract.modelCatalog.customToolsBaseModels).toContain('WAN 2.6 Flash');
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

    it('builds team-scoped Runway URLs from the current workspace URL', () => {
        const currentUrl = 'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=tools';
        expect(extractRunwayTeamBase(currentUrl)).toBe('https://app.runwayml.com/video-tools/teams/pos090011');
        expect(buildRunwaySurfaceUrl('apps', currentUrl)).toBe('https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=apps');
        expect(buildRunwaySurfaceUrl('recents', currentUrl)).toBe('https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/recents');
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
            url: () => 'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=tools',
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
        expect(calls[0].url).toBe('https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=apps');
        expect(parsed.command).toBe('open');
        expect(parsed.safety.mutationAllowed).toBe(false);
    });

    it('open discovers the team URL before opening apps from a blank page', async () => {
        const calls = [];
        let currentUrl = 'about:blank';
        const page = {
            url: () => currentUrl,
            title: async () => 'Runway',
            goto: async (url, options) => {
                calls.push({ url, options });
                currentUrl = url.includes('mode=tools')
                    ? 'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=tools'
                    : url;
            },
            waitForLoadState: async () => undefined,
            evaluate: async () => makeDomSummary({
                textSample: 'Runway Unlimited Describe your creation or search apps',
                selectors: {
                    '[data-testid="mira-app-sidebar"]': true,
                    '[data-testid="credit-info-button"]': true,
                    'input[placeholder="Describe your creation or search apps"]': true,
                },
            }),
        };
        const lines = [];
        await runRunwayCli(['open', '--surface', 'apps', '--json'], {
            getPage: async () => page,
            write: text => lines.push(text),
        });
        expect(calls.map(call => call.url)).toEqual([
            'https://app.runwayml.com/ai-tools/generate?mode=tools',
            'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=apps',
        ]);
    });


    it('detects Runway queue gate as a terminal poll signal', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: "You're on a roll! Please wait for your last generation to complete, or switch to Credits Mode.",
                outputItemCount: 12,
                outputLabels: ['Kling O3 4K - sample.mp4'],
                activeLabels: [],
                progressTexts: [],
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

    it('keeps Runway active when a transient queue gate appears with active generation signals', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: "You're on a roll! Your video is generating in Explore Mode. 55%",
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
        expect(result.state).toBe('active');
        expect(result.terminal).toBe(false);
        expect(result.completionSignal).toBe('active-generation-signals');
        expect(result.queue.full).toBe(true);
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

    it('poll keeps waiting for an expected video output after early idle', async () => {
        const states = [
            {
                textSample: 'Ready but video not attached yet',
                outputItemCount: 1,
                outputLabels: ['https://cdn.runwayml.com/result/thumb.png'],
                activeLabels: [],
                progressTexts: [],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: false,
            },
            {
                textSample: 'Video ready',
                outputItemCount: 2,
                outputLabels: [
                    'https://cdn.runwayml.com/result/thumb.png',
                    'https://cdn.runwayml.com/video-previews/finished.mp4',
                ],
                activeLabels: [],
                progressTexts: [],
                queueGateText: null,
                readyText: null,
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
            afterCount: 0,
            expectedType: 'video',
            sleep: async () => undefined,
        });
        expect(result.polls).toBe(2);
        expect(result.state).toBe('idle');
        expect(result.submitEvidence.acceptedAfterBaseline).toBe(true);
        expect(result.outputLabels).toEqual(['https://cdn.runwayml.com/video-previews/finished.mp4']);
    });

    it('treats right-rail percent text as an active Runway generation signal', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: 'All Favorited Downloaded 4K 16 17 18 50%',
                outputItemCount: 18,
                outputLabels: ['Seedance 2_0 - A clean cinematic sample.mp4'],
                activeLabels: [],
                progressTexts: [],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: false,
            }),
        };
        const result = await inspectRunwayCompletionState(page, { queueLimit: 2, afterCount: 17 });
        expect(result.state).toBe('active');
        expect(result.terminal).toBe(false);
        expect(result.completionSignal).toBe('active-generation-signals');
        expect(result.activeLabels).toContain('50%');
    });

    it('treats plain Runway in-queue card text as an active generation signal', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: 'Prompt and controls only.',
                activeText: `${'older output '.repeat(150)}Your generation is in queue and will start in a few minutes.`,
                outputItemCount: 13,
                outputLabels: ['Reuse settings', 'See full prompt'],
                activeLabels: [],
                progressTexts: [],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: false,
            }),
        };
        const result = await inspectRunwayCompletionState(page, { queueLimit: 2, afterCount: 12 });
        expect(result.state).toBe('active');
        expect(result.terminal).toBe(false);
        expect(result.activeLabels).toContain('in queue');
    });

    it('keeps two in-progress Runway jobs active instead of terminal queue_full without a queue gate', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: '17 20% 18 50%',
                outputItemCount: 18,
                outputLabels: [],
                activeLabels: ['20%', '50%'],
                progressTexts: [],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: true,
            }),
        };
        const result = await inspectRunwayCompletionState(page, { queueLimit: 2, afterCount: 16 });
        expect(result.queue.full).toBe(true);
        expect(result.state).toBe('active');
        expect(result.terminal).toBe(false);
        expect(result.completionSignal).toBe('active-generation-signals');
    });

    it('treats stale loading animation as complete after a new output appears', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: 'All Favorited Downloaded 4K loading animation',
                outputItemCount: 11,
                outputLabels: ['https://cdn.runwayml.com/video-previews/finished.mp4'],
                activeLabels: ['loading animation'],
                progressTexts: [],
                queueGateText: null,
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: false,
            }),
        };
        const result = await inspectRunwayCompletionState(page, { queueLimit: 2, afterCount: 10 });
        expect(result.state).toBe('idle');
        expect(result.terminal).toBe(true);
        expect(result.submitEvidence.acceptedAfterBaseline).toBe(true);
        expect(result.queue.activeCountEstimate).toBe(0);
        expect(result.queue.rawActiveCountEstimate).toBe(1);
    });

    it('uses expected video output count before accepting completion', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                textSample: 'Shot output ready',
                outputItemCount: 20,
                outputLabels: [
                    'https://cdn.runwayml.com/result/thumb.png',
                    'https://cdn.runwayml.com/video-previews/finished.mp4',
                ],
                activeLabels: [],
                progressTexts: [],
                queueGateText: 'You are on a roll / wait for last generation / Credits Mode',
                readyText: null,
                hasGenerateButton: true,
                generateDisabled: false,
            }),
        };
        const result = await inspectRunwayCompletionState(page, {
            queueLimit: 2,
            afterCount: 0,
            expectedType: 'video',
        });
        expect(result.state).toBe('idle');
        expect(result.submitEvidence.outputItemCount).toBe(1);
        expect(result.submitEvidence.acceptedAfterBaseline).toBe(true);
        expect(result.outputLabels).toEqual(['https://cdn.runwayml.com/video-previews/finished.mp4']);
    });

    it('inspects runway page with enhanced plan/model/generation fields', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            evaluate: async () => ({
                ...makeDomSummary(),
                plan: { type: 'Unlimited', credits: null },
                workspace: { name: 'My Workspace' },
                model: { selected: 'Seedance 2.0', catalog: [], visibleOptions: [] },
                generation: { mode: 'Explore' },
            }),
        };
        const result = await inspectRunwayPage(page, { surface: 'auto' });
        expect(result.plan.type).toBe('Unlimited');
        expect(result.workspace.name).toBe('My Workspace');
        expect(result.model.selected).toBe('Seedance 2.0');
        expect(result.model.catalog).toEqual([]);
        expect(result.generation.mode).toBe('Explore');
    });

    it('inspects runway recents and returns asset list', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/recents',
            title: async () => 'Runway',
            evaluate: async () => ({
                assets: [
                    { index: 0, type: 'video', label: 'Cat walking.mp4', thumbnail: 'https://example.com/thumb.jpg', downloadUrl: null },
                    { index: 1, type: 'image', label: 'Dog portrait.png', thumbnail: 'https://example.com/thumb2.jpg', downloadUrl: 'https://example.com/download' },
                ],
                totalVisible: 5,
            }),
        };
        const result = await inspectRunwayRecents(page, { limit: 20, type: 'all' });
        expect(result.ok).toBe(true);
        expect(result.count).toBe(2);
        expect(result.assets[0].type).toBe('video');
        expect(result.assets[1].type).toBe('image');
    });

    it('filters recents by type', async () => {
        const page = {
            url: () => 'https://app.runwayml.com/ai-tools/recents',
            title: async () => 'Runway',
            evaluate: async () => ({
                assets: [
                    { index: 0, type: 'video', label: 'Vid1.mp4', thumbnail: null, downloadUrl: null },
                    { index: 1, type: 'image', label: 'Img1.png', thumbnail: null, downloadUrl: null },
                ],
                totalVisible: 2,
            }),
        };
        const result = await inspectRunwayRecents(page, { limit: 20, type: 'video' });
        expect(result.count).toBe(1);
        expect(result.assets[0].type).toBe('video');
    });

    it('detects recents surface from URL', () => {
        expect(detectRunwaySurface('https://app.runwayml.com/ai-tools/recents')).toBe('recents');
    });

    it('builds safety levels correctly', () => {
        const level0 = buildRunwaySafety(0);
        expect(level0.mutationAllowed).toBe(false);
        expect(level0.submitAllowed).toBe(false);

        const level1 = buildRunwaySafety(1);
        expect(level1.mutationAllowed).toBe(true);
        expect(level1.submitAllowed).toBe(false);

        const level2 = buildRunwaySafety(2);
        expect(level2.mutationAllowed).toBe(true);
        expect(level2.submitAllowed).toBe(true);
    });

    it('runway recents command navigates and parses', async () => {
        const navigated = [];
        const page = {
            url: () => 'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=tools',
            title: async () => 'Runway',
            goto: async (url) => navigated.push(url),
            waitForLoadState: async () => undefined,
            evaluate: async () => ({
                assets: [],
                totalVisible: 0,
            }),
        };
        const lines = [];
        await runRunwayCli(['recents', '--json'], {
            getPage: async () => page,
            write: text => lines.push(text),
        });
        expect(navigated.length).toBeGreaterThan(0);
        expect(navigated[0]).toBe('https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/recents');
        const parsed = JSON.parse(lines.join('\n'));
        expect(parsed.command).toBe('recents');
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

    it('plans a custom-tools continuity sequence without using workflow surface', () => {
        const plan = buildRunwaySequencePlan({
            story: 'A single continuous camera move through a product reveal.',
            targetDuration: 120,
        });

        expect(plan.shotDuration).toBe(10);
        expect(plan.shotCount).toBe(12);
        expect(plan.totalDuration).toBe(120);

        const anchored = buildAnchoredPrompt('The camera continues past the hero product.', 2, 12, true);
        expect(anchored).toContain('Continue directly from the provided first frame');
        expect(anchored).toContain('Avoid a hard reset');
    });

    it('routes runway sequence dry-run through the CLI as a custom-tools chain', async () => {
        const lines = [];
        await runRunwayCli([
            'sequence',
            '--dry-run',
            '--story',
            'A seamless product reveal built from connected clips.',
            '--target-duration',
            '20',
            '--json',
        ], {
            getPage: async () => {
                throw new Error('dry-run must not require a browser page');
            },
            write: text => lines.push(text),
        });

        const parsed = JSON.parse(lines.join('\n'));
        expect(parsed.ok).toBe(true);
        expect(parsed.command).toBe('sequence');
        expect(parsed.surface).toBe('custom-tools');
        expect(parsed.continuityMode).toBe('last-frame-to-next-first-frame');
        expect(parsed.plan.shotCount).toBe(2);
        expect(parsed.plan.totalDuration).toBe(20);
        expect(parsed.safety.submitAllowed).toBe(false);
    });

    it('clears stale references for every submitted continuity sequence shot', async () => {
        let generationOptions = null;
        const result = await executeRunwaySequence({}, {
            story: 'A connected camera move.',
            targetDuration: 4,
            shotDuration: 4,
            maxShots: 1,
            outputDir: '/tmp/runway-sequence-unit-clear-refs',
            manifest: '/tmp/runway-sequence-unit-clear-refs/manifest.json',
        }, {
            executeGeneration: async (_page, options) => {
                generationOptions = options;
                return { ok: false, error: 'stop after options capture' };
            },
            extractLastFrame: async () => ({ ok: false, error: 'not reached' }),
        });

        expect(result.status).toBe('failed');
        expect(generationOptions).toMatchObject({
            surface: 'custom-tools',
            mode: 'video',
            clearReferences: true,
        });
    });
});
