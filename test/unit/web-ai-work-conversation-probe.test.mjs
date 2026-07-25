import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    detectChatGptWorkConversation,
    detectChatGptComposerSurface,
    readWorkConversationState,
} from '../../web-ai/product-surfaces.mjs';
import { selectChatGptModel } from '../../web-ai/chatgpt-model.mjs';

/**
 * Drive the browser-context probe over a real jsdom document, the same dual-use
 * pattern chatgpt-response-dom.mjs uses: production serializes it into
 * page.evaluate, tests call it in process.
 */
const GLOBAL_KEYS = ['window', 'document', 'location', 'HTMLElement', 'URL'];
/** @type {Record<string, unknown>} */
let savedGlobals = null;

function installDom(html, url) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url });
    // Snapshot the ORIGINAL descriptors once: `delete globalThis.URL` would drop
    // Node's native URL and silently break the conversation-url parser in every
    // later test.
    if (!savedGlobals) {
        savedGlobals = Object.fromEntries(GLOBAL_KEYS.map(key => [key, globalThis[key]]));
    }
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    globalThis.HTMLElement = dom.window.HTMLElement;
    globalThis.URL = dom.window.URL;
    return dom;
}

function runProbe(html, { url = 'https://chatgpt.com/c/abc-123', expectedId = 'abc-123' } = {}) {
    installDom(html, url);
    return readWorkConversationState({ expectedId });
}

/** Playwright-shaped page whose evaluate runs the probe against a jsdom document. */
function makePage(html, { url = 'https://chatgpt.com/c/abc-123', evaluate } = {}) {
    const runInJsdom = async (fn, arg) => {
        installDom(html, url);
        try {
            return fn(arg);
        } finally {
            restoreGlobals();
        }
    };
    return { url: () => url, evaluate: evaluate || runInJsdom };
}

function restoreGlobals() {
    if (!savedGlobals) return;
    for (const key of GLOBAL_KEYS) {
        if (savedGlobals[key] === undefined) delete globalThis[key];
        else globalThis[key] = savedGlobals[key];
    }
}

const badge = '<span class="flex items-center"><span class="shrink-0">Work</span></span>';
const anchor = (extra = '', inner = '') =>
    `<a class="__menu-item" href="/c/abc-123" ${extra}>Conversation title${inner}</a>`;

afterEach(() => {
    restoreGlobals();
});

describe('ChatGPT Work conversation probe (G17/G18)', () => {
    it('classifies a Work conversation from the structured sidebar badge', () => {
        expect(runProbe(anchor('', badge))).toMatchObject({ state: 'work' });
    });

    it('aggregates duplicate anchors instead of trusting the first', () => {
        expect(runProbe(`${anchor('aria-label="Conversation title"')}${anchor('', badge)}`))
            .toMatchObject({ state: 'work' });
    });

    it('classifies Chat only from positive metadata', () => {
        expect(runProbe(anchor('aria-label="Conversation title"'))).toMatchObject({ state: 'chat' });
    });

    it('stays unresolved during a hydration race with no aria-label', () => {
        expect(runProbe(anchor())).toMatchObject({
            state: 'unresolved',
            evidence: { reason: 'no-positive-chat-metadata' },
        });
    });

    it('stays unresolved for an aria-label ending in ", work"', () => {
        expect(runProbe(anchor('aria-label="Some title, work"'))).toMatchObject({
            state: 'unresolved',
            evidence: { reason: 'no-positive-chat-metadata' },
        });
    });

    it('is not fooled by a conversation merely titled Work', () => {
        // Free-form text, not a structured leaf badge.
        expect(runProbe(`<a class="__menu-item" href="/c/abc-123" aria-label="Work notes">Work notes</a>`))
            .toMatchObject({ state: 'chat' });
    });

    it.each([
        ['missing shrink-0', '<span class="flex items-center"><span>Work</span></span>'],
        ['dir attribute present', '<span class="flex items-center"><span class="shrink-0" dir="auto">Work</span></span>'],
        ['badge has child elements', '<span class="flex items-center"><span class="shrink-0"><b>Work</b></span></span>'],
        ['wrong parent structure', '<div class="flex items-center"><span class="shrink-0">Work</span></div>'],
        ['text is not exactly work', '<span class="flex items-center"><span class="shrink-0">Workspace</span></span>'],
    ])('rejects a malformed Work badge: %s', (_label, malformed) => {
        // Each structural constraint must carry its own weight: without these,
        // ordinary sidebar text could be promoted to Work evidence.
        expect(runProbe(anchor('aria-label="Conversation title"', malformed)))
            .toMatchObject({ state: 'chat' });
    });

    it('ignores foreign-origin anchors', () => {
        expect(runProbe(`<a class="__menu-item" href="https://evil.example/c/abc-123">x${badge}</a>`))
            .toMatchObject({ state: 'unresolved', evidence: { reason: 'conversation-anchor-not-found' } });
    });

    it('ignores a substring conversation id', () => {
        expect(runProbe(`<a class="__menu-item" href="/c/abc-1234">x${badge}</a>`))
            .toMatchObject({ state: 'unresolved', evidence: { reason: 'conversation-anchor-not-found' } });
    });

    it('ignores links inside message content', () => {
        expect(runProbe(`<a href="/c/abc-123">inline link${badge}</a>`))
            .toMatchObject({ state: 'unresolved', evidence: { reason: 'conversation-anchor-not-found' } });
    });

    it('fails closed when the page navigated between check and probe', () => {
        expect(runProbe(anchor('', badge), { expectedId: 'other-id' })).toMatchObject({
            state: 'unresolved',
            evidence: { reason: 'navigation-race' },
        });
    });
});

describe('Work conversation probe wrapper (URL contract)', () => {
    it('never probes a non-conversation page', async () => {
        let called = false;
        const page = makePage('', {
            url: 'https://chatgpt.com/',
            evaluate: async () => { called = true; return null; },
        });
        await expect(detectChatGptWorkConversation(page)).resolves.toMatchObject({
            evidence: { reason: 'not-a-conversation-url' },
        });
        expect(called).toBe(false);
    });

    it.each([
        ['query lookalike', 'https://chatgpt.com/?next=/c/abc-123'],
        ['fragment lookalike', 'https://chatgpt.com/#/c/abc-123'],
        ['share link', 'https://chatgpt.com/share/abc-123'],
    ])('treats a %s as a non-conversation url', async (_label, url) => {
        const page = makePage('', { url, evaluate: async () => { throw new Error('should not run'); } });
        await expect(detectChatGptWorkConversation(page)).resolves.toMatchObject({
            evidence: { reason: 'not-a-conversation-url' },
        });
    });

    it('accepts a GPT-prefixed conversation with a trailing slash', async () => {
        const page = makePage(anchor('', badge).replace('/c/abc-123', '/g/gpt-slug/c/ABC-123'), {
            url: 'https://chat.openai.com/g/gpt-slug/c/ABC-123/',
        });
        await expect(detectChatGptWorkConversation(page)).resolves.toMatchObject({ state: 'work' });
    });

    it('fails closed with a conversation id when evaluate rejects', async () => {
        const page = makePage('', { evaluate: async () => { throw new Error('detached'); } });
        await expect(detectChatGptWorkConversation(page)).resolves.toMatchObject({
            state: 'unresolved',
            evidence: { reason: 'probe-failed', conversationId: 'abc-123' },
        });
    });

    it('fails closed when the page cannot evaluate at all', async () => {
        await expect(detectChatGptWorkConversation({ url: () => 'https://chatgpt.com/c/abc-123' }))
            .resolves.toMatchObject({ evidence: { reason: 'probe-unavailable', conversationId: 'abc-123' } });
    });

    it('survives a throwing url accessor', async () => {
        const page = { url: () => { throw new Error('detached'); }, evaluate: async () => null };
        await expect(detectChatGptWorkConversation(page)).resolves.toMatchObject({
            evidence: { reason: 'not-a-conversation-url' },
        });
    });
});

/** A page with no surface radios, so detection falls through to the probe. */
function radiolessPage(html, url = 'https://chatgpt.com/c/abc-123') {
    const page = makePage(html, { url });
    return {
        ...page,
        locator: () => ({ count: async () => 0, nth: () => ({}), first: () => ({ isVisible: async () => false }) }),
    };
}

/**
 * A page carrying unrelated `role=radio` controls but no Chat/Work toggle: the
 * radio count is non-zero, yet the surface is still legacy.
 */
function unrelatedRadioPage(html, url = 'https://chatgpt.com/c/abc-123') {
    const page = makePage(html, { url });
    const radio = {
        isVisible: async () => true,
        textContent: async () => 'Voice',
        getAttribute: async () => null,
    };
    return {
        ...page,
        locator: () => ({ count: async () => 1, nth: () => radio, first: () => radio }),
    };
}

describe('model-mutation guard on radio-less conversation pages (G18)', () => {
    it('reports a Work conversation as the work surface', async () => {
        await expect(detectChatGptComposerSurface(radiolessPage(anchor('', badge)))).resolves.toMatchObject({
            ui: 'legacy',
            surface: 'work',
        });
    });

    it('still probes when unrelated radios exist without a Chat/Work toggle', async () => {
        // A single unrelated role=radio must not skip conversation detection and
        // let a Work conversation read as "no surface".
        await expect(detectChatGptComposerSurface(unrelatedRadioPage(anchor('', badge)))).resolves.toMatchObject({
            ui: 'legacy',
            surface: 'work',
        });
    });

    it('blocks a model mutation on a Work conversation behind unrelated radios', async () => {
        const error = await selectChatGptModel(unrelatedRadioPage(anchor('', badge)), 'thinking')
            .then(() => null, err => err);
        expect(error).toMatchObject({
            errorCode: 'capability.unsupported',
            stage: 'provider-surface-preflight',
        });
    });

    it('blocks a model mutation on a Work conversation', async () => {
        const error = await selectChatGptModel(radiolessPage(anchor('', badge)), 'thinking')
            .then(() => null, err => err);
        expect(error).toMatchObject({
            errorCode: 'capability.unsupported',
            stage: 'provider-surface-preflight',
            retryHint: 'switch-to-chat',
        });
    });

    it('blocks a model mutation when the conversation mode cannot be established', async () => {
        // Collapsed sidebar / hydration race: the URL says conversation, the DOM
        // cannot prove which mode, so mutating the model is unsafe.
        const error = await selectChatGptModel(radiolessPage(anchor()), 'thinking')
            .then(() => null, err => err);
        expect(error).toMatchObject({ errorCode: 'capability.unsupported' });
        expect(error.message).toContain('conversation-unresolved');
    });

    it('allows a model mutation on a verified Chat conversation', async () => {
        const error = await selectChatGptModel(
            radiolessPage(anchor('aria-label="Conversation title"')),
            'thinking',
        ).then(() => null, err => err);
        // It may still fail later for a missing model menu, but never at the
        // surface preflight.
        expect(error?.stage).not.toBe('provider-surface-preflight');
    });

    it('does not block an ordinary non-conversation page', async () => {
        const error = await selectChatGptModel(radiolessPage('', 'https://chatgpt.com/'), 'thinking')
            .then(() => null, err => err);
        expect(error?.stage).not.toBe('provider-surface-preflight');
    });

    it('stays zero-touch when no model, effort or family was requested', async () => {
        // The guard must run AFTER the zero-request early return, so an ordinary
        // send on a Work conversation is never blocked.
        await expect(selectChatGptModel(radiolessPage(anchor('', badge)), undefined)).resolves.toBeNull();
    });
});
