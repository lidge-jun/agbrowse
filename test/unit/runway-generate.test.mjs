import { describe, expect, it, vi } from 'vitest';
import {
    selectRunwayModel,
    setRunwayPrompt,
    setRunwayMode,
    setRunwayParams,
    uploadRunwayFile,
    clearRunwayReferences,
    ensureExploreMode,
    clickRunwayGenerate,
    setupRunwayGeneration,
    executeRunwayGeneration,
} from '../../skills/browser/runway-generate.mjs';

function makePage(overrides = {}) {
    return {
        url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
        title: async () => 'Runway',
        goto: async () => undefined,
        waitForLoadState: async () => undefined,
        waitForSelector: async () => ({
            click: async () => undefined,
            evaluate: async () => undefined,
            setInputFiles: async () => undefined,
        }),
        waitForTimeout: async () => undefined,
        keyboard: {
            press: async () => undefined,
            type: async () => undefined,
        },
        evaluate: async () => ({}),
        ...overrides,
    };
}

describe('selectRunwayModel', () => {
    it('returns auto when model is auto', async () => {
        const page = makePage({
            evaluate: async () => 'Seedance 2.0',
        });
        const result = await selectRunwayModel(page, 'auto');
        expect(result.selected).toBe(true);
        expect(result.model).toBe('Seedance 2.0');
    });

    it('returns auto unchanged when model is empty', async () => {
        const page = makePage({
            evaluate: async () => null,
        });
        const result = await selectRunwayModel(page, '');
        expect(result.selected).toBe(true);
    });

    it('keeps the current model when it already matches the requested model', async () => {
        const page = makePage({
            waitForSelector: async () => {
                throw new Error('dropdown should not open');
            },
            evaluate: async () => 'Seedance 2.0',
        });
        const result = await selectRunwayModel(page, 'seedance-2');
        expect(result.selected).toBe(true);
        expect(result.model).toBe('Seedance 2.0');
    });

    it('clicks dropdown and selects matching model', async () => {
        const interactions = [];
        let currentRead = true;
        const page = makePage({
            waitForSelector: async () => ({
                evaluate: async () => interactions.push('dropdown'),
            }),
            waitForTimeout: async () => undefined,
            evaluate: async (fn, arg) => {
                if (currentRead) {
                    currentRead = false;
                    return 'WAN 2.6';
                }
                if (typeof arg === 'string') return 'Seedance 2.0•Multi-modal control';
                return null;
            },
            keyboard: { press: async () => undefined },
        });
        const result = await selectRunwayModel(page, 'seedance-2');
        expect(result.selected).toBe(true);
        expect(result.model).toBe('Seedance 2.0•Multi-modal control');
        expect(interactions).toContain('dropdown');
    });

    it('returns error when model not found', async () => {
        const page = makePage({
            waitForSelector: async () => ({
                evaluate: async () => undefined,
            }),
            waitForTimeout: async () => undefined,
            evaluate: async (fn, arg) => {
                if (typeof arg === 'string') return null;
                return null;
            },
            keyboard: { press: async () => undefined },
        });
        const result = await selectRunwayModel(page, 'nonexistent-model');
        expect(result.selected).toBe(false);
        expect(result.error).toContain('not found');
    });
});

describe('setRunwayPrompt', () => {
    it('types prompt into editor', async () => {
        const typed = [];
        const page = makePage({
            waitForSelector: async () => ({
                evaluate: async () => undefined,
            }),
            waitForTimeout: async () => undefined,
            keyboard: {
                press: async (key) => typed.push(key),
                type: async (text) => typed.push(text),
            },
            evaluate: async () => true,
        });
        const result = await setRunwayPrompt(page, 'A cat in space');
        expect(result.set).toBe(true);
        expect(typed).toContain('A cat in space');
    });

    it('returns error on failure', async () => {
        const page = makePage({
            waitForSelector: async () => { throw new Error('editor not found'); },
        });
        const result = await setRunwayPrompt(page, 'test');
        expect(result.set).toBe(false);
        expect(result.error).toContain('editor not found');
    });
});

describe('setRunwayMode', () => {
    it('selects the Video radio when requested', async () => {
        let clicked = false;
        const originalDocument = globalThis.document;
        globalThis.document = {
            querySelectorAll: () => [{
                textContent: 'Video',
                getAttribute: name => name === 'aria-checked' ? 'false' : '',
                checked: false,
                click: () => { clicked = true; },
            }],
        };
        try {
            const page = makePage({
                evaluate: async (fn, arg) => fn(arg),
                waitForTimeout: async () => undefined,
            });
            const result = await setRunwayMode(page, 'video');
            expect(result.selected).toBe(true);
            expect(result.changed).toBe(true);
            expect(clicked).toBe(true);
        } finally {
            globalThis.document = originalDocument;
        }
    });

    it('skips auto mode selection', async () => {
        const result = await setRunwayMode(makePage(), 'auto');
        expect(result.selected).toBe(true);
        expect(result.skipped).toBe(true);
    });
});

describe('uploadRunwayFile', () => {
    it('sets files on an attached hidden input', async () => {
        const calls = [];
        const page = makePage({
            waitForSelector: async (selector, options) => {
                calls.push({ selector, options });
                return { setInputFiles: async file => calls.push({ file }) };
            },
            waitForTimeout: async () => undefined,
        });
        const result = await uploadRunwayFile(page, new URL(import.meta.url).pathname);
        expect(result.uploaded).toBe(true);
        expect(calls[0]).toMatchObject({
            selector: 'input[type="file"]',
            options: { state: 'attached' },
        });
    });
});

describe('clearRunwayReferences', () => {
    it('removes stale IMG references before a new setup', async () => {
        const originalDocument = globalThis.document;
        const refs = ['Remove IMG_1', 'Remove IMG_2'];
        globalThis.document = {
            querySelectorAll: () => refs.map((label, index) => ({
                textContent: label,
                getAttribute: name => name === 'aria-label' ? label : '',
                click: () => { refs.splice(index, 1); },
            })),
        };
        try {
            const page = makePage({
                evaluate: async fn => fn(),
                waitForTimeout: async () => undefined,
            });
            const result = await clearRunwayReferences(page);
            expect(result.cleared).toBe(true);
            expect(result.removed).toBe(2);
            expect(refs).toEqual([]);
        } finally {
            globalThis.document = originalDocument;
        }
    });
});

describe('setRunwayParams', () => {
    it('clicks duration button when found', async () => {
        const page = makePage({
            evaluate: async () => true,
        });
        const result = await setRunwayParams(page, { duration: 10 });
        expect(result.set).toContain('duration=10');
    });

    it('matches custom-tools duration labels written as seconds', async () => {
        let clicked = false;
        const originalDocument = globalThis.document;
        globalThis.document = {
            querySelectorAll: () => [{
                textContent: '10 seconds',
                getAttribute: () => '',
                click: () => { clicked = true; },
            }],
        };
        try {
            const page = makePage({
                evaluate: async (fn, arg) => fn(arg),
            });
            const result = await setRunwayParams(page, { duration: 10 });
            expect(clicked).toBe(true);
            expect(result.set).toContain('duration=10');
        } finally {
            globalThis.document = originalDocument;
        }
    });

    it('opens the custom-tools duration dropdown before selecting seconds', async () => {
        let opened = false;
        let selected = false;
        const originalDocument = globalThis.document;
        globalThis.document = {
            querySelectorAll: (selector) => {
                if (selector.includes('[role="option"]')) {
                    return opened
                        ? [{
                            textContent: '10 seconds',
                            getAttribute: () => '',
                            click: () => { selected = true; },
                        }]
                        : [];
                }
                return [{
                    textContent: '5s',
                    getAttribute: name => name === 'aria-label' ? 'Duration' : '',
                    click: () => { opened = true; },
                }];
            },
        };
        try {
            const page = makePage({
                evaluate: async (fn, arg) => fn(arg),
                waitForTimeout: async () => undefined,
            });
            const result = await setRunwayParams(page, { duration: 10 });
            expect(opened).toBe(true);
            expect(selected).toBe(true);
            expect(result.set).toContain('duration=10');
        } finally {
            globalThis.document = originalDocument;
        }
    });

    it('reports skipped when button not found', async () => {
        const page = makePage({
            evaluate: async () => false,
        });
        const result = await setRunwayParams(page, { duration: 10 });
        expect(result.skipped.length).toBeGreaterThan(0);
    });

    it('handles multiple params', async () => {
        const page = makePage({
            evaluate: async () => true,
        });
        const result = await setRunwayParams(page, { duration: 5, ratio: '16:9', resolution: '1080p' });
        expect(result.set).toContain('duration=5');
        expect(result.set).toContain('ratio=16:9');
        expect(result.set).toContain('resolution=1080p');
    });
});

describe('ensureExploreMode', () => {
    it('reports already in explore mode', async () => {
        const page = makePage({
            evaluate: async () => ({ mode: 'Explore', found: true, switched: false }),
            waitForTimeout: async () => undefined,
        });
        const result = await ensureExploreMode(page);
        expect(result.mode).toBe('Explore');
        expect(result.switched).toBe(false);
    });

    it('switches to explore mode', async () => {
        const page = makePage({
            evaluate: async () => ({ mode: 'Explore', found: true, switched: true }),
            waitForTimeout: async () => undefined,
        });
        const result = await ensureExploreMode(page);
        expect(result.mode).toBe('Explore');
        expect(result.switched).toBe(true);
    });

    it('reports error when toggle not found', async () => {
        const page = makePage({
            evaluate: async () => ({ mode: 'unknown', found: false }),
        });
        const result = await ensureExploreMode(page);
        expect(result.error).toContain('not found');
    });

    it('accepts current Unlimited UI as implicit Explore when no toggle is exposed', async () => {
        const page = makePage({
            evaluate: async () => ({ mode: 'Explore', found: false, switched: false, inferred: true }),
        });
        const result = await ensureExploreMode(page);
        expect(result.mode).toBe('Explore');
        expect(result.inferred).toBe(true);
        expect(result.error).toBeUndefined();
    });
});

describe('clickRunwayGenerate', () => {
    it('clicks generate button', async () => {
        const page = makePage({
            waitForSelector: async () => ({}),
            evaluate: async () => true,
            waitForTimeout: async () => undefined,
        });
        const result = await clickRunwayGenerate(page);
        expect(result.clicked).toBe(true);
    });

    it('returns error when button not found', async () => {
        const page = makePage({
            waitForSelector: async () => ({}),
            evaluate: async () => false,
            waitForTimeout: async () => undefined,
        });
        const result = await clickRunwayGenerate(page);
        expect(result.clicked).toBe(false);
    });
});

describe('setupRunwayGeneration', () => {
    it('runs full setup pipeline and returns readyToGenerate', async () => {
        const page = makePage({
            url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
            goto: async () => undefined,
            waitForLoadState: async () => undefined,
            waitForSelector: async () => ({
                evaluate: async () => undefined,
                setInputFiles: async () => undefined,
            }),
            waitForTimeout: async () => undefined,
            keyboard: {
                press: async () => undefined,
                type: async () => undefined,
            },
            evaluate: async (fn, arg) => {
                // Model select — return auto
                if (typeof arg === 'string') return null;
                // Ready check
                if (!arg) {
                    const fnStr = String(fn);
                    if (fnStr.includes('hasGenerateButton')) {
                        return { hasGenerateButton: true, generateEnabled: true };
                    }
                    // Explore mode
                    if (fnStr.includes('explore')) {
                        return { mode: 'Explore', found: true, switched: false };
                    }
                    return null;
                }
                return null;
            },
        });

        const result = await setupRunwayGeneration(page, {
            prompt: 'A cat walking through neon city',
            model: 'auto',
            explore: true,
        });

        expect(result.command).toBe('setup');
        expect(result.prompt).toBe('A cat walking through neon city');
        expect(result.modelQuery).toBe('auto');
        expect(result.steps.mode.selected).toBe(true);
        expect(result.explore).toBe(true);
        expect(result.safety.mutationAllowed).toBe(true);
        expect(result.safety.submitAllowed).toBe(false);
    });

    it('navigates when the current Runway surface differs from the requested setup surface', async () => {
        const navigated = [];
        const page = makePage({
            url: () => 'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=tools',
            goto: async (url) => navigated.push(url),
            waitForLoadState: async () => undefined,
            waitForSelector: async () => ({
                evaluate: async () => undefined,
                setInputFiles: async () => undefined,
            }),
            waitForTimeout: async () => undefined,
            keyboard: {
                press: async () => undefined,
                type: async () => undefined,
            },
            evaluate: async (fn, arg) => {
                if (typeof arg === 'string') return null;
                const fnStr = String(fn);
                if (fnStr.includes('select-base-model')) return 'Seedance 2.0';
                if (fnStr.includes('div[aria-label="Prompt"]')) return true;
                if (fnStr.includes('hasGenerateButton')) {
                    return { hasGenerateButton: true, generateEnabled: true };
                }
                return null;
            },
        });

        const result = await setupRunwayGeneration(page, {
            surface: 'apps',
            prompt: 'A catalog prompt',
        });

        expect(navigated).toEqual([
            'https://app.runwayml.com/video-tools/teams/pos090011/ai-tools/generate?mode=apps',
        ]);
        expect(result.command).toBe('setup');
    });
});

describe('runRunwayGenerateCli safety', () => {
    it('rejects setup without --allow-mutation', async () => {
        const { runRunwayGenerateCli } = await import('../../skills/browser/runway-generate.mjs');
        await expect(
            runRunwayGenerateCli('setup', ['--prompt', 'test'], {})
        ).rejects.toThrow('--allow-mutation');
    });

    it('rejects generate without --allow-submit', async () => {
        const { runRunwayGenerateCli } = await import('../../skills/browser/runway-generate.mjs');
        await expect(
            runRunwayGenerateCli('generate', ['--prompt', 'test', '--allow-mutation'], {})
        ).rejects.toThrow('--allow-submit');
    });

    it('rejects generate without --prompt', async () => {
        const { runRunwayGenerateCli } = await import('../../skills/browser/runway-generate.mjs');
        await expect(
            runRunwayGenerateCli('generate', ['--allow-submit'], {})
        ).rejects.toThrow('--prompt');
    });
});

describe('executeRunwayGeneration', () => {
    it('does not download stale assets when Runway reports queue_full', async () => {
        let evaluateCount = 0;
        const page = makePage({
            waitForSelector: async () => ({
                evaluate: async () => undefined,
                setInputFiles: async () => undefined,
            }),
            waitForTimeout: async () => undefined,
            keyboard: {
                press: async () => undefined,
                type: async () => undefined,
            },
            evaluate: async (fn, arg) => {
                evaluateCount += 1;
                const fnText = String(fn);
                if (fnText.includes('queueGateText')) {
                    return {
                        textSample: 'Please wait for your last generation to complete, or switch to Credits Mode.',
                        outputItemCount: 3,
                        outputLabels: ['https://cdn.runwayml.com/video-previews/old.mp4'],
                        activeLabels: [],
                        progressTexts: [],
                        queueGateText: 'You are on a roll / wait for last generation / Credits Mode',
                        readyText: null,
                        hasGenerateButton: true,
                        generateDisabled: false,
                    };
                }
                if (fnText.includes('outputPattern')) return 3;
                if (fnText.includes('[role="radio"]')) {
                    return { found: true, selected: true, changed: false };
                }
                if (typeof arg === 'string') return null;
                if (fnText.includes('select-base-model')) return 'Seedance 2.0';
                if (fnText.includes('div[aria-label="Prompt"]')) return true;
                if (fnText.includes('hasGenerateButton')) {
                    return { hasGenerateButton: true, generateEnabled: true };
                }
                return true;
            },
        });

        const result = await executeRunwayGeneration(page, {
            prompt: 'test',
            model: 'Seedance 2.0',
            mode: 'video',
            timeout: 10,
            interval: 1,
            sleep: async () => undefined,
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe('queue_full');
        expect(result.outputFile).toBeNull();
        expect(result.download).toBeNull();
        expect(evaluateCount).toBeGreaterThan(0);
    });
});
