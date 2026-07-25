import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    classifyCloudflareVerdict,
    classifyInterstitial,
    CLOUDFLARE_SHORT_BODY_LENGTH,
    detectInterstitial,
    emptyShellHostKind,
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

describe('provider-aware empty shell (G13c)', () => {
    /**
     * A page whose shell stays empty until `hydrateAfterTitleReads` title reads
     * have happened. `title()` is called exactly once per gather cycle, which
     * makes it the reliable cycle counter — `now()` is called many times per
     * cycle by the bounded-probe races and cannot be used for that.
     */
    function makePage(url, { hydrateAfterTitleReads = Infinity } = {}) {
        const state = { cycles: 0, sleeps: 0 };
        return {
            state,
            page: {
                url: () => url,
                title: async () => { state.cycles += 1; return ''; },
                innerText: async () => '',
                locator: (selector) => ({
                    count: async () => (state.cycles > hydrateAfterTitleReads
                        && !String(selector).includes('challenge') ? 1 : 0),
                }),
            },
        };
    }

    /**
     * Scheduler following this file's existing convention: a probe-timeout sleep
     * (>= PROBE_TIMEOUT_MS) never resolves, so the real probe value wins the race;
     * only the grace re-probe sleeps advance the clock.
     */
    function makeScheduler(state) {
        let now = 0;
        return {
            scheduler: {
                now: () => now,
                sleep: (ms) => {
                    if (ms >= 250) return new Promise(() => {});
                    state.sleeps += 1;
                    now += Math.max(ms, 1);
                    return Promise.resolve();
                },
            },
            get now() { return now; },
        };
    }

    /** Same convention, for the one-off cases below. */
    function raceSafeScheduler() {
        let now = 0;
        return {
            now: () => now,
            sleep: (ms) => {
                if (ms >= 250) return new Promise(() => {});
                now += Math.max(ms, 1);
                return Promise.resolve();
            },
        };
    }

    it.each([
        ['immediate', 'https://chatgpt.com/'],
        ['immediate', 'https://chat.openai.com/'],
        ['graced', 'https://grok.com/'],
        ['graced', 'https://www.grok.com/'],
        ['graced', 'https://gemini.google.com/app'],
        ['graced', 'https://x.com/i/grok'],
        ['none', 'https://notgrok.com/'],
        ['none', 'https://x.com/home'],
        ['none', 'https://evil.example/?u=https://x.com/i/grok'],
        ['none', 'not a url at all'],
        // Trailing-dot FQDNs are DNS-equivalent to their supported hosts.
        ['graced', 'https://grok.com./'],
        ['graced', 'https://www.grok.com./'],
        ['graced', 'https://gemini.google.com./app'],
        ['immediate', 'https://chatgpt.com./'],
        // Path bound: /i/groking is a different page.
        ['graced', 'https://x.com/i/grok/share'],
        ['none', 'https://x.com/i/groking'],
        // Provider pages are HTTP(S) only.
        ['none', 'ftp://grok.com/'],
    ])('classifies %s host for %s', (kind, url) => {
        expect(emptyShellHostKind(url)).toBe(kind);
    });

    it('reports an empty shell for every supported host and none elsewhere', () => {
        const empty = { hasComposer: false, hasTurns: false, bodyText: '' };
        expect(classifyInterstitial({ ...empty, url: 'https://chatgpt.com/' }).kind).toBe('empty-shell');
        expect(classifyInterstitial({ ...empty, url: 'https://grok.com/' }).kind).toBe('empty-shell');
        expect(classifyInterstitial({ ...empty, url: 'https://gemini.google.com/app' }).kind).toBe('empty-shell');
        expect(classifyInterstitial({ ...empty, url: 'https://notgrok.com/' }).kind).toBe('none');
    });

    it('never carries a graced flag into the public verdict', () => {
        const verdict = classifyInterstitial({
            url: 'https://grok.com/', hasComposer: false, hasTurns: false, bodyText: '',
        });
        expect('graced' in verdict).toBe(false);
    });

    it('decides ChatGPT on a SINGLE gather cycle', async () => {
        // The byte-identical guard: ChatGPT must not enter the re-probe loop.
        const harness = makePage('https://chatgpt.com/');
        const clock = makeScheduler(harness.state);
        const result = await detectInterstitial(harness.page, {
            shellSelectors: INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.chatgpt,
            graceMs: 5_000,
            // Below the never-resolving probe-timeout threshold, so a regression
            // here fails on the cycle assertion instead of hanging the test.
            intervalMs: 10,
            scheduler: clock.scheduler,
        });
        expect(result.kind).toBe('empty-shell');
        expect(harness.state.cycles).toBe(1);
    });

    it.each([
        ['grok', 'https://grok.com/'],
        ['gemini', 'https://gemini.google.com/app'],
    ])('re-probes a %s empty shell until the grace expires', async (provider, url) => {
        const harness = makePage(url);
        const clock = makeScheduler(harness.state);
        const result = await detectInterstitial(harness.page, {
            shellSelectors: INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER[provider],
            // The bounded probe races consume the clock too, so the grace must
            // exceed a few probe timeouts for the loop to get a second look.
            graceMs: 5_000,
            intervalMs: 10,
            scheduler: clock.scheduler,
        });
        expect(result.kind).toBe('empty-shell');
        // It re-probed rather than deciding on the first look.
        expect(harness.state.cycles).toBeGreaterThan(1);
        expect(harness.state.sleeps).toBeGreaterThan(0);
    });

    it('returns none when a graced provider hydrates during the grace', async () => {
        // The deferral's stated fear, now a required test: a slow load must NOT
        // become a hard error.
        const harness = makePage('https://grok.com/', { hydrateAfterTitleReads: 2 });
        const clock = makeScheduler(harness.state);
        const result = await detectInterstitial(harness.page, {
            shellSelectors: INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.grok,
            graceMs: 5_000,
            intervalMs: 10,
            scheduler: clock.scheduler,
        });
        expect(result.kind).toBe('none');
        expect(harness.state.cycles).toBeGreaterThan(1);
    });

    it('lets a challenge win over an empty shell on a graced host', async () => {
        const page = {
            url: () => 'https://grok.com/',
            title: async () => 'Just a moment...',
            innerText: async () => 'Checking your browser',
            locator: () => ({ count: async () => 0 }),
        };
        // The clock MUST advance: a frozen `now` never reaches the deadline and the
        // re-probe loop would spin forever.
        await expect(detectInterstitial(page, {
            shellSelectors: INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.grok,
            graceMs: 10,
            scheduler: raceSafeScheduler(),
        })).resolves.toMatchObject({ kind: 'cloudflare-challenge' });
    });

    it('lets a login wall win over an empty shell on a graced host', async () => {
        const page = {
            url: () => 'https://gemini.google.com/app',
            title: async () => '',
            innerText: async () => 'Sign in to continue',
            locator: () => ({ count: async () => 0 }),
        };
        await expect(detectInterstitial(page, {
            shellSelectors: INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.gemini,
            graceMs: 10,
            scheduler: raceSafeScheduler(),
        })).resolves.toMatchObject({ kind: 'login-required' });
    });
});
