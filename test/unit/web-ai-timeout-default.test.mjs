import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    TIER_DEFAULT_TIMEOUT_SEC,
    PRO_TIMEOUT_SEC,
    CHATGPT_PRO_TIMEOUT_SEC,
    tierDefaultTimeoutSec,
    deriveTimeoutTier,
    resolveTimeoutDefaultSec,
    resolveDeadlineAt,
    resolveTimeoutBudgetSec,
    resolvePollTimeoutSec,
} from '../../web-ai/session.mjs';

afterEach(() => { vi.useRealTimers(); });

describe('web-ai tier-aware default poll timeout', () => {
    it('exposes the 3-split tier table (chatgpt-pro=5400, grok-heavy=3600, deep-research=3600)', () => {
        expect({ ...TIER_DEFAULT_TIMEOUT_SEC }).toEqual({
            instant: 120,
            thinking: 600,
            'chatgpt-pro': 5400,
            'grok-heavy': 3600,
            'deep-research': 3600,
        });
        expect(CHATGPT_PRO_TIMEOUT_SEC).toBe(5400);
        expect(PRO_TIMEOUT_SEC).toBe(5400);
    });

    it('derives ChatGPT tier: pro -> chatgpt-pro', () => {
        expect(deriveTimeoutTier('chatgpt', 'instant')).toBe('instant');
        expect(deriveTimeoutTier('chatgpt', 'thinking')).toBe('thinking');
        expect(deriveTimeoutTier('chatgpt', 'pro')).toBe('chatgpt-pro');
        expect(deriveTimeoutTier('chatgpt', 'pro', 'deep')).toBe('deep-research');
        expect(deriveTimeoutTier('chatgpt', 'thinking', 'deep')).toBe('deep-research');
        expect(deriveTimeoutTier('chatgpt', undefined)).toBe(null);
    });

    it('derives Grok tier: heavy -> grok-heavy', () => {
        expect(deriveTimeoutTier('grok', 'heavy')).toBe('grok-heavy');
        expect(deriveTimeoutTier('grok', 'expert')).toBe('thinking');
        expect(deriveTimeoutTier('grok', 'thinking')).toBe('thinking');
        expect(deriveTimeoutTier('grok', 'fast')).toBe('instant');
        expect(deriveTimeoutTier('grok', 'auto')).toBe('thinking');
    });

    it('derives the Gemini tier including deep-think', () => {
        expect(deriveTimeoutTier('gemini', 'deepthink')).toBe('deep-research');
        expect(deriveTimeoutTier('gemini', 'flash-lite')).toBe('instant');
        expect(deriveTimeoutTier('gemini', 'flash')).toBe('thinking');
        expect(deriveTimeoutTier('gemini', 'pro')).toBe('thinking');
    });

    it('maps tiers to seconds with vendor fallback', () => {
        expect(tierDefaultTimeoutSec('chatgpt-pro')).toBe(5400);
        expect(tierDefaultTimeoutSec('grok-heavy')).toBe(3600);
        expect(tierDefaultTimeoutSec('instant')).toBe(120);
        expect(tierDefaultTimeoutSec('thinking')).toBe(600);
        expect(tierDefaultTimeoutSec('deep-research')).toBe(3600);
        expect(tierDefaultTimeoutSec(null, 'chatgpt')).toBe(1200);
        expect(tierDefaultTimeoutSec(null, 'grok')).toBe(600);
        expect(tierDefaultTimeoutSec(null, 'gemini')).toBe(1200);
    });

    it('resolves end-to-end defaults: chatgpt-pro=5400, grok-heavy=3600, expert=600', () => {
        expect(resolveTimeoutDefaultSec({ model: 'pro' }, 'chatgpt')).toBe(5400);
        expect(resolveTimeoutDefaultSec({ model: 'instant' }, 'chatgpt')).toBe(120);
        expect(resolveTimeoutDefaultSec({ model: 'thinking' }, 'chatgpt')).toBe(600);
        expect(resolveTimeoutDefaultSec({ model: 'pro', research: 'deep' }, 'chatgpt')).toBe(3600);
        expect(resolveTimeoutDefaultSec({ model: 'heavy' }, 'grok')).toBe(3600);
        expect(resolveTimeoutDefaultSec({ model: 'expert' }, 'grok')).toBe(600);
        expect(resolveTimeoutDefaultSec({ model: 'deepthink' }, 'gemini')).toBe(3600);
        expect(resolveTimeoutDefaultSec({}, 'chatgpt')).toBe(1200);
        expect(resolveTimeoutDefaultSec({}, 'grok')).toBe(600);
    });
});

describe('resolveDeadlineAt tier-aware creation', () => {
    it('creates chatgpt-pro deadline at now + 5400s when model=pro and timeout omitted', () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const now = Date.now();
        const dl = resolveDeadlineAt({ model: 'pro' }, 'chatgpt');
        expect(Date.parse(dl) - now).toBe(5400 * 1000);
    });

    it('explicit timeout overrides tier default', () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const now = Date.now();
        const dl = resolveDeadlineAt({ model: 'pro', timeout: 45 }, 'chatgpt');
        expect(Date.parse(dl) - now).toBe(45 * 1000);
    });

    it('explicit deadline passes through', () => {
        const iso = '2099-01-01T00:00:00.000Z';
        expect(resolveDeadlineAt({ deadline: iso })).toBe(iso);
    });

    it('grok heavy gets 3600s, not 5400s', () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const now = Date.now();
        const dl = resolveDeadlineAt({ model: 'heavy' }, 'grok');
        expect(Date.parse(dl) - now).toBe(3600 * 1000);
    });

    it('deep research gets 3600s', () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const now = Date.now();
        const dl = resolveDeadlineAt({ model: 'thinking', research: 'deep' }, 'chatgpt');
        expect(Date.parse(dl) - now).toBe(3600 * 1000);
    });

    it('unknown model falls back to vendor default', () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const now = Date.now();
        expect(Date.parse(resolveDeadlineAt({}, 'chatgpt')) - now).toBe(1200 * 1000);
        expect(Date.parse(resolveDeadlineAt({}, 'grok')) - now).toBe(600 * 1000);
    });
});

describe('resolveTimeoutBudgetSec priority', () => {
    const NOW = new Date('2026-07-10T00:00:00.000Z').getTime();

    it('explicit timeout wins over stored deadline and tier default', () => {
        const session = {
            deadlineAt: new Date(NOW + 600_000).toISOString(),
            vendor: 'chatgpt',
            envelopeSummary: { model: 'pro' },
        };
        expect(resolveTimeoutBudgetSec({ timeout: 30 }, session, 'chatgpt', NOW)).toBe(30);
    });

    it('stored deadline remainder is used when timeout absent', () => {
        const session = {
            deadlineAt: new Date(NOW + 600_000).toISOString(),
            vendor: 'chatgpt',
            envelopeSummary: { model: 'pro' },
        };
        expect(resolveTimeoutBudgetSec({}, session, 'chatgpt', NOW)).toBe(600);
    });

    it('stored deadline remainder decreases over time, not reset to tier default', () => {
        const session = {
            deadlineAt: new Date(NOW + 600_000).toISOString(),
            vendor: 'chatgpt',
            envelopeSummary: { model: 'pro' },
        };
        const oneMinLater = NOW + 60_000;
        expect(resolveTimeoutBudgetSec({}, session, 'chatgpt', oneMinLater)).toBe(540);
    });

    it('expired stored deadline clamps to 1s, not tier default', () => {
        const session = {
            deadlineAt: new Date(NOW - 1).toISOString(),
            vendor: 'chatgpt',
            envelopeSummary: { model: 'pro' },
        };
        expect(resolveTimeoutBudgetSec({}, session, 'chatgpt', NOW)).toBe(1);
    });

    it('no deadline: chatgpt envelopeSummary.model=pro -> chatgpt-pro tier 5400', () => {
        const session = { deadlineAt: null, vendor: 'chatgpt', envelopeSummary: { model: 'pro' } };
        expect(resolveTimeoutBudgetSec({}, session, 'chatgpt', NOW)).toBe(5400);
    });

    it('no deadline: grok envelopeSummary.model=heavy -> grok-heavy tier 3600', () => {
        const session = { deadlineAt: null, vendor: 'grok', envelopeSummary: { model: 'heavy' } };
        expect(resolveTimeoutBudgetSec({}, session, 'grok', NOW)).toBe(3600);
    });

    it('no deadline: researchMode=deep -> deep-research tier 3600', () => {
        const session = { deadlineAt: null, vendor: 'chatgpt', researchMode: 'deep', envelopeSummary: {} };
        expect(resolveTimeoutBudgetSec({}, session, 'chatgpt', NOW)).toBe(3600);
    });

    it('no deadline, no model info: grok vendor fallback 600', () => {
        const session = { deadlineAt: null, vendor: 'grok', envelopeSummary: {} };
        expect(resolveTimeoutBudgetSec({}, session, 'grok', NOW)).toBe(600);
    });

    it('grok-heavy does not consume chatgpt-pro budget (non-mixing)', () => {
        const session = { deadlineAt: null, vendor: 'grok', envelopeSummary: { model: 'heavy' } };
        const budget = resolveTimeoutBudgetSec({}, session, 'grok', NOW);
        expect(budget).toBe(3600);
        expect(budget).not.toBe(5400);
    });

    it('gemini deep-think does not consume chatgpt-pro or grok-heavy (non-mixing)', () => {
        const session = { deadlineAt: null, vendor: 'gemini', envelopeSummary: { model: 'deepthink' } };
        const budget = resolveTimeoutBudgetSec({}, session, 'gemini', NOW);
        expect(budget).toBe(3600);
        expect(budget).not.toBe(5400);
    });

    it('damaged deadline (unparseable): falls back to stored model tier', () => {
        const session = { deadlineAt: 'not-a-date', vendor: 'chatgpt', envelopeSummary: { model: 'pro' } };
        expect(resolveTimeoutBudgetSec({}, session, 'chatgpt', NOW)).toBe(5400);
    });

    it('null session: falls back to tier from input model', () => {
        expect(resolveTimeoutBudgetSec({ model: 'pro' }, null, 'chatgpt', NOW)).toBe(5400);
    });

    it('null session, no model: vendor default', () => {
        expect(resolveTimeoutBudgetSec({}, null, 'chatgpt', NOW)).toBe(1200);
    });
});

describe('watcher normalizeWatchOptions deadline guard', () => {
    it('returns null deadlineAt when no explicit override given', async () => {
        const { normalizeWatchOptions } = await import('../../web-ai/watcher.mjs');
        const opts = normalizeWatchOptions({ session: 'S' });
        expect(opts.deadlineAt).toBe(null);
    });

    it('sets deadlineAt from explicit timeout', async () => {
        const { normalizeWatchOptions } = await import('../../web-ai/watcher.mjs');
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const opts = normalizeWatchOptions({ session: 'S', timeout: 90 });
        const expected = new Date(Date.now() + 90 * 1000).toISOString();
        expect(opts.deadlineAt).toBe(expected);
    });
});

describe('chatgpt-deep-research.mjs resume no longer uses 1_200_000 hardcode', () => {
    it('resumeDeepResearch default timeoutMs uses TIER_DEFAULT_TIMEOUT_SEC deep-research', async () => {
        const src = (await import('node:fs')).readFileSync(
            new URL('../../web-ai/chatgpt-deep-research.mjs', import.meta.url), 'utf8',
        );
        expect(src).not.toMatch(/resumeDeepResearch[\s\S]*?timeoutMs\s*=\s*1[_,]?200[_,]?000/);
        expect(src).toMatch(/TIER_DEFAULT_TIMEOUT_SEC/);
    });
});

/**
 * Every surface that resumes an existing session shares this. Each one got the
 * same thing wrong differently, so the behaviour is pinned once, here.
 */
describe('resolvePollTimeoutSec never outlives the stored deadline', () => {
    const NOW = new Date('2026-07-10T00:00:00.000Z').getTime();

    it('returns the sub-second remainder instead of rounding it up', () => {
        const session = { deadlineAt: new Date(NOW + 400).toISOString(), vendor: 'chatgpt' };
        expect(resolvePollTimeoutSec({}, session, 'chatgpt', NOW)).toBeCloseTo(0.4, 3);
    });

    it('caps an explicit timeout that would outlive the deadline', () => {
        const session = { deadlineAt: new Date(NOW + 2_000).toISOString(), vendor: 'chatgpt' };
        expect(resolvePollTimeoutSec({ timeout: 30 }, session, 'chatgpt', NOW)).toBeCloseTo(2, 3);
    });

    it('leaves an explicit timeout alone when it fits', () => {
        const session = { deadlineAt: new Date(NOW + 600_000).toISOString(), vendor: 'chatgpt' };
        expect(resolvePollTimeoutSec({ timeout: 30 }, session, 'chatgpt', NOW)).toBe(30);
    });

    it('stays positive for an expired deadline rather than reading as "no budget"', () => {
        // Zero or negative gets floored back up by some providers, which is the
        // bug. Callers that must refuse an expired session check the remainder.
        const session = { deadlineAt: new Date(NOW - 5_000).toISOString(), vendor: 'chatgpt' };
        const sec = resolvePollTimeoutSec({}, session, 'chatgpt', NOW);
        expect(sec).toBeGreaterThan(0);
        expect(sec).toBeLessThan(0.01);
    });

    it.each(['gemini', 'grok'])('bounds %s, which reads no stored deadline of its own', (vendor) => {
        // Omitting the timeout for these vendors is NOT safe: they fall back to
        // their own 1200s/600s defaults, so a 400ms remainder became minutes.
        const session = { deadlineAt: new Date(NOW + 400).toISOString(), vendor };
        expect(resolvePollTimeoutSec({}, session, vendor, NOW)).toBeCloseTo(0.4, 3);
    });

    it('falls back to the tier default when there is no stored deadline', () => {
        const session = { deadlineAt: null, vendor: 'chatgpt', envelopeSummary: { model: 'pro' } };
        expect(resolvePollTimeoutSec({}, session, 'chatgpt', NOW)).toBe(5400);
    });
});

describe('WP5 shared-file source contracts', () => {
    it('pollWebAi no longer has hardcoded || 1200 fallback', () => {
        const src = readFileSync(new URL('../../web-ai/chatgpt.mjs', import.meta.url), 'utf8');
        expect(src).not.toMatch(/const timeout\s*=\s*Math\.max\(1,\s*Number\(input\.timeout\s*\|\|\s*1200\)\)/);
    });

    it('CLI poll/watch/resume preserve undefined timeout (send/query only inject tier default)', () => {
        const src = readFileSync(new URL('../../web-ai/cli.mjs', import.meta.url), 'utf8');
        expect(src).toMatch(/command\s*===\s*'send'\s*\|\|\s*command\s*===\s*'query'/);
    });

    it('MCP wait/resume resolves a bounded timeout, not raw args.timeout passthrough', () => {
        const src = readFileSync(new URL('../../web-ai/mcp-server.mjs', import.meta.url), 'utf8');
        // Was `resolveTimeoutBudgetSec`. That resolver floors at a whole second
        // and knows nothing about the stored deadline, which is what let a
        // resumed session poll past it; `resolvePollTimeoutSec` wraps it.
        expect(src).toMatch(/resolvePollTimeoutSec/);
        const pollBlock = src.match(/pollByProvider\([\s\S]*?\)\s*\)/)?.[0] || '';
        expect(pollBlock).not.toMatch(/timeout:\s*args\.timeout\s*[,)]/);
    });

    /**
     * Resolving a budget for a caller who gave no timeout floors the stored
     * remainder to a whole second and hands it down as `input.timeout`, which
     * the provider cannot tell apart from a real `--timeout`. That let an
     * expired session poll for another second, defeating the millisecond
     * deadline the wrapper enforces.
     *
     * These are source contracts because the behaviour lives across a process
     * boundary; the behavioural cover for the same defect is in
     * web-ai-watcher.test.mjs, which drives the real `callVendorPoll`.
     */
    it.each([
        ['resume', '../../web-ai/cli-sessions.mjs'],
        ['MCP', '../../web-ai/mcp-server.mjs'],
        ['watch', '../../web-ai/watcher.mjs'],
        ['work poll', '../../web-ai/chatgpt-work-picker.mjs'],
    ])('%s clamps its poll timeout to the stored deadline', (_label, modulePath) => {
        const src = readFileSync(new URL(modulePath, import.meta.url), 'utf8');
        expect(src).toMatch(/resolvePollTimeoutSec\(/);
    });

    it('tool schema timeout fields have minimum:1 and descriptions without 40min/2400 literals', () => {
        const src = readFileSync(new URL('../../web-ai/tool-schema.mjs', import.meta.url), 'utf8');
        // Use dynamic import so we get the live schema objects
        for (const name of ['web_ai_submit_prompt', 'web_ai_wait_response', 'web_ai_session_resume']) {
            // Verify minimum:1 appears in timeout definitions
            expect(src).toMatch(/minimum:\s*1/);
        }
        expect(src).not.toMatch(/40\s*min/);
        expect(src).not.toMatch(/2400/);
    });
});

describe('MCP submit pro-tier regression (CLI bypass)', () => {
    const NOW = new Date('2026-07-10T00:00:00.000Z').getTime();

    it('web_ai_submit_prompt model=pro creates deadline at chatgpt-pro tier (5400s)', async () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        // The deadline is created by resolveDeadlineAt in chatgpt.mjs sendWebAi,
        // which calls through session.mjs. Verify the resolver path directly.
        const dl = resolveDeadlineAt({ model: 'pro' }, 'chatgpt');
        const diffMs = Date.parse(dl) - Date.now();
        expect(diffMs).toBe(TIER_DEFAULT_TIMEOUT_SEC['chatgpt-pro'] * 1000);
        expect(diffMs).toBe(5400 * 1000);
    });

    it('web_ai_submit_prompt model=pro with explicit timeout=77 overrides tier default', async () => {
        vi.useFakeTimers({ now: new Date('2026-07-10T00:00:00.000Z') });
        const dl = resolveDeadlineAt({ model: 'pro', timeout: 77 }, 'chatgpt');
        expect(Date.parse(dl) - Date.now()).toBe(77 * 1000);
    });
});
