// @ts-check
// gapclose Phase 20: golden scenario hardening (ask -> poll -> audit -> artifact)
// plus explicit failure-mode contracts F1-F4. Fixture-level: no live browser.
// Fake page fixture is duplicated locally per repo convention (see
// web-ai-fake-chatgpt.test.mjs, web-ai-composer.test.mjs).

import { describe, expect, it } from 'vitest';
import { queryWebAi, pollWebAi } from '../../web-ai/chatgpt.mjs';
import { applyRequiredSourceAudit } from '../../web-ai/cli.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';

const SOURCED_ANSWER = 'agbrowse ships a search command [Source](https://github.com/lidge-jun/agbrowse).';
const UNSOURCED_ANSWER = 'agbrowse ships a search command and it is quite fast.';

function makeDeps(page) {
    return {
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
    };
}

describe.sequential('web-ai golden scenario (ask -> poll -> audit -> artifact)', () => {
    it('runs the full golden path on the fake provider and audits sources', async () => {
        const page = createFakeChatGptPage({ finalAnswer: SOURCED_ANSWER });
        // 1. ask + 2. poll (queryWebAi = send + poll in one call)
        const result = await queryWebAi(makeDeps(page), {
            vendor: 'chatgpt',
            prompt: 'What does agbrowse ship?',
            project: 'gapclose',
            goal: 'golden scenario',
            output: 'one line with inline source',
            constraints: 'inline only',
            timeout: 2,
            allowCopyMarkdownFallback: true,
        });
        expect(result.ok).toBe(true);
        expect(result.status).toBe('complete');
        expect(result.answerText).toBe(SOURCED_ANSWER);

        // 3. audit — the same fail-closed gate the CLI applies for
        // --require-source-audit, in the completed-answer context.
        const audited = applyRequiredSourceAudit('query', result, { requireSourceAudit: true });
        expect(audited.sourceAudit.ok).toBe(true);
        expect(audited.sourceAudit.unsourcedClaims).toHaveLength(0);

        // 4. artifact — contract fields consumed by downstream agents.
        expect(result.answerArtifact).toMatchObject({
            provider: 'chatgpt',
            conversationUrl: 'https://chatgpt.com/c/fake',
            text: SOURCED_ANSWER,
            exactnessScore: 1,
        });
        expect(result.answerArtifact.responseStableMs).toBeGreaterThanOrEqual(1000);
        expect(result.baseline.promptHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.traceSummary.sessionId).toBe(result.sessionId);
    });

    it('F1: composer not visible fails typed (provider.composer-not-visible, composer-prereq)', async () => {
        const page = createFakeChatGptPage({ composerVisible: false });
        let caught = null;
        try {
            await queryWebAi(makeDeps(page), {
                vendor: 'chatgpt',
                prompt: 'should never send',
                timeout: 1,
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(WebAiError);
        expect(caught.errorCode).toBe('provider.composer-not-visible');
        expect(caught.stage).toBe('composer-prereq');
        // The failure must never look like a silent no-op send.
        expect(page.clickedSend).toBe(false);
    });

    it('F2: poll against an unknown conversation fails explicit (no silent success)', async () => {
        // The golden test above leaves a baseline in the store, so polling a
        // conversation that baseline never saw must surface the mismatch
        // explicitly (conversation-mismatch envelope), never a fake answer.
        const page = createFakeChatGptPage({});
        page.url = () => 'https://chatgpt.com/c/never-seen-conversation';
        const result = await pollWebAi({
            getPage: async () => page,
            getTargetId: async () => 'no-such-target',
        }, {
            vendor: 'chatgpt',
            timeout: 1,
        });
        expect(result.ok).toBe(false);
        expect(result.status).toBe('conversation-mismatch');
        expect(result.warnings.join(' ')).toContain('conversation changed');
        expect(result.answerText ?? '').toBe('');
    });

    it('F3: source audit fails closed on completed answers without inline sources', async () => {
        const page = createFakeChatGptPage({ finalAnswer: UNSOURCED_ANSWER });
        const result = await queryWebAi(makeDeps(page), {
            vendor: 'chatgpt',
            prompt: 'What does agbrowse ship?',
            timeout: 2,
            allowCopyMarkdownFallback: true,
        });
        expect(result.ok).toBe(true); // provider completed...
        let caught = null;
        try {
            applyRequiredSourceAudit('query', result, { requireSourceAudit: true });
        } catch (error) {
            caught = error;
        }
        // ...but the audit gate refuses to pass it through silently.
        expect(caught).toBeInstanceOf(WebAiError);
        expect(caught.errorCode).toBe('source-audit.failed');
        expect(caught.stage).toBe('source-audit');
        expect(caught.evidence.gaps.map(g => g.code)).toContain('unsourced-claims');
    });

    it('F4: never-stabilizing answer times out as an explicit recoverable envelope', async () => {
        // Answer stays in "thinking" state forever: waitForTimeout never resolves it.
        const page = createFakeChatGptPage({ neverStabilize: true });
        const result = await queryWebAi(makeDeps(page), {
            vendor: 'chatgpt',
            prompt: 'this will never finish',
            timeout: 2,
        });
        // No-recovery timeout branch contract (chatgpt.mjs:645-683).
        expect(result.ok).toBe(false);
        expect(result.status).toBe('timeout');
        expect(result.recoverable).toBe(true);
        expect(result.retryHint).toBe('poll-or-resume');
        // Silent success is forbidden: no complete status, no exactness-1 artifact.
        expect(result.status).not.toBe('complete');
    });
});

// ─── local fake provider fixture (duplicated per repo convention) ───────────

/**
 * @param {{ finalAnswer?: string, composerVisible?: boolean, neverStabilize?: boolean }} [opts]
 */
function createFakeChatGptPage(opts = {}) {
    const finalAnswer = opts.finalAnswer ?? 'OK';
    const composerVisible = opts.composerVisible !== false;
    const neverStabilize = opts.neverStabilize === true;
    const page = {
        composerValue: '',
        insertedText: '',
        keys: [],
        assistantTexts: ['old answer'],
        assistantTurns: [{
            text: 'old answer',
            messageId: 'm0',
            turnId: 'conversation-turn-0',
            finished: true,
        }],
        turnTexts: ['old answer'],
        clickedSend: false,
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
            if (!neverStabilize && page.assistantTexts.at(-1) === 'Pro thinking...') {
                page.assistantTexts[page.assistantTexts.length - 1] = finalAnswer;
                Object.assign(page.assistantTurns.at(-1), { text: finalAnswer, finished: true });
            }
        },
        evaluate: async (_fn, arg, legacySendSelectors) => {
            if (_fn?.name === 'readTopLevelAssistantSnapshots') {
                return page.assistantTurns.map((turn, turnIndex) => ({ ...turn, turnIndex }));
            }
            if (_fn?.name === 'readChatGptStreamingState') return false;
            // Model the ordering gate explicitly; a fall-through `null` would be
            // normalized to `unknown` and (correctly) veto completion.
            if (_fn?.name === 'readAssistantTurnOrderingInPage') return 'ordered';
            if (String(_fn).includes('finishedSelector') && arg?.sample) {
                const turnIndex = page.assistantTurns.findLastIndex(turn =>
                    (!arg.sample.messageId || turn.messageId === arg.sample.messageId)
                    && (!arg.sample.turnId || turn.turnId === arg.sample.turnId));
                const turn = page.assistantTurns[turnIndex];
                return {
                    finished: Boolean(turn?.finished),
                    messageId: turn?.messageId || null,
                    turnId: turn?.turnId || null,
                    turnIndex,
                };
            }
            if (typeof arg === 'string' && arg.includes('copy-turn-action-button')) {
                const lastAnswer = page.assistantTexts.at(-1) || '';
                return Boolean(lastAnswer) && lastAnswer !== 'Pro thinking...';
            }
            if (arg?.selectorSet?.copyButtonSelectors) {
                page.copyMarkdownSelectors = arg.selectorSet.copyButtonSelectors;
                const lastAnswer = page.assistantTexts.at(-1) || '';
                if (lastAnswer === 'Pro thinking...') return { ok: false };
                return { ok: true, text: lastAnswer };
            }
            const sendSelectors = Array.isArray(legacySendSelectors) ? legacySendSelectors : arg?.sendSelectors;
            if (!Array.isArray(sendSelectors)) return null;
            commitPrompt(page);
            return 'clicked';
        },
        locator: selector => createFakeLocator(page, selector, { composerVisible }),
    };
    return page;
}

function createFakeLocator(page, selector, opts) {
    const isComposer = selector.includes('prompt-textarea') || selector.includes('composer-textarea') || selector.includes('ProseMirror') || selector.includes('contenteditable');
    const isSendButton = selector.includes('send-button') || selector.includes('composer-send') || selector.includes('button[type="submit"]') || selector.includes('aria-label*="Send"');
    const isCopyButton = selector.includes('copy-turn-action-button') || selector.includes('aria-label*="Copy"');
    const isTurn = selector.includes('conversation-turn') || selector.includes('data-message-author-role') || selector.includes('data-turn');
    const isAssistant = selector.includes('assistant');
    return {
        first: () => createFakeLocator(page, selector, opts),
        count: async () => {
            if (isComposer) return opts.composerVisible ? 1 : 0;
            if (isSendButton) return 1;
            if (isCopyButton) return 1;
            if (isAssistant) return page.assistantTexts.length;
            if (isTurn) return page.turnTexts.length;
            return 0;
        },
        waitFor: async () => undefined,
        isVisible: async () => {
            if (isComposer) return opts.composerVisible;
            return isSendButton || isCopyButton;
        },
        isEnabled: async () => true,
        isEditable: async () => isComposer && opts.composerVisible,
        fill: async value => { page.composerValue = value; },
        click: async () => {
            if (isSendButton) commitPrompt(page);
        },
        evaluate: async fn => {
            if (isComposer && typeof fn === 'function') {
                if (!opts.composerVisible) return null;
                return { role: 'textbox', label: 'Message ChatGPT', tagName: 'textarea', isEditable: true };
            }
            if (isSendButton && typeof fn === 'function') {
                return { role: 'button', label: 'Send message', tagName: 'button', isEditable: false };
            }
            if (isCopyButton && typeof fn === 'function') {
                return { role: 'button', label: 'Copy', tagName: 'button', isEditable: false };
            }
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
        messageId: `m${page.assistantTurns.length}`,
        turnId: `conversation-turn-${page.assistantTurns.length}`,
        finished: false,
    });
    page.turnTexts.push('Pro thinking...');
}
