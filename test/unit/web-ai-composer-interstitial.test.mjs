import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyComposerInterstitial } from '../../web-ai/composer-interstitial.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';
import { grokSendWebAi } from '../../web-ai/grok-live.mjs';
import { geminiSendWebAi } from '../../web-ai/gemini-live.mjs';

const page = { url: () => 'https://grok.com/' };
const cause = new WebAiError({
    errorCode: 'provider.composer-not-visible',
    stage: 'composer-prereq',
    vendor: 'grok',
    retryHint: 're-snapshot',
    message: 'grok composer not visible',
});

const challenge = {
    kind: 'cloudflare-challenge',
    evidence: 'challenge title',
    url: 'https://grok.com/',
    retryHint: 'wait-and-retry',
};
const login = { kind: 'login-required', evidence: 'log in', url: 'https://gemini.google.com/', retryHint: 'login' };

afterEach(() => {
    vi.restoreAllMocks();
});

describe('composer interstitial classification (G13b)', () => {
    it('re-classifies a Grok challenge and preserves the original cause', async () => {
        const error = await classifyComposerInterstitial(page, 'grok', cause, { detect: () => challenge });

        expect(error).toBeInstanceOf(WebAiError);
        expect(error).toMatchObject({
            errorCode: 'provider.interstitial',
            stage: 'provider-interstitial',
            vendor: 'grok',
            retryHint: 'wait-and-retry',
        });
        expect(error.evidence).toMatchObject({ kind: 'cloudflare-challenge' });
        expect(error.cause).toBe(cause);
    });

    it('re-classifies a Gemini login wall with the detector retry hint', async () => {
        const error = await classifyComposerInterstitial(page, 'gemini', cause, { detect: async () => login });
        expect(error).toMatchObject({
            errorCode: 'provider.interstitial',
            vendor: 'gemini',
            retryHint: 'login',
        });
    });

    it('passes the provider shell selectors to the detector', async () => {
        let seen = null;
        await classifyComposerInterstitial(page, 'grok', cause, {
            detect: (_page, options) => { seen = options; return challenge; },
        });
        expect(seen.shellSelectors.composer).toContain('.ProseMirror');
    });

    it('leaves the original error standing when no interstitial is found', async () => {
        await expect(classifyComposerInterstitial(page, 'grok', cause, { detect: () => ({ kind: 'none' }) }))
            .resolves.toBeNull();
    });

    it('never lets a probe failure replace the composer error', async () => {
        // rejected promise, synchronous throw, and a non-function injection all
        // have to degrade to null rather than escaping as a TypeError.
        await expect(classifyComposerInterstitial(page, 'grok', cause, {
            detect: async () => { throw new Error('probe exploded'); },
        })).resolves.toBeNull();

        await expect(classifyComposerInterstitial(page, 'grok', cause, {
            detect: () => { throw new Error('probe exploded'); },
        })).resolves.toBeNull();
    });

    it('falls back to the real detector when the injected seam is not a function', async () => {
        // A truthy non-function must not be called; the REAL detector runs. On an
        // unsupported host it finds nothing, which is what proves the fallback
        // happened rather than the seam being invoked.
        await expect(classifyComposerInterstitial(
            { url: () => 'https://example.com/', title: async () => '', innerText: async () => '' },
            'grok',
            cause,
            { detect: /** @type {any} */ (true) },
        )).resolves.toBeNull();
    });

    it('ignores an unknown vendor without calling the detector', async () => {
        let called = false;
        const result = await classifyComposerInterstitial(page, /** @type {any} */ ('perplexity'), cause, {
            detect: () => { called = true; return challenge; },
        });
        expect(result).toBeNull();
        expect(called).toBe(false);
    });

    it('is actually consumed by both provider submit paths', () => {
        // A helper nobody calls is the failure mode this row exists to close:
        // interstitial.mjs itself shipped unconsumed for a full round.
        for (const [file, vendor] of [['grok-live.mjs', 'grok'], ['gemini-live.mjs', 'gemini']]) {
            const src = readFileSync(join(process.cwd(), 'web-ai', file), 'utf8');
            expect(src, `${file} must call the classifier`)
                .toMatch(new RegExp(`classifyComposerInterstitial\\(page, '${vendor}'`));
            expect(src, `${file} must fall back to the composer error`)
                .toMatch(/\)\) \|\| notVisible;/);
        }
    });

    it.each([
        ['grok', grokSendWebAi, 'https://grok.com/', challenge, 'wait-and-retry'],
        ['gemini', geminiSendWebAi, 'https://gemini.google.com/app', login, 'login'],
    ])('behaviourally re-classifies a %s composer miss', async (vendor, send, url, verdict, retryHint) => {
        // Source-shape assertions can pass on a bare import, so drive the real
        // submit path with a page whose composer selectors never resolve.
        // The composer probes poll against a real 10s wall-clock deadline. Drive
        // a virtual clock instead so the behavioural test costs milliseconds.
        let now = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        // Nothing on the page resolves: this is a challenge/login shell.
        const emptyLocator = {
            first: () => emptyLocator,
            nth: () => emptyLocator,
            all: async () => [],
            count: async () => 0,
            isVisible: async () => false,
            evaluateAll: async () => [],
            textContent: async () => '',
            innerText: async () => '',
            getAttribute: async () => null,
        };
        const page = {
            url: () => url,
            goto: async () => undefined,
            locator: () => emptyLocator,
            getByText: () => emptyLocator,
            waitForTimeout: async (ms = 250) => { now += Number(ms) || 250; },
            evaluate: async () => null,
            title: async () => '',
            innerText: async () => '',
            keyboard: { press: async () => undefined, down: async () => undefined, up: async () => undefined },
        };
        const deps = {
            getPage: async () => page,
            detectInterstitial: () => verdict,
        };

        const error = await send(deps, { prompt: 'hello' }).then(
            () => null,
            (err) => err,
        );

        expect(error, `${vendor} send should have thrown`).toBeTruthy();
        expect(error.errorCode, `${vendor} must surface the interstitial, not the composer miss`)
            .toBe('provider.interstitial');
        expect(error).toMatchObject({ stage: 'provider-interstitial', vendor, retryHint });
        expect(error.cause?.errorCode).toBe('provider.composer-not-visible');
    });
});
