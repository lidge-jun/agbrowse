import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
    MENU_CONTAINER_SELECTOR,
    MENU_ITEM_SELECTOR,
    MENU_OPEN_TEXT_PATTERN,
    resolveComposerMenuItem,
    snapshotOpenMenus,
} from '../../web-ai/chatgpt-menu-resolver.mjs';

const PLUS_SELECTORS = [
    '[data-testid="composer-plus-btn"]',
    'button[aria-label*="Add" i][aria-haspopup="menu"]',
];

// jsdom has no layout, so visibility is modelled by an attribute. Everything
// else — selector matching, containment, document order — is real.
const isVisible = (node) => !node.hasAttribute('data-test-hidden');

function mount(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    return dom;
}

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
});

function resolve(labels, { token = null } = {}) {
    return resolveComposerMenuItem({
        containerSelector: MENU_CONTAINER_SELECTOR,
        itemSelector: MENU_ITEM_SELECTOR,
        plusSelectors: PLUS_SELECTORS,
        labels,
        menuTextPattern: { source: MENU_OPEN_TEXT_PATTERN.source, flags: MENU_OPEN_TEXT_PATTERN.flags },
        token,
        isVisible,
    });
}

function snapshot() {
    return snapshotOpenMenus({ containerSelector: MENU_CONTAINER_SELECTOR, isVisible });
}

const plusButton = '<button data-testid="composer-plus-btn">Add</button>';
const githubRow = '<div class="__menu-item" tabindex="0" data-fill><span>GitHub</span><span>Access repositories</span></div>';

describe('ChatGPT composer menu resolver (issue #81)', () => {
    it('resolves a connector-only popover that appeared after the plus click', () => {
        // The exact issue-#81 shape: no aria-controls, no tool phrase, no More.
        mount(`<form>${plusButton}</form>`);
        const before = snapshot();
        expect(before.count).toBe(0);

        document.body.insertAdjacentHTML('beforeend', `<div class="popover">${githubRow}</div>`);
        const result = resolve(['GitHub'], { token: before.token });

        expect(result.index).toBe(0);
        expect(result.ownership).toBe('appeared-on-open');
    });

    it('resolves a popover the plus button owns via aria-controls', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover">${githubRow}</div>
        `);
        const result = resolve(['GitHub']);
        expect(result).toMatchObject({ index: 0, ownership: 'aria-controls' });
    });

    it('resolves a menu identified by composer menu text', () => {
        mount(`<div role="menu"><div role="menuitem">더 보기</div><div role="menuitem">GitHub</div></div>`);
        const result = resolve(['GitHub']);
        expect(result).toMatchObject({ ownership: 'menu-text' });
        expect(result.index).toBe(1);
    });

    it('never selects from an unowned popover', () => {
        mount(`<form>${plusButton}</form><div id="account-menu" class="popover">${githubRow}</div>`);
        expect(resolve(['GitHub'])).toMatchObject({ index: -1, reason: 'no-owned-menu' });
    });

    it('disables the causal tier when the snapshot never ran', () => {
        mount(`<form>${plusButton}</form><div id="account-menu" class="popover">${githubRow}</div>`);
        // token null models a rejected snapshot evaluate
        expect(resolve(['GitHub'], { token: null })).toMatchObject({ reason: 'no-owned-menu' });
    });

    it('disables the causal tier for a stale token', () => {
        mount(`<form>${plusButton}</form>`);
        const first = snapshot();
        document.body.insertAdjacentHTML('beforeend', `<div class="popover">${githubRow}</div>`);
        snapshot();
        expect(resolve(['GitHub'], { token: first.token })).toMatchObject({ reason: 'no-owned-menu' });
    });

    it('disables the causal tier when a snapshotted container was replaced', () => {
        mount(`<form>${plusButton}</form><div id="account-menu" class="popover">${githubRow}</div>`);
        const before = snapshot();
        const account = document.querySelector('#account-menu');
        account.replaceWith(account.cloneNode(true));
        expect(resolve(['GitHub'], { token: before.token })).toMatchObject({ reason: 'no-owned-menu' });
    });

    it('resolves a hidden pre-rendered popover once the click reveals it', () => {
        mount(`<form>${plusButton}</form><div class="popover" data-test-hidden>${githubRow}</div>`);
        const before = snapshot();
        expect(before.count).toBe(0);

        document.querySelector('.popover').removeAttribute('data-test-hidden');
        expect(resolve(['GitHub'], { token: before.token })).toMatchObject({ ownership: 'appeared-on-open' });
    });

    it('deduplicates one row matched through nested containers', () => {
        mount(`<form>${plusButton}</form>`);
        const before = snapshot();
        document.body.insertAdjacentHTML('beforeend', `<div class="popover"><div role="menu">${githubRow}</div></div>`);
        const result = resolve(['GitHub'], { token: before.token });
        expect(result.index).toBeGreaterThanOrEqual(0);
        expect(result.ownership).toBe('appeared-on-open');
    });

    it('fails closed when two owned containers hold the same label', () => {
        mount(`<form>${plusButton}</form>`);
        const before = snapshot();
        document.body.insertAdjacentHTML('beforeend', `
            <div class="popover">${githubRow}</div>
            <div class="popover">${githubRow}</div>
        `);
        expect(resolve(['GitHub'], { token: before.token })).toMatchObject({ index: -1, reason: 'ambiguous' });
    });

    it('prefers aria-controls ownership over a weaker tier', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover">${githubRow}</div>
        `);
        const before = snapshot();
        document.body.insertAdjacentHTML('beforeend', `<div class="popover">${githubRow}</div>`);
        const result = resolve(['GitHub'], { token: before.token });
        expect(result.ownership).toBe('aria-controls');
        expect(result.index).toBe(0);
    });

    it('ignores hidden containers and hidden rows', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div class="popover" data-test-hidden>${githubRow}</div>
            <div id="menu-x" class="popover">${githubRow}</div>
        `);
        const result = resolve(['GitHub']);
        expect(result.ownership).toBe('aria-controls');
    });

    it('does not treat a focusable non-row child as a menu item', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover"><div tabindex="0"><span>GitHub</span></div></div>
        `);
        expect(resolve(['GitHub'])).toMatchObject({ index: -1, reason: 'label-not-found' });
    });

    it('reports ownership for an empty-label probe when an owned menu is open', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover">${githubRow}</div>
        `);
        expect(resolve([])).toMatchObject({ reason: 'label-not-found', ownership: 'aria-controls' });
    });

    it('reports no-owned-menu for an empty-label probe over unowned popovers', () => {
        mount(`<form>${plusButton}</form><div class="popover">${githubRow}</div>`);
        expect(resolve([])).toMatchObject({ reason: 'no-owned-menu' });
    });

    it('reports no-open-menu when nothing is visible', () => {
        mount(`<form>${plusButton}</form>`);
        expect(resolve(['GitHub'])).toMatchObject({ index: -1, reason: 'no-open-menu' });
    });

    it('returns the checked state so an already-selected row is not clicked', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover"><div role="menuitem" aria-checked="true">GitHub</div></div>
        `);
        expect(resolve(['GitHub']).checked).toBe('true');
    });

    it('preserves label-not-found when an owned menu lacks the label', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover"><div role="menuitem">Canva</div></div>
        `);
        expect(resolve(['GitHub'])).toMatchObject({ index: -1, reason: 'label-not-found' });
    });

    it('writes no bookkeeping attributes into the document', () => {
        mount(`<form>${plusButton}</form><div class="popover">${githubRow}</div>`);
        snapshot();
        resolve(['GitHub']);
        expect(document.body.innerHTML).not.toMatch(/agbrowse/i);
    });

    it('declares its registry key inside every serialized function body', () => {
        // page.evaluate serializes the body only: a module-scope constant would
        // be a ReferenceError inside the page.
        for (const fn of [snapshotOpenMenus, resolveComposerMenuItem]) {
            expect(fn.toString()).toContain('__agbrowseComposerMenuEpoch');
        }
        expect(resolveComposerMenuItem.toString()).toContain('OWNERSHIP_RANK');
    });
});

describe('triggering-row aria-controls ownership (G81b)', () => {
    function resolveWithOwner(labels, { ownedContainerId = null, token = null } = {}) {
        return resolveComposerMenuItem({
            containerSelector: MENU_CONTAINER_SELECTOR,
            itemSelector: MENU_ITEM_SELECTOR,
            plusSelectors: PLUS_SELECTORS,
            labels,
            menuTextPattern: { source: MENU_OPEN_TEXT_PATTERN.source, flags: MENU_OPEN_TEXT_PATTERN.flags },
            token,
            ownedContainerId,
            isVisible,
        });
    }

    it('resolves a portaled submenu owned by the More row', () => {
        // Hover-opened, no composer menu text, no causal token: only the
        // triggering row's aria-controls can confer ownership.
        mount(`
            <form>${plusButton}</form>
            <div class="popover"><div class="__menu-item" tabindex="0" data-fill aria-controls="submenu-x">More</div></div>
            <div id="submenu-x" class="popover">${githubRow}</div>
        `);
        const result = resolveWithOwner(['GitHub'], { ownedContainerId: 'submenu-x' });
        expect(result).toMatchObject({ ownership: 'aria-controls' });
        expect(result.index).toBeGreaterThanOrEqual(0);
    });

    it('ignores an owned container that is hidden', () => {
        mount(`
            <form>${plusButton}</form>
            <div id="submenu-x" class="popover" data-test-hidden>${githubRow}</div>
        `);
        // The row inside a hidden container is itself hidden, so `index: -1` alone
        // would pass even if the visibility check on the CONTAINER were removed.
        // Make the container visible but keep the row hidden — then only the
        // container-level check can produce `no-owned-menu`.
        expect(resolveWithOwner(['GitHub'], { ownedContainerId: 'submenu-x' }))
            .toMatchObject({ index: -1, reason: 'no-open-menu' });
    });

    it('does not confer ownership on a hidden container holding a visible row', () => {
        // Isolates the container visibility check: the row would otherwise be a
        // perfectly good candidate.
        mount(`
            <form>${plusButton}</form>
            <div id="submenu-x" class="popover" data-test-hidden><div class="__menu-item" tabindex="0" data-fill><span>GitHub</span></div></div>
        `);
        const doc = globalThis.document;
        // Force the ROW visible while its container stays hidden.
        doc.querySelector('#submenu-x .__menu-item').setAttribute('data-force-visible', '');
        const result = resolveComposerMenuItem({
            containerSelector: MENU_CONTAINER_SELECTOR,
            itemSelector: MENU_ITEM_SELECTOR,
            plusSelectors: PLUS_SELECTORS,
            labels: ['GitHub'],
            menuTextPattern: { source: MENU_OPEN_TEXT_PATTERN.source, flags: MENU_OPEN_TEXT_PATTERN.flags },
            token: null,
            ownedContainerId: 'submenu-x',
            isVisible: (node) => node.hasAttribute('data-force-visible') || !node.hasAttribute('data-test-hidden'),
        });
        expect(result).toMatchObject({ index: -1, reason: 'no-open-menu' });
    });

    it('does NOT confer ownership on an unrelated row pointing elsewhere', () => {
        // The blocker this row exists to prevent: passing a SELECTOR would have
        // admitted this popover; passing the observed id does not.
        mount(`
            <form>${plusButton}</form>
            <div class="popover"><div class="__menu-item" tabindex="0" data-fill aria-controls="unrelated">Settings</div></div>
            <div id="unrelated" class="popover">${githubRow}</div>
        `);
        expect(resolveWithOwner(['GitHub'], { ownedContainerId: null }))
            .toMatchObject({ index: -1, reason: 'no-owned-menu' });
    });

    it('confers ownership on EXACTLY the observed id, not on other aria-controls rows', () => {
        // The sharper form: an observed id IS supplied, and a DIFFERENT row also
        // carries aria-controls pointing at the popover holding the target. Only
        // the observed container may be owned, so the target stays unreachable.
        mount(`
            <form>${plusButton}</form>
            <div class="popover">
                <div class="__menu-item" tabindex="0" data-fill aria-controls="submenu-x"><span>More</span></div>
                <div class="__menu-item" tabindex="0" data-fill aria-controls="unrelated"><span>Settings</span></div>
            </div>
            <div id="submenu-x" class="popover"><div class="__menu-item" tabindex="0" data-fill><span>Canva</span></div></div>
            <div id="unrelated" class="popover">${githubRow}</div>
        `);
        expect(resolveWithOwner(['GitHub'], { ownedContainerId: 'submenu-x' }))
            .toMatchObject({ index: -1 });
    });

    it('ignores a nonexistent owned id without throwing', () => {
        mount(`<form>${plusButton}</form><div class="popover">${githubRow}</div>`);
        expect(resolveWithOwner(['GitHub'], { ownedContainerId: 'does-not-exist' }))
            .toMatchObject({ index: -1, reason: 'no-owned-menu' });
    });

    it('behaves exactly as before when no owned id is supplied', () => {
        mount(`
            <form><button data-testid="composer-plus-btn" aria-controls="menu-x">Add</button></form>
            <div id="menu-x" class="popover">${githubRow}</div>
        `);
        expect(resolveWithOwner(['GitHub'])).toMatchObject({ index: 0, ownership: 'aria-controls' });
    });

    it('wires the observed control id through the More path', () => {
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt-tools.mjs'), 'utf8');
        expect(src).toContain("more.locator.getAttribute('aria-controls')");
        expect(src).toContain('resolveMenuItemLocator(page, labels, null, moreControls)');
        expect(src).toContain('clicked ? clickEpoch : null, moreControls');
        // A selector must NEVER be passed as the owned container.
        expect(src).not.toMatch(/ownedContainerId: MENU_ITEM_SELECTOR/);
    });
});
