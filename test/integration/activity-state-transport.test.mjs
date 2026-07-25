import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright-core';
import {
    CHATGPT_ASSISTANT_SELECTORS,
    CHATGPT_STOP_SELECTORS,
    readAssistantSnapshotSources,
    readChatGptStreamingState,
    resolveTopLevelAssistantTurns,
} from '../../web-ai/chatgpt-response-dom.mjs';
import { chromiumLaunchOptions } from './playwright-launch.mjs';

// `page.evaluate` serializes a function BODY, not its module bindings. The
// completed-reasoning grammar and its unit alternation are declared inside
// readChatGptStreamingState for exactly that reason; only a real transport round
// trip can prove it, because every jsdom test calls the function in-process where
// module scope is available.
describe('activity state browser transport', () => {
    let browser;

    beforeAll(async () => {
        browser = await chromium.launch(chromiumLaunchOptions());
    });

    afterAll(async () => {
        await browser?.close();
    });

    const sidecar = (text) => `
        <main><div data-message-author-role="assistant">answer</div></main>
        <aside data-testid="reasoning-sidecar"
               style="position:fixed;left:60%;width:320px;height:240px">${text}</aside>
    `;

    async function read(page) {
        return page.evaluate(readChatGptStreamingState, {
            assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
            stopSelectors: CHATGPT_STOP_SELECTORS,
            resolverSource: resolveTopLevelAssistantTurns.toString(),
        });
    }

    it('returns a structured verdict with no ReferenceError', async () => {
        const page = await browser.newPage();
        await page.setContent(sidecar('Thinking'));
        await expect(read(page)).resolves.toMatchObject({ strength: 'weak', evidence: 'panel-text' });
        await page.close();
    });

    it('applies the body-local completed-summary grammar in the page', async () => {
        const page = await browser.newPage();
        await page.setContent(sidecar('Reasoning Thought for 12s Edit'));
        await expect(read(page)).resolves.toMatchObject({ strength: 'none' });
        await page.close();
    });

    it('keeps a growing trace live in the page', async () => {
        const page = await browser.newPage();
        await page.setContent(sidecar('Thought for 2s: Searching the web'));
        await expect(read(page)).resolves.toMatchObject({ strength: 'weak', evidence: 'panel-trace' });
        await page.close();
    });

    it('reports a visible composer stop button as strong', async () => {
        const page = await browser.newPage();
        await page.setContent('<form><button data-testid="stop-button" style="width:40px;height:40px">stop</button></form>');
        await expect(read(page)).resolves.toMatchObject({ strength: 'strong', evidence: 'stop-button' });
        await page.close();
    });
});

describe('snapshot source acquisition browser transport (G11)', () => {
    let browser;

    beforeAll(async () => {
        browser = await chromium.launch(chromiumLaunchOptions());
    });

    afterAll(async () => {
        await browser?.close();
    });

    async function acquire(page) {
        return page.evaluate(readAssistantSnapshotSources, {
            assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
            resolverSource: resolveTopLevelAssistantTurns.toString(),
        });
    }

    it('admits wrapperless markdown following the latest user, in one coordinate space', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <div data-message-author-role="user">question</div>
            <div class="markdown">wrapperless first</div>
            <div data-message-author-role="assistant">wrapped later</div>
        `);

        const result = await acquire(page);
        expect(result.ok).toBe(true);
        expect(result.wrapperless.map(s => s.text)).toEqual(['wrapperless first']);

        const all = [...result.wrapped, ...result.wrapperless].sort((a, b) => a.domOrder - b.domOrder);
        expect(all.at(-1).text).toBe('wrapped later');
        expect(new Set(all.map(s => s.domOrder)).size).toBe(all.length);
        await page.close();
    });

    it('rejects markdown preceding the latest user and dedups overlapping selectors', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <div class="markdown" data-message-content>old answer</div>
            <div data-message-author-role="user">resend</div>
        `);
        const result = await acquire(page);
        expect(result).toMatchObject({ ok: true });
        expect(result.wrapperless).toHaveLength(0);
        await page.close();
    });
});
