import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression coverage for #87: `--family` was documented by help, README, the
// bundled skill, and the MCP schema, but never reached ChatGPT model selection.
// These tests assert the wiring at the module boundary rather than grepping
// source text, so a refactor that drops the argument fails here.

// Mutable holder the hoisted mock reads from (vi.mock factories cannot close
// over per-test locals directly).
const captured = { selectCalls: [], probeCalls: [] };

vi.mock('../../web-ai/chatgpt-model.mjs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        selectChatGptModel: async (_page, model, options = {}) => {
            captured.selectCalls.push({ model, options });
            return {
                requested: model || null,
                selected: 'thinking',
                alreadySelected: true,
                effort: options.effort || null,
                requestedEffort: options.effort || null,
                usedFallbacks: [],
                warnings: [],
                modelSelection: {
                    requestedModel: model || null,
                    resolvedLabel: 'High',
                    surface: 'chat',
                    familyLabel: options.family ? 'GPT-5.6 Sol' : null,
                    tierLabel: 'High',
                    normalizedModel: 'thinking',
                    strategy: 'select',
                    status: 'already-selected',
                    verified: true,
                },
            };
        },
        chatGptModelCapabilityProbe: async (_page, model, options = {}) => {
            captured.probeCalls.push({ model, options });
            return { state: 'ok', evidence: {}, next: 'send' };
        },
    };
});

describe('web-ai ChatGPT --family wiring (#87)', () => {
    beforeEach(() => {
        captured.selectCalls = [];
        captured.probeCalls = [];
    });

    it('carries input.family into selectChatGptModel from the send path', async () => {
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        await sendWebAi(createDeps(createFakeChatGptPage()), {
            vendor: 'chatgpt',
            prompt: 'family wiring check',
            family: 'gpt-5.6-sol',
            model: 'thinking',
            reasoningEffort: 'high',
            inlineOnly: true,
            timeout: 1,
        }).catch(() => undefined);

        expect(captured.selectCalls.length).toBeGreaterThan(0);
        expect(captured.selectCalls[0].options.family).toBe('gpt-5.6-sol');
        expect(captured.selectCalls[0].options.effort).toBe('high');
        expect(captured.selectCalls[0].model).toBe('thinking');
    });

    it('preserves the zero-mutation contract when family is omitted', async () => {
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        await sendWebAi(createDeps(createFakeChatGptPage()), {
            vendor: 'chatgpt',
            prompt: 'no family',
            model: 'thinking',
            reasoningEffort: 'high',
            inlineOnly: true,
            timeout: 1,
        }).catch(() => undefined);

        expect(captured.selectCalls.length).toBeGreaterThan(0);
        expect(captured.selectCalls[0].options.family).toBeUndefined();
    });

    it('forwards family into the model capability probe', async () => {
        const { statusWebAi } = await import('../../web-ai/chatgpt.mjs');
        await statusWebAi(createDeps(createFakeChatGptPage()), {
            vendor: 'chatgpt',
            family: 'gpt-5.6-sol',
            model: 'thinking',
            reasoningEffort: 'high',
        }).catch(() => undefined);

        const familyProbe = captured.probeCalls.find(call => call.options.family);
        expect(familyProbe?.options.family).toBe('gpt-5.6-sol');
    });
});

describe('ChatGPT family validation fails closed (#87)', () => {
    it('probe reports fail for an unsupported family instead of a clean pass', async () => {
        const actual = await vi.importActual('../../web-ai/chatgpt-model.mjs');
        const result = await actual.chatGptModelCapabilityProbe(untouchablePage(), 'thinking', {
            family: 'gpt-5.6-luna',
        });
        expect(result.state).toBe('fail');
        expect(result.next).toBe('model-fallback');
        expect(result.evidence.family).toBe('gpt-5.6-luna');
    });

    it('selectChatGptModel rejects an unsupported family before touching the page', async () => {
        const actual = await vi.importActual('../../web-ai/chatgpt-model.mjs');
        await expect(actual.selectChatGptModel(untouchablePage(), 'thinking', { family: 'gpt-5.6-luna' }))
            .rejects.toMatchObject({ errorCode: 'provider.model-mismatch' });
    });
});

function untouchablePage() {
    return new Proxy({}, {
        get() {
            throw new Error('page must not be touched for an invalid family');
        },
    });
}

/** Minimal deps stub covering only what the send path touches around selection. */
function createDeps(page) {
    return {
        getPage: async () => page,
        getTargetId: async () => 'target-family',
        getPort: () => 9222,
        getCdpSession: async () => ({
            send: async () => undefined,
            detach: async () => undefined,
        }),
    };
}

function createFakeChatGptPage() {
    const locatorStub = () => ({
        first: () => locatorStub(),
        last: () => locatorStub(),
        all: async () => [],
        filter: () => locatorStub(),
        locator: () => locatorStub(),
        isVisible: async () => false,
        innerText: async () => '',
        click: async () => undefined,
        boundingBox: async () => null,
        count: async () => 0,
    });
    return {
        url: () => 'https://chatgpt.com/c/family-wiring',
        locator: locatorStub,
        evaluate: async () => [],
        innerText: async () => '',
        waitForTimeout: async () => undefined,
        keyboard: { insertText: async () => undefined, press: async () => undefined },
        mouse: { move: async () => undefined },
        goto: async () => undefined,
    };
}
