import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import {
    CHATGPT_STOP_SELECTORS,
    anyStopButtonVisible,
    probeStopButton,
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
        // The shared helper is now `probeStopButton`, which reports a verdict.
        // The rule is unchanged: no surface may hand-roll its own stop probe,
        // or a page-wide "Stop"-labelled control could be read as streaming.
        const expected = {
            'chatgpt-deep-research.mjs': [/probeStopButton\(page\)/],
            'chatgpt-multi-turn.mjs': [/probeStopButton\(page\)/],
            'chatgpt-work-picker.mjs': [
                /probeStopButton\(scopeToMainRegion\(page\)\)/,
                /probeStopButton\(mainRegion\)/,
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

/**
 * The stop probe reports whether it could LOOK (issue #88, boundary B04).
 *
 * "No stop button" is how this codebase decides a response finished, and every
 * failure path used to collapse into that same answer. Multi-turn returns after
 * 1.5s of it, deep research extracts a report after 5s, and Work reads it as a
 * completed task — so an unreadable probe published a half-written response.
 */
describe('stop probe verdict (B04)', () => {
    /** @param {Record<string, any>} behaviour */
    function scopeWith(behaviour) {
        return { locator: (selector) => behaviour[selector] ?? { all: async () => [] } };
    }

    const [firstSelector, secondSelector] = CHATGPT_STOP_SELECTORS;

    it('Y1: a visible stop node reports visible', async () => {
        const scope = scopeWith({ [firstSelector]: { all: async () => [{ isVisible: async () => true }] } });
        await expect(probeStopButton(scope)).resolves.toBe('visible');
    });

    it('Y2: every selector examined with nothing visible reports absent', async () => {
        const scope = scopeWith({});
        await expect(probeStopButton(scope)).resolves.toBe('absent');
    });

    it('Y3: a throwing all() reports unknown', async () => {
        const scope = scopeWith({ [firstSelector]: { all: async () => { throw new Error('detached'); } } });
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('Y4: a throwing isVisible() reports unknown', async () => {
        const scope = scopeWith({
            [firstSelector]: { all: async () => [{ isVisible: async () => { throw new Error('detached'); } }] },
        });
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('Y5: one failed selector poisons an otherwise empty result', async () => {
        // The selectors are alternative paths: the stop button may have been
        // behind the one that failed.
        const scope = scopeWith({
            [firstSelector]: { all: async () => { throw new Error('detached'); } },
            [secondSelector]: { all: async () => [] },
        });
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('Y6: a visible node still wins over a failed selector', async () => {
        // Positive proof of generation; another path failing cannot retract it.
        const scope = scopeWith({
            [firstSelector]: { all: async () => { throw new Error('detached'); } },
            [secondSelector]: { all: async () => [{ isVisible: async () => true }] },
        });
        await expect(probeStopButton(scope)).resolves.toBe('visible');
    });

    it('Y7: a scope without locator() reports unknown', async () => {
        await expect(probeStopButton(null)).resolves.toBe('unknown');
        await expect(probeStopButton({})).resolves.toBe('unknown');
    });

    it('Y14: a locator() that throws synchronously reports unknown', async () => {
        const scope = { locator: () => { throw new Error('bad selector'); } };
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('Y15: a non-array all() reports unknown', async () => {
        const scope = scopeWith({ [firstSelector]: { all: async () => null } });
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('Y16: a locator without all() reports unknown', async () => {
        // Real Playwright locators always expose `all()`. Guessing at a partial
        // double's shape is exactly what this verdict exists to stop.
        const scope = scopeWith({ [firstSelector]: { first: () => ({ isVisible: async () => true }) } });
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('Y17: a matched node without isVisible() reports unknown', async () => {
        const scope = scopeWith({ [firstSelector]: { all: async () => [{}] } });
        await expect(probeStopButton(scope)).resolves.toBe('unknown');
    });

    it('anyStopButtonVisible stays a boolean view of the verdict', async () => {
        const visible = scopeWith({ [firstSelector]: { all: async () => [{ isVisible: async () => true }] } });
        const unknown = scopeWith({ [firstSelector]: { all: async () => { throw new Error('detached'); } } });
        await expect(anyStopButtonVisible(visible)).resolves.toBe(true);
        await expect(anyStopButtonVisible(unknown)).resolves.toBe(false);
    });

    it('Y18: scopeToMainRegion survives a throwing locator()', async () => {
        // It used to escape as a raw error, so the Work path never reached the
        // typed unknown contract at all.
        const page = { locator: () => { throw new Error('detached'); } };
        expect(() => scopeToMainRegion(page)).not.toThrow();
        await expect(probeStopButton(scopeToMainRegion(page))).resolves.toBe('unknown');
    });
});
