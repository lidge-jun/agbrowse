import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSession, getSession, listSessions, saveBaseline, updateSession } from '../../web-ai/session.mjs';
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
    function makeCopyPage({ text, activity }) {
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
                if (source.startsWith('function readChatGptStreamingState')) {
                    return typeof activity === 'function'
                        ? activity(offset)
                        : activity || { strength: 'none', evidence: '' };
                }
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

    /**
     * `findActiveSession` adopts the most recent active ChatGPT session when the
     * caller passes none, so leftovers from earlier tests would silently make
     * this a session-bound poll — and session-bound polls exit through recovery,
     * never reaching the copy route this covers.
     */
    function retireActiveSessions() {
        for (const stored of listSessions({ vendor: 'chatgpt', active: true })) {
            updateSession(stored.sessionId, { status: 'complete', completedAt: new Date().toISOString() });
        }
    }

    /**
     * Weak activity inside the loop demands the 5s window, which a 2s budget
     * cannot reach; the post-deadline read then reports quiet so `stableText`
     * survives into the copy route.
     *
     * The switch must fall AFTER the deadline (offset 2000): flipping to quiet
     * on the last in-budget tick drops the window to 1s and the loop completes
     * before the copy route is ever reached.
     */
    const weakThenQuiet = (offset) => (offset > 2_000
        ? { strength: 'none', evidence: '' }
        : { strength: 'weak', evidence: 'panel-text' });

    function pollCopyNoSession(page, extraInput = {}) {
        retireActiveSessions();
        saveBaseline({
            vendor: 'chatgpt',
            url: 'https://chatgpt.com/c/copy',
            assistantCount: 0,
            envelope: { vendor: 'chatgpt', prompt: 'q' },
        });
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
            const page = makeCopyPage({ text, activity: weakThenQuiet });
            const outcome = await pollCopyNoSession(page, { outputImage: '/tmp/agbrowse-never-written.png' })
                .then(result => {
                    // Proves this really is the session-free copy route.
                    expect(result.sessionId).toBeUndefined();
                    return result.status;
                }, err => `threw:${err?.errorCode || 'unknown'}`);
            expect(outcome).not.toBe('complete');
        }
    });

    it('T12e: image-chrome text still completes when no output image was asked for', async () => {
        // Classification is observational. Over-blocking on the chrome string
        // alone would break ordinary polls whose answer happens to be short.
        const page = makeCopyPage({ text: 'Edit', activity: weakThenQuiet });
        const result = await pollCopyNoSession(page);
        expect(result.status).toBe('complete');
        expect(result.sessionId).toBeUndefined();
        expect(result.usedFallbacks).toContain('copy-markdown');
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

    /**
     * The loop, recovery and the copy fallback each perform their OWN activity
     * read. A test whose loop read already fails cannot tell whether the later
     * two record anything — the ledger is already populated. These keep the loop
     * clean so only the later read can produce the observation.
     */
    it('T14a: recovery records an unknown the loop never saw', async () => {
        // Every read INSIDE the loop succeeds; only the post-deadline read fails.
        // The virtual clock passes 2s exactly when the loop exits, so this binds
        // the failure to the loop/recovery boundary rather than a tick count.
        const { page } = makePage({
            activity: (offset) => {
                if (offset > 2_000) throw new Error('stalled after the deadline');
                return { strength: 'none', evidence: '' };
            },
            text: 'answer',
            finished: true,
            turnOrdering: 'stale', // hold the loop off completion until the deadline
        });
        const session = makeSession();
        const result = await pollWebAi(
            { getPage: async () => page, getTargetId: async () => 'target-activity' },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 2, skipFinalize: true },
        );
        expect(result.warnings).toContain('activity-read-unverified');
    });

    it('T14b: the no-session copy route records its own first unknown', async () => {
        // No session means recovery never runs, so the copy fallback's read is
        // the only one that can produce this observation.
        const text = 'a real substantive markdown answer';
        const start = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        const snapshot = { text, messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 };
        const page = {
            url: () => 'https://chatgpt.com/c/copy',
            waitForTimeout: async (ms) => {
                offset += Math.max(Number(ms) || 250, 250);
                await new Promise(resolve => setImmediate(resolve));
            },
            evaluate: async (fn, arg) => {
                const source = String(fn);
                if (source.startsWith('function readChatGptStreamingState')) {
                    // Inside the budget: weak, so the 5s window holds the loop off.
                    // After it: the read fails, which is the copy route's own read.
                    if (offset > 2_000) throw new Error('stalled after the deadline');
                    return { strength: 'weak', evidence: 'panel-text' };
                }
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
        for (const stored of listSessions({ vendor: 'chatgpt', active: true })) {
            updateSession(stored.sessionId, { status: 'complete', completedAt: new Date().toISOString() });
        }
        saveBaseline({
            vendor: 'chatgpt',
            url: 'https://chatgpt.com/c/copy',
            assistantCount: 0,
            envelope: { vendor: 'chatgpt', prompt: 'q' },
        });

        const result = await pollWebAi(
            { getPage: async () => page },
            { vendor: 'chatgpt', timeout: 2, skipFinalize: true, allowCopyMarkdownFallback: true },
        );

        expect(result.sessionId).toBeUndefined();
        expect(result.warnings).toContain('activity-read-unverified');
    });
});

/**
 * Target identity sentinels (issue #88, boundary B24).
 *
 * `deps.getTargetId().catch(() => null)` made an unreadable target look exactly
 * like a matching one: the mismatch check is `if (currentTargetId && ...)`, so
 * `null` switched the whole check off. It switched off precisely when CDP was
 * unstable — the moment a tab is most likely to have changed underneath.
 *
 * The session branch also skips the conversation-URL check in its `else`, so a
 * tick with no identity evidence has NO identity evidence at all.
 */
describe('target identity failure is not a passing check (B24)', () => {
    function pollWithTargetProbe(getTargetId, extraInput = {}) {
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer',
            finished: true,
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
            { getPage: async () => page, getTargetId, getPort: () => 9222 },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 2, skipFinalize: true, ...extraInput },
        );
    }

    it('U1: a throwing target probe blocks completion and is recorded', async () => {
        const result = await pollWithTargetProbe(async () => { throw new Error('cdp unstable'); });
        expect(result.status).not.toBe('complete');
        expect(result.warnings).toContain('target-identity-unverified');
    });

    it('U2: a null target probe is treated exactly like a throw', async () => {
        // The diagnostic differs; the identity evidence — none — does not.
        const result = await pollWithTargetProbe(async () => null);
        expect(result.status).not.toBe('complete');
        expect(result.warnings).toContain('target-identity-unverified');
    });

    it('U2b: a matching target completes normally', async () => {
        const result = await pollWithTargetProbe(async () => 'target-activity');
        expect(result.status).toBe('complete');
        expect(result.warnings || []).not.toContain('target-identity-unverified');
    });

    it('U3: a differing target still returns mismatch with its evidence', async () => {
        const result = await pollWithTargetProbe(async () => 'someone-elses-tab');
        expect(result.status).toBe('target-mismatch');
        // `actualTargetId` comes from the SAME read as the verdict; re-probing to
        // recover it would race with the tab changing again.
        expect(JSON.stringify(result)).toContain('someone-elses-tab');
    });

    it('U1b: recovery does not restore a candidate the loop disqualified', async () => {
        // Without the recovery-side gate the loop refuses for the whole budget
        // and then recovery hands back the same text as `complete`.
        let calls = 0;
        const result = await pollWithTargetProbe(async () => {
            calls += 1;
            throw new Error('cdp unstable');
        });
        expect(calls).toBeGreaterThan(1);
        expect(result.status).not.toBe('complete');
    });
});

/**
 * Remaining observation contracts (issue #88, boundaries B23 and B25).
 *
 * Neither is fully fail-closed — both still return an answer. What they must not
 * do is stay silent, because the caller cannot otherwise tell that the poll read
 * a borrowed baseline or skipped artifact capture.
 */
describe('degraded reads are reported, not hidden', () => {
    it('U10: a baseline borrowed from the host is recorded', async () => {
        // `session-store` turns a corrupt store into an empty one, so this same
        // path is reached when the store fails to read — the poll then answers
        // against whatever conversation on this host was newest.
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer from some other conversation',
            finished: true,
        });
        // A conversation no earlier test has recorded a baseline for, so the
        // exact lookup must miss and the host-wide fallback must be used.
        const unseenUrl = `https://chatgpt.com/c/unseen-${Date.now()}`;
        page.url = () => unseenUrl;
        for (const stored of listSessions({ vendor: 'chatgpt', active: true })) {
            updateSession(stored.sessionId, { status: 'complete', completedAt: new Date().toISOString() });
        }
        // A baseline for a DIFFERENT conversation on the same host.
        saveBaseline({
            vendor: 'chatgpt',
            url: 'https://chatgpt.com/c/someone-else',
            assistantCount: 0,
            envelope: { vendor: 'chatgpt', prompt: 'q' },
        });

        const result = await pollWebAi(
            { getPage: async () => page },
            { vendor: 'chatgpt', timeout: 2, skipFinalize: true },
        );

        expect(result.warnings).toContain('baseline-inferred-from-host');
    });

    it('U10b: an exact baseline is not reported as inferred', async () => {
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer',
            finished: true,
        });
        for (const stored of listSessions({ vendor: 'chatgpt', active: true })) {
            updateSession(stored.sessionId, { status: 'complete', completedAt: new Date().toISOString() });
        }
        saveBaseline({
            vendor: 'chatgpt',
            url: 'https://chatgpt.com/c/activity',
            assistantCount: 0,
            envelope: { vendor: 'chatgpt', prompt: 'q' },
        });

        const result = await pollWebAi(
            { getPage: async () => page },
            { vendor: 'chatgpt', timeout: 2, skipFinalize: true },
        );

        expect(result.warnings || []).not.toContain('baseline-inferred-from-host');
    });

    it('U4: skipped file capture is reported instead of passing silently', async () => {
        // Opportunistic capture, so the answer still completes — but a plain
        // success would hide that attachments were never collected.
        const { page } = makePage({
            activity: { strength: 'none', evidence: '' },
            text: 'answer with attachments',
            finished: true,
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

        const result = await pollWebAi(
            {
                getPage: async () => page,
                getTargetId: async () => 'target-activity',
                getCdpSession: async () => null,
            },
            { vendor: 'chatgpt', session: session.sessionId, timeout: 12 },
        );

        expect(result.status).toBe('complete');
        expect(result.warnings).toContain('file-artifact-cdp-unavailable');
    });
});

/**
 * An unreadable assistant count is not zero (issue #88, boundaries B01/B02).
 *
 * `baseline.assistantCount` is the positional slice point: the poll takes
 * `wrapped.slice(baseline.assistantCount)` to decide which turns are new. A
 * failed read used to store 0, which re-admits the entire conversation as fresh
 * candidates. WP10's ordering gate catches most of that, but not when ordering
 * is `unverifiable` or when the image shortcut runs first — and relying on a
 * later gate to undo a poisoned candidate set is the wrong place to fix it.
 */
describe('an uncountable baseline stops the send (B01/B02)', () => {
    /**
     * Every read path fails: split, snapshot retries, and the locator fallback.
     *
     * Drives a virtual clock so `waitForStableAssistantCount` reaches its 8s
     * deadline in milliseconds. That also makes the null-reset observable: if an
     * unreadable count were treated as stable, the wait would return after two
     * reads instead of spending the whole budget.
     */
    function unreadablePage() {
        const start = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        let waits = 0;
        const page = {
            url: () => 'https://chatgpt.com/c/unreadable',
            waitForTimeout: async (ms) => {
                waits += 1;
                offset += Math.max(Number(ms) || 250, 250);
                await new Promise(resolve => setImmediate(resolve));
            },
            evaluate: async () => { throw new Error('evaluate detached'); },
            locator: () => ({
                all: async () => { throw new Error('detached'); },
                first: () => ({ isVisible: async () => false }),
                count: async () => 0,
            }),
            innerText: async () => '',
        };
        return Object.assign(page, { waitCount: () => waits });
    }

    it('X8: send fails typed instead of writing a zero baseline', async () => {
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        const { getBaseline } = await import('../../web-ai/session.mjs');
        const url = `https://chatgpt.com/c/unreadable-${Date.now()}`;
        const page = unreadablePage();
        page.url = () => url;

        const failure = await sendWebAi(
            { getPage: async () => page },
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
        ).then(() => null, err => err);

        expect(failure).toMatchObject({
            errorCode: 'snapshot.unavailable',
            stage: 'baseline-snapshot',
            retryHint: 're-snapshot',
        });
        // Throwing the right error after already writing the baseline would be
        // no better than not throwing at all.
        expect(getBaseline('chatgpt', url)).toBeFalsy();
        // X10: an unreadable count is never "stable". Counting it as stable
        // would end the wait after two reads; it must spend the full budget.
        expect(page.waitCount()).toBeGreaterThan(4);
    });

    it('X8b: deep research fails before creating a session or a lease', async () => {
        // Ordering matters: `envelopeSummary.assistantCount` is read back later
        // through `sessionToBaseline`, where `Number(null) || 0` would resurrect
        // the false zero.
        const { deepResearchWebAi } = await import('../../web-ai/chatgpt.mjs');
        const { listLeases } = await import('../../web-ai/tab-lease-store.mjs');
        const before = listSessions({ vendor: 'chatgpt' }).length;
        const page = unreadablePage();
        // A target id is required for the lease path to be reachable at all;
        // without it the "no lease" assertion would pass vacuously.
        const targetId = `target-deepresearch-${Date.now()}`;

        const failure = await deepResearchWebAi(
            { getPage: async () => page, getTargetId: async () => targetId, getPort: () => 9222 },
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
        ).then(() => null, err => err);

        expect(failure).toMatchObject({
            errorCode: 'snapshot.unavailable',
            stage: 'baseline-snapshot',
            retryHint: 're-snapshot',
        });
        expect(listSessions({ vendor: 'chatgpt' }).length).toBe(before);
        expect((await listLeases()).some(lease => lease.targetId === targetId)).toBe(false);
    });
});

/**
 * The read-failure branches themselves (issue #88, boundaries B01/B02).
 *
 * The tests above prove the typed failure at the send boundary, but only when
 * EVERY read fails. These cover the mixed cases, which are the ones that decide
 * whether a real answer is found or a false zero is stored.
 */
describe('mixed snapshot read outcomes (B01/B02)', () => {
    /**
     * A page whose two snapshot attempts can be scripted independently.
     * `readAssistantSnapshots` calls the plain-selectors form first, then the
     * `{selectors, resolverSource}` form.
     *
     * @param {{ first: 'throw'|'malformed'|'empty'|'rows', second: 'throw'|'malformed'|'empty'|'rows', split?: 'ok'|'fail' }} plan
     */
    function scriptedPage(plan) {
        const rows = [{ text: 'recovered answer', messageId: 'm1', turnId: 'conversation-turn-1', turnIndex: 0 }];
        const outcome = (mode) => {
            if (mode === 'throw') throw new Error('evaluate detached');
            if (mode === 'malformed') return null;
            return mode === 'rows' ? rows : [];
        };
        // `waitForStableAssistantCount` polls the counter repeatedly, so a
        // one-shot counter would desync: every round calls attempt 1 then
        // attempt 2, so use parity instead of absolute call order.
        let snapshotCalls = 0;
        return {
            url: () => 'https://chatgpt.com/c/mixed',
            waitForTimeout: async () => { await new Promise(resolve => setImmediate(resolve)); },
            innerText: async () => '',
            evaluate: async (fn) => {
                const source = String(fn);
                if (source.startsWith('function readAssistantSnapshotSources')) {
                    if ((plan.split || 'fail') === 'fail') throw new Error('split detached');
                    return { ok: true, wrapped: [], wrapperless: [] };
                }
                if (source.startsWith('function readTopLevelAssistantSnapshots')) {
                    snapshotCalls += 1;
                    return outcome(snapshotCalls % 2 === 1 ? plan.first : plan.second);
                }
                throw new Error('evaluate detached');
            },
            locator: () => ({
                all: async () => { throw new Error('detached'); },
                first: () => ({ isVisible: async () => false }),
                count: async () => 0,
            }),
        };
    }

    /** @param {any} page */
    async function countThroughSend(page) {
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        // Reaching the composer is out of scope; what matters is whether the
        // baseline read threw before it.
        return sendWebAi({ getPage: async () => page }, { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' })
            .then(() => 'no-throw', err => err?.stage === 'baseline-snapshot' ? 'baseline-throw' : 'other-throw');
    }

    it('X2: a failed first attempt still falls back to the second', async () => {
        // The two-step fallback predates this work and must survive it.
        await expect(countThroughSend(scriptedPage({ first: 'throw', second: 'rows' })))
            .resolves.not.toBe('baseline-throw');
    });

    it('X2b: a successful empty read is not undone by a failing retry', async () => {
        // The first attempt observed the page. The second failing adds nothing,
        // and treating that as unknown would block sends on genuinely new chats.
        await expect(countThroughSend(scriptedPage({ first: 'empty', second: 'throw' })))
            .resolves.not.toBe('baseline-throw');
    });

    it('X2c: a malformed first result is a failed attempt, not an empty page', async () => {
        await expect(countThroughSend(scriptedPage({ first: 'malformed', second: 'rows' })))
            .resolves.not.toBe('baseline-throw');
    });

    it('X2d: both attempts malformed is unknown, not zero', async () => {
        await expect(countThroughSend(scriptedPage({ first: 'malformed', second: 'malformed' })))
            .resolves.toBe('baseline-throw');
    });

    it('X7: a failed split with a working snapshot read still counts', async () => {
        await expect(countThroughSend(scriptedPage({ first: 'rows', second: 'rows' })))
            .resolves.not.toBe('baseline-throw');
    });
});

describe('poll loop when every reader fails (B01)', () => {
    /**
     * `failFrom`/`failUntil` describe a WINDOW of blind ticks so a read can
     * succeed, then fail, then recover — the only sequence where a stale
     * candidate from before the failure could still be consumed.
     *
     * @param {{ splitFails?: boolean, snapshotFails?: boolean, failFrom?: number, failUntil?: number }} plan
     */
    function pollPage(plan) {
        const start = Date.now();
        let offset = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => start + offset);
        const snapshot = { text: 'answer', messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 };
        let waits = 0;
        let reads = 0;
        // `failFrom`/`failUntil` describe a WINDOW of blind ticks: reads succeed,
        // then fail, then recover. That sequence is the only one where a stale
        // candidate left over from before the failure could actually be used.
        const blind = () => plan.failFrom !== undefined
            && reads > plan.failFrom
            && (plan.failUntil === undefined || reads <= plan.failUntil);
        const page = {
            url: () => 'https://chatgpt.com/c/activity',
            waitForTimeout: async (ms) => {
                waits += 1;
                offset += Math.max(Number(ms) || 250, 250);
                await new Promise(resolve => setImmediate(resolve));
            },
            evaluate: async (fn, arg) => {
                const source = String(fn);
                if (source.startsWith('function readChatGptStreamingState')) return { strength: 'none', evidence: '' };
                if (arg?.finishedSelector) return { finished: true, messageId: 'm1', turnId: 'conversation-turn-2', turnIndex: 1 };
                if (source.startsWith('function readAssistantSnapshotSources')) {
                    reads += 1;
                    if (plan.splitFails || blind()) throw new Error('split detached');
                    return { ok: true, wrapped: [{ ...snapshot, source: 'wrapped', domOrder: 0 }], wrapperless: [] };
                }
                if (source.startsWith('function readTopLevelAssistantSnapshots')) {
                    if (plan.snapshotFails || blind()) throw new Error('snapshot detached');
                    return [snapshot];
                }
                if (source.startsWith('function readAssistantTurnOrderingInPage')) return 'ordered';
                return true;
            },
            locator: () => ({
                all: async () => {
                    if (plan.snapshotFails || blind()) throw new Error('detached');
                    return [];
                },
                first: () => ({ isVisible: async () => false }),
                count: async () => 0,
            }),
        };
        return { page, waitCount: () => waits };
    }

    it('X11: an unreadable tick paces the loop and reaches the deadline', async () => {
        // A `continue` that skipped the wait would spin forever here: the virtual
        // clock only advances inside `waitForTimeout`.
        const { page, waitCount } = pollPage({ splitFails: true, snapshotFails: true });
        const { result } = await poll(page, 2);
        expect(result.status).not.toBe('complete');
        expect(waitCount()).toBeGreaterThan(1);
        expect(result.warnings).toContain('assistant-read-unverified');
    });

    it('X11b: blind ticks do not count toward the quiet window once reads recover', async () => {
        // Ticks 1-2 build stability, 3-6 read nothing, then reads recover with
        // the SAME text. Keeping the earlier `stableSince` would let the blind
        // interval count as quiet time and complete on evidence the poll never
        // actually observed; it has to re-earn the window instead.
        const { page, waitCount } = pollPage({ failFrom: 2, failUntil: 6 });
        const { result } = await poll(page, 12);

        expect(result.warnings).toContain('assistant-read-unverified');
        expect(waitCount()).toBeGreaterThan(6);
    });

    it('X10: an unreadable count does not settle the pre-send stability wait', async () => {
        // `waitForStableAssistantCount` returns as soon as two reads agree. A
        // null count counted as agreement would let two blind ticks look like a
        // settled page and hand a guessed baseline to the send.
        const { sendWebAi } = await import('../../web-ai/chatgpt.mjs');
        const { page } = pollPage({ splitFails: true, snapshotFails: true });
        let waits = 0;
        const originalWait = page.waitForTimeout;
        page.waitForTimeout = async (ms) => { waits += 1; return originalWait(ms); };

        await sendWebAi({ getPage: async () => page }, {
            vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only',
        }).catch(() => undefined);

        // Two agreeing nulls would have returned after two waits.
        expect(waits).toBeGreaterThan(2);
    });

    it('X12: a failed split with a working fallback still completes', async () => {
        // The paired case: over-applying the guard would break the legacy path.
        const { page } = pollPage({ splitFails: true, snapshotFails: false });
        const { result } = await poll(page, 12);
        expect(result.status).toBe('complete');
        expect(result.warnings || []).not.toContain('assistant-read-unverified');
    });
});
