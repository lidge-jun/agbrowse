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

    // Swallowing a lane failure is right for the environment and wrong for our
    // own bug: a TypeError from this code would be reported as "that source had
    // nothing" and the fetch would return partial evidence as if complete.
    it('rethrows a programming fault instead of recording it as a lane failure', async () => {
        await expect(runAdaptiveFetch({
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
                throw new TypeError('undefined is not a function');
            },
        })).rejects.toBeInstanceOf(TypeError);
    });

    // The separator is `cause`, not the type. Node's fetch reports ENOTFOUND and
    // ECONNREFUSED as `TypeError: fetch failed` with the system error attached,
    // so a type-only rule would crash on any dead hostname.
    it('keeps going when a fetch lane fails with undici TypeError carrying a cause', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => {
                const error = new TypeError('fetch failed');
                error.cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
                throw error;
            },
        });
        expect(result.ok).toBe(false);
        expect(result.attempts.some(a => a.verdict === 'error' && a.reason === 'fetch failed')).toBe(true);
    });

    it('rethrows a fetch-lane TypeError that carries no cause', async () => {
        await expect(runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => {
                throw new TypeError('deps.fetch is not a function');
            },
        })).rejects.toBeInstanceOf(TypeError);
    });

    // Pin the whole set, not just the type we happened to hit first. Without
    // this, dropping a constructor from the guard passes every other test.
    it.each([
        ['TypeError', () => new TypeError('undefined is not a function')],
        ['ReferenceError', () => new ReferenceError('someVar is not defined')],
        ['RangeError', () => new RangeError('Maximum call stack size exceeded')],
        ['SyntaxError', () => new SyntaxError('Unexpected token }')],
    ])('rethrows %s from a lane instead of recording it', async (_name, makeError) => {
        await expect(runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => { throw makeError(); },
        })).rejects.toBeInstanceOf(makeError().constructor);
    });

    // A malformed `Location` is remote input, not our bug. Before the fetcher
    // guarded it, `new URL()` threw a cause-less TypeError that the scheduler
    // read as a programming fault and rethrew, crashing the whole fetch.
    it('treats a malformed redirect Location as a lane failure, not a crash', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/x',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response('', { status: 301, headers: { location: 'http://[bad' } }),
        });
        expect(result.ok).toBe(false);
        expect(result.verdict).toBe('blocked');
        expect(result.attempts.some(a => a.evidence?.includes('invalid-redirect-location'))).toBe(true);
    });

    it('still follows a well-formed relative redirect', async () => {
        const seen = [];
        const result = await runAdaptiveFetch({
            url: 'https://example.com/start',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async (url) => {
                seen.push(String(url));
                if (seen.length === 1) return new Response('', { status: 302, headers: { location: '/moved' } });
                return new Response(
                    '<title>Moved</title><article>' + 'Body text that a reader can use. '.repeat(20) + '</article>',
                    { status: 200, headers: { 'content-type': 'text/html' } },
                );
            },
        });
        expect(seen[1]).toBe('https://example.com/moved');
        expect(result.ok).toBe(true);
    });

    // A blank Location resolves to the base URL rather than throwing, so without
    // the blank check it becomes a redirect to itself and burns the redirect
    // budget. Standard Headers normalizes blanks away, so reach it through a
    // fetchImpl that implements headers.get directly.
    it('does not loop on a blank redirect Location', async () => {
        let calls = 0;
        const result = await runAdaptiveFetch({
            url: 'https://example.com/start',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => {
                calls += 1;
                return {
                    status: 301,
                    headers: {
                        get: (name) => (name.toLowerCase() === 'location' ? '   ' : null),
                        entries: () => [][Symbol.iterator](),
                    },
                    body: null,
                    text: async () => '',
                };
            },
        });
        expect(calls).toBe(1);
        expect(result.ok).toBe(false);
    });

    // Q6: the lane reads `camoResult.html`. Reading `content` instead made the
    // candidate's text always '' so it was dropped, and the lane could never
    // contribute evidence even with camoufox installed. Nothing pinned that
    // field name until this test, because reaching the lane used to require a
    // real camoufox install and a browser spawn.
    it('reads html from the camoufox lane and adopts it as evidence', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'required',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetchViaCamoufox: async () => ({
                ok: true,
                url: 'https://example.com/article',
                title: 'Rendered Title',
                html: '<title>Rendered Title</title><article>'
                    + 'Content the camoufox lane rendered. '.repeat(20) + '</article>',
            }),
        });
        expect(result.ok).toBe(true);
        expect(result.evidence).toContain('camoufox-render');
        expect(result.content.length).toBeGreaterThan(100);
        expect(result.attempts.some(a => a.reason === 'camoufox-render')).toBe(true);
    });

    // The lane must stay a no-op when camoufox returns nothing, and must not
    // fabricate a candidate from an empty render.
    it('drops the camoufox candidate when the render carries no text', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'required',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetchViaCamoufox: async () => ({ ok: true, url: 'https://example.com/article', title: '', html: '' }),
            // Inject the browser lane too, otherwise the verdict below would be
            // asserting that this environment has no isolated page rather than
            // anything about the camoufox lane.
            createIsolatedPage: async () => ({
                page: fakePage({ text: '', title: '' }),
                cleanup: async () => undefined,
            }),
        });
        expect(result.evidence).not.toContain('camoufox-render');
        expect(result.ok).toBe(false);
    });

    // `--browser never` must not reach the camoufox lane at all. Nothing pinned
    // this: dropping the browserMode guard left all 1892 tests green while every
    // `--no-browser` run paid for a spawn.
    it('never spawns the camoufox lane in browser never mode', async () => {
        let camoufoxCalls = 0;
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response('<p>Short</p>', {
                status: 200,
                headers: { 'content-type': 'text/html' },
            }),
            fetchViaCamoufox: async () => {
                camoufoxCalls += 1;
                return { ok: true, url: 'https://example.com/article', title: 'T', html: '<article>x</article>' };
            },
        });
        expect(camoufoxCalls).toBe(0);
        expect(result.evidence).not.toContain('camoufox-render');
    });

    // The lane also has to stay off once an earlier rung already produced a
    // strong result. It sits before the early-return check, so only the
    // strong_ok guard stops it paying for a spawn nobody needs.
    it('does not spawn the camoufox lane once a rung already scored strong_ok', async () => {
        let camoufoxCalls = 0;
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'auto',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<title>Strong Article</title><article><p>'
                + 'Long readable body text that scores well. '.repeat(80) + '</p></article>',
                { status: 200, headers: { 'content-type': 'text/html' } },
            ),
            fetchViaCamoufox: async () => {
                camoufoxCalls += 1;
                return { ok: true, url: 'https://example.com/article', title: 'T', html: '<article>x</article>' };
            },
        });
        expect(result.verdict).toBe('strong_ok');
        expect(camoufoxCalls).toBe(0);
    });

    // Phase 1d reads the fetched body and records alternate URLs found in it.
    // It was unreachable for the same reason the camoufox guard was always
    // true: the scored wrapper has no `text`, only `candidate.text`. The unit
    // tests import the discovery helpers directly, so they passed while the
    // lane never ran in the pipeline.
    it('records alternate URLs discovered in the fetched body', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<title>Article</title><article><p>'
                + 'Readable body text with a reference. '.repeat(20)
                + ' See https://github.com/openai/codex and https://arxiv.org/abs/2401.00001 for more.'
                + '</p></article>',
                { status: 200, headers: { 'content-type': 'text/html' } },
            ),
        });
        const discovered = result.attempts.filter(a => String(a.reason || '').startsWith('candidate-discovered:'));
        expect(discovered.length).toBeGreaterThan(0);
        expect(discovered.map(a => a.url)).toContain('https://github.com/openai/codex');
        // Discovery records, it does not fetch. A verdict implying the URL passed
        // evaluation would be a lie in the trace.
        expect(discovered.every(a => a.verdict === 'discovered')).toBe(true);
    });

    // The phase must stay a recorder: `agbrowse fetch` reads the one URL it was
    // given. Following discovered links would make every fetch a crawl.
    it('does not fetch the URLs it discovers', async () => {
        const requested = [];
        await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async (url) => {
                requested.push(String(url));
                return new Response(
                    '<title>Article</title><article><p>'
                    + 'Readable body text with a reference. '.repeat(20)
                    + ' See https://github.com/openai/codex for more.</p></article>',
                    { status: 200, headers: { 'content-type': 'text/html' } },
                );
            },
        });
        expect(requested).toEqual(['https://example.com/article']);
    });

    // Discovery classifies each URL into a lane, and the lane rides along in the
    // attempt reason. Pin it: a bare `candidate-discovered:` with no lane means
    // ranking silently degraded to unclassified.
    it('classifies discovered candidates into lanes', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<title>Article</title><article><p>'
                + 'Readable body text with references. '.repeat(20)
                + ' See https://github.com/openai/codex and https://arxiv.org/abs/2401.00001 for more.'
                + '</p></article>',
                { status: 200, headers: { 'content-type': 'text/html' } },
            ),
        });
        const reasons = result.attempts
            .filter(a => String(a.reason || '').startsWith('candidate-discovered:'))
            .map(a => a.reason);
        expect(reasons).toContain('candidate-discovered:package');
        expect(reasons).toContain('candidate-discovered:academic');
    });

    // The original URL must not be re-fetched as its own discovered candidate.
    it('does not rediscover the URL it is already fetching', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'never',
            publicEndpoints: false,
            trace: true,
        }, {
            fetch: async () => new Response(
                '<title>Article</title><article><p>'
                + 'Body that links to itself: https://example.com/article and again. '.repeat(20)
                + '</p></article>',
                { status: 200, headers: { 'content-type': 'text/html' } },
            ),
        });
        const discoveredUrls = result.attempts
            .filter(a => String(a.reason || '').startsWith('candidate-discovered:'))
            .map(a => a.url);
        expect(discoveredUrls).not.toContain('https://example.com/article');
    });

    // A render the lane itself reports as failed is not evidence. Without the
    // `ok` guard a challenge page body gets promoted into the result.
    it('does not adopt a camoufox render the lane reported as failed', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/article',
            browserMode: 'required',
            browserSession: 'isolated',
            publicEndpoints: false,
            trace: true,
        }, {
            fetchViaCamoufox: async () => ({
                ok: false,
                url: 'https://example.com/article',
                title: 'Just a moment',
                html: '<title>Just a moment</title><article>' + 'Checking your browser. '.repeat(20) + '</article>',
            }),
        });
        expect(result.evidence).not.toContain('camoufox-render');
        expect(result.ok).toBe(false);
    });

    // The lane is wrapped in `.catch(() => null)`, so a lane that throws must
    // not take the whole fetch down.
    it('keeps going when the camoufox lane throws', async () => {
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
            fetchViaCamoufox: async () => { throw new Error('camoufox spawn failed'); },
            createIsolatedPage: async () => { throw new BrowserRequiredError('no browser here'); },
        });
        expect(result.ok).toBe(true);
        expect(result.content.length).toBeGreaterThan(100);
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
