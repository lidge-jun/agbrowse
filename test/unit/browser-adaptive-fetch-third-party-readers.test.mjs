import { describe, expect, it } from 'vitest';
import { runAdaptiveFetch } from '../../skills/browser/adaptive-fetch/index.mjs';
import {
    buildJinaReaderUrl,
    fetchThirdPartyReaderCandidate,
    shouldUseThirdPartyReader,
} from '../../skills/browser/adaptive-fetch/third-party-readers.mjs';

describe('adaptive fetch third-party readers', () => {
    it('is disabled by default and enabled only by explicit option', () => {
        expect(shouldUseThirdPartyReader()).toBe(false);
        expect(shouldUseThirdPartyReader({ allowThirdPartyReader: true })).toBe(true);
    });

    it('builds Jina Reader URL and rejects private or credential-bearing targets', () => {
        expect(buildJinaReaderUrl('https://example.com/a')).toBe('https://r.jina.ai/https://example.com/a');
        expect(() => buildJinaReaderUrl('https://localhost/a')).toThrow(/private or local host/);
        expect(() => buildJinaReaderUrl('https://user:pass@example.com/a')).toThrow(/credential-bearing/);
        expect(() => buildJinaReaderUrl('https://example.com/a?token=secret')).toThrow(/sensitive query/);
        expect(() => buildJinaReaderUrl('https://example.com/a?api_key=secret')).toThrow(/sensitive query/);
    });

    it('fetches a third-party candidate only when explicitly allowed', async () => {
        let requestedUrl = '';
        const result = await fetchThirdPartyReaderCandidate('https://example.com/a', {
            allowThirdPartyReader: true,
            fetchImpl: async (url) => {
                requestedUrl = String(url);
                return new Response('Reader title\n\nReadable reader content '.repeat(80), {
                    status: 200,
                    headers: { 'content-type': 'text/plain' },
                });
            },
        });
        expect(requestedUrl).toBe('https://r.jina.ai/https://example.com/a');
        expect(result.finalUrl).toBe('https://example.com/a');
        expect(result.evidence).toContain('third-party-reader:jina');
    });

    it('runAdaptiveFetch lets opt-in third-party reader beat weak direct fetch', async () => {
        const result = await runAdaptiveFetch({
            url: 'https://example.com/a',
            publicEndpoints: false,
            allowThirdPartyReader: true,
            trace: true,
        }, {
            fetch: async (url) => {
                if (String(url).startsWith('https://r.jina.ai/')) {
                    return new Response('Reader title\n\nReadable reader content '.repeat(100), {
                        status: 200,
                        headers: { 'content-type': 'text/plain' },
                    });
                }
                return new Response('<title>Weak</title><p>Short</p>', {
                    status: 200,
                    headers: { 'content-type': 'text/html' },
                });
            },
        });
        expect(result.ok).toBe(true);
        expect(result.source).toBe('third_party_reader');
        expect(result.verdict).toBe('strong_ok');
        expect(result.attempts.some(a => a.source === 'third_party_reader')).toBe(true);
    });
});
