// @ts-check
import { describe, it, expect } from 'vitest';

// Import the functions we need to test. The helpers are not exported, so we
// test them indirectly through the public API or by importing the module and
// checking behavior with mocked candidates.

import { scoreReaderCandidate } from '../../skills/browser/adaptive-fetch/content-scorer.mjs';

describe('SPA fetch content scoring', () => {
    it('penalises network_api candidates with JSON blob text', () => {
        const jsonCandidate = {
            source: 'network_api',
            text: JSON.stringify({ accounts: { default: { plan_type: 'guest' } } }),
            title: '',
            ok: true,
            status: 200,
        };
        const scored = scoreReaderCandidate(jsonCandidate);
        // Without the penalty this would score ~76 (text/80 + density + source trust)
        // With the -30 penalty it should be significantly lower
        expect(scored.score).toBeLessThan(50);
    });

    it('does not penalise browser-render candidates with normal text', () => {
        const textCandidate = {
            source: 'browser',
            text: 'This is a normal web page with plenty of visible text content that a user would actually want to read. '.repeat(10),
            title: 'Example Page Title',
            ok: true,
            status: 200,
        };
        const scored = scoreReaderCandidate(textCandidate);
        expect(scored.score).toBeGreaterThanOrEqual(50);
    });

    it('does not penalise network_api candidates with non-JSON text', () => {
        const htmlCandidate = {
            source: 'network_api',
            text: '<html><body>Some actual content from a network response</body></html>',
            title: '',
            ok: true,
            status: 200,
        };
        const scored = scoreReaderCandidate(htmlCandidate);
        // Should not get the JSON penalty
        expect(scored.score).toBeGreaterThanOrEqual(16); // at least SOURCE_TRUST
    });
});

describe('SPA internal endpoint filtering', () => {
    // We test the regex pattern directly since isSpaInternalEndpoint is not exported
    const SPA_INTERNAL_PATTERN = new RegExp('/backend-api/|/backend-anon/|/_next/data/|/api/auth/|/api/v\\d+/', 'i');

    it('matches ChatGPT backend-api endpoints', () => {
        expect(SPA_INTERNAL_PATTERN.test('https://chatgpt.com/backend-api/settings/user')).toBe(true);
        expect(SPA_INTERNAL_PATTERN.test('https://chatgpt.com/backend-api/conversation/abc123')).toBe(true);
    });

    it('matches ChatGPT backend-anon endpoints', () => {
        expect(SPA_INTERNAL_PATTERN.test('https://chatgpt.com/backend-anon/accounts/check/v4')).toBe(true);
    });

    it('matches Next.js data endpoints', () => {
        expect(SPA_INTERNAL_PATTERN.test('https://example.com/_next/data/abc/page.json')).toBe(true);
    });

    it('matches generic API versioned endpoints', () => {
        expect(SPA_INTERNAL_PATTERN.test('https://app.example.com/api/v1/users')).toBe(true);
        expect(SPA_INTERNAL_PATTERN.test('https://app.example.com/api/v2/config')).toBe(true);
    });

    it('does not match regular page URLs', () => {
        expect(SPA_INTERNAL_PATTERN.test('https://chatgpt.com/g/abc/c/def')).toBe(false);
        expect(SPA_INTERNAL_PATTERN.test('https://example.com/about')).toBe(false);
        expect(SPA_INTERNAL_PATTERN.test('https://example.com/blog/post-1')).toBe(false);
    });
});
