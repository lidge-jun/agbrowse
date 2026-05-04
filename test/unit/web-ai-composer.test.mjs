import { describe, expect, it } from 'vitest';
import {
    INPUT_SELECTORS,
    SEND_BUTTON_SELECTORS,
    findComposerCandidate,
    insertPromptIntoComposer,
    submitPromptFromComposer,
    verifyPromptCommitted,
} from '../../web-ai/chatgpt-composer.mjs';

describe('web-ai ChatGPT composer hardening', () => {
    it('uses structured composer selectors and send-button-first submission', () => {
        expect(INPUT_SELECTORS).toContain('.ProseMirror');
        expect(INPUT_SELECTORS).toContain('[contenteditable="true"][data-virtualkeyboard="true"]');
        expect(SEND_BUTTON_SELECTORS).toContain('button[data-testid="send-button"]');
    });

    it('inserts through keyboard.insertText and verifies composer state', async () => {
        const page = createFakePage();
        await insertPromptIntoComposer(page, 'hello composer');
        expect(page.insertedText).toBe('hello composer');
        expect(page.composerValue).toBe('hello composer');
    });

    it('uses injected CDP-style insertText before keyboard fallback', async () => {
        const page = createFakePage();
        await insertPromptIntoComposer(page, 'cdp insert text', {
            insertText: async text => {
                page.insertedText = `cdp:${text}`;
                page.composerValue = text;
            },
        });
        expect(page.insertedText).toBe('cdp:cdp insert text');
        expect(page.composerValue).toBe('cdp insert text');
    });

    it('verifies inserted prompt even when ChatGPT folds newlines into spaces', async () => {
        const page = createFakePage({
            readComposerValue: value => value.replace(/\s+/g, ' '),
        });
        await insertPromptIntoComposer(page, '[USER]\n## Project\ncli-jaw\n\n## Question\nReply exactly: OK');
        expect(page.composerValue).toContain('Reply exactly: OK');
    });

    it('chooses a visible composer instead of the first hidden selector match', async () => {
        const page = createVisibilityFakePage();
        const candidate = await findComposerCandidate(page);
        expect(candidate.selector).toBe('.ProseMirror');
    });

    it('uses a resolver-selected composer target when provided', async () => {
        const page = createFakePage();
        await insertPromptIntoComposer(page, 'resolver composer', {
            composerTarget: { selector: '[data-testid="composer-textarea"]', resolution: 'css-fallback' },
        });
        expect(page.locatorSelectors[0]).toBe('[data-testid="composer-textarea"]');
        expect(page.insertedText).toBe('resolver composer');
    });

    it('falls back to Enter only when no enabled send button exists', async () => {
        const page = createFakePage({ hasSendButton: false });
        const result = await submitPromptFromComposer(page);
        expect(result.method).toBe('enter');
        expect(page.keys).toContain('Enter');
    });

    it('clicks enabled send button before Enter fallback', async () => {
        const page = createFakePage();
        const result = await submitPromptFromComposer(page);
        expect(result.method).toBe('button');
        expect(page.clickedSend).toBe(true);
        expect(page.keys).not.toContain('Enter');
    });

    it('prefers a resolver-selected send button target when provided', async () => {
        const page = createFakePage();
        const result = await submitPromptFromComposer(page, {
            sendTarget: { selector: 'button[data-testid="send-button"]', resolution: 'css-fallback' },
        });
        expect(result).toMatchObject({
            method: 'button',
            selector: 'button[data-testid="send-button"]',
            resolution: 'css-fallback',
        });
        expect(page.locatorSelectors[0]).toBe('button[data-testid="send-button"]');
        expect(page.clickedSend).toBe(true);
        expect(page.keys).not.toContain('Enter');
    });

    it('verifies commit from a new turn and cleared composer', async () => {
        const page = createFakePage();
        page.composerValue = '';
        page.turnTexts.push('## Question hello composer');
        page.assistantTexts.push('Pro thinking...');
        await expect(verifyPromptCommitted(page, '## Question hello composer', { baselineTurns: 0, timeoutMs: 50 })).resolves.toEqual({ turnsCount: 1 });
    });
});

function createFakePage(options = {}) {
    const page = {
        composerValue: '',
        insertedText: '',
        keys: [],
        clickedSend: false,
        hasSendButton: options.hasSendButton !== false,
        readComposerValue: options.readComposerValue || (value => value),
        locatorSelectors: [],
        turnTexts: [],
        assistantTexts: [],
        keyboard: {
            insertText: async text => {
                page.insertedText = text;
                page.composerValue = text;
            },
            press: async key => {
                page.keys.push(key);
            },
        },
        waitForTimeout: async () => undefined,
        evaluate: async (_fn, payload, legacySendSelectors) => {
            const sendSelectors = Array.isArray(legacySendSelectors) ? legacySendSelectors : payload?.sendSelectors;
            if (!Array.isArray(sendSelectors)) return null;
            if (!page.hasSendButton) return 'missing';
            page.clickedSend = true;
            return 'clicked';
        },
        locator: selector => {
            page.locatorSelectors.push(selector);
            return createFakeLocator(page, selector);
        },
    };
    return page;
}

function createVisibilityFakePage() {
    return {
        locator: selector => createVisibilityLocator(selector),
    };
}

function createVisibilityLocator(selector) {
    const exists = selector === 'textarea[data-id="prompt-textarea"]' || selector === '.ProseMirror';
    const visible = selector === '.ProseMirror';
    return {
        first: () => createVisibilityLocator(selector),
        nth: () => createVisibilityLocator(selector),
        count: async () => (exists ? 1 : 0),
        waitFor: async () => {
            if (!visible) throw new Error('hidden');
        },
        boundingBox: async () => (visible ? { width: 100, height: 20 } : { width: 0, height: 0 }),
        evaluate: async () => visible,
    };
}

function createFakeLocator(page, selector) {
    const isComposer = selector.includes('prompt-textarea') || selector.includes('composer-textarea') || selector.includes('ProseMirror') || selector.includes('contenteditable');
    const isSend = selector.includes('send-button') || selector.includes('button[type="submit"]') || selector.includes('aria-label*="Send"');
    const isAssistant = selector.includes('assistant');
    const isTurn = selector.includes('conversation-turn') || selector.includes('data-message-author-role') || selector.includes('data-turn');
    return {
        first: () => createFakeLocator(page, selector),
        count: async () => {
            if (isComposer) return 1;
            if (isSend) return page.hasSendButton ? 1 : 0;
            if (isAssistant) return page.assistantTexts.length;
            if (isTurn) return page.turnTexts.length;
            return 0;
        },
        waitFor: async () => undefined,
        isVisible: async () => isComposer || isSend,
        isEnabled: async () => isComposer || (isSend && page.hasSendButton),
        click: async () => {
            if (isSend) page.clickedSend = true;
        },
        evaluate: async () => false,
        inputValue: async () => page.readComposerValue(page.composerValue),
        innerText: async () => page.readComposerValue(page.composerValue),
        all: async () => {
            if (isAssistant) return page.assistantTexts.map(text => ({ innerText: async () => text }));
            if (isTurn) return page.turnTexts.map(text => ({ innerText: async () => text }));
            return [];
        },
    };
}
