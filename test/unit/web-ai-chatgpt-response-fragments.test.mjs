import { describe, expect, it } from 'vitest';
import {
    CHATGPT_ASSISTANT_SELECTORS,
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
