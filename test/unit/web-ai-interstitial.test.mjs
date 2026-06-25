import { describe, expect, it } from 'vitest';
import { classifyInterstitial, isPageDeathError } from '../../web-ai/interstitial.mjs';

// Parity catalog 201 #4 (P1): unified interstitial detector.
describe('web-ai interstitial detector', () => {
    it('detects a Cloudflare challenge from body text', () => {
        const r = classifyInterstitial({ url: 'https://chatgpt.com/', bodyText: 'Just a moment... checking your browser' });
        expect(r.kind).toBe('cloudflare-challenge');
        expect(r.retryHint).toBe('wait-and-retry');
        expect(r.evidence).toBe('just a moment');
    });

    it('detects login from an auth URL regardless of body', () => {
        const r = classifyInterstitial({ url: 'https://auth.openai.com/login', bodyText: 'anything' });
        expect(r.kind).toBe('login-required');
        expect(r.retryHint).toBe('login');
        expect(r.evidence).toMatch(/auth URL/);
    });

    it('detects login from short body text with a login phrase', () => {
        const r = classifyInterstitial({ url: 'https://example.com/', bodyText: 'Please sign in to continue' });
        expect(r.kind).toBe('login-required');
        expect(r.retryHint).toBe('login');
    });

    it('does NOT flag login when a login phrase appears in a long page', () => {
        const big = 'Sign in '.padEnd(2500, 'x');
        const r = classifyInterstitial({ url: 'https://example.com/', bodyText: big });
        expect(r.kind).toBe('none');
    });

    it('detects an empty ChatGPT shell (no composer/turns, short body)', () => {
        const r = classifyInterstitial({ url: 'https://chatgpt.com/', bodyText: 'loading', hasComposer: false, hasTurns: false });
        expect(r.kind).toBe('empty-shell');
        expect(r.retryHint).toBe('wait-and-retry');
    });

    it('returns none when the ChatGPT composer is present', () => {
        const r = classifyInterstitial({ url: 'https://chatgpt.com/', bodyText: 'loading', hasComposer: true });
        expect(r.kind).toBe('none');
    });

    it('returns none for a normal non-provider page', () => {
        const r = classifyInterstitial({ url: 'https://example.com/article', bodyText: 'A long article body here' });
        expect(r.kind).toBe('none');
        expect(r.retryHint).toBe('none');
    });

    it('isPageDeathError recognizes fatal target/crash messages only', () => {
        expect(isPageDeathError(new Error('Target closed'))).toBe(true);
        expect(isPageDeathError(new Error('Page crashed!'))).toBe(true);
        expect(isPageDeathError('browser has been closed')).toBe(true);
        expect(isPageDeathError(new Error('element not found'))).toBe(false);
        expect(isPageDeathError(null)).toBe(false);
    });
});
