import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, getSession } from '../../web-ai/session.mjs';
import { pollWebAi } from '../../web-ai/chatgpt.mjs';

/**
 * Behavioural poll-loop harness for the activity strata (G8).
 *
 * Source-shape assertions cannot prove the safety property that matters here:
 * deleting `finished &&` from the completion condition leaves every string check
 * green. These tests drive `pollWebAi` for real against a page double whose
 * activity verdict, answer text and terminal evidence are controlled, on a
 * virtual clock so a 5s weak window costs milliseconds.
 */
function makePage({ activity, text, finished }) {
    // The virtual clock advances only through `waitForTimeout`, which the poll
    // loop awaits every iteration. Mocking Date.now globally made the suite
    // allocate unboundedly when run in parallel with other files, so the clock is
    // driven by a real elapsed-time offset instead.
    const start = Date.now();
    let offset = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => start + offset);

    const snapshot = { text, messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 };
    const page = {
        url: () => 'https://chatgpt.com/c/activity',
        waitForTimeout: async (ms) => {
            offset += Math.max(Number(ms) || 250, 250);
            // Yield to the event loop so the loop cannot spin synchronously.
            await new Promise(resolve => setImmediate(resolve));
        },
        evaluate: async (fn, arg) => {
            const source = String(fn);
            if (source.startsWith('function readChatGptStreamingState')) {
                return typeof activity === 'function' ? activity(offset) : activity;
            }
            if (arg?.finishedSelector) {
                return finished
                    ? { finished: true, messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 }
                    : { finished: false, messageId: null, turnId: null, turnIndex: -1 };
            }
            if (source.startsWith('function readAssistantSnapshotSources')) {
                return { ok: true, wrapped: [{ ...snapshot, source: 'wrapped', domOrder: 0 }], wrapperless: [] };
            }
            if (source.startsWith('function readTopLevelAssistantSnapshots')) return [snapshot];
            // Ordering probe (doesAssistantFollowUser) and anything else.
            return true;
        },
        locator: () => ({
            first: () => ({ isVisible: async () => false }),
            all: async () => [],
        }),
    };
    return { page, advance: (ms) => { offset += ms; } };
}

function poll(page, timeoutSec = 30) {
    const session = createSession(
        { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
        {
            targetId: 'target-activity',
            conversationUrl: 'https://chatgpt.com/c/activity',
            deadlineAt: new Date(Date.now() + 600_000).toISOString(),
            envelopeSummary: { assistantCount: 0 },
        },
    );
    return pollWebAi(
        { getPage: async () => page, getTargetId: async () => 'target-activity' },
        { vendor: 'chatgpt', session: session.sessionId, timeout: timeoutSec, skipFinalize: true },
    ).then(result => ({ result, session }));
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('ChatGPT poll loop activity strata (G8 behavioural)', () => {
    it('completes quickly when there is no activity and terminal evidence exists', async () => {
        const { page } = makePage({ activity: { strength: 'none', evidence: '' }, text: 'final answer', finished: true });
        const { result } = await poll(page);
        expect(result).toMatchObject({ ok: true, status: 'complete', answerText: 'final answer' });
    });

    it('completes under WEAK activity once the longer window is satisfied', async () => {
        // The stale-sidecar hang this row exists to fix: weak activity used to
        // freeze the stability window forever.
        const { page } = makePage({ activity: { strength: 'weak', evidence: 'panel-text' }, text: 'final answer', finished: true });
        const { result } = await poll(page);
        expect(result).toMatchObject({ ok: true, status: 'complete', answerText: 'final answer' });
    });

    it('never completes under STRONG activity', async () => {
        const { page } = makePage({ activity: { strength: 'strong', evidence: 'stop-button' }, text: 'still writing', finished: true });
        const { result } = await poll(page, 2);
        // The loop must never reach the stable-completion branch. A timeout-path
        // recovery result is acceptable; `status: 'complete'` is not.
        expect(result.status).not.toBe('complete');
    });

    it('never completes without terminal evidence, even when quiet and stable', async () => {
        // Guards the `finished &&` half of the completion condition: deleting it
        // must fail here.
        const { page } = makePage({ activity: { strength: 'none', evidence: '' }, text: 'looks done but is not', finished: false });
        const { result } = await poll(page, 2);
        expect(result.status).not.toBe('complete');
        // Explicit: the completion branch also stamps `finishedEvidence`-bearing
        // fields, so its absence proves the branch never ran.
        expect(result.responseStableMs === undefined || result.ok !== true).toBe(true);
    });

    it('counts terminal evidence probes, proving `finished` is consulted', async () => {
        // A direct guard on the `finished &&` conjunct: if it were deleted, the
        // loop would complete on the FIRST stable window and this probe count
        // would collapse to zero-or-one.
        let finishedProbes = 0;
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'stable text',
            finished: false,
        });
        const original = page.evaluate;
        page.evaluate = async (fn, arg) => {
            if (arg?.finishedSelector) finishedProbes += 1;
            return original(fn, arg);
        };

        const { result } = await poll(page, 2);

        expect(result.status).not.toBe('complete');
        expect(finishedProbes).toBeGreaterThan(1);
    });

    it('never completes under weak activity without terminal evidence', async () => {
        const { page } = makePage({ activity: { strength: 'weak', evidence: 'panel-trace' }, text: 'partial', finished: false });
        const { result } = await poll(page, 2);
        expect(result.status).not.toBe('complete');
    });

    it('reaches the 1s window under no activity within a 2s budget', async () => {
        const { page } = makePage({ activity: { strength: 'none', evidence: '' }, text: 'answer', finished: true });
        const { result } = await poll(page, 2);
        expect(result.status).toBe('complete');
    });

    it('cannot reach the 5s window under weak activity within a 2s budget', async () => {
        // The window is genuinely longer: same page, same evidence, same budget,
        // only the strength differs.
        const { page } = makePage({ activity: { strength: 'weak', evidence: 'panel-text' }, text: 'answer', finished: true });
        const { result } = await poll(page, 2);
        expect(result.status).not.toBe('complete');
    });
});

describe('wrapperless completion through the poll loop (G11 behavioural)', () => {
    /**
     * The split reader returns ONLY a wrapperless candidate, the wrapped-turn
     * lookup finds nothing (turnIndex -1), and the ordering probe returns FALSE —
     * so this only completes if `isResponseFinished` honours wrapperless
     * provenance AND the poll loop skips the ordering gate for it.
     */
    function makeWrapperlessPage({ finishedResult = { finished: false, messageId: null, turnId: null, turnIndex: -1 } } = {}) {
        const start = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        const candidate = {
            text: 'wrapperless answer',
            messageId: null,
            turnId: null,
            turnIndex: -1,
            source: 'wrapperless',
            domOrder: 0,
        };
        return {
            url: () => 'https://chatgpt.com/c/wrapperless',
            waitForTimeout: async (ms) => {
                offset += Math.max(Number(ms) || 250, 250);
                await new Promise(resolve => setImmediate(resolve));
            },
            evaluate: async (fn, arg) => {
                const source = String(fn);
                if (source.startsWith('function readChatGptStreamingState')) return { strength: 'none', evidence: '' };
                if (arg?.finishedSelector) return finishedResult;
                if (source.startsWith('function readAssistantSnapshotSources')) {
                    return { ok: true, wrapped: [], wrapperless: [candidate] };
                }
                if (source.startsWith('function readTopLevelAssistantSnapshots')) return [];
                // doesAssistantFollowUser: NO wrapped assistant turn exists, so the
                // real helper would veto. Returning false proves the gate is skipped.
                return false;
            },
            locator: () => ({ first: () => ({ isVisible: async () => false }), all: async () => [] }),
        };
    }

    it('completes on a wrapperless candidate the ordering gate would have vetoed', async () => {
        const page = makeWrapperlessPage();
        const { result } = await poll(page, 10);
        expect(result).toMatchObject({ ok: true, status: 'complete', answerText: 'wrapperless answer' });
    });

    it('does not let a successful empty read reach the completion branch', async () => {
        // ok:true with both lists empty means "nothing yet": the poll loop must
        // keep polling instead of letting the legacy reader supply a candidate.
        // (The post-timeout recovery path has its own readers and is out of scope
        // here; what matters is that the LOOP never completes.)
        const start = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        let terminalProbes = 0;
        const page = {
            url: () => 'https://chatgpt.com/c/empty',
            waitForTimeout: async (ms) => {
                offset += Math.max(Number(ms) || 250, 250);
                await new Promise(resolve => setImmediate(resolve));
            },
            evaluate: async (fn, arg) => {
                const source = String(fn);
                if (source.startsWith('function readChatGptStreamingState')) return { strength: 'none', evidence: '' };
                if (arg?.finishedSelector) {
                    terminalProbes += 1;
                    return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
                }
                if (source.startsWith('function readAssistantSnapshotSources')) return { ok: true, wrapped: [], wrapperless: [] };
                if (source.startsWith('function readTopLevelAssistantSnapshots')) {
                    return [{ text: 'legacy invention', messageId: null, turnId: null, turnIndex: 0 }];
                }
                return true;
            },
            locator: () => ({ first: () => ({ isVisible: async () => false }), all: async () => [] }),
        };

        const { result } = await poll(page, 2);

        expect(result.status).not.toBe('complete');
        // The loop itself never had a candidate: with the old both-empty fallback
        // it would have adopted the legacy one and probed for terminal evidence on
        // EVERY iteration. Post-deadline recovery probes once, so a single probe
        // proves the loop stayed empty.
        expect(terminalProbes).toBeLessThanOrEqual(1);
    });

});
