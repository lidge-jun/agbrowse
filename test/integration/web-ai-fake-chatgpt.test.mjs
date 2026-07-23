import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pollWebAi, queryWebAi } from '../../web-ai/chatgpt.mjs';
import { getSession, saveBaseline } from '../../web-ai/session.mjs';

describe('web-ai fake ChatGPT fixture', () => {
    it('fills composer, stores baseline, filters placeholder, and returns final answer', async () => {
        const page = createFakeChatGptPage();
        const result = await queryWebAi({
            getPage: async () => page,
            getCdpSession: async () => ({
                send: async (method, payload) => {
                    if (method === 'Input.insertText') {
                        page.insertedText = payload.text;
                        page.composerValue = payload.text;
                    }
                },
                detach: async () => undefined,
            }),
        }, {
            vendor: 'chatgpt',
            prompt: 'Reply exactly: OK',
            project: 'cli-jaw',
            goal: 'fixture test',
            output: 'one line',
            constraints: 'inline only',
            timeout: 2,
            allowCopyMarkdownFallback: true,
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe('complete');
        expect(result.answerText).toBe('OK');
        expect(result.answerArtifact).toMatchObject({
            provider: 'chatgpt',
            conversationUrl: 'https://chatgpt.com/c/fake',
            capturedBy: 'copy-button',
            text: 'OK',
            markdown: 'OK',
            exactnessScore: 1,
        });
        expect(result.answerArtifact.responseStableMs).toBeGreaterThanOrEqual(1000);
        expect(result.baseline.assistantCount).toBe(1);
        expect(result.usedFallbacks).toContain('copy-markdown');
        expect(result.baseline.promptHash).toMatch(/^[a-f0-9]{64}$/);
        expect(page.insertedText).toContain('## Question\nReply exactly: OK');
        expect(page.composerResolverValidated).toBe(true);
        expect(page.sendResolverValidated).toBe(true);
        expect(page.copyResolverValidated).toBe(true);
        expect(page.copyMarkdownSelectors[0]).toBe('button[data-testid="copy-turn-action-button"]');
        expect(page.clickedSend).toBe(true);
        expect(page.keys).not.toContain('Enter');
        const session = getSession(result.sessionId);
        const resolverSteps = session.trace.filter(step => step.action === 'target-resolve');
        expect(resolverSteps.map(step => step.intentId)).toEqual(expect.arrayContaining(['composer.fill', 'send.click', 'copy.lastResponse']));
        expect(resolverSteps.every(step => step.status === 'ok')).toBe(true);
        expect(JSON.stringify(resolverSteps)).not.toContain('Reply exactly: OK');
        expect(result.traceSummary).toMatchObject({
            sessionId: result.sessionId,
            totalSteps: 3,
        });
    });

    it('accepts turn-only identity with scoped controls', async () => {
        const page = createFakeChatGptPage({ identity: 'turn' });
        const result = await runFakeQuery(page);
        expect(result.status).toBe('complete');
    });

    it('accepts message-only identity with scoped controls', async () => {
        const page = createFakeChatGptPage({ identity: 'message' });
        const result = await runFakeQuery(page);
        expect(result.status).toBe('complete');
    });

    it('accepts identity-less completion only at or after the assistant baseline', async () => {
        const page = createFakeChatGptPage({ identity: 'none' });
        const result = await runFakeQuery(page);
        expect(result.status).toBe('complete');
        expect(result.baseline.assistantCount).toBe(1);
    });

    it('requires both identities when both are sampled', async () => {
        const page = createFakeChatGptPage({ mismatchMessageId: true });
        const result = await runFakeQuery(page, { timeout: 1 });
        expect(result.status).not.toBe('complete');
        expect(result.warnings).toContain('recovery-deferred-unverified');
    });

    it('returns deferred unverified when completion evaluation fails in a session', async () => {
        const page = createFakeChatGptPage({ failCompletionEvaluate: true });
        const result = await runFakeQuery(page, { timeout: 1 });
        expect(result.status).toBe('polling');
        expect(result.warnings).toContain('recovery-deferred-unverified');
    });

    it('returns recoverable provider poll-timeout without a session when selectors drift', async () => {
        const page = createFakeChatGptPage({ url: 'https://chatgpt.com/c/non-session-drift', failSnapshotEvaluate: true });
        saveBaseline({
            vendor: 'chatgpt', url: page.url(), envelope: {}, assistantCount: 1, textHash: 'fake',
        });
        const result = await pollWebAi({ getPage: async () => page }, { vendor: 'chatgpt', timeout: 1 });
        expect(result).toMatchObject({
            status: 'timeout', recoverable: true, error: 'timed out waiting for answer',
        });
    });

    it('returns deferred streaming recovery for the sampled response', async () => {
        const page = createFakeChatGptPage({ streaming: true });
        const result = await runFakeQuery(page, { timeout: 1 });
        expect(result.status).toBe('polling');
        expect(result.warnings).toContain('recovery-deferred-streaming');
    });

    it('does not complete copy-markdown timeout fallback without correlated controls', async () => {
        const page = createFakeChatGptPage({ finishResponse: false });
        const result = await runFakeQuery(page, { timeout: 1, allowCopyMarkdownFallback: true });
        expect(result.status).toBe('polling');
        expect(result.warnings).toContain('recovery-deferred-unverified');
    });

    it('completes an image-only response before the tightened text gate', async () => {
        const outputImage = '/tmp/agbrowse-fake-generated-image.png';
        rmSync(outputImage, { force: true });
        const page = createFakeChatGptPage({ imageOnly: true });
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
        });
        try {
            const result = await runFakeQuery(page, { outputImage }, {
                send: async (method, payload) => {
                    if (method === 'Input.insertText') {
                        page.insertedText = payload.text;
                        page.composerValue = payload.text;
                        return {};
                    }
                    return method === 'Runtime.evaluate'
                    ? { result: { value: [{
                        url: 'https://chatgpt.com/backend-api/estuary/content?id=file_fake',
                        fileId: 'file_fake', alt: 'Generated image', width: 512, height: 512,
                    }] } }
                    : method === 'Network.getCookies' ? { cookies: [] } : {};
                },
                detach: async () => undefined,
            });
            expect(result).toMatchObject({ status: 'complete', answerText: expect.stringContaining('Generated image.') });
            expect(result.usedFallbacks).toContain('generated-image');
        } finally {
            globalThis.fetch = previousFetch;
            rmSync(outputImage, { force: true });
        }
    });
});

function createFakeChatGptPage(options = {}) {
    const page = {
        composerValue: '',
        insertedText: '',
        keys: [],
        assistantTexts: ['old answer'],
        assistantTurns: [{ text: 'old answer', messageId: 'm0', turnId: 'conversation-turn-0', finished: true }],
        options,
        turnTexts: ['old answer'],
        clickedSend: false,
        composerResolverValidated: false,
        sendResolverValidated: false,
        copyResolverValidated: false,
        copyMarkdownSelectors: [],
        url: () => options.url || 'https://chatgpt.com/c/fake',
        keyboard: {
            insertText: async text => {
                page.insertedText = text;
                page.composerValue = text;
            },
            press: async key => {
                page.keys.push(key);
                if (key === 'Enter') commitPrompt(page);
            },
        },
        innerText: async selector => selector === 'body' ? page.assistantTexts.join('\n') : '',
        waitForTimeout: async () => {
            if (page.assistantTexts.at(-1) === 'Pro thinking...') {
                page.assistantTexts[page.assistantTexts.length - 1] = 'OK';
                const text = options.imageOnly ? 'Edit' : 'OK';
                page.assistantTexts[page.assistantTexts.length - 1] = text;
                Object.assign(page.assistantTurns.at(-1), { text, finished: options.finishResponse !== false });
            }
        },
        evaluate: async (_fn, arg, legacySendSelectors) => {
            if (_fn?.name === 'readTopLevelAssistantSnapshots') {
                if (options.failSnapshotEvaluate) throw new Error('snapshot evaluate failed');
                return page.assistantTurns.map((turn, turnIndex) => ({ ...turn, turnIndex }));
            }
            if (_fn?.name === 'readChatGptStreamingState') return options.streaming === true;
            if (String(_fn).includes('finishedSelector') && arg?.sample) {
                if (options.failCompletionEvaluate) throw new Error('evaluate failed');
                const turnIndex = page.assistantTurns.findLastIndex(turn =>
                    (!arg.sample.messageId || turn.messageId === arg.sample.messageId)
                    && (!arg.sample.turnId || turn.turnId === arg.sample.turnId));
                const turn = page.assistantTurns[turnIndex];
                return {
                    finished: options.mismatchMessageId ? false : Boolean(turn?.finished),
                    messageId: options.mismatchMessageId ? 'different-message' : turn?.messageId || null,
                    turnId: turn?.turnId || null,
                    turnIndex,
                };
            }
            if (typeof arg === 'string' && arg.includes('copy-turn-action-button')) {
                const lastAnswer = page.assistantTexts.at(-1) || '';
                return lastAnswer && lastAnswer !== 'Pro thinking...';
            }
            if (arg?.selectorSet?.copyButtonSelectors) {
                page.copyMarkdownSelectors = arg.selectorSet.copyButtonSelectors;
                return { ok: true, text: 'OK' };
            }
            const sendSelectors = Array.isArray(legacySendSelectors) ? legacySendSelectors : arg?.sendSelectors;
            if (!Array.isArray(sendSelectors)) return null;
            commitPrompt(page);
            return 'clicked';
        },
        locator: selector => createFakeLocator(page, selector),
    };
    return page;
}

function createFakeLocator(page, selector) {
    const isComposer = selector.includes('prompt-textarea') || selector.includes('composer-textarea') || selector.includes('ProseMirror') || selector.includes('contenteditable');
    const isSendButton = selector.includes('send-button') || selector.includes('composer-send') || selector.includes('button[type="submit"]') || selector.includes('aria-label*="Send"');
    const isCopyButton = selector.includes('copy-turn-action-button') || selector.includes('aria-label*="Copy"');
    const isTurn = selector.includes('conversation-turn') || selector.includes('data-message-author-role') || selector.includes('data-turn');
    const isAssistant = selector.includes('assistant');
    return {
        first: () => createFakeLocator(page, selector),
        evaluateAll: async () => false,
        count: async () => {
            if (isComposer || isSendButton) return 1;
            if (isCopyButton) return 1;
            if (isAssistant) return page.assistantTexts.length;
            if (isTurn) return page.turnTexts.length;
            return 0;
        },
        waitFor: async () => undefined,
        isVisible: async () => isComposer || isSendButton || isCopyButton,
        isEnabled: async () => true,
        isEditable: async () => isComposer,
        fill: async value => { page.composerValue = value; },
        click: async () => {
            if (isSendButton) commitPrompt(page);
        },
        evaluate: async fn => {
            if (isComposer && typeof fn === 'function') {
                page.composerResolverValidated = true;
                return { role: 'textbox', label: 'Message ChatGPT', tagName: 'textarea', isEditable: true };
            }
            if (isSendButton && typeof fn === 'function') {
                page.sendResolverValidated = true;
                return { role: 'button', label: 'Send message', tagName: 'button', isEditable: false };
            }
            if (isCopyButton && typeof fn === 'function') {
                page.copyResolverValidated = true;
                return { role: 'button', label: 'Copy', tagName: 'button', isEditable: false };
            }
            if (isSendButton) return false;
            if (isComposer && page.composerValue) return undefined;
            if (typeof fn === 'function') return undefined;
            return undefined;
        },
        inputValue: async () => page.composerValue,
        innerText: async () => isComposer ? page.composerValue : '',
        all: async () => {
            if (isAssistant) return page.assistantTexts.map(text => ({ innerText: async () => text }));
            if (isTurn) return page.turnTexts.map(text => ({ innerText: async () => text }));
            return [];
        },
    };
}

function commitPrompt(page) {
    page.clickedSend = true;
    page.turnTexts.push(page.composerValue);
    page.composerValue = '';
    page.assistantTexts.push('Pro thinking...');
    page.assistantTurns.push({
        text: 'Pro thinking...',
        messageId: ['turn', 'none'].includes(page.options.identity) ? null : `m${page.assistantTurns.length}`,
        turnId: ['message', 'none'].includes(page.options.identity) ? null : `conversation-turn-${page.assistantTurns.length}`,
        finished: false,
    });
    page.turnTexts.push('Pro thinking...');
}

async function runFakeQuery(page, input = {}, cdpOverride = null) {
    return queryWebAi({
        getPage: async () => page,
        getCdpSession: async () => cdpOverride || ({
            send: async (method, payload) => {
                if (method === 'Input.insertText') {
                    page.insertedText = payload.text;
                    page.composerValue = payload.text;
                }
                return {};
            },
            detach: async () => undefined,
        }),
    }, {
        vendor: 'chatgpt', prompt: 'Reply exactly: OK', project: 'fixture', goal: 'test',
        output: 'one line', constraints: 'inline only', timeout: 2,
        ...input,
    });
}
