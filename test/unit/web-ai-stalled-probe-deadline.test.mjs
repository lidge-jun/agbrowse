import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, saveBaseline } from '../../web-ai/session.mjs';
import { geminiPollWebAi } from '../../web-ai/gemini-live.mjs';
import { grokPollWebAi } from '../../web-ai/grok-live.mjs';
import { pollWorkSession } from '../../web-ai/chatgpt-work-picker.mjs';
import { resumeDeepResearch } from '../../web-ai/chatgpt-deep-research.mjs';

/**
 * A probe that never settles must not defeat the timeout.
 *
 * This is the last thing standing between #88 and closed. Every one of these
 * loops checked its deadline only BETWEEN awaited browser probes, so a single
 * `page.evaluate` or `locator.all` that never resolves left the caller waiting
 * forever — capping the sleeps did nothing, because the sleep is not where the
 * time went.
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
 * @param {string} url
 */
function stalledPage(url) {
    const hangingLocator = {
        all: forever,
        first: () => ({ isVisible: forever, innerText: forever, waitFor: forever }),
        count: forever,
        innerText: forever,
        evaluateAll: forever,
        locator: () => hangingLocator,
    };
    return {
        url: () => url,
        waitForTimeout: async (ms) => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
        evaluate: forever,
        innerText: forever,
        locator: () => hangingLocator,
        title: forever,
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

        const result = await geminiPollWebAi(
            { getPage: async () => stalledPage(url), getTargetId: async () => 'target-gem-stalled' },
            { vendor: 'gemini', session: session.sessionId, timeout: 1 },
        );

        expect(result.status).toBe('timeout');
        expect(result.error).toBe('timed out waiting for gemini response');
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);

    it('B-GROK: grok returns at its deadline', async () => {
        const url = 'https://grok.com/chat/stalled';
        const session = pollableSession('grok', url, 'grok-stalled');
        const started = Date.now();

        const result = await grokPollWebAi(
            { getPage: async () => stalledPage(url), getTargetId: async () => 'target-grok-stalled' },
            { vendor: 'grok', session: session.sessionId, timeout: 1 },
        );

        expect(result.status).toBe('timeout');
        expect(result.error).toBe('timed out waiting for grok response');
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);

    it('B-WORK: the work poller returns at its deadline', async () => {
        const url = 'https://chatgpt.com/c/work-stalled';
        const session = pollableSession('chatgpt', url, 'work-stalled');
        const started = Date.now();

        const result = await pollWorkSession(
            { getPage: async () => stalledPage(url), getTargetId: async () => 'target-work-stalled' },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 1 },
        );

        expect(result.status).toBe('timeout');
        expect(result.warnings).toContain('work-poll-timeout');
        // The Work-specific fields survive the race path, so a consumer cannot
        // tell it apart from the loop's own timeout.
        expect(result.surface).toBe('work');
        expect(result.responseContract).toBe('work');
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);

    it('B-DR: a deep research resume returns at its deadline', async () => {
        const url = 'https://chatgpt.com/c/dr-stalled';
        const session = pollableSession('chatgpt', url, 'dr-stalled');
        const started = Date.now();

        const result = await resumeDeepResearch(stalledPage(url), {}, {
            session,
            timeoutMs: 1_000,
        });

        expect(result.status).toBe('timeout');
        expect(result.warnings).toContain('deep-research-resume-timeout');
        // The expiry path does not re-enter the browser to capture a report:
        // that call is itself a probe and would re-enter the stall.
        expect(result.warnings).toContain('deep-research-capture-skipped-past-deadline');
        expect(Date.now() - started).toBeLessThan(2_500);
    }, 20_000);
});
