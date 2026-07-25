import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright-core';
import {
    MENU_CONTAINER_SELECTOR,
    MENU_ITEM_SELECTOR,
    MENU_OPEN_TEXT_PATTERN,
    resolveComposerMenuItem,
    snapshotOpenMenus,
} from '../../web-ai/chatgpt-menu-resolver.mjs';
import { chromiumLaunchOptions } from './playwright-launch.mjs';

// Regression guard for the defect class that nearly shipped: `page.evaluate`
// serializes a function BODY, not its module bindings, so any constant lifted
// out of these functions becomes a ReferenceError inside the page. Every
// in-process jsdom test stays green while production silently loses ownership
// detection — only a real transport round trip can catch it.
describe('composer menu resolver browser transport', () => {
    let browser;

    beforeAll(async () => {
        browser = await chromium.launch(chromiumLaunchOptions());
    });

    afterAll(async () => {
        await browser?.close();
    });

    const PLUS_SELECTORS = ['[data-testid="composer-plus-btn"]'];

    async function resolve(page, labels, token) {
        return page.evaluate(resolveComposerMenuItem, {
            containerSelector: MENU_CONTAINER_SELECTOR,
            itemSelector: MENU_ITEM_SELECTOR,
            plusSelectors: PLUS_SELECTORS,
            labels,
            menuTextPattern: { source: MENU_OPEN_TEXT_PATTERN.source, flags: MENU_OPEN_TEXT_PATTERN.flags },
            token,
        });
    }

    it('runs both serialized functions and resolves the issue #81 popover', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <form><button data-testid="composer-plus-btn" style="width:40px;height:40px">Add</button></form>
        `);

        const snapshot = await page.evaluate(snapshotOpenMenus, {
            containerSelector: MENU_CONTAINER_SELECTOR,
        });
        expect(snapshot).toMatchObject({ ok: true, count: 0 });
        expect(typeof snapshot.token).toBe('number');

        // The connector-only popover the issue reports: no aria-controls, no
        // tool phrase, no More entry.
        await page.evaluate(() => {
            const popover = document.createElement('div');
            popover.className = 'popover';
            popover.style.cssText = 'width:300px;height:80px';
            popover.innerHTML = '<div class="__menu-item" tabindex="0" data-fill style="width:280px;height:40px">'
                + '<span>GitHub</span><span>Access repositories, issues, and pull requests</span></div>';
            document.body.appendChild(popover);
        });

        const result = await resolve(page, ['GitHub'], snapshot.token);
        expect(result).toMatchObject({ index: 0, ownership: 'appeared-on-open' });

        const text = await page.locator(MENU_ITEM_SELECTOR).nth(result.index).innerText();
        expect(text).toContain('GitHub');
        await page.close();
    });

    it('never claims an unowned popover in the page context', async () => {
        const page = await browser.newPage();
        await page.setContent(`
            <form><button data-testid="composer-plus-btn" style="width:40px;height:40px">Add</button></form>
            <div id="account-menu" class="popover" style="width:300px;height:80px">
                <div class="__menu-item" tabindex="0" data-fill style="width:280px;height:40px">GitHub</div>
            </div>
        `);

        await expect(resolve(page, ['GitHub'], null)).resolves
            .toMatchObject({ index: -1, reason: 'no-owned-menu' });
        await page.close();
    });
});
