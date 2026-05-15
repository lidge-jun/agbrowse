import { describe, expect, it } from 'vitest';
import { resolvePublicEndpointCandidates } from '../../skills/browser/adaptive-fetch/endpoint-resolvers.mjs';

describe('adaptive fetch endpoint resolvers', () => {
    it('resolves supported public endpoint shapes only', () => {
        expect(resolvePublicEndpointCandidates('https://github.com/org/repo/blob/main/README.md')[0]).toMatchObject({
            label: 'github-raw',
            url: 'https://raw.githubusercontent.com/org/repo/main/README.md',
        });
        expect(resolvePublicEndpointCandidates('https://news.ycombinator.com/item?id=123')[0].url).toContain('/item/123.json');
        expect(resolvePublicEndpointCandidates('https://en.wikipedia.org/wiki/Agentic_AI')[0].url).toContain('/api/rest_v1/page/summary/');
        expect(resolvePublicEndpointCandidates('https://example.com/article')).toEqual([]);
    });

    it('resolves broader public endpoint shapes without browser or credentials', () => {
        const cases = [
            ['https://bsky.app/profile/alice.example/post/3abc', 'bluesky-post-thread', 'public.api.bsky.app/xrpc/app.bsky.feed.getPostThread'],
            ['https://mastodon.social/@alice/111222333', 'mastodon-status-api', 'mastodon.social/api/v1/statuses/111222333'],
            ['https://stackoverflow.com/questions/123/title', 'stackexchange-question-api', 'api.stackexchange.com/2.3/questions/123'],
            ['https://dev.to/alice/my-post', 'devto-article-api', 'dev.to/api/articles/alice/my-post'],
            ['https://doi.org/10.1000/example.doi', 'crossref-work-api', 'api.crossref.org/works/10.1000%2Fexample.doi'],
            ['https://openlibrary.org/works/OL45883W/Foo', 'openlibrary-works-json', 'openlibrary.org/works/OL45883W.json'],
            ['https://web.archive.org/web/20200101000000/https://example.com/a', 'wayback-cdx-api', 'web.archive.org/cdx/search/cdx?url=https%3A%2F%2Fexample.com%2Fa'],
            ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube-oembed', 'youtube.com/oembed'],
            ['https://x.com/alice/status/123456789', 'x-twitter-oembed', 'publish.twitter.com/oembed'],
            ['https://www.v2ex.com/t/12345', 'v2ex-topic-api', 'v2ex.com/api/topics/show.json?id=12345'],
            ['https://lobste.rs/s/abc123/title', 'lobsters-story-json', 'lobste.rs/s/abc123/title.json'],
        ];
        for (const [input, label, urlPart] of cases) {
            const [candidate] = resolvePublicEndpointCandidates(input);
            expect(candidate).toMatchObject({ label, source: 'public_endpoint' });
            expect(candidate.url).toContain(urlPart);
        }
    });

    it('preserves query strings when deriving Wayback CDX targets', () => {
        const [candidate] = resolvePublicEndpointCandidates('https://web.archive.org/web/20200101000000/https://example.com/a?b=c&d=e');
        expect(candidate).toMatchObject({ label: 'wayback-cdx-api', source: 'public_endpoint' });
        expect(candidate.url).toContain('url=https%3A%2F%2Fexample.com%2Fa%3Fb%3Dc%26d%3De');
    });

    it('preserves escaped target query values when deriving Wayback CDX targets', () => {
        const [candidate] = resolvePublicEndpointCandidates(
            'https://web.archive.org/web/20200101000000/https://example.com/search?q=a%26b&x=1',
        );
        expect(candidate.url).toContain(
            'url=https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Da%2526b%26x%3D1',
        );
    });

    it('treats reddit json as a candidate without mutating already-json URLs', () => {
        expect(resolvePublicEndpointCandidates('https://www.reddit.com/r/test/comments/abc/title/')[0].url).toContain('.json');
        expect(resolvePublicEndpointCandidates('https://www.reddit.com/r/test/comments/abc/title/.json')).toEqual([]);
    });

    it('adds Hacker News Algolia item API alongside Firebase item API', () => {
        expect(resolvePublicEndpointCandidates('https://news.ycombinator.com/item?id=123').map(c => c.label)).toEqual([
            'hacker-news-item-api',
            'hacker-news-algolia-item-api',
        ]);
    });

    it('resolves registry and academic endpoint shapes', () => {
        expect(resolvePublicEndpointCandidates('https://www.npmjs.com/package/lodash')[0]).toMatchObject({
            label: 'npm-registry',
            url: 'https://registry.npmjs.org/lodash',
        });
        expect(resolvePublicEndpointCandidates('https://www.npmjs.com/package/@npmcli/arborist')[0]).toMatchObject({
            label: 'npm-registry',
            url: 'https://registry.npmjs.org/%40npmcli%2Farborist',
        });
        expect(resolvePublicEndpointCandidates('https://www.npmjs.com/package/%40npmcli/arborist')[0]).toMatchObject({
            label: 'npm-registry',
            url: 'https://registry.npmjs.org/%40npmcli%2Farborist',
        });
        expect(resolvePublicEndpointCandidates('https://www.npmjs.com/package/%40npmcli%2Farborist')[0]).toMatchObject({
            label: 'npm-registry',
            url: 'https://registry.npmjs.org/%40npmcli%2Farborist',
        });
        expect(resolvePublicEndpointCandidates('https://pypi.org/project/requests/')[0]).toMatchObject({
            label: 'pypi-json',
            url: 'https://pypi.org/pypi/requests/json',
        });
        expect(resolvePublicEndpointCandidates('https://pypi.org/project/requests%2Dcache/')[0]).toMatchObject({
            label: 'pypi-json',
            url: 'https://pypi.org/pypi/requests-cache/json',
        });
        expect(resolvePublicEndpointCandidates('https://arxiv.org/abs/2402.03300')[0]).toMatchObject({
            label: 'arxiv-api',
            url: 'https://export.arxiv.org/api/query?id_list=2402.03300',
        });
    });
});
