import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright-core';
import { resolveActionTarget, validateResolvedTarget } from '../../web-ai/self-heal.mjs';
import { createActionCacheHandle } from '../../web-ai/action-cache.mjs';
import { chromiumLaunchOptions } from './playwright-launch.mjs';
import { startSmokeServer, stopSmokeServer } from './smoke-server.mjs';

describe('self-heal browser smoke', () => {
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

    it('resolves composer via CSS fallback on v1 fixture', async () => {
        const page = await browser.newPage();
        await page.goto(`${serverUrl}/chatgpt-composer-v1.html`);

        const result = await resolveActionTarget(page, {
            provider: 'chatgpt',
            intent: 'composer.fill',
            actionKind: 'fill',
            selectors: ['#prompt-textarea', '[data-testid="composer-textarea"]', 'div[contenteditable="true"]'],
        });

        expect(result.ok).toBe(true);
        expect(result.target.selector).toBe('#prompt-textarea');
        expect(result.target.resolution).toBe('css-fallback');
        await page.close();
    });

    it('rejects stale selector when element role changed', async () => {
        const page = await browser.newPage();
        await page.goto(`${serverUrl}/chatgpt-composer-stale.html`);

        const result = await validateResolvedTarget(page, {
            selector: '#prompt-textarea',
            role: 'textbox',
            nameHash: null,
        }, {
            semanticTarget: { roles: ['textbox'], names: [/message/i] },
            actionKind: 'fill',
        });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('not-editable');
        await page.close();
    });

    it('rejects ambiguous selector (duplicate buttons)', async () => {
        const page = await browser.newPage();
        await page.goto(`${serverUrl}/chatgpt-composer-duplicate.html`);

        const result = await validateResolvedTarget(page, {
            selector: 'button[aria-label="Send message"]',
        }, { actionKind: 'click' });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('ambiguous-selector');
        expect(result.count).toBe(2);
        await page.close();
    });

    it('uses cached selector on v1, then heals on v2 after redesign', async () => {
        const cache = createActionCacheHandle();
        const urlHost = new URL(serverUrl).hostname;
        
        const page1 = await browser.newPage();
        await page1.goto(`${serverUrl}/chatgpt-composer-v1.html`);
        const result1 = await resolveActionTarget(page1, {
            provider: 'chatgpt',
            intent: 'composer.fill',
            actionKind: 'fill',
            cache,
            selectors: ['#prompt-textarea'],
        });
        expect(result1.ok).toBe(true);
        cache.update(
            { provider: 'chatgpt', intent: 'composer.fill', actionKind: 'fill', urlHost },
            result1.target,
            { domHashPrefix: 'mock', axHashPrefix: 'mock' }
        );

        const page2 = await browser.newPage();
        await page2.goto(`${serverUrl}/chatgpt-composer-v2.html`);
        const result2 = await resolveActionTarget(page2, {
            provider: 'chatgpt',
            intent: 'composer.fill',
            actionKind: 'fill',
            cache,
            selectors: ['#composer-textarea'],
            fingerprint: { domHashPrefix: 'mock', axHashPrefix: 'mock' },
        });
        expect(result2.ok).toBe(true);
        expect(result2.attempts.some(a => a.source === 'cache')).toBe(true);
        expect(result2.target.resolution).toBe('css-fallback');
        await page1.close();
        await page2.close();
    });
});
