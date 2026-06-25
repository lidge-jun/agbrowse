import { describe, expect, it } from 'vitest';
import {
    buildResponseObserverExpression,
    observeAssistantResponse,
    recoverAssistantResponse,
} from '../../web-ai/chatgpt-response-observer.mjs';
import { CHATGPT_ASSISTANT_SELECTORS } from '../../web-ai/chatgpt-response-dom.mjs';

describe('buildResponseObserverExpression', () => {
    it('embeds clamped baseline / quiet / timeout literals', () => {
        const expr = buildResponseObserverExpression({ baselineAssistantCount: 2, quietMs: 800, timeoutMs: 5_000 });
        expect(expr).toContain('const MIN = 2;');
        expect(expr).toContain('const QUIET = 800;');
        expect(expr).toContain('const HARD = 5000;');
    });

    it('clamps invalid inputs to safe minimums', () => {
        const expr = buildResponseObserverExpression({ baselineAssistantCount: -3, quietMs: 1, timeoutMs: 1 });
        expect(expr).toContain('const MIN = 0;');
        expect(expr).toContain('const QUIET = 200;');
        expect(expr).toContain('const HARD = 1000;');
    });

    it('installs a MutationObserver and resolves null on timeout (never rejects)', () => {
        const expr = buildResponseObserverExpression();
        expect(expr).toContain('new MutationObserver');
        expect(expr).toContain('setTimeout(() => finish(null), HARD)');
        expect(expr).toContain('new Promise((resolve)');
    });
});

describe('observeAssistantResponse', () => {
    it('returns the in-page settle result', async () => {
        const page = { evaluate: async () => ({ settled: true }) };
        expect(await observeAssistantResponse(page, { timeoutMs: 1_000 })).toEqual({ settled: true });
    });

    it('returns null when already aborted (no evaluate)', async () => {
        let evaluated = false;
        const page = { evaluate: async () => { evaluated = true; return { settled: true }; } };
        const ac = new AbortController();
        ac.abort();
        expect(await observeAssistantResponse(page, { signal: ac.signal })).toBeNull();
        expect(evaluated).toBe(false);
    });

    it('returns null when the page evaluate throws', async () => {
        const page = { evaluate: async () => { throw new Error('detached'); } };
        expect(await observeAssistantResponse(page)).toBeNull();
    });
});

describe('recoverAssistantResponse', () => {
    const pageWith = (texts) => ({ evaluate: async () => texts });

    it('returns the latest assistant turn when it passes isFinalAnswer', async () => {
        const r = await recoverAssistantResponse(pageWith(['old', 'the real final answer']), {
            isFinalAnswer: (t) => !/^answer now$/i.test(t),
            stabilityWindowMs: 0,
        });
        expect(r).toEqual({
            from: 'recovery',
            text: 'the real final answer',
            recovered: true,
            streaming: false,
            finished: false,
            responseStableMs: 0,
        });
    });

    it('rejects a placeholder latest turn', async () => {
        const r = await recoverAssistantResponse(pageWith(['Answer now']), {
            isFinalAnswer: (t) => !/^answer now$/i.test(t),
            stabilityWindowMs: 0,
        });
        expect(r).toBeNull();
    });

    it('returns null when there are no assistant turns', async () => {
        expect(await recoverAssistantResponse(pageWith([]))).toBeNull();
    });

    it('returns the latest turn when no predicate is supplied', async () => {
        const r = await recoverAssistantResponse(pageWith(['x', 'y']), { stabilityWindowMs: 0 });
        expect(r?.text).toBe('y');
    });

    it('returns null when the page evaluate throws', async () => {
        const r = await recoverAssistantResponse({ evaluate: async () => { throw new Error('boom'); } });
        expect(r).toBeNull();
    });

    it('returns non-terminal streaming metadata when stop button is visible', async () => {
        const r = await recoverAssistantResponse(pageWith(['partial answer']), {
            readStreaming: async () => true,
            readFinished: async () => true,
            stabilityWindowMs: 0,
        });
        expect(r).toMatchObject({
            text: 'partial answer',
            streaming: true,
            finished: false,
            responseStableMs: 0,
        });
    });

    it('marks finished recovery with non-zero finality evidence', async () => {
        const r = await recoverAssistantResponse(pageWith(['final answer']), {
            readStreaming: async () => false,
            readFinished: async () => true,
            stabilityWindowMs: 0,
        });
        expect(r).toMatchObject({
            text: 'final answer',
            streaming: false,
            finished: true,
            responseStableMs: 1,
        });
    });

    it('prefers top-level assistant text over nested child fragments', async () => {
        const parent = fakeNode('Full assistant answer\nFragment');
        const child = fakeNode('Fragment');
        parent.children.add(child);
        const r = await recoverAssistantResponse(pageWithDocument({ [CHATGPT_ASSISTANT_SELECTORS[0]]: [parent, child] }), {
            stabilityWindowMs: 0,
        });
        expect(r?.text).toBe('Full assistant answer\nFragment');
    });
});

function fakeNode(text) {
    return {
        innerText: text,
        textContent: text,
        children: new Set(),
        contains(other) {
            if (this.children.has(other)) return true;
            return Array.from(this.children).some(child => child.contains?.(other));
        },
    };
}

function pageWithDocument(nodesBySelector) {
    return {
        evaluate: async (fn, selectors) => {
            const previous = globalThis.document;
            globalThis.document = {
                querySelectorAll: (selector) => nodesBySelector[selector] || [],
            };
            try {
                return fn(selectors);
            } finally {
                if (previous === undefined) delete globalThis.document;
                else globalThis.document = previous;
            }
        },
    };
}
