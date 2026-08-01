import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, saveBaseline } from '../../web-ai/session.mjs';
import { geminiPollWebAi } from '../../web-ai/gemini-live.mjs';
import { grokPollWebAi } from '../../web-ai/grok-live.mjs';

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
