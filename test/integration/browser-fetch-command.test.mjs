import { describe, expect, it } from 'vitest';
import { runAdaptiveFetch, runAdaptiveFetchCli } from '../../skills/browser/adaptive-fetch/index.mjs';
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

    it('does not treat browser-rendered 404 bodies as successful content', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/missing',
            browserMode: 'required',
            browserSession: 'isolated',
            trace: true,
        }, {
            createIsolatedPage: async () => ({
                page: fakePage({
                    url: 'https://example.com/missing',
                    title: 'Missing',
                    text: 'Not found '.repeat(1000),
                    navResponse: {
                        status: () => 404,
                        ok: () => false,
                        headers: () => ({ 'content-type': 'text/html' }),
                    },
                }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('blocked');
        expect(result.attempts.some(a => a.source === 'browser' && a.status === 404)).toBe(true);
    });

    it('does not treat browser-rendered 500 bodies as successful content', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/error',
            browserMode: 'required',
            browserSession: 'isolated',
            trace: true,
        }, {
            createIsolatedPage: async () => ({
                page: fakePage({
                    url: 'https://example.com/error',
                    title: 'Server Error',
                    text: 'Server error '.repeat(1000),
                    navResponse: {
                        status: () => 500,
                        ok: () => false,
                        headers: () => ({ 'content-type': 'text/html' }),
                    },
                }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('blocked');
        expect(result.attempts.some(a => a.source === 'browser' && a.status === 500)).toBe(true);
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

    it('emits valid compact JSON for large public endpoint content', async () => {
        const chunks = [];
        await runAdaptiveFetchCli([
            'https://www.reddit.com/',
            '--json',
            '--trace',
            '--browser',
            'never',
        ], {
            fetch: async () => new Response(JSON.stringify({
                kind: 'Listing',
                data: {
                    children: Array.from({ length: 300 }, (_, index) => ({
                        data: {
                            title: `Large reddit item ${index}`,
                            selftext: 'Readable public endpoint body '.repeat(60),
                        },
                    })),
                },
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
            stdout: {
                write(chunk, callback) {
                    chunks.push(String(chunk));
                    if (typeof callback === 'function') callback();
                    return true;
                },
            },
        });

        const parsed = JSON.parse(chunks.join(''));
        expect(parsed.ok).toBe(true);
        expect(parsed.source).toBe('public_endpoint');
        expect(parsed.contentTruncated).toBe(true);
        expect(parsed.contentBytes).toBeGreaterThan(parsed.contentLimitBytes);
        expect(Buffer.byteLength(parsed.content, 'utf8')).toBeLessThanOrEqual(parsed.contentLimitBytes);
        expect(parsed.attempts.length).toBeGreaterThan(0);
    });

    it('detects challenge in direct fetch and records it in trace', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/protected',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<html><title>Just a moment...</title>Checking your browser before accessing</html>',
                { status: 403, headers: { 'content-type': 'text/html', 'server': 'cloudflare', 'cf-ray': '123-LAX' } },
            ),
        });
        expect(result.ok).toBe(false);
        expect(result.attempts.some(a => a.verdict === 'challenge')).toBe(true);
    });

    it('user session mode navigates with existing page dependency', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/paywalled',
            browserMode: 'auto',
            browserSession: 'user',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<html><p>Subscribe to read more. Members only.</p></html>',
                { status: 200, headers: { 'content-type': 'text/html' } },
            ),
            getPage: async () => fakePage({
                text: 'Full article behind paywall '.repeat(120),
                title: 'Premium Article',
            }),
        });
        expect(result.ok).toBe(true);
        expect(result.verdict).toBe('strong_ok');
    });

    it('challenge detection does not cause early return from scheduler', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/cf',
            browserMode: 'required',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<html>Checking your browser captcha cloudflare</html>',
                { status: 403, headers: { 'content-type': 'text/html' } },
            ),
            createIsolatedPage: async () => ({
                page: fakePage({
                    text: 'Real article content after challenge resolved '.repeat(100),
                    title: 'Article Title',
                }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.ok).toBe(true);
        expect(result.source).toBe('browser');
        expect(result.chromeUsed).toBe(true);
    });

    it('safetyFlags propagate from winning candidate to final result', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/paywall',
            browserMode: 'auto',
            browserSession: 'user',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response('<p>Short</p>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
            getPage: async () => fakePage({
                text: 'Full article with user session '.repeat(120),
                title: 'User Session Article',
            }),
        });
        expect(result.ok).toBe(true);
        expect(result.safetyFlags).toContain('user_session_used');
    });

    // A CDP connect failure is a plain Error, not a BrowserRequiredError, so the
    // escalation catch used to rethrow it and the whole fetch died with
    // internal.unhandled — throwing away text an earlier lane had already read.
    // Running `agbrowse fetch <url>` without Chrome up hit this on the default
    // path.
    it('keeps earlier lane content when browser escalation fails with a plain error', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'auto',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<title>Readable</title><article>' + 'Body text that a reader can use. '.repeat(20) + '</article>',
                { status: 200, headers: { 'content-type': 'text/html' } },
            ),
            createIsolatedPage: async () => {
                throw new Error('CDP connection failed after 4 attempts: connect ECONNREFUSED 127.0.0.1:9222');
            },
        });
        expect(result.ok).toBe(true);
        expect(result.content.length).toBeGreaterThan(100);
        expect(result.attempts.some(a => a.source === 'browser' && a.verdict === 'error')).toBe(true);
        expect(result.warnings.some(w => w.includes('CDP connection failed'))).toBe(true);
    });

    // Same failure under `required`: there is no usable candidate, so the verdict
    // stays browser_required, but the reason why the browser never came up must
    // survive into the result instead of vanishing.
    it('reports browser_required with the failure reason when required escalation errors', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/spa',
            browserMode: 'required',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response('', { status: 200, headers: { 'content-type': 'text/html' } }),
            createIsolatedPage: async () => {
                throw new Error('CDP connection failed after 4 attempts: connect ECONNREFUSED 127.0.0.1:9222');
            },
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('browser_required');
        expect(result.warnings.some(w => w.includes('CDP connection failed'))).toBe(true);
    });
});

function fakePage({ text = '', title = '', url = 'https://example.com/rendered', networkCandidates = [], navResponse = undefined }) {
    return {
        async goto() {
            return navResponse;
        },
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
