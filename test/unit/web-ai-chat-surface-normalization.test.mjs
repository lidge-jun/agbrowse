import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureChatSurface, ensureWorkSurface } from '../../web-ai/chatgpt-work-picker.mjs';

// The completed-send harness at the bottom of this file reaches saveBaseline and
// createSession, which persist under BROWSER_AGENT_HOME. Point it at a temp dir
// BEFORE web-ai/chatgpt.mjs is imported (it is imported dynamically, inside the
// tests) so a unit run never writes into the developer's real ~/.browser-agent.
const TEMP_BROWSER_HOME = mkdtempSync(join(tmpdir(), 'agbrowse-surface-'));
process.env.BROWSER_AGENT_HOME = TEMP_BROWSER_HOME;
afterAll(() => { rmSync(TEMP_BROWSER_HOME, { recursive: true, force: true }); });

/**
 * Page double exposing the Chat/Work radio pair. `surfaces` is the sequence of
 * states the detector should observe: the first entry is the pre-click state,
 * the second (if present) the post-click state.
 */
function makePage(states, { onClick = () => {} } = {}) {
    let index = 0;
    const clicks = [];
    const current = () => states[Math.min(index, states.length - 1)];
    const radioFor = (label) => ({
        isVisible: async () => current()[label] !== undefined,
        textContent: async () => label,
        getAttribute: async (name) => {
            const state = current()[label];
            if (!state) return null;
            if (name === 'aria-checked') return state.active ? 'true' : 'false';
            if (name === 'data-state') return state.active ? 'on' : 'off';
            return null;
        },
        click: async () => { clicks.push(label); index += 1; onClick(label); },
    });
    return {
        clicks,
        page: {
            url: () => 'https://chatgpt.com/',
            locator: () => {
                const labels = Object.keys(current());
                return {
                    count: async () => labels.length,
                    nth: (i) => radioFor(labels[i]),
                    first: () => radioFor(labels[0]),
                    all: async () => labels.map(radioFor),
                };
            },
            evaluate: async () => null,
        },
    };
}

const chatActive = { Chat: { active: true }, Work: { active: false } };
const workActive = { Chat: { active: false }, Work: { active: true } };
const ambiguous = { Chat: { active: true }, Work: { active: true } };

describe('opt-in Work→Chat normalization (G16)', () => {
    it('switches from Work to Chat and verifies the result', async () => {
        const harness = makePage([workActive, chatActive]);
        const result = await ensureChatSurface(harness.page);
        expect(result.switched).toBe(true);
        expect(harness.clicks).toEqual(['Chat']);
    });

    it('is a no-op when Chat is already active', async () => {
        const harness = makePage([chatActive]);
        const result = await ensureChatSurface(harness.page);
        expect(result.switched).toBe(false);
        expect(harness.clicks).toEqual([]);
    });

    it('fails closed on an ambiguous surface without clicking', async () => {
        const harness = makePage([ambiguous]);
        await expect(ensureChatSurface(harness.page)).rejects.toMatchObject({
            errorCode: 'provider.work-state-unknown',
            stage: 'provider-work-preflight',
        });
        expect(harness.clicks).toEqual([]);
    });

    it('never navigates away from a conversation page', async () => {
        // No radios at all: normalizing here would mean leaving the user's
        // conversation, which is out of scope.
        const harness = makePage([{}]);
        await expect(ensureChatSurface(harness.page)).rejects.toMatchObject({
            errorCode: 'capability.unsupported',
        });
        expect(harness.clicks).toEqual([]);
    });

    it('surfaces a failed post-click verification', async () => {
        // The click happens but the surface stays on Work.
        const harness = makePage([workActive, workActive]);
        await expect(ensureChatSurface(harness.page)).rejects.toMatchObject({
            errorCode: 'provider.work-state-unknown',
        });
        expect(harness.clicks).toEqual(['Chat']);
    });

    it('leaves ensureWorkSurface behavior unchanged', async () => {
        const harness = makePage([chatActive, workActive]);
        const result = await ensureWorkSurface(harness.page);
        expect(result.switched).toBe(true);
        expect(harness.clicks).toEqual(['Work']);
    });

    it('returns switched:false for a legacy conversation already on Chat', async () => {
        // Round 4 made `surface` non-null on conversation pages, so
        // {ui:'legacy', surface:'chat'} is reachable. The chat check must run
        // BEFORE the legacy throw, or a perfectly good Chat conversation errors.
        const page = {
            url: () => 'https://chatgpt.com/c/abc-123',
            locator: () => ({ count: async () => 0, nth: () => ({}), first: () => ({ isVisible: async () => false }) }),
            // The conversation probe reports positive Chat metadata.
            evaluate: async () => ({ state: 'chat', evidence: { conversationId: 'abc-123', matched: 1 } }),
        };
        const result = await ensureChatSurface(page);
        expect(result).toMatchObject({ switched: false });
        expect(result.detection).toMatchObject({ ui: 'legacy', surface: 'chat' });
    });
});

describe('normalizeSurface opt-in wiring (G16)', () => {
    const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');
    const cliSrc = readFileSync(join(process.cwd(), 'web-ai', 'cli.mjs'), 'utf8');

    it('defaults to OFF, so an ordinary send never touches the surface', () => {
        expect(chatgptSrc).toContain('if (input.normalizeSurface === true) {');
        expect(cliSrc).toContain("'normalize-surface': { type: 'boolean', default: false }");
        expect(cliSrc).toContain("normalizeSurface: values['normalize-surface'] === true");
    });

    it('runs normalization BEFORE model selection', () => {
        // The model guard rejects a Work surface, so normalizing after it would
        // never get the chance to fix the very state the flag exists for.
        const normalizeAt = chatgptSrc.indexOf('const { ensureChatSurface }');
        const modelAt = chatgptSrc.indexOf('const selectedModel = await selectChatGptModel(');
        expect(normalizeAt).toBeGreaterThan(-1);
        expect(modelAt).toBeGreaterThan(normalizeAt);
    });

    it('merges the warning into the existing send warnings array', () => {
        expect(chatgptSrc).toContain("surfaceWarnings.push('composer surface normalized: work -> chat')");
        expect(chatgptSrc).toMatch(/warnings: \[\s*\n\s*\.\.\.rendered\.warnings,\s*\n\s*\.\.\.\(contextPack\?\.warnings \|\| \[\]\),\s*\n\s*\.\.\.surfaceWarnings,/);
    });

    it('documents the flag for the docs gate', () => {
        expect(cliSrc).toContain('--normalize-surface');
    });
});

describe('normalizeSurface behaviour through the send path (G16)', () => {
    /**
     * A page whose Chat/Work radios are observable and whose every other probe
     * fails benignly, so `sendWebAi` reaches the surface/model stage and then
     * stops. What matters is WHICH surface calls happened, not that the send
     * completes.
     */
    function makeSendPage(initial) {
        let state = initial;
        const events = [];
        const radio = (label) => ({
            isVisible: async () => true,
            textContent: async () => label,
            getAttribute: async (name) => {
                const active = state === label.toLowerCase();
                if (name === 'aria-checked') return active ? 'true' : 'false';
                if (name === 'data-state') return active ? 'on' : 'off';
                return null;
            },
            click: async () => { events.push(`click:${label}`); state = label.toLowerCase(); },
            focus: async () => undefined,
            boundingBox: async () => null,
            innerText: async () => label,
            count: async () => 1,
            all: async () => [],
            first: () => radio(label),
            nth: () => radio(label),
            hover: async () => undefined,
        });
        const page = {
            url: () => 'https://chatgpt.com/',
            goto: async () => undefined,
            waitForTimeout: async () => undefined,
            keyboard: { press: async () => undefined, down: async () => undefined, up: async () => undefined },
            mouse: { click: async () => undefined, move: async () => undefined },
            locator: (selector) => {
                if (String(selector).includes('radio')) {
                    events.push('detect:surface');
                    return {
                        count: async () => 2,
                        nth: (i) => radio(i === 0 ? 'Chat' : 'Work'),
                        first: () => radio('Chat'),
                        all: async () => [radio('Chat'), radio('Work')],
                    };
                }
                return {
                    count: async () => 0,
                    all: async () => [],
                    first: () => ({ isVisible: async () => false, count: async () => 0 }),
                    nth: () => ({ isVisible: async () => false }),
                };
            },
            evaluate: async () => null,
        };
        return { page, events, get state() { return state; } };
    }

    async function send(harness, input) {
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        return sendWebAi(
            { getPage: async () => harness.page, getTargetId: async () => 'surface-target' },
            { vendor: 'chatgpt', prompt: 'hello', skipFinalize: true, attachmentPolicy: 'inline-only', ...input },
        ).then(result => ({ result }), error => ({ error }));
    }

    it('never clicks a surface radio when the flag is absent', async () => {
        const harness = makeSendPage('work');
        await send(harness, {});
        expect(harness.events.filter(e => e.startsWith('click:'))).toEqual([]);
        expect(harness.state).toBe('work');
    });

    it('never clicks a surface radio when the flag is absent even with a model request', async () => {
        // The pre-existing model guard may READ the surface; it must not mutate it.
        const harness = makeSendPage('work');
        await send(harness, { model: 'instant' });
        expect(harness.events.filter(e => e.startsWith('click:'))).toEqual([]);
        expect(harness.state).toBe('work');
    });

    it('clicks Chat before model selection when the flag is set', async () => {
        const harness = makeSendPage('work');
        await send(harness, { normalizeSurface: true, model: 'instant' });
        expect(harness.events).toContain('click:Chat');
        expect(harness.state).toBe('chat');
    });

    it('does not click when the flag is set but Chat is already active', async () => {
        const harness = makeSendPage('chat');
        await send(harness, { normalizeSurface: true });
        expect(harness.events.filter(e => e.startsWith('click:'))).toEqual([]);
    });
});

/**
 * The harness above deliberately stops before the send completes, so it can
 * prove WHICH surface calls happened but never sees the returned `warnings`.
 * The double below runs a Work→Chat send all the way to `status: 'sent'`, which
 * is the only place the caller can observe that normalization was reported.
 */
describe('normalizeSurface warning reaches the caller (G16)', () => {
    function makeCompletedSendPage(initialSurface) {
        const surfaceClicks = [];
        let surface = initialSurface;
        const page = {
            composerValue: '',
            insertedText: '',
            keys: [],
            turnTexts: ['old answer'],
            assistantTexts: ['old answer'],
            surfaceClicks,
            get surface() { return surface; },
            url: () => 'https://chatgpt.com/',
            innerText: async (selector) => (selector === 'body' ? page.assistantTexts.join('\n') : ''),
            waitForTimeout: async () => undefined,
            keyboard: {
                insertText: async (text) => { page.insertedText = text; page.composerValue = text; },
                press: async (key) => { page.keys.push(key); if (key === 'Enter') commit(); },
            },
            evaluate: async () => null,
            locator: (selector) => makeLocator(selector),
        };

        function commit() {
            page.turnTexts.push(page.composerValue);
            page.composerValue = '';
            page.turnTexts.push('Pro thinking...');
            page.assistantTexts.push('Pro thinking...');
        }

        function radio(label) {
            const active = () => surface === label.toLowerCase();
            const handle = {
                isVisible: async () => true,
                textContent: async () => label,
                innerText: async () => label,
                getAttribute: async (name) => {
                    if (name === 'aria-checked') return active() ? 'true' : 'false';
                    if (name === 'data-state') return active() ? 'on' : 'off';
                    return null;
                },
                click: async () => { surfaceClicks.push(label); surface = label.toLowerCase(); },
                count: async () => 1,
                first: () => handle,
                nth: () => handle,
                all: async () => [handle],
            };
            return handle;
        }

        function makeLocator(selector) {
            if (String(selector).includes('role="radio"')) {
                return {
                    count: async () => 2,
                    nth: (i) => radio(i === 0 ? 'Chat' : 'Work'),
                    first: () => radio('Chat'),
                    all: async () => [radio('Chat'), radio('Work')],
                };
            }
            const isComposer = ['prompt-textarea', 'composer-textarea', 'ProseMirror', 'contenteditable'].some(s => String(selector).includes(s));
            const isSend = ['send-button', 'composer-send', 'button[type="submit"]', 'aria-label*="Send"'].some(s => String(selector).includes(s));
            const isTurn = ['conversation-turn', 'data-message-author-role', 'data-turn'].some(s => String(selector).includes(s));
            const handle = {
                first: () => handle,
                nth: () => handle,
                count: async () => (isComposer || isSend ? 1 : (isTurn ? page.turnTexts.length : 0)),
                waitFor: async () => undefined,
                isVisible: async () => isComposer || isSend,
                isEnabled: async () => true,
                isEditable: async () => isComposer,
                click: async () => { if (isSend) commit(); },
                hover: async () => undefined,
                boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
                evaluate: async (fn) => {
                    if (typeof fn !== 'function') return undefined;
                    if (isComposer) return { role: 'textbox', label: 'Message ChatGPT', tagName: 'textarea', isEditable: true };
                    if (isSend) return { role: 'button', label: 'Send message', tagName: 'button', isEditable: false };
                    return undefined;
                },
                evaluateAll: async () => false,
                inputValue: async () => page.composerValue,
                innerText: async () => (isComposer ? page.composerValue : ''),
                getAttribute: async () => null,
                all: async () => (isTurn ? page.turnTexts.map(text => ({ innerText: async () => text })) : []),
            };
            return handle;
        }

        return page;
    }

    async function completeSend(page, input) {
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        return sendWebAi({
            getPage: async () => page,
            getTargetId: async () => 'surface-complete-target',
            getCdpSession: async () => ({
                send: async (method, payload) => {
                    if (method === 'Input.insertText') {
                        page.insertedText = payload.text;
                        page.composerValue = payload.text;
                    }
                    return {};
                },
                detach: async () => undefined,
            }),
        }, { vendor: 'chatgpt', prompt: 'Reply exactly: OK', attachmentPolicy: 'inline-only', ...input });
    }

    it('returns the normalization warning to the caller after a completed Work->Chat send', async () => {
        const page = makeCompletedSendPage('work');
        const result = await completeSend(page, { normalizeSurface: true });
        expect(result.status).toBe('sent');
        expect(page.surfaceClicks).toEqual(['Chat']);
        expect(result.warnings).toContain('composer surface normalized: work -> chat');
    });

    it('emits no normalization warning when Chat was already active', async () => {
        const page = makeCompletedSendPage('chat');
        const result = await completeSend(page, { normalizeSurface: true });
        expect(result.status).toBe('sent');
        expect(page.surfaceClicks).toEqual([]);
        expect(result.warnings).not.toContain('composer surface normalized: work -> chat');
    });

    it('emits no normalization warning when the flag is absent', async () => {
        const page = makeCompletedSendPage('work');
        const result = await completeSend(page, {});
        expect(result.status).toBe('sent');
        expect(page.surface).toBe('work');
        expect(result.warnings).not.toContain('composer surface normalized: work -> chat');
    });
});
