import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, saveBaseline } from '../../web-ai/session.mjs';
import { geminiPollWebAi } from '../../web-ai/gemini-live.mjs';
import { grokPollWebAi } from '../../web-ai/grok-live.mjs';
import { runSessionsCommand } from '../../web-ai/cli-sessions.mjs';
import { withSessionCommandLock } from '../../web-ai/session-store.mjs';

/**
 * The boundary clamp is worthless if the provider on the other side rounds it
 * back up. Both of these floored their timeout at a whole second, so a caller
 * that carefully computed a 400ms remainder still got a full second — and an
 * omitted timeout fell through to 1200s (Gemini) or 600s (Grok).
 *
 * These drive the real provider polls against a page double. Every audit round
 * that missed this defect did so because the tests stopped at the dispatch and
 * never asked whether the consumer honoured the value.
 */
const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-provider-deadline-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

/**
 * A page that never produces an answer, so the poll can only end on its
 * deadline. `waitForTimeout` is honoured for real: the point of the test is
 * how long the loop actually takes.
 *
 * @param {string} url
 */
function stallingProviderPage(url) {
    return {
        url: () => url,
        waitForTimeout: async (ms) => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
        evaluate: async () => '',
        innerText: async () => '',
        locator: () => ({
            first: () => ({ isVisible: async () => false, innerText: async () => '' }),
            all: async () => [],
            count: async () => 0,
            evaluateAll: async () => [],
        }),
    };
}

describe.each([
    {
        vendor: 'gemini',
        url: 'https://gemini.google.com/app/deadline',
        poll: geminiPollWebAi,
    },
    {
        vendor: 'grok',
        url: 'https://grok.com/chat/deadline',
        poll: grokPollWebAi,
    },
])('$vendor honours a sub-second poll timeout', ({ vendor, url, poll }) => {
    it('returns inside a fractional budget instead of flooring it to a second', async () => {
        saveBaseline({ vendor, url, assistantCount: 0, envelope: { vendor, prompt: 'q' } });
        const session = createSession(
            { vendor, prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: `target-${vendor}-deadline`,
                conversationUrl: url,
                deadlineAt: new Date(Date.now() + 60_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
        const page = stallingProviderPage(url);
        const started = Date.now();

        await poll(
            { getPage: async () => page, getTargetId: async () => `target-${vendor}-deadline` },
            { vendor, session: session.sessionId, timeout: 0.4 },
        );
        const elapsed = Date.now() - started;

        // The whole-second floor lands at ~1000ms; the uncapped tick pushes it
        // further still. Generous ceiling so this measures the floor, not
        // machine speed.
        expect(elapsed).toBeLessThan(900);
    }, 20_000);
});

/**
 * The ordinary loop is not the only place that sleeps. Gemini waits five
 * seconds when it sees a Deep Think placeholder — longer than many resumed
 * budgets — and the test above never reaches that branch because it supplies
 * no responses at all. That is how the defect survived a round of review.
 */
describe('gemini honours the deadline while waiting on a Deep Think placeholder', () => {
    it('does not sleep five seconds inside a sub-second budget', async () => {
        const url = 'https://gemini.google.com/app/deepthink';
        saveBaseline({ vendor: 'gemini', url, assistantCount: 0, envelope: { vendor: 'gemini', prompt: 'q' } });
        const session = createSession(
            { vendor: 'gemini', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-gemini-deepthink',
                conversationUrl: url,
                deadlineAt: new Date(Date.now() + 60_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
        let waits = 0;
        // Gemini reads responses through nested `locator().all()` and
        // `innerText`, not `evaluateAll`. A double that only answers
        // `evaluateAll` returns no responses at all, which skips the branch
        // entirely — the first version of this test did exactly that and
        // stayed green against the uncapped sleep.
        const pendingText = 'Generating your response...';
        const textLocator = {
            innerText: async () => pendingText,
            isVisible: async () => true,
        };
        const responseLocator = {
            innerText: async () => pendingText,
            isVisible: async () => true,
            locator: () => ({ all: async () => [textLocator], first: () => textLocator, count: async () => 1 }),
        };
        const page = {
            url: () => url,
            waitForTimeout: async (ms) => {
                waits += 1;
                await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
            },
            evaluate: async () => '',
            innerText: async () => pendingText,
            locator: (selector) => ({
                first: () => responseLocator,
                all: async () => [responseLocator],
                // `hasCompletionSignal` needs a completion selector present and
                // no progressbar, or the poll never looks at the text.
                count: async () => (String(selector).includes('progressbar') ? 0 : 1),
                evaluateAll: async () => [pendingText],
            }),
        };
        const started = Date.now();

        const result = await geminiPollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-gemini-deepthink' },
            { vendor: 'gemini', session: session.sessionId, timeout: 0.4 },
        );
        const elapsed = Date.now() - started;

        expect(result.status).toBe('timeout');
        // The loop really ran rather than short-circuiting on some other check.
        expect(waits).toBeGreaterThan(0);
        // The uncapped branch lands at ~5000ms.
        expect(elapsed).toBeLessThan(900);
    }, 20_000);

    it('spends most of the budget instead of returning immediately', async () => {
        // The upper bound alone is not enough: a provider that consumed a tiny
        // fraction of its budget would satisfy it while being just as broken.
        // Capping the effective deadline at 100ms was demonstrated to leave the
        // ceiling-only assertion green.
        const url = 'https://gemini.google.com/app/lowerbound';
        saveBaseline({ vendor: 'gemini', url, assistantCount: 0, envelope: { vendor: 'gemini', prompt: 'q' } });
        const session = createSession(
            { vendor: 'gemini', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-gemini-lowerbound',
                conversationUrl: url,
                deadlineAt: new Date(Date.now() + 60_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
        const page = stallingProviderPage(url);
        const started = Date.now();

        const result = await geminiPollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-gemini-lowerbound' },
            { vendor: 'gemini', session: session.sessionId, timeout: 0.4 },
        );
        const elapsed = Date.now() - started;

        expect(result.status).toBe('timeout');
        // Bracketed: the budget was 400ms, so a correct poll uses nearly all of
        // it. Generous lower bound so this measures the contract, not the host.
        expect(elapsed).toBeGreaterThanOrEqual(300);
        expect(elapsed).toBeLessThan(900);
    }, 20_000);
});

/**
 * The clamp keeps a positive minimum so providers cannot read it as "no
 * budget" and floor it back up. That minimum is only safe if the surfaces that
 * resolve a page first refuse an expired session outright — otherwise an
 * expired poll still opens a tab and takes at least one probe, and Gemini's
 * placeholder branch then waits five seconds.
 */
describe('an expired session is refused before its page is opened', () => {
    it('sessions resume returns a timeout without resolving a page', async () => {
        const url = 'https://chatgpt.com/c/expired-resume';
        saveBaseline({ vendor: 'chatgpt', url, assistantCount: 0, envelope: { vendor: 'chatgpt', prompt: 'q' } });
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-expired-resume',
                conversationUrl: url,
                deadlineAt: new Date(Date.now() - 5_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
        let pageRequests = 0;
        const deps = {
            getPort: () => 9222,
            getPage: async () => { pageRequests += 1; throw new Error('resume must not open a page'); },
            getTargetId: async () => 'target-expired-resume',
        };

        const result = await runSessionsCommand(['resume', session.sessionId], {}, deps, {});

        expect(result.status).toBe('timeout');
        expect(result.errorCode).toBe('provider.poll-timeout');
        expect(pageRequests).toBe(0);
    });

    it('refuses a session that expires WHILE the command lock is held', async () => {
        // The pre-lock check alone is a TOCTOU gap: acquiring the session
        // command lock retries 200 times at 25ms, so a session with a little
        // time left passes the check and is expired by the time the lock is
        // granted. Without a second check the run then opens a tab anyway.
        const url = 'https://chatgpt.com/c/expired-in-lock';
        saveBaseline({ vendor: 'chatgpt', url, assistantCount: 0, envelope: { vendor: 'chatgpt', prompt: 'q' } });
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-expired-in-lock',
                conversationUrl: url,
                // Alive right now, so the pre-lock check passes.
                deadlineAt: new Date(Date.now() + 150).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
        let pageRequests = 0;
        const deps = {
            getPort: () => 9222,
            getPage: async () => { pageRequests += 1; throw new Error('resume must not open a page'); },
            getTargetId: async () => 'target-expired-in-lock',
        };

        // Hold the lock past the deadline, exactly as contention would.
        const holding = withSessionCommandLock(session.sessionId, async () => {
            await new Promise(resolve => setTimeout(resolve, 400));
        }, { ttlMs: 30_000, heartbeatMs: 0 });
        // Give the holder time to take the lock before the resume tries.
        await new Promise(resolve => setTimeout(resolve, 25));
        const resumed = await runSessionsCommand(['resume', session.sessionId], {}, deps, {});
        await holding;

        expect(resumed.status).toBe('timeout');
        expect(resumed.errorCode).toBe('provider.poll-timeout');
        expect(pageRequests).toBe(0);
    }, 20_000);
});
