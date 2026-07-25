import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CHATGPT_ASSISTANT_SELECTORS,
    CHATGPT_STOP_SELECTORS,
    isActiveState,
    readChatGptStreamingState,
    readTopLevelAssistantSnapshots,
    readTopLevelAssistantTexts,
    readTopLevelAssistantTextsFromLocators,
} from '../../web-ai/chatgpt-response-dom.mjs';

describe('ChatGPT assistant response fragments', () => {
    it('deduplicates nested assistant nodes into one visible turn', () => {
        const parent = fakeNode('Full assistant answer\nFinal paragraph');
        const child = fakeNode('Final paragraph');
        parent.children.add(child);

        const texts = withDocument({ [CHATGPT_ASSISTANT_SELECTORS[0]]: [parent, child] }, () =>
            readTopLevelAssistantTexts(CHATGPT_ASSISTANT_SELECTORS));

        expect(texts).toEqual(['Full assistant answer\nFinal paragraph']);
    });

    it('keeps sibling top-level assistant turns in order', () => {
        const first = fakeNode('first answer');
        const second = fakeNode('second answer');

        const texts = withDocument({ [CHATGPT_ASSISTANT_SELECTORS[0]]: [first, second] }, () =>
            readTopLevelAssistantTexts(CHATGPT_ASSISTANT_SELECTORS));

        expect(texts).toEqual(['first answer', 'second answer']);
    });

    it('baseline slicing still sees a new top-level answer after prior answers', () => {
        const oldAnswer = fakeNode('old complete answer');
        const newAnswer = fakeNode('new complete answer');
        const nestedParagraph = fakeNode('new complete answer');
        newAnswer.children.add(nestedParagraph);

        const texts = withDocument({ [CHATGPT_ASSISTANT_SELECTORS[0]]: [oldAnswer, newAnswer, nestedParagraph] }, () =>
            readTopLevelAssistantTexts(CHATGPT_ASSISTANT_SELECTORS));

        expect(texts.slice(1)).toEqual(['new complete answer']);
    });

    it('applies the same descendant deduplication in locator fallback', async () => {
        const parent = fakeNode('Full assistant answer');
        const child = fakeNode('paragraph fragment');
        parent.children.add(child);
        const selector = CHATGPT_ASSISTANT_SELECTORS[0];
        const nodesBySelector = { [selector]: [parent, child] };
        const page = {
            locator: (activeSelector) => ({
                all: async () => activeSelector === selector
                    ? nodesBySelector[selector].map(node => fakeLocator(node, nodesBySelector))
                    : [],
            }),
        };

        await expect(readTopLevelAssistantTextsFromLocators(page, CHATGPT_ASSISTANT_SELECTORS))
            .resolves.toEqual(['Full assistant answer']);
    });

    it('extracts message id, turn id, and top-level turn index with assistant text', () => {
        const snapshots = readSnapshotsFixture(`
            <article data-testid="conversation-turn-7">
                <div data-message-author-role="assistant" data-message-id="m7">Final answer</div>
            </article>`);
        expect(snapshots).toEqual([{
            text: 'Final answer',
            messageId: 'm7',
            turnId: 'conversation-turn-7',
            turnIndex: 0,
        }]);
    });

    it('keeps readTopLevelAssistantTexts as a snapshot projection', () => {
        const dom = new JSDOM('<article data-testid="conversation-turn-1"><div data-turn="assistant">Projected text</div></article>');
        const previous = globalThis.document;
        globalThis.document = dom.window.document;
        try {
            expect(readTopLevelAssistantTexts(CHATGPT_ASSISTANT_SELECTORS)).toEqual(['Projected text']);
        } finally {
            dom.window.close();
            if (previous === undefined) delete globalThis.document;
            else globalThis.document = previous;
        }
    });

    it('does not snapshot a newer bare conversation article without an assistant role', () => {
        const snapshots = readSnapshotsFixture(`
            <article data-testid="conversation-turn-1"><div data-turn="assistant">Verified</div></article>
            <article data-testid="conversation-turn-2">Bare newer turn</article>`);
        expect(snapshots.map(snapshot => snapshot.text)).toEqual(['Verified']);
    });
});

describe('ChatGPT streaming state', () => {
    it('detects an exact stop test-id outside the composer', () => {
        expect(readStreamingFixture('<button data-testid="stop-button">Stop</button>')).toBe(true);
    });

    it('detects the scoped aria Stop fallback inside the composer', () => {
        expect(readStreamingFixture('<form><button aria-label="Stop generating">Stop</button></form>')).toBe(true);
    });

    it('ignores the aria Stop fallback outside the composer', () => {
        expect(readStreamingFixture('<button aria-label="Stop generating">Stop</button>')).toBe(false);
    });

    it('excludes a composer Stop dictation control', () => {
        expect(readStreamingFixture('<form><button aria-label="Stop dictation">Stop</button></form>')).toBe(false);
    });

    it('excludes a composer Stop voice control', () => {
        expect(readStreamingFixture('<form><button aria-label="Stop voice">Stop</button></form>')).toBe(false);
    });

    it('excludes a composer Stop reading control', () => {
        expect(readStreamingFixture('<form><button aria-label="Stop reading">Stop</button></form>')).toBe(false);
    });

    it('scopes progress to the latest role-verified assistant turn', () => {
        const shellOnly = `
            <progress value="10" max="100"></progress>
            <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Old</div></article>
            <article data-testid="conversation-turn-2"><div data-message-author-role="assistant">Latest</div></article>`;
        const latestProgress = `
            <article data-testid="conversation-turn-1"><div data-message-author-role="assistant"><progress value="10" max="100"></progress></div></article>
            <article data-testid="conversation-turn-2"><div data-message-author-role="assistant"><progress value="20" max="100"></progress></div></article>`;
        expect(readStreamingFixture(shellOnly)).toBe(false);
        expect(readStreamingFixture(latestProgress)).toBe(true);
    });

    it('does not treat a bare latest conversation article as an assistant turn', () => {
        const html = `
            <article data-testid="conversation-turn-1"><div data-message-author-role="assistant">Old</div></article>
            <article data-testid="conversation-turn-2"><progress value="20" max="100"></progress></article>`;
        expect(readStreamingFixture(html)).toBe(false);
    });

    it('treats completed HTML progress as idle and incomplete HTML progress as live', () => {
        const fixture = (value) => `
            <article data-testid="conversation-turn-1">
                <div data-message-author-role="assistant"><progress value="${value}" max="100"></progress></div>
            </article>`;
        expect(readStreamingFixture(fixture(100))).toBe(false);
        expect(readStreamingFixture(fixture(99))).toBe(true);
    });

    it('treats indeterminate HTML progress as live', () => {
        const html = '<div data-message-author-role="assistant"><progress></progress></div>';
        expect(readStreamingFixture(html)).toBe(true);
    });

    it('defaults omitted ARIA max to 100 for completed and incomplete progress', () => {
        const fixture = (now) => `
            <div data-turn="assistant"><div role="progressbar" aria-valuenow="${now}"></div></div>`;
        expect(readStreamingFixture(fixture(100))).toBe(false);
        expect(readStreamingFixture(fixture(99))).toBe(true);
    });

    it('requires thinking metadata before a right-side panel can veto completion', () => {
        expect(readStreamingFixture('<aside>Reasoning</aside>', { sidecar: true })).toBe(false);
        expect(readStreamingFixture('<aside data-testid="reasoning-sidecar">Reasoning</aside>', { sidecar: true })).toBe(true);
    });

    it('ignores an anchored completed sidecar summary', () => {
        const html = '<aside data-testid="reasoning-sidecar">Thought for 12s</aside>';
        expect(readStreamingFixture(html, { sidecar: true })).toBe(false);
    });

    it('keeps a growing Thought for trace live', () => {
        const html = '<aside data-testid="reasoning-sidecar">Reasoning Thought for 2s: Searching…</aside>';
        expect(readStreamingFixture(html, { sidecar: true })).toBe(true);
    });
});

describe('ChatGPT completed-reasoning grammar (G7/G9/G12)', () => {
    const panel = (text) => `<aside data-testid="reasoning-sidecar">${text}</aside>`;
    const strength = (text) => readActivityFixture(panel(text), { sidecar: true }).strength;

    it.each([
        ['Thought for 12s'],
        ['Reasoning Thought for 12s'],
        ['Pro thinking Thought for 1.5 minutes'],
        ['Thought for 1m 5s'],
        ['Thought for a moment'],
        ['Thought for a few seconds'],
        ['Thought for 12s Edit'],
        ['Reasoning Thought for 2 hours Edit'],
    ])('treats %s as a completed summary', (text) => {
        expect(strength(text)).toBe('none');
    });

    it.each([
        ['Thought for 2s: Searching…', 'panel-trace'],
        ['Thought for 12s and still going through the sources it found', 'panel-trace'],
        ['Thinking', 'panel-text'],
        ['Reasoning', 'panel-text'],
    ])('treats %s as weak live activity', (text, evidence) => {
        const state = readActivityFixture(panel(text), { sidecar: true });
        expect(state).toMatchObject({ strength: 'weak', evidence });
    });
});

describe('ChatGPT activity strata (G8)', () => {
    it('reports a visible stop button as strong', () => {
        const html = '<form><button data-testid="stop-button">stop</button></form>';
        expect(readActivityFixture(html)).toMatchObject({ strength: 'strong', evidence: 'stop-button' });
    });

    it('reports live progress inside a verified panel as strong', () => {
        const html = '<aside data-testid="reasoning-sidecar">Thinking<progress value="1" max="10"></progress></aside>';
        expect(readActivityFixture(html, { sidecar: true })).toMatchObject({ strength: 'strong', evidence: 'panel-progress' });
    });

    it('does not let a weak panel mask a later panel with live progress', () => {
        const html = '<aside data-testid="reasoning-sidecar">Thinking</aside>'
            + '<aside data-testid="thinking-sidecar">Reasoning<progress value="1" max="10"></progress></aside>';
        expect(readActivityFixture(html, { sidecar: true }).strength).toBe('strong');
    });

    it('reports nothing as none', () => {
        expect(readActivityFixture('<div>plain answer</div>')).toMatchObject({ strength: 'none' });
    });

    it('exposes a boolean view for legacy callers', () => {
        expect(isActiveState(true)).toBe(true);
        expect(isActiveState(false)).toBe(false);
        expect(isActiveState(null)).toBe(false);
        expect(isActiveState(undefined)).toBe(false);
        expect(isActiveState({ strength: 'none', evidence: '' })).toBe(false);
        expect(isActiveState({ strength: 'weak', evidence: 'panel-text' })).toBe(true);
        expect(isActiveState({ strength: 'strong', evidence: 'stop-button' })).toBe(true);
    });

    it('keeps the poll loop honest about weak activity', () => {
        // Source-shape guard for the behavioural change: weak activity must not
        // count as `streaming`, must lengthen the stability window, and must not
        // open the image shortcut.
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');
        expect(src).toContain("const streaming = activity.strength === 'strong'");
        expect(src).toContain("const weakActive = activity.strength === 'weak'");
        expect(src).toContain('const minStableMs = weakActive ? 5_000 : 1_000');
        expect(src).toContain("if (activity.strength === 'none' && latestSnapshot && session");
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

function fakeLocator(node, nodesBySelector) {
    return {
        evaluate: async (fn, selector) => withDocument(nodesBySelector, () => fn(node, selector)),
        innerText: async () => node.innerText,
    };
}

function withDocument(nodesBySelector, fn) {
    const previous = globalThis.document;
    globalThis.document = {
        querySelectorAll: (selector) => nodesBySelector[selector] || [],
    };
    try {
        return fn();
    } finally {
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
}

function readStreamingFixture(html, options = {}) {
    return isActiveState(readActivityFixture(html, options));
}

function readActivityFixture(html, { sidecar = false } = {}) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const previous = {
        document: globalThis.document,
        window: globalThis.window,
        HTMLElement: globalThis.HTMLElement,
        HTMLProgressElement: globalThis.HTMLProgressElement,
    };
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.HTMLProgressElement = dom.window.HTMLProgressElement;
    Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 1000 });
    for (const element of dom.window.document.querySelectorAll('*')) {
        element.getBoundingClientRect = () => ({
            left: sidecar && element.matches('aside') ? 400 : 0,
            width: sidecar && element.matches('aside') ? 300 : 20,
            height: sidecar && element.matches('aside') ? 200 : 20,
            right: 0,
            bottom: 0,
            top: 0,
            x: 0,
            y: 0,
            toJSON() {},
        });
    }
    try {
        return readChatGptStreamingState({
            assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
            stopSelectors: CHATGPT_STOP_SELECTORS,
        });
    } finally {
        dom.window.close();
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete globalThis[key];
            else globalThis[key] = value;
        }
    }
}

function readSnapshotsFixture(html) {
    const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
    const previous = globalThis.document;
    globalThis.document = dom.window.document;
    try {
        return readTopLevelAssistantSnapshots(CHATGPT_ASSISTANT_SELECTORS);
    } finally {
        dom.window.close();
        if (previous === undefined) delete globalThis.document;
        else globalThis.document = previous;
    }
}
