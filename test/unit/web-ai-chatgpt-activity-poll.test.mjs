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
function makePage({ activity, text, finished, turnOrdering = 'ordered' }) {
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
            // The ordering probe must be MODELLED, not waved through. A fixture
            // that returns a catch-all truthy value leaves the gate unexercised:
            // deleting the production call would not fail a single test.
            if (source.startsWith('function readAssistantTurnOrderingInPage')) {
                return typeof turnOrdering === 'function' ? turnOrdering(offset) : turnOrdering;
            }
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
                // Ordering probe: NO wrapped assistant turn exists, so the real
                // helper would report `stale`. Returning it proves the gate is
                // skipped for wrapperless candidates.
                if (source.startsWith('function readAssistantTurnOrderingInPage')) return 'stale';
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

/**
 * Fail-closed sentinels (issue #88, boundaries B03 and B06).
 *
 * The defect these cover is not slowness — it is a WRONG ANSWER. When a read
 * fails, the old code reported "quiet" and "ordered", the two facts the poll
 * uses to decide an answer is final. A stall therefore disguised itself as a
 * finished response.
 */
/**
 * The poll can finish two ways: the LOOP completes (no fallback recorded), or
 * the post-deadline recovery does (`usedFallbacks: ['recovery']`). These tests
 * care about the loop, so they assert on that distinction rather than on
 * `status` alone — recovery completing on its own terminal evidence is correct
 * behaviour, not a leak of the sentinel.
 */
const completedInLoop = (result) =>
    result.status === 'complete' && !(result.usedFallbacks || []).includes('recovery');

describe('activity read failure is not quiet (B03)', () => {
    it('T1: a throwing activity read reports unknown, not none', async () => {
        const { page } = makePage({
            activity: () => { throw new Error('evaluate stalled'); },
            text: 'looks final',
            finished: true,
        });
        const { result } = await poll(page, 2);
        // `unknown` buys the longer quiet window, so a 2s budget cannot complete
        // IN THE LOOP. Under the old `none` collapse it completed there at 1s.
        expect(completedInLoop(result)).toBe(false);
        expect(result.warnings).toContain('activity-read-unverified');
    });

    it('T2/T10: malformed and out-of-contract verdicts normalize to unknown', async () => {
        for (const activity of [{ strength: 'bogus' }, { nope: 1 }, 'weird']) {
            const { page } = makePage({ activity, text: 'looks final', finished: true });
            const { result } = await poll(page, 2);
            expect(completedInLoop(result)).toBe(false);
            expect(result.warnings).toContain('activity-read-unverified');
        }
    });

    it('T3: unknown demands the 5s window, not the 1s one', async () => {
        // Same page, same terminal evidence, only the read outcome differs.
        // `finished: true` is required: without it the `finished` conjunct alone
        // blocks completion and this would pass even with the sentinel deleted.
        const short = makePage({ activity: () => { throw new Error('stalled'); }, text: 'answer', finished: true });
        const shortRun = await poll(short.page, 2);
        expect(completedInLoop(shortRun.result)).toBe(false);

        const long = makePage({ activity: () => { throw new Error('stalled'); }, text: 'answer', finished: true });
        const longRun = await poll(long.page, 12);
        expect(completedInLoop(longRun.result)).toBe(true);
    });

    it('T4/T13: an unverified read surfaces in warnings even on success', async () => {
        const { page } = makePage({ activity: () => { throw new Error('stalled'); }, text: 'answer', finished: true });
        const { result } = await poll(page, 12);
        expect(result.status).toBe('complete');
        expect(result.warnings).toContain('activity-read-unverified');
    });

    it('T5: a genuine quiet read still means none, with no warning', async () => {
        const { page } = makePage({ activity: { strength: 'none', evidence: '' }, text: 'answer', finished: true });
        const { result } = await poll(page, 2);
        expect(completedInLoop(result)).toBe(true);
        expect(result.warnings || []).not.toContain('activity-read-unverified');
    });
});

describe('ordering read failure is not ordered (B06)', () => {
    it('T6/T9: an unreadable ordering gate blocks completion and times out', async () => {
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'possibly stale answer',
            finished: true,
            turnOrdering: () => { throw new Error('ordering evaluate stalled'); },
        });
        const { result } = await poll(page, 2);
        expect(result.status).not.toBe('complete');
        expect(result.warnings).toContain('assistant-ordering-unverified');
    });

    it('T7: a stale verdict blocks completion', async () => {
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'old answer',
            finished: true,
            turnOrdering: 'stale',
        });
        const { result } = await poll(page, 2);
        expect(result.status).not.toBe('complete');
    });

    it('T8: "no user turn" is unverifiable, not a failure, and still completes', async () => {
        // Over-applying fail-closed is its own defect: system-initiated
        // conversations legitimately have no user turn.
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer',
            finished: true,
            turnOrdering: 'unverifiable',
        });
        const { result } = await poll(page, 2);
        expect(completedInLoop(result)).toBe(true);
    });

    it('T11: a blocked ordering gate still paces the loop instead of spinning', async () => {
        // The regression this guards: `continue` skipped `waitForTimeout`, and the
        // virtual clock only advances there — so the deadline was never reached.
        let waits = 0;
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer',
            finished: true,
            turnOrdering: 'stale',
        });
        const originalWait = page.waitForTimeout;
        page.waitForTimeout = async (ms) => { waits += 1; return originalWait(ms); };

        const { result } = await poll(page, 2);

        // The loop paced itself to the deadline and never completed; recovery
        // then deferred rather than handing back the stale text.
        expect(completedInLoop(result)).toBe(false);
        expect(['timeout', 'polling']).toContain(result.status);
        expect(waits).toBeGreaterThan(1);
    });

    it('T15: a recovered ordering read completes, keeping only the warning', async () => {
        let calls = 0;
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer',
            finished: true,
            turnOrdering: () => {
                calls += 1;
                if (calls <= 2) throw new Error('transient');
                return 'ordered';
            },
        });
        const { result } = await poll(page, 12);
        expect(completedInLoop(result)).toBe(true);
        expect(result.warnings).toContain('assistant-ordering-unverified');
    });

    it('proves the gate is consulted: deleting it would let a stale answer through', async () => {
        let orderingProbes = 0;
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer',
            finished: true,
            turnOrdering: () => { orderingProbes += 1; return 'stale'; },
        });
        await poll(page, 2);
        expect(orderingProbes).toBeGreaterThan(1);
    });
});

describe('an unsatisfied --output-image is never a textual complete', () => {
    /**
     * Post-deadline recovery and the copy fallback both collect NO images. If
     * either returns text as `complete` while an explicit `--output-image` was
     * requested, the caller is told a file exists that was never written. The
     * public contract
     * (devlog/_fin/260508_oracle_parity/11_generated_images_public_contract.md)
     * requires a failure there.
     *
     * The text is deliberately substantive: gating on image-chrome strings alone
     * would let this through, which is exactly the hole being closed.
     */
    /**
     * Drives a poll to the deadline WITHOUT blocking on ordering, so the
     * output-image invariant is the only thing that can stop completion.
     *
     * A failing activity read buys the 5s quiet window, which a 2s budget cannot
     * satisfy; ordering stays `ordered` so recovery's own gate lets the candidate
     * through. Blocking with `turnOrdering: 'stale'` instead would mask the
     * invariant: recovery would defer even with it deleted.
     */
    function pollPastDeadline(extraInput = {}) {
        const { page } = makePage({
            activity: () => { throw new Error('stalled'); },
            text: 'a real substantive answer',
            finished: true,
            turnOrdering: 'ordered',
        });
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
            {
                vendor: 'chatgpt',
                session: session.sessionId,
                timeout: 2,
                skipFinalize: true,
                ...extraInput,
            },
        );
    }

    it('T12a/T12c/T12g: recovery defers instead of completing', async () => {
        const result = await pollPastDeadline({ outputImage: '/tmp/agbrowse-never-written.png' });
        expect(result.status).not.toBe('complete');
    });

    it('proves the invariant is load-bearing: the same poll completes without it', async () => {
        // Identical page, identical deadline overrun, only `outputImage` differs.
        // Deleting the recovery invariant makes the test above match this one.
        const result = await pollPastDeadline();
        expect(result.status).toBe('complete');
        expect(result.usedFallbacks).toContain('recovery');
    });

    it('completes normally when no output image was requested', async () => {
        // The guard must not fire on ordinary text polls.
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'a real substantive answer',
            finished: true,
        });
        const { result } = await poll(page, 2);
        expect(result.status).toBe('complete');
    });

    /**
     * The copy fallback is a SEPARATE post-deadline exit. A no-session poll skips
     * recovery entirely, so guarding recovery alone leaves this route open.
     */
    function makeCopyPage({ text }) {
        const start = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        const snapshot = { text, messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 };
        return {
            url: () => 'https://chatgpt.com/c/copy',
            waitForTimeout: async (ms) => {
                offset += Math.max(Number(ms) || 250, 250);
                await new Promise(resolve => setImmediate(resolve));
            },
            evaluate: async (fn, arg) => {
                const source = String(fn);
                if (source.startsWith('function readChatGptStreamingState')) return { strength: 'none', evidence: '' };
                if (arg?.finishedSelector) return { finished: true, messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 };
                if (source.startsWith('function readAssistantSnapshotSources')) {
                    return { ok: true, wrapped: [{ ...snapshot, source: 'wrapped', domOrder: 0 }], wrapperless: [] };
                }
                if (source.startsWith('function readTopLevelAssistantSnapshots')) return [snapshot];
                if (source.startsWith('function readAssistantTurnOrderingInPage')) return 'ordered';
                if (arg?.selectorSet?.copyButtonSelectors) return { ok: true, text };
                return true;
            },
            locator: () => ({
                first: () => ({ isVisible: async () => false }),
                all: async () => [],
                count: async () => 0,
            }),
        };
    }

    function pollCopyNoSession(page, extraInput = {}) {
        return pollWebAi(
            { getPage: async () => page },
            {
                vendor: 'chatgpt',
                timeout: 2,
                skipFinalize: true,
                allowCopyMarkdownFallback: true,
                ...extraInput,
            },
        );
    }

    it('T12d/T12f: the no-session copy route never completes an unsatisfied output image', async () => {
        // Both shapes must fail closed. Image chrome may raise the typed
        // `provider.image-output` error before copy is reached — that is the
        // contract's own failure mode and equally acceptable. What is NOT
        // acceptable is `status: 'complete'`.
        for (const text of ['Edit', 'a real substantive markdown answer']) {
            const page = makeCopyPage({ text });
            const outcome = await pollCopyNoSession(page, { outputImage: '/tmp/agbrowse-never-written.png' })
                .then(result => result.status, err => `threw:${err?.errorCode || 'unknown'}`);
            expect(outcome).not.toBe('complete');
        }
    });

    it('T12e: image-chrome text still completes when no output image was asked for', async () => {
        // Classification is observational. Over-blocking on the chrome string
        // alone would break ordinary polls whose answer happens to be short.
        const page = makeCopyPage({ text: 'Edit' });
        const result = await pollCopyNoSession(page);
        expect(result.status).toBe('complete');
    });
});

/**
 * An observation that reaches only the top-level `warnings` is half-recorded.
 * The same list is copied into `answerArtifact` at construction time, persisted
 * to the session by the deferred builder, and handed to the finalizer before the
 * return — so each has to be checked separately.
 */
describe('observation warnings reach every envelope', () => {
    function makeSession() {
        return createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-activity',
                conversationUrl: 'https://chatgpt.com/c/activity',
                deadlineAt: new Date(Date.now() + 600_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
    }

    it('T17: answerArtifact carries the same warnings as the result', async () => {
        const { page } = makePage({
            activity: () => { throw new Error('stalled'); },
            text: 'answer',
            finished: true,
        });
        const { result } = await poll(page, 12);
        expect(result.status).toBe('complete');
        expect(result.warnings).toContain('activity-read-unverified');
        expect(result.answerArtifact.warnings).toContain('activity-read-unverified');
    });

    it('T18/T14a: a deferred result and its persisted session agree', async () => {
        const { page } = makePage({
            activity: () => { throw new Error('stalled'); },
            text: 'answer',
            finished: true,
            turnOrdering: 'stale',
        });
        const session = makeSession();
        const result = await pollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-activity' },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 2, skipFinalize: true },
        );
        expect(result.status).toBe('polling');
        expect(result.warnings).toContain('activity-read-unverified');
        expect(getSession(session.sessionId).warnings).toContain('activity-read-unverified');
    });

    it('T19: the finalizer receives the observation too', async () => {
        // The finalizer runs BEFORE the return and stores what it is given, so
        // merging after the fact would leave the stored copy short.
        const { page } = makePage({
            activity: () => { throw new Error('stalled'); },
            text: 'answer',
            finished: true,
        });
        const session = makeSession();
        const result = await pollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-activity' },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 12 },
        );
        expect(result.status).toBe('complete');
        expect(getSession(session.sessionId).warnings).toContain('activity-read-unverified');
    });

    it('T16: an early target-mismatch return still reports the earlier failed read', async () => {
        // Mismatch exits before every other envelope; a per-return merge is easy
        // to forget exactly here.
        const { page } = makePage({
            activity: () => { throw new Error('stalled'); },
            text: 'answer',
            finished: false,
        });
        const session = makeSession();
        let calls = 0;
        const result = await pollWebAi(
            {
                getPage: async () => page,
                getTargetId: async () => { calls += 1; return calls > 1 ? 'moved-target' : 'target-activity'; },
                getPort: () => 9222,
            },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 5, skipFinalize: true },
        );
        expect(result.status).toBe('target-mismatch');
        expect(result.warnings).toContain('activity-read-unverified');
    });
});
