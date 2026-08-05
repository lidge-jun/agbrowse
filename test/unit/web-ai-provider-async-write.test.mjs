import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, DEADLINE_PASSED, getSession, updateSessionAsync } from '../../web-ai/session.mjs';
import { isGeminiRunActive } from '../../web-ai/gemini-live.mjs';
import { isGrokRunActive } from '../../web-ai/grok-live.mjs';
import { isWorkRunActive } from '../../web-ai/chatgpt-work-picker.mjs';
import { isDeepResearchResumeActive } from '../../web-ai/chatgpt-deep-research.mjs';
import { sendMultiTurn } from '../../web-ai/chatgpt-multi-turn.mjs';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-provider-async-write-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

function createChatSession(slug) {
    return createSession(
        { vendor: 'chatgpt', prompt: 'initial', attachmentPolicy: 'inline-only' },
        {
            targetId: `target-${slug}`,
            conversationUrl: `https://chatgpt.com/c/${slug}`,
            deadlineAt: new Date(Date.now() + 60_000).toISOString(),
            envelopeSummary: { assistantCount: 0 },
        },
    );
}

describe.each([
    ['gemini', isGeminiRunActive],
    ['grok', isGrokRunActive],
    ['work', isWorkRunActive],
    ['deep-research-resume', isDeepResearchResumeActive],
])('%s async write liveness', (name, isRunActive) => {
    it('refuses a post-deadline write before the expiry callback flips the token', async () => {
        const session = createChatSession(`combined-${name}`);
        const token = { expired: false, hardDeadline: Date.now() - 1 };

        const result = await updateSessionAsync(
            session.sessionId,
            { status: 'crashed' },
            () => isRunActive(token),
        );

        expect(result).toBe(DEADLINE_PASSED);
        expect(getSession(session.sessionId)?.status).toBe(session.status);
    });
});

function createMultiTurnHarness({ stallAssistantRead = false } = {}) {
    let prompt = '';
    let submitted = false;
    let releaseAssistantRead = () => undefined;
    let markAssistantReadFinished = () => undefined;
    const assistantReadGate = new Promise(resolve => { releaseAssistantRead = resolve; });
    const assistantReadFinished = new Promise(resolve => { markAssistantReadFinished = resolve; });

    const emptyNode = {
        click: async () => undefined,
        count: async () => 0,
        evaluate: async () => undefined,
        innerText: async () => prompt,
        inputValue: async () => prompt,
        isEnabled: async () => true,
        isVisible: async () => true,
        waitFor: async () => undefined,
    };

    const page = {
        url: () => 'https://chatgpt.com/c/multi-turn-async',
        waitForTimeout: async () => undefined,
        keyboard: { press: async () => undefined },
        evaluate: async (_fn, arg) => {
            if (Array.isArray(arg)) {
                return { editorText: prompt, fallbackValue: '', activeValue: prompt };
            }
            if (arg?.sendSelectors) {
                submitted = true;
                return 'clicked';
            }
            return false;
        },
        locator: (selector) => {
            const text = String(selector);
            const isAssistant = text === '[data-message-author-role="assistant"]';
            const isStop = text.includes('stop-button') || text.includes('Stop');
            const isConversation = text.includes('conversation-turn') || text.includes('[data-message-author-role]') || text.includes('[data-turn]');
            return {
                first: () => emptyNode,
                all: async () => {
                    if (isConversation && submitted) return [{ innerText: async () => prompt }];
                    return [];
                },
                count: async () => {
                    if (isAssistant && submitted && stallAssistantRead) {
                        await assistantReadGate;
                        markAssistantReadFinished();
                    }
                    return isAssistant || isStop ? 0 : 1;
                },
            };
        },
    };

    const deps = {
        getCdpSession: async () => ({
            send: async (method, params) => {
                if (method === 'Input.insertText') prompt = String(params?.text || '');
            },
            detach: async () => undefined,
        }),
    };

    return { page, deps, releaseAssistantRead, assistantReadFinished };
}

describe('multi-turn outer deadline bookkeeping', () => {
    it('persists partial state when a turn times out while the outer run is alive', async () => {
        const session = createChatSession('partial-outer-alive');
        const { page, deps } = createMultiTurnHarness();

        const result = await sendMultiTurn(page, deps, {
            followUps: ['first', 'second'],
            session,
            timeoutPerTurn: 150,
        });

        expect(result.finalStatus).toBe('partial');
        expect(result.warnings).toContain('turn-0-failed');
        expect(getSession(session.sessionId)).toMatchObject({
            status: 'partial',
            followUpCount: 1,
            turns: [{ index: 0, prompt: 'first', status: 'failed' }],
        });
    });

    it('refuses detached bookkeeping after the outer race is lost', async () => {
        const session = createChatSession('partial-outer-lost');
        const before = getSession(session.sessionId);
        const { page, deps, releaseAssistantRead, assistantReadFinished } = createMultiTurnHarness({ stallAssistantRead: true });

        const result = await sendMultiTurn(page, deps, {
            followUps: ['stalled'],
            session,
            timeoutPerTurn: 80,
        });
        expect(result.warnings).toContain('multi-turn-deadline-expired');

        releaseAssistantRead();
        await assistantReadFinished;
        await new Promise(resolve => setImmediate(resolve));

        expect(getSession(session.sessionId)).toEqual(before);
    });
});
