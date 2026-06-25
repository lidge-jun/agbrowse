import { describe, expect, it } from 'vitest';
import { rankDiscoveredCandidates, extractCandidateUrlsFromText } from '../../skills/browser/adaptive-fetch/candidate-discovery.mjs';

// Parity catalog 203.7 (P3): lane-classified candidate discovery.
describe('adaptive fetch candidate discovery', () => {
    it('extracts + dedups URLs from text, stripping trailing punctuation', () => {
        const urls = extractCandidateUrlsFromText('see https://a.com/x, and https://a.com/x. plus https://b.org/y!');
        expect(urls).toEqual(['https://a.com/x', 'https://b.org/y']);
    });

    it('classifies lanes and orders official first', () => {
        const result = rankDiscoveredCandidates([
            { url: 'https://example.com/page' },
            { url: 'https://docs.python.org/3/library/json.html' },
            { url: 'https://github.com/foo/bar' },
            { url: 'https://reddit.com/r/python/comments/1' },
            { url: 'https://x.com/u/status/1' },
            { url: 'https://arxiv.org/abs/2401.00001' },
        ]);
        const laneOf = (host) => result.candidates.find((c) => c.hostname.includes(host))?.lane;
        expect(laneOf('docs.python.org')).toBe('official');
        expect(laneOf('github.com')).toBe('package');
        expect(laneOf('arxiv.org')).toBe('academic');
        expect(laneOf('reddit.com')).toBe('community');
        expect(laneOf('x.com')).toBe('realtime');
        expect(laneOf('example.com')).toBe('fetch');
        // highest score (official) ranks first
        expect(result.candidates[0].lane).toBe('official');
    });

    it('honors officialDomains and dedups by tracking-stripped URL', () => {
        const result = rankDiscoveredCandidates([
            { url: 'https://mycorp.com/api?utm_source=news' },
            { url: 'https://www.mycorp.com/api' },
        ], { officialDomains: ['mycorp.com'] });
        // both normalize to the same URL → one candidate, official lane
        expect(result.candidates.length).toBe(1);
        expect(result.candidates[0].lane).toBe('official');
        expect(result.candidates[0].reasons).toContain('official-domain-match');
    });

    it('rejects SSRF/invalid URLs into the rejected list', () => {
        const result = rankDiscoveredCandidates([
            { url: 'http://localhost/secret' },
            { url: 'not a url' },
            { url: 'https://good.example/page' },
        ]);
        expect(result.rejected.length).toBe(2);
        expect(result.candidates.length).toBe(1);
        expect(result.candidates[0].hostname).toBe('good.example');
    });
});
