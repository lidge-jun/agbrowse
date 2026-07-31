import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    CHATGPT_ASSISTANT_SELECTORS,
    readAssistantSnapshotSources,
    resolveTopLevelAssistantTurns,
} from '../../web-ai/chatgpt-response-dom.mjs';

const GLOBALS = ['window', 'document', 'HTMLElement', 'Node'];
let saved = null;

function install(html) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
    if (!saved) saved = Object.fromEntries(GLOBALS.map(key => [key, globalThis[key]]));
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.Node = dom.window.Node;
    // jsdom has no layout: make every element visible unless opted out.
    for (const element of dom.window.document.querySelectorAll('*')) {
        const hidden = element.hasAttribute('data-test-hidden');
        element.getBoundingClientRect = () => ({
            width: hidden ? 0 : 100, height: hidden ? 0 : 20,
            left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, toJSON() {},
        });
    }
    return dom;
}

function read(html) {
    install(html);
    return readAssistantSnapshotSources({
        assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
        resolverSource: resolveTopLevelAssistantTurns.toString(),
    });
}

afterEach(() => {
    if (!saved) return;
    for (const key of GLOBALS) {
        if (saved[key] === undefined) delete globalThis[key];
        else globalThis[key] = saved[key];
    }
});

const user = (text = 'question') => `<div data-message-author-role="user">${text}</div>`;
const md = (text) => `<div class="markdown">${text}</div>`;

describe('wrapperless completion correlation (G11)', () => {
    it('accepts markdown that DOM-follows the latest user node', () => {
        const result = read(`${user()}${md('new answer')}`);
        expect(result.wrapperless).toHaveLength(1);
        expect(result.wrapperless[0]).toMatchObject({ text: 'new answer', source: 'wrapperless', turnIndex: -1 });
    });

    it('rejects markdown that precedes the latest user node', () => {
        const result = read(`${md('old answer')}${user()}`);
        expect(result.wrapperless).toHaveLength(0);
    });

    it('rejects an old answer sitting between two user nodes', () => {
        const result = read(`${user('first')}${md('old answer')}${user('resend')}`);
        expect(result.wrapperless).toHaveLength(0);
    });

    it('fails closed when there is no user node at all', () => {
        expect(read(md('orphan')).wrapperless).toHaveLength(0);
    });

    it('excludes markdown inside a recognized wrapper', () => {
        const result = read(`${user()}<div data-message-author-role="assistant">${md('wrapped')}</div>`);
        expect(result.wrapperless).toHaveLength(0);
        expect(result.wrapped.length).toBeGreaterThan(0);
    });

    it('excludes hidden and empty markdown', () => {
        const result = read(`${user()}<div class="markdown" data-test-hidden>hidden</div><div class="markdown">   </div>`);
        expect(result.wrapperless).toHaveLength(0);
    });

    it('deduplicates a node matching several markdown selectors', () => {
        const result = read(`${user()}<div class="markdown" data-message-content>once</div>`);
        expect(result.wrapperless).toHaveLength(1);
    });

    it('picks the DOCUMENT-last user node across mixed selectors', () => {
        // The OLD selector-order loop iterated USER_SELECTORS and kept the last
        // node of the last selector, so a `[data-turn="user"]` appearing FIRST in
        // the document would win over a later `[data-message-author-role="user"]`
        // and an old answer between them would look "new". Document order is the
        // only correct rule; this fixture fails under the old algorithm.
        const html = `<div data-turn="user">old user</div>`
            + `<div class="markdown">old answer</div>`
            + `<div data-message-author-role="user">new user</div>`;
        const result = read(html);
        expect(result.wrapperless).toHaveLength(0);
    });

    it('shares one document-order coordinate space across sources', () => {
        const html = `${user()}${md('wrapperless first')}`
            + `<div data-message-author-role="assistant">wrapped later</div>`;
        const result = read(html);
        const all = [...result.wrapped, ...result.wrapperless].sort((a, b) => a.domOrder - b.domOrder);
        expect(all.at(-1).text).toBe('wrapped later');
        // Distinct nodes never share a coordinate.
        expect(new Set(all.map(s => s.domOrder)).size).toBe(all.length);
    });

    it('wires the split reader and the ordering-gate skip into the poll loop', () => {
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');
        expect(src).toContain('readAssistantSnapshotsSplit');
        expect(src).toContain("latestSnapshot?.source !== 'wrapperless'");
        expect(src).toContain("'source' in sample && sample.source === 'wrapperless'");
        expect(src).toMatch(/sort\(\(a, b\) => \(a\.domOrder \?\? 0\) - \(b\.domOrder \?\? 0\)\)/);
    });

    it('gates both legacy fallbacks on a FAILED acquisition, never a successful empty one', () => {
        // `countAssistantMessages` is only reachable through the send path, so its
        // `ok` gate is pinned structurally: the fallback must be guarded by `ok`,
        // and must never trigger on `wrapped.length === 0`. Without this, a
        // successful empty read on a user-only page lets the legacy locator reader
        // count the USER article, shifting `baseline.assistantCount` to 1 and
        // silently dropping the first real answer.
        const src = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');

        const counter = src.slice(src.indexOf('async function countAssistantMessages'));
        const counterBody = counter.slice(0, counter.indexOf('\n}\n'));
        expect(counterBody).toContain('if (split.ok) return split.wrapped.length;');
        expect(counterBody).not.toMatch(/if \(split\.wrapped\.length\)/);
        expect(counterBody).not.toMatch(/if \(wrapped\.length\)/);

        // Poll-loop fallback: same rule.
        // The fallback is entered on `!split.ok` and never on emptiness. It used
        // to read `const wrapped = split.ok ? …`; WP14 split it into a block so
        // the fallback's OWN read failure can be handled, but the gate is the
        // same condition.
        expect(src).toContain('if (!split.ok) {');
        expect(src).not.toMatch(/if \(!split\.wrapped\.length\)/);
        expect(src).not.toMatch(/\(split\.wrapped\.length \|\| split\.wrapperless\.length\)/);
    });
});
