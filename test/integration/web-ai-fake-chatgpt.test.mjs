import { describe, expect, it } from 'vitest';
import { queryWebAi } from '../../web-ai/chatgpt.mjs';
import { getSession } from '../../web-ai/session.mjs';

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
        expect(result.answerArtifact.responseStableMs).toBeGreaterThanOrEqual(1500);
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
});

function createFakeChatGptPage() {
    const page = {
        composerValue: '',
        insertedText: '',
        keys: [],
        assistantTexts: ['old answer'],
        turnTexts: ['old answer'],
        clickedSend: false,
        composerResolverValidated: false,
        sendResolverValidated: false,
        copyResolverValidated: false,
        copyMarkdownSelectors: [],
        url: () => 'https://chatgpt.com/c/fake',
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
            }
        },
        evaluate: async (_fn, arg, legacySendSelectors) => {
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
    page.turnTexts.push('Pro thinking...');
}
