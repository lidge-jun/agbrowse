import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    classifyCloudflareVerdict,
    classifyInterstitial,
    CLOUDFLARE_SHORT_BODY_LENGTH,
    detectInterstitial,
    INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER,
    isPageDeathError,
} from '../../web-ai/interstitial.mjs';

describe('web-ai interstitial detector', () => {
    afterEach(() => vi.useRealTimers());

    it('strong-title immediate', async () => {
        const { page, sleeps } = snapshotPage([{ title: 'Just a moment...' }]);
        await expect(detectInterstitial(page)).resolves.toMatchObject({ kind: 'cloudflare-challenge', evidence: 'challenge title' });
        expect(sleeps).toEqual([]);
    });

    it('structured challenge widget is immediate', async () => {
        const { page, sleeps } = snapshotPage([{ selectors: ['#challenge-form'] }]);
        await expect(detectInterstitial(page)).resolves.toMatchObject({ kind: 'cloudflare-challenge', evidence: 'challenge widget' });
        expect(sleeps).toEqual([]);
    });

    it('normal article quoting challenge copy is not flagged without artificial shell flags', () => {
        const bodyText = `An article quotes “checking your browser” while explaining web security. ${'content '.repeat(90)}`;
        expect(bodyText.length).toBeGreaterThanOrEqual(CLOUDFLARE_SHORT_BODY_LENGTH);
        expect(classifyCloudflareVerdict({ bodyText }).kind).toBe('none');
    });

    it('Work-UI shell plus challenge copy is vetoed', async () => {
        const shell = INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.chatgpt;
        const { page, sleeps } = snapshotPage([{ bodyText: 'Checking your browser', selectors: ['#prompt-textarea'] }]);
        await expect(detectInterstitial(page, { shellSelectors: shell })).resolves.toMatchObject({ kind: 'none' });
        expect(sleeps).toEqual([]);
    });

    it('600+ content-rich quote page remains none', () => {
        const bodyText = `Checking your browser is quoted here. ${'substantive article text '.repeat(30)}`;
        expect(bodyText.length).toBeGreaterThan(600);
        expect(classifyCloudflareVerdict({ bodyText }).kind).toBe('none');
    });

    it('599/600 boundary uses normalized body length', () => {
        const prefix = 'checking your browser ';
        const at599 = prefix + 'x'.repeat(599 - prefix.length);
        const at600 = prefix + 'x'.repeat(600 - prefix.length);
        expect(classifyCloudflareVerdict({ bodyText: at599 }).kind).toBe('strong');
        expect(classifyCloudflareVerdict({ bodyText: at600 }).kind).toBe('none');
    });

    it('weak-evidence disappearance clears', async () => {
        vi.useFakeTimers();
        const { page } = snapshotPage([
            { until: 499, selectors: ['script[src*="/cdn-cgi/challenge-platform/"]'] },
            { bodyText: 'ordinary hydrated page content' },
        ]);
        const pending = detectInterstitial(page, { graceMs: 12_000, intervalMs: 500 });
        await vi.advanceTimersByTimeAsync(500);
        await expect(pending).resolves.toMatchObject({ kind: 'none' });
    });

    it('live shell-veto immediate return', async () => {
        const shell = INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.chatgpt;
        const { page, sleeps } = snapshotPage([{
            selectors: ['#prompt-textarea', 'script[src*="/cdn-cgi/challenge-platform/"]'],
        }]);
        await expect(detectInterstitial(page, { shellSelectors: shell })).resolves.toMatchObject({ kind: 'none' });
        expect(sleeps).toEqual([]);
    });

    it('grace-window expiry escalates persistent weak evidence', async () => {
        vi.useFakeTimers();
        const { page } = snapshotPage([{ selectors: ['script[src*="/cdn-cgi/challenge-platform/"]'] }]);
        const pending = detectInterstitial(page, { graceMs: 12_000, intervalMs: 500 });
        let settled = false;
        pending.finally(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(11_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toMatchObject({ kind: 'cloudflare-challenge' });
    });

    it('localized/long challenge fixture is not promoted by body copy alone', () => {
        const localized = `보안 연결을 확인하고 있습니다. 계속하려면 기다려 주세요. ${'자세한 도움말과 개인정보 보호 안내 '.repeat(40)}`;
        expect(localized.length).toBeGreaterThanOrEqual(600);
        expect(classifyCloudflareVerdict({ bodyText: localized }).kind).toBe('none');
        expect(classifyCloudflareVerdict({ title: 'Attention Required! | Cloudflare', bodyText: localized }).kind).toBe('strong');
    });

    it('hanging-probe-bounded', async () => {
        const never = new Promise(() => {});
        let now = 0;
        const scheduler = { now: () => now, sleep: async (ms) => { now += ms; } };
        const page = {
            url: () => 'https://example.com/', title: () => never, innerText: () => never,
            locator: () => ({ count: () => never }),
        };
        await expect(detectInterstitial(page, { probeTimeoutMs: 20, scheduler })).resolves.toMatchObject({ kind: 'none' });
        expect(now).toBeGreaterThanOrEqual(20);
    });

    it.each([0, -10])('interval clamped for %s', async (intervalMs) => {
        let now = 0;
        const graceSleeps = [];
        const scheduler = {
            now: () => now,
            sleep: (ms) => {
                if (ms >= 250) return new Promise(() => {});
                graceSleeps.push(ms);
                now += ms;
                return Promise.resolve();
            },
        };
        const title = vi.fn().mockResolvedValue('');
        const page = {
            url: () => 'https://example.com/', title, innerText: async () => '',
            locator: (selector) => ({ count: async () => selector.startsWith('script[') ? 1 : 0 }),
        };
        await expect(detectInterstitial(page, { graceMs: 2, intervalMs, scheduler })).resolves.toMatchObject({ kind: 'cloudflare-challenge' });
        expect(graceSleeps).toEqual([1, 1]);
    });

    it('probe-error policy treats failed probes as absent evidence', async () => {
        const page = {
            url: () => 'https://example.com/', title: async () => { throw new Error('no title'); },
            innerText: async () => { throw new Error('no body'); },
            locator: () => ({ count: async () => { throw new Error('detached'); } }),
        };
        await expect(detectInterstitial(page)).resolves.toEqual({ kind: 'none', evidence: '', url: 'https://example.com/', retryHint: 'none' });
    });

    it('provider shell selector maps retain ChatGPT, Grok, and Gemini shapes', () => {
        expect(INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.chatgpt.composer).toContain('#prompt-textarea');
        expect(INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.grok.composer).toContain('.ProseMirror');
        expect(INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.grok.turns).toContain('[data-testid="assistant-message"]');
        expect(INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.gemini.turns).toEqual(expect.arrayContaining(['model-response', '[data-response-index]']));
    });

    it('compat classifier never promotes weak evidence', () => {
        expect(classifyCloudflareVerdict({ hasChallengeScript: true }).kind).toBe('weak');
        expect(classifyInterstitial({ url: 'https://example.com/', hasChallengeScript: true }).kind).toBe('none');
    });

    it('preserves login and empty-shell compatibility classifications', () => {
        expect(classifyInterstitial({ url: 'https://auth.openai.com/login', bodyText: 'anything' }).kind).toBe('login-required');
        expect(classifyInterstitial({ url: 'https://example.com/', bodyText: 'Please sign in to continue' }).kind).toBe('login-required');
        expect(classifyInterstitial({ url: 'https://chatgpt.com/', bodyText: 'loading' }).kind).toBe('empty-shell');
    });

    it('isPageDeathError recognizes fatal target/crash messages only', () => {
        expect(isPageDeathError(new Error('Target closed'))).toBe(true);
        expect(isPageDeathError(new Error('Page crashed!'))).toBe(true);
        expect(isPageDeathError('browser has been closed')).toBe(true);
        expect(isPageDeathError(new Error('element not found'))).toBe(false);
    });
});

function snapshotPage(snapshots, now = () => Date.now()) {
    const sleeps = [];
    const startedAt = now();
    const current = () => snapshots.find((snapshot) => snapshot.until == null || now() - startedAt <= snapshot.until)
        || snapshots.at(-1);
    return {
        sleeps,
        page: {
            url: () => 'https://example.com/',
            title: async () => current().title || '',
            innerText: async () => current().bodyText || '',
            locator: (selector) => ({ count: async () => current().selectors?.includes(selector) ? 1 : 0 }),
            waitForTimeout: async (ms) => { sleeps.push(ms); },
        },
    };
}
