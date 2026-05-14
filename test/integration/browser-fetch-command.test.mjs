import { describe, expect, it } from 'vitest';
import { runAdaptiveFetch } from '../../skills/browser/adaptive-fetch/index.mjs';
import { getFetchBrowserPage, BrowserRequiredError } from '../../skills/browser/adaptive-fetch/browser-runtime.mjs';
import { fetchTextCandidate } from '../../skills/browser/adaptive-fetch/fetcher.mjs';

describe('adaptive fetch browser escalation', () => {
    it('does not call browser dependencies in browser never mode', async () => {
        let browserCalled = false;
        const result = await runAdaptiveFetch({
            url: 'https://example.com/a',
            browserMode: 'never',
            publicEndpoints: false,
        }, {
            fetch: async () => new Response('<title>Weak</title><p>Short</p>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
            getPage: async () => {
                browserCalled = true;
                return fakePage({});
            },
        });
        expect(browserCalled).toBe(false);
        expect(result.chromeUsed).toBe(false);
    });

    it('surfaces archive fallback as deferred instead of silently ignoring the flag', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/a',
            browserMode: 'never',
            publicEndpoints: false,
            allowArchive: true,
        }, {
            fetch: async () => new Response('<title>Weak</title><p>Short</p>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
        });
        expect(result.warnings).toContain('archive-fallback-deferred');
    });

    it('does not fall back from isolated browser session to an existing page dependency', async () => {
        let existingCalled = false;
        await expect(getFetchBrowserPage({
            browserSession: 'isolated',
            browserDeps: {
                getPage: async () => {
                    existingCalled = true;
                    return fakePage({});
                },
            },
        })).rejects.toBeInstanceOf(BrowserRequiredError);
        expect(existingCalled).toBe(false);
    });

    it('uses browser required mode after URL validation', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/spa',
            browserMode: 'required',
            browserSession: 'isolated',
            trace: true,
        }, {
            createIsolatedPage: async () => ({
                page: fakePage({ text: 'Rendered article body '.repeat(120), title: 'Rendered title' }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.ok).toBe(true);
        expect(result.source).toBe('browser');
        expect(result.chromeUsed).toBe(true);
        expect(result.attempts.some(a => a.source === 'browser')).toBe(true);
    });

    it('auto mode lets browser render beat weak direct fetch', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/spa',
            browserMode: 'auto',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response('<title>SPA</title><div id="root"></div>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
            createIsolatedPage: async () => ({
                page: fakePage({
                    text: 'Hydrated article body '.repeat(140),
                    title: 'Hydrated title',
                    networkCandidates: [{
                        source: 'network_api',
                        finalUrl: 'https://example.com/data.json',
                        text: '{"body":"network json"}',
                        evidence: ['fixture'],
                    }],
                }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.source).toBe('browser');
        expect(result.verdict).toBe('strong_ok');
        expect(result.attempts.some(a => a.source === 'network_api')).toBe(true);
    });

    it('rejects private browser final URLs and skips private network JSON candidates', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/spa',
            browserMode: 'required',
            browserSession: 'isolated',
            trace: true,
        }, {
            createIsolatedPage: async () => ({
                page: fakePage({
                    url: 'http://127.0.0.1/private',
                    text: 'Private redirect body '.repeat(100),
                    title: 'Private',
                    networkCandidates: [{
                        finalUrl: 'http://127.0.0.1/data.json',
                        text: '{"body":"private"}',
                    }],
                }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('blocked');
        expect(result.attempts.some(a => a.source === 'network_api')).toBe(false);
    });

    it('returns browser_required when required browser dependency is missing', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/spa',
            browserMode: 'required',
            trace: true,
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('browser_required');
        expect(result.chromeRequired).toBe(true);
    });

    it('does not treat long 404 bodies as successful content', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/missing',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response('<article>' + 'Not found '.repeat(500) + '</article>', {
                status: 404,
                headers: { 'content-type': 'text/html' },
            }),
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('blocked');
    });

    it('continues to direct fetch when a public endpoint candidate throws', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://github.com/org/repo',
            browserMode: 'never',
            trace: true,
        }, {
            fetch: async (url) => {
                if (String(url).startsWith('https://api.github.com/')) throw new Error('api down');
                return new Response('<article><h1>Repo</h1><p>' + 'Readable repo body '.repeat(160) + '</p></article>', {
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                });
            },
        });
        expect(result.ok).toBe(true);
        expect(result.source).toBe('fetch');
        expect(result.attempts.some(a => a.source === 'public_endpoint' && a.verdict === 'error')).toBe(true);
    });

    it('stops streaming response reads when max bytes is exceeded', async () => {
        let canceled = false;
        let pulls = 0;
        const stream = new ReadableStream({
            pull(controller) {
                pulls += 1;
                controller.enqueue(new TextEncoder().encode('x'.repeat(64)));
                if (pulls > 10) controller.close();
            },
            cancel() {
                canceled = true;
            },
        });
        const result = await fetchTextCandidate('https://example.com/large', {
            maxBytes: 80,
            fetchImpl: async () => new Response(stream, {
                status: 200,
                headers: { 'content-type': 'text/plain' },
            }),
        });
        expect(result.ok).toBe(false);
        expect(result.warnings).toContain('body-exceeds-max-bytes');
        expect(canceled).toBe(true);
    });
});

function fakePage({ text = '', title = '', url = 'https://example.com/rendered', networkCandidates = [] }) {
    return {
        async goto() {},
        async waitForTimeout() {},
        url: () => url,
        title: async () => title,
        evaluate: async () => text,
        on: async (_event, handler) => {
            for (const candidate of networkCandidates) handler(fakeResponse(candidate));
        },
        off: () => undefined,
    };
}

function fakeResponse(candidate) {
    return {
        headers: () => ({ 'content-type': 'application/json' }),
        text: async () => candidate.text,
        url: () => candidate.finalUrl,
        status: () => 200,
        ok: () => true,
    };
}
