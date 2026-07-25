import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
    anyStopButtonVisible,
    scopeToMainRegion,
} from '../../web-ai/chatgpt-response-dom.mjs';

/**
 * DOM-backed locator adapter with Playwright's contract: `locator(selector)`
 * resolves the selector for real (so CSS semantics — form scoping, :not()
 * exclusions — are genuinely exercised), `all()` yields every match, and
 * `isVisible()` reports per-node visibility.
 *
 * Visibility is modelled with a `data-hidden` attribute because jsdom has no
 * layout; every other aspect of the selector match is real.
 */
function domScope(html, { root = 'body' } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    const document = dom.window.document;

    const wrap = (rootNode) => ({
        locator(selector) {
            const nodes = rootNode ? Array.from(rootNode.querySelectorAll(selector)) : [];
            const node = (element) => ({
                isVisible: async () => Boolean(element) && !element.hasAttribute('data-hidden'),
                locator: (nested) => wrap(element).locator(nested),
            });
            return {
                all: async () => nodes.map(node),
                count: async () => nodes.length,
                nth: (index) => node(nodes[index]),
                first: () => node(nodes[0]),
                locator: (nested) => wrap(nodes[0]).locator(nested),
            };
        },
    });

    const rootNode = root === 'body' ? document.body : document.querySelector(root);
    return { scope: wrap(rootNode), document };
}

describe('ChatGPT stop-button scoping (G1b)', () => {
    it('ignores a dictation control rendered inside the composer form', async () => {
        // Real selector semantics: the :not() exclusions must reject this node.
        const { scope } = domScope(`
            <main><form>
                <button aria-label="Stop dictation">mic</button>
                <button aria-label="Stop voice mode">voice</button>
                <button aria-label="Stop reading aloud">read</button>
            </form></main>
        `);
        await expect(anyStopButtonVisible(scope)).resolves.toBe(false);
    });

    it('ignores an aria-only stop control rendered outside any form', async () => {
        const { scope } = domScope('<aside><button aria-label="Stop generating">x</button></aside>');
        await expect(anyStopButtonVisible(scope)).resolves.toBe(false);
    });

    it('matches a real form-scoped "Stop generating" control', async () => {
        const { scope } = domScope('<main><form><button aria-label="Stop generating">x</button></form></main>');
        await expect(anyStopButtonVisible(scope)).resolves.toBe(true);
    });

    it('matches the testid control anywhere on the page', async () => {
        const { scope } = domScope('<div><button data-testid="stop-button">x</button></div>');
        await expect(anyStopButtonVisible(scope)).resolves.toBe(true);
    });

    it('treats a present but hidden stop node as not streaming', async () => {
        // Regression guard for the previous `count() > 0` predicate in
        // chatgpt-multi-turn.mjs, which reported streaming for hidden nodes.
        const { scope } = domScope('<button data-testid="stop-button" data-hidden>x</button>');
        await expect(anyStopButtonVisible(scope)).resolves.toBe(false);
    });

    it('finds a visible stop node even when a hidden one precedes it', async () => {
        // A `.first()`-only probe reports idle here — premature completion in
        // the multi-turn poll loop.
        const { scope } = domScope(`
            <button data-testid="stop-button" data-hidden>stale</button>
            <button data-testid="stop-button">live</button>
        `);
        await expect(anyStopButtonVisible(scope)).resolves.toBe(true);
    });

    it('scopes away a stop button rendered outside main', async () => {
        const html = `
            <nav><button data-testid="stop-button">sidebar</button></nav>
            <main><form><textarea></textarea></form></main>
        `;
        const { scope: pageScope } = domScope(html);
        const { scope: mainScope } = domScope(html, { root: 'main' });

        await expect(anyStopButtonVisible(pageScope)).resolves.toBe(true);
        await expect(anyStopButtonVisible(mainScope)).resolves.toBe(false);
    });

    it('returns the main locator for a page that exposes one', () => {
        const main = { locator: () => ({}) };
        const page = { locator: (selector) => (selector === 'main' ? main : null) };
        expect(scopeToMainRegion(page)).toBe(main);
    });

    it('falls back to the page for locator-less doubles', () => {
        const page = { locator: () => null };
        expect(scopeToMainRegion(page)).toBe(page);
        expect(scopeToMainRegion(undefined)).toBe(undefined);
    });

    it('returns false for a scope without a locator', async () => {
        await expect(anyStopButtonVisible(null)).resolves.toBe(false);
        await expect(anyStopButtonVisible({})).resolves.toBe(false);
    });

    it('routes every ChatGPT streaming probe through the shared helper', () => {
        const expected = {
            'chatgpt-deep-research.mjs': [/anyStopButtonVisible\(page\)/],
            'chatgpt-multi-turn.mjs': [/anyStopButtonVisible\(page\)/],
            'chatgpt-work-picker.mjs': [
                /anyStopButtonVisible\(scopeToMainRegion\(page\)\)/,
                /anyStopButtonVisible\(mainRegion\)/,
            ],
        };
        for (const [file, callPatterns] of Object.entries(expected)) {
            const src = readFileSync(join(process.cwd(), 'web-ai', file), 'utf8');
            for (const pattern of callPatterns) {
                expect(src, `${file} must CALL the shared probe as ${pattern}`).toMatch(pattern);
            }
            expect(src, `${file} must not keep a page-wide Stop matcher`)
                .not.toMatch(/locator\('button\[aria-label\*="Stop" i\]'\)/);
        }
    });
});
