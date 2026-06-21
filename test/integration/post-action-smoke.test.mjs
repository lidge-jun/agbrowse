import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright-core';
import { assertPostAction, clickWithPostAssert, fillWithPostAssert } from '../../web-ai/post-action-assert.mjs';
import { chromiumLaunchOptions } from './playwright-launch.mjs';
import { startSmokeServer, stopSmokeServer } from './smoke-server.mjs';

describe('post-action browser smoke', () => {
    let server;
    let serverUrl;
    let browser;

    beforeAll(async () => {
        const result = await startSmokeServer();
        server = result.server;
        serverUrl = result.url;
        browser = await chromium.launch(chromiumLaunchOptions());
    });

    afterAll(async () => {
        await browser?.close();
        await stopSmokeServer(server);
    });

    it('fill detects value mismatch', async () => {
        const page = await browser.newPage();
        await page.goto(`${serverUrl}/chatgpt-composer-v1.html`);
        const locator = page.locator('#prompt-textarea');
        await locator.fill('actual text');
        const result = await assertPostAction(page, 'fill', { selector: '#prompt-textarea' }, { expectedValue: 'wrong text' });
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('value-mismatch');
        await page.close();
    });
});
