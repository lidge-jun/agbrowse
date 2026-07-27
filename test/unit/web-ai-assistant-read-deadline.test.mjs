import { describe, expect, it } from 'vitest';

// Regression coverage for #88: the poll loop only re-checked its deadline at the
// `while` boundary, and `readAssistantMessages()` awaited `page.evaluate()` with
// no per-call bound. A never-resolving evaluate therefore suspended the command
// past --timeout instead of returning a recoverable poll timeout.

describe('bounded assistant DOM reads (#88)', () => {
    it('withAssistantReadTimeout resolves the sentinel instead of hanging', async () => {
        const { withAssistantReadTimeout, ASSISTANT_READ_TIMED_OUT } =
            await import('../../web-ai/chatgpt-response-dom.mjs');

        const neverResolves = new Promise(() => {});
        const started = Date.now();
        const result = await withAssistantReadTimeout(neverResolves, 50);

        expect(result).toBe(ASSISTANT_READ_TIMED_OUT);
        expect(Date.now() - started).toBeLessThan(2_000);
    });

    it('withAssistantReadTimeout returns the value when the read wins', async () => {
        const { withAssistantReadTimeout } = await import('../../web-ai/chatgpt-response-dom.mjs');
        await expect(withAssistantReadTimeout(Promise.resolve(['answer']), 5_000))
            .resolves.toEqual(['answer']);
    });

    it('withAssistantReadTimeout treats a rejected read as timed out, never throws', async () => {
        const { withAssistantReadTimeout, ASSISTANT_READ_TIMED_OUT } =
            await import('../../web-ai/chatgpt-response-dom.mjs');
        await expect(withAssistantReadTimeout(Promise.reject(new Error('detached')), 5_000))
            .resolves.toBe(ASSISTANT_READ_TIMED_OUT);
    });

    it('resolveAssistantReadBudgetMs clamps to the remaining deadline', async () => {
        const { resolveAssistantReadBudgetMs, ASSISTANT_READ_TIMEOUT_MS } =
            await import('../../web-ai/chatgpt-response-dom.mjs');

        expect(resolveAssistantReadBudgetMs(undefined)).toBe(ASSISTANT_READ_TIMEOUT_MS);
        expect(resolveAssistantReadBudgetMs(500)).toBe(500);
        expect(resolveAssistantReadBudgetMs(ASSISTANT_READ_TIMEOUT_MS + 60_000))
            .toBe(ASSISTANT_READ_TIMEOUT_MS);
        expect(resolveAssistantReadBudgetMs(0)).toBe(0);
        expect(resolveAssistantReadBudgetMs(-5)).toBe(0);
    });

    it('pollWebAi returns a recoverable timeout when every assistant read stalls', async () => {
        const { pollWebAi } = await import('../../web-ai/chatgpt.mjs');
        const { createSession } = await import('../../web-ai/session.mjs');

        const session = createSession(
            { vendor: 'chatgpt', prompt: 'huge conversation', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-stalled-dom',
                conversationUrl: 'https://chatgpt.com/c/stalled',
                deadlineAt: new Date(Date.now() + 60_000).toISOString(),
                envelopeSummary: { assistantCount: 3 },
            },
        );

        let evaluateCalls = 0;
        const page = {
            url: () => 'https://chatgpt.com/c/stalled',
            // Simulates the reported failure: assistant-message extraction never
            // returns because the conversation is too large to serialize.
            evaluate: async () => {
                evaluateCalls += 1;
                return new Promise(() => {});
            },
            waitForTimeout: async (ms) => new Promise(resolve => setTimeout(resolve, Math.min(Number(ms) || 0, 20))),
            locator: () => ({
                first: () => ({ isVisible: async () => false }),
                all: async () => [],
            }),
            innerText: async () => '',
        };

        const started = Date.now();
        const result = await pollWebAi({
            getPage: async () => page,
            getTargetId: async () => 'target-stalled-dom',
        }, {
            vendor: 'chatgpt',
            session: session.sessionId,
            timeout: 2,
        });
        const elapsedMs = Date.now() - started;

        expect(result).toMatchObject({
            ok: false,
            vendor: 'chatgpt',
            status: 'timeout',
            sessionId: session.sessionId,
            recoverable: true,
            retryHint: 'poll-or-resume',
        });
        // The command must honor its own deadline rather than parking forever.
        expect(elapsedMs).toBeLessThan(30_000);
        expect(evaluateCalls).toBeGreaterThan(0);
        // A stalled read is reported distinctly from "provider still generating".
        expect(result.warnings.some(w => String(w).startsWith('assistant-dom-read-timeout:'))).toBe(true);
    }, 40_000);
});

describe('post-baseline assistant extraction (#88)', () => {
    it('serializes only turns at/after the baseline index', async () => {
        const { readAssistantTextsAfterIndex } = await import('../../web-ai/chatgpt-response-dom.mjs');

        const serialized = [];
        const makeNode = (label) => ({
            get innerText() {
                serialized.push(label);
                return label;
            },
            textContent: label,
            contains: () => false,
        });
        const nodes = ['old-1', 'old-2', 'old-3', 'new-1'].map(makeNode);
        const selectors = ['[data-message-author-role="assistant"]'];

        const previous = globalThis.document;
        globalThis.document = {
            querySelectorAll: (selector) => (selector === selectors[0] ? nodes : []),
        };
        try {
            const result = readAssistantTextsAfterIndex({ selectors, minIndex: 3 });
            expect(result.total).toBe(4);
            expect(result.texts).toEqual(['new-1']);
            // Historical turns must not be re-serialized on every tick.
            expect(serialized).toEqual(['new-1']);
        } finally {
            if (previous === undefined) delete globalThis.document;
            else globalThis.document = previous;
        }
    });

    it('reports the full turn count so baseline math stays correct', async () => {
        const { readAssistantTextsAfterIndex } = await import('../../web-ai/chatgpt-response-dom.mjs');
        const selectors = ['[data-message-author-role="assistant"]'];
        const nodes = ['a', 'b'].map(text => ({ innerText: text, textContent: text, contains: () => false }));

        const previous = globalThis.document;
        globalThis.document = {
            querySelectorAll: (selector) => (selector === selectors[0] ? nodes : []),
        };
        try {
            expect(readAssistantTextsAfterIndex({ selectors, minIndex: 0 }))
                .toEqual({ total: 2, texts: ['a', 'b'] });
        } finally {
            if (previous === undefined) delete globalThis.document;
            else globalThis.document = previous;
        }
    });
});
