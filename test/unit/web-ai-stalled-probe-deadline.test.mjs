import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, getSession, saveBaseline } from '../../web-ai/session.mjs';
import { geminiPollWebAi } from '../../web-ai/gemini-live.mjs';
import { grokPollWebAi } from '../../web-ai/grok-live.mjs';
import { pollWorkSession } from '../../web-ai/chatgpt-work-picker.mjs';
import { resumeDeepResearch } from '../../web-ai/chatgpt-deep-research.mjs';

/**
 * A probe that never settles must not defeat the timeout.
 *
 * Every one of these loops checked its deadline only BETWEEN awaited browser
 * probes, so a single `page.evaluate` or `locator.all` that never resolves left
 * the caller waiting forever — capping the sleeps did nothing, because the
 * sleep is not where the time went.
 *
 * NOT the whole bound. A run that passes its expiry check and then blocks
 * inside a contended synchronous `updateSession` still suspends the timer;
 * that is the blocking session store one layer down and needs the async write,
 * so #88 stays open on it.
 *
 * The stalled work is NOT cancelled; Playwright gives no handle for that. What
 * these prove is the weaker, honest property: the CALLER stops waiting.
 */
const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-stalled-probe-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

/** A promise that never settles — the shape of a hung CDP round trip. */
const forever = () => new Promise(() => {});

/**
 * A page whose every read hangs. `url()` stays synchronous because the poll
 * needs it to identify the tab before it starts reading.
 *
 * `reached` records which hanging method the poll actually got to. Without it a
 * test can pass because the deadline expired during a *sleep* rather than in a
 * stalled probe — which proves nothing about the defect. That exact false pass
 * has already happened twice in this effort.
 *
 * @param {string} url
 * @param {{ tickMs?: number }} [opts] how long `waitForTimeout` honours; keep it
 *   small so the budget is spent in the probe, not the tick
 */
function stalledPage(url, { tickMs = 0 } = {}) {
    /** @type {Record<string, number>} */
    const reached = {};
    /** @param {string} name */
    const hang = (name) => () => { reached[name] = (reached[name] || 0) + 1; return forever(); };
    const hangingLocator = {
        all: hang('locator.all'),
        first: () => ({ isVisible: hang('isVisible'), innerText: hang('innerText'), waitFor: hang('waitFor') }),
        count: hang('count'),
        innerText: hang('locator.innerText'),
        evaluateAll: hang('evaluateAll'),
        locator: () => hangingLocator,
    };
    return {
        reached,
        url: () => url,
        // Capped at `tickMs`: a full-length tick would consume the budget
        // itself and the deadline would fire during a sleep, never reaching a
        // stalled probe at all.
        waitForTimeout: async (ms) => new Promise(resolve => setTimeout(resolve, Math.min(tickMs, Math.max(0, Number(ms) || 0)))),
        evaluate: hang('evaluate'),
        innerText: hang('page.innerText'),
        locator: () => hangingLocator,
        title: hang('title'),
    };
}

/** @param {string} vendor @param {string} url @param {string} slug */
function pollableSession(vendor, url, slug) {
    saveBaseline({ vendor, url, assistantCount: 0, envelope: { vendor, prompt: 'q' } });
    return createSession(
        { vendor, prompt: 'q', attachmentPolicy: 'inline-only' },
        {
            targetId: `target-${slug}`,
            conversationUrl: url,
            deadlineAt: new Date(Date.now() + 600_000).toISOString(),
            envelopeSummary: { assistantCount: 0 },
        },
    );
}

describe('a never-settling probe cannot outlive the poll deadline', () => {
    it('B-GEM: gemini returns at its deadline', async () => {
        const url = 'https://gemini.google.com/app/stalled';
        const session = pollableSession('gemini', url, 'gem-stalled');
        const started = Date.now();

        const page = stalledPage(url);
        const result = await geminiPollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-gem-stalled' },
            { vendor: 'gemini', session: session.sessionId, timeout: 1 },
        );

        expect(result.status).toBe('timeout');
        expect(result.error).toBe('timed out waiting for gemini response');
        // The budget was spent in a STALLED PROBE, not in a sleep.
        expect(Object.keys(page.reached).length).toBeGreaterThan(0);
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);

    it('B-GROK: grok returns at its deadline', async () => {
        const url = 'https://grok.com/chat/stalled';
        const session = pollableSession('grok', url, 'grok-stalled');
        const started = Date.now();

        const page = stalledPage(url);
        const result = await grokPollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-grok-stalled' },
            { vendor: 'grok', session: session.sessionId, timeout: 1 },
        );

        expect(result.status).toBe('timeout');
        expect(result.error).toBe('timed out waiting for grok response');
        expect(Object.keys(page.reached).length).toBeGreaterThan(0);
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);

    it('B-WORK: the work poller returns at its deadline', async () => {
        const url = 'https://chatgpt.com/c/work-stalled';
        const session = pollableSession('chatgpt', url, 'work-stalled');
        const started = Date.now();

        const page = stalledPage(url);
        const result = await pollWorkSession(
            { getPage: async () => page, getTargetId: async () => 'target-work-stalled' },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 1 },
        );

        expect(result.status).toBe('timeout');
        expect(result.warnings).toContain('work-poll-timeout');
        // The Work-specific fields survive the race path, so a consumer cannot
        // tell it apart from the loop's own timeout.
        expect(result.surface).toBe('work');
        expect(result.responseContract).toBe('work');
        expect(Object.keys(page.reached).length).toBeGreaterThan(0);
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);

    it('B-DR: a deep research resume returns at its deadline', async () => {
        const url = 'https://chatgpt.com/c/dr-stalled';
        const session = pollableSession('chatgpt', url, 'dr-stalled');
        const started = Date.now();

        const page = stalledPage(url);
        const result = await resumeDeepResearch(page, {}, {
            session,
            timeoutMs: 1_000,
        });

        expect(result.status).toBe('timeout');
        expect(result.warnings).toContain('deep-research-resume-timeout');
        // The expiry path does not re-enter the browser to capture a report:
        // that call is itself a probe and would re-enter the stall.
        expect(result.warnings).toContain('deep-research-capture-skipped-past-deadline');
        // The reviewer showed the first version of this test never reached a
        // hanging probe at all — the fixed 2s tick ate the whole budget, so the
        // deadline fired during a sleep and the assertion proved nothing.
        expect(Object.keys(page.reached).length).toBeGreaterThan(0);
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);
});

/**
 * A held session-store lock must not defeat the deadline either.
 *
 * The blocking lock waits with `Atomics.wait`, which stops the event loop —
 * a contended acquire was measured at 6.4s during which a 50ms timer never
 * fired. So a poll that read the store synchronously was unbounded no matter
 * how good its race was, and the expiry envelope itself could block or throw
 * "failed to acquire lock" instead of returning.
 */
describe('a held session-store lock cannot outlive the poll deadline', () => {
    /** Writes a lock that becomes stale shortly, so contention is real but self-clearing. */
    function holdStoreLock(afterMs) {
        const lockPath = join(tmpHome, 'web-ai-sessions.json.lock');
        mkdirSync(tmpHome, { recursive: true });
        writeFileSync(lockPath, JSON.stringify({
            pid: process.pid,
            acquiredAt: new Date(Date.now() - (5 * 60 * 1000) + afterMs).toISOString(),
        }));
        return () => rmSync(lockPath, { force: true });
    }

    it.each([
        ['gemini', 'https://gemini.google.com/app/locked', geminiPollWebAi],
        ['grok', 'https://grok.com/chat/locked', grokPollWebAi],
    ])('%s returns at its deadline while the store lock is held', async (vendor, url, poll) => {
        const session = pollableSession(vendor, url, `${vendor}-locked`);
        const release = holdStoreLock(3_000);
        const started = Date.now();
        try {
            const result = await poll(
                { getPage: async () => stalledPage(url), getTargetId: async () => `target-${vendor}-locked` },
                { vendor, session: session.sessionId, timeout: 1 },
            );
            expect(result.status).toBe('timeout');
            // The envelope still identifies the session: it is seeded from an
            // ASYNC read before the race, so a blocked store cannot strip it.
            expect(result.sessionId).toBe(session.sessionId);
            expect(Date.now() - started).toBeLessThan(2_500);
        } finally {
            release();
        }
    }, 20_000);

    it.each([
        ['gemini', 'https://gemini.google.com/app/implicit', geminiPollWebAi],
        ['grok', 'https://grok.com/chat/implicit', grokPollWebAi],
    ])('%s returns at its deadline with an IMPLICIT session while the lock is held', async (vendor, url, poll) => {
        // No `input.session`, so the poll finds its session by lookup. That
        // fallback listed sessions under the blocking lock, which stops the
        // event loop — the explicit-session fix did not cover it, and a held
        // lock still produced 6.4s returns on a 50ms budget.
        pollableSession(vendor, url, `${vendor}-implicit`);
        const release = holdStoreLock(3_000);
        const started = Date.now();
        try {
            const result = await poll(
                { getPage: async () => stalledPage(url), getTargetId: async () => `target-${vendor}-implicit` },
                { vendor, timeout: 1 },
            );
            expect(result.status).toBe('timeout');
            expect(Date.now() - started).toBeLessThan(2_500);
        } finally {
            release();
        }
    }, 20_000);

    it('the work poller returns at its deadline while the store lock is held', async () => {
        const url = 'https://chatgpt.com/c/work-locked';
        const session = pollableSession('chatgpt', url, 'work-locked');
        const release = holdStoreLock(3_000);
        const started = Date.now();
        try {
            const result = await pollWorkSession(
                { getPage: async () => stalledPage(url), getTargetId: async () => 'target-work-locked' },
                { vendor: 'chatgpt', session: session.sessionId, timeout: 1 },
            );
            expect(result.status).toBe('timeout');
            expect(Date.now() - started).toBeLessThan(2_500);
        } finally {
            release();
        }
    }, 20_000);
});

/**
 * A probe that settles LATE must not write.
 *
 * The race cannot cancel the stalled work, so the losing run keeps going and
 * may reach a session write long after its caller was handed `timeout`. The
 * run token exists to stop that, and the reviewer showed all four wrappers
 * were discarding it: a Work probe settling 70ms past a 50ms deadline wrote
 * `status: complete, answer: 'late answer'` to a session the caller had
 * already been told timed out.
 */
describe('a run that lost its deadline does not write afterwards', () => {
    it('the work poller does not record a late completion', async () => {
        const url = 'https://chatgpt.com/c/work-late';
        const session = pollableSession('chatgpt', url, 'work-late');
        // Reports a FINISHED task, but only after the 1s budget has passed —
        // the shape of a probe that settles late. Mirrors the real read path in
        // `readWorkTaskState`: a visible Copy button, then `.last().textContent()`.
        let readStarted = 0;
        const lateTurn = { textContent: async () => 'late answer', innerText: async () => 'late answer' };
        /**
         * Mirrors what `readWorkTaskState` actually reads: no Stop button and
         * no "Thinking" (so the state is not `running`), a stop probe that
         * returns `absent` rather than `unknown` (so it is not fenced early),
         * and a visible Copy button with an assistant turn — which together
         * mean `complete`. The Copy check is where the delay goes, so the task
         * reads as finished only after the deadline has passed.
         *
         * @param {string} selector
         */
        const locatorFor = (selector) => {
            const isStop = /stop/i.test(selector);
            const isCopy = /copy/i.test(selector);
            return {
                first: () => ({
                    isVisible: async () => {
                        if (!isCopy) return false;
                        readStarted += 1;
                        await new Promise(resolve => setTimeout(resolve, 1_400));
                        return true;
                    },
                    textContent: async () => 'late answer',
                    innerText: async () => 'late answer',
                }),
                last: () => lateTurn,
                all: async () => (isStop ? [] : [lateTurn]),
                count: async () => (isStop ? 0 : 1),
                evaluateAll: async () => ['late answer'],
                textContent: async () => 'late answer',
                innerText: async () => 'late answer',
                locator: (/** @type {string} */ inner) => locatorFor(inner),
                getByText: () => locatorFor('text'),
            };
        };
        const page = {
            url: () => url,
            waitForTimeout: async () => {},
            evaluate: async () => 'late answer',
            innerText: async () => 'late answer',
            locator: (/** @type {string} */ selector) => locatorFor(selector),
            getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
        };

        const result = await pollWorkSession(
            { getPage: async () => page, getTargetId: async () => 'target-work-late' },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 1 },
        );
        expect(result.status).toBe('timeout');
        expect(readStarted).toBeGreaterThan(0);

        // Let the loser finish, then look at what it managed to do.
        await new Promise(resolve => setTimeout(resolve, 1_200));
        const after = getSession(session.sessionId);
        expect(after.answer ?? null).toBeNull();
        expect(after.status).not.toBe('complete');
    }, 20_000);
});

/**
 * A stored deadline must still bound the poll when no timeout is passed.
 *
 * The Work wrapper cannot read the session before arming its race — that read
 * is exactly the blocking call being bounded — so it arms on the vendor
 * default and tightens once the async read lands. Without that hand-back, an
 * omitted timeout meant a 50ms stored remainder ran to the vendor default.
 */
describe('an inherited stored deadline still bounds the work poll', () => {
    it('returns near the stored remainder, not the vendor default', async () => {
        const url = 'https://chatgpt.com/c/work-inherited';
        saveBaseline({ vendor: 'chatgpt', url, assistantCount: 0, envelope: { vendor: 'chatgpt', prompt: 'q' } });
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-work-inherited',
                conversationUrl: url,
                deadlineAt: new Date(Date.now() + 600).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
        const page = stalledPage(url);
        const started = Date.now();

        const result = await pollWorkSession(
            { getPage: async () => page, getTargetId: async () => 'target-work-inherited' },
            // No timeout: the stored deadline is the only bound.
            { vendor: 'chatgpt', session: session.sessionId },
        );

        expect(result.status).toBe('timeout');
        expect(Object.keys(page.reached).length).toBeGreaterThan(0);
        // The vendor default is minutes; anything near it means the hand-back
        // did not happen.
        expect(Date.now() - started).toBeLessThan(3_000);
    }, 30_000);
});
