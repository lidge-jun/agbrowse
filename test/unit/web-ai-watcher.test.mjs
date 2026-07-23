import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tabState = vi.hoisted(() => ({ page: null }));
vi.mock('../../skills/browser/tab-manager.mjs', () => ({
    isTabAlive: vi.fn(async () => Boolean(tabState.page)),
    getPageByTargetId: vi.fn(async () => tabState.page),
    createTab: vi.fn(), waitForPageByTargetId: vi.fn(), listManagedTabs: vi.fn(), closeTab: vi.fn(),
}));

import { hasStreamingIndicator, watchSessionOnce } from '../../web-ai/watcher.mjs';
import { createSession, getSession, updateSession } from '../../web-ai/session.mjs';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-watcher-cdp-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    tabState.page = fakeWatcherPage();
});

afterEach(() => {
    tabState.page = null;
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

const watcherSrc = readFileSync(join(process.cwd(), 'web-ai/watcher.mjs'), 'utf8');

describe('web-ai watcher transient-timeout promotion (source-string contract)', () => {
    it('imports withSessionCommandLock from session-store', () => {
        expect(watcherSrc).toContain("import { withSessionCommandLock } from './session-store.mjs'");
    });

    it('promotes a pre-deadline timeout back to polling inside the session command lock', () => {
        // The promotion block must check status === 'timeout' AND !isDeadlineExpired,
        // and the mutation must happen inside withSessionCommandLock.
        expect(watcherSrc).toMatch(
            /session\.status === 'timeout' && !isDeadlineExpired\(session\.deadlineAt\)[\s\S]*?await withSessionCommandLock\(session\.sessionId/,
        );
    });

    it('re-reads session inside the lock to avoid clobbering a concurrent live poll', () => {
        expect(watcherSrc).toMatch(/withSessionCommandLock\(session\.sessionId, async \(\) =>[\s\S]*?const refreshed = getSession\(session\.sessionId\)/);
    });

    it('uses short ttl and disables heartbeat for the status flip', () => {
        expect(watcherSrc).toMatch(/\{\s*ttlMs:\s*30_000,\s*heartbeatMs:\s*0\s*\}/);
    });

    it('still treats a deadline-expired timeout as terminal', () => {
        expect(watcherSrc).toMatch(/if\s*\(\s*TERMINAL_SESSION_STATUSES\.has\(session\.status\)\s*\)\s*\{[\s\S]*?terminal:\s*true/);
        expect(watcherSrc).toMatch(/if\s*\(\s*isDeadlineExpired\(session\.deadlineAt\)\s*\)\s*\{[\s\S]*?status:\s*'timeout'/);
    });

    it('appends a watcher-resumed-transient-timeout warning when promoting', () => {
        expect(watcherSrc).toContain('watcher-resumed-transient-timeout');
    });
});

describe('web-ai watcher self-heals drifted conversation URL (source-string contract)', () => {
    it('destructures the resolver-healed session from the withSessionPage callback', () => {
        expect(watcherSrc).toMatch(
            /withSessionPage\(deps, options\.sessionId, async \(\{ page, targetId, session: resolvedSession \}\)/,
        );
    });

    it('feeds the healed session (not the stale outer one) to the attach check', () => {
        expect(watcherSrc).toContain('ensureWatcherAttached(page, resolvedSession || session, options)');
    });

    it('uses the canonical tolerant urlsCompatible predicate imported from tab-recovery', () => {
        expect(watcherSrc).toMatch(/import \{[^}]*withSessionPage[^}]*urlsCompatible[^}]*\} from '\.\/tab-recovery\.mjs'/);
        expect(watcherSrc).toContain('if (urlsCompatible(targetUrl, currentUrl))');
    });

    it('retires the strict urlsEquivalentForWatch helper', () => {
        expect(watcherSrc).not.toContain('urlsEquivalentForWatch');
    });
});

describe('web-ai watcher streaming guard', () => {
    it('detects ChatGPT stop controls as in-flight streaming', async () => {
        const page = fakeVisibilityPage({
            'button[data-testid="stop-button"]': true,
        });
        await expect(hasStreamingIndicator(page, 'chatgpt')).resolves.toBe(true);
    });

    it('does not treat Gemini completion footers as in-flight streaming', async () => {
        const page = fakeVisibilityPage({
            '.response-footer.complete': true,
            messageActions: true,
            '[aria-label*="Good response" i]': true,
        });
        await expect(hasStreamingIndicator(page, 'gemini')).resolves.toBe(false);
    });

    it('contains a complete-plus-streaming downgrade path', () => {
        expect(watcherSrc).toContain('watcher-complete-deferred-streaming');
        expect(watcherSrc).toMatch(/status === 'complete' && await hasStreamingIndicator\(page, vendor\)/);
        expect(watcherSrc).toMatch(/status:\s*'polling'[\s\S]*?terminal:\s*false/);
    });
});

function fakeVisibilityPage(visibleBySelector) {
    return {
        locator: (selector) => ({
            first: () => ({
                isVisible: async () => Boolean(visibleBySelector[selector]),
            }),
        }),
    };
}

describe('watchSessionOnce recoverable CDP disconnect', () => {
    it('classifies a thrown disconnect and performs one bounded reattach poll', async () => {
        const session = createWatcherSession();
        const poll = vi.fn()
            .mockRejectedValueOnce(new Error('WebSocket is not open: readyState 3'))
            .mockResolvedValueOnce({ ok: true, status: 'polling', answerText: '' });
        const recovery = recoveryFakes(poll, { endpointReachable: true, targetFound: true });
        const result = await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);
        expect(result.status).toBe('polling');
        expect(recovery.reattachSessionPage).toHaveBeenCalledOnce();
        expect(poll).toHaveBeenCalledTimes(2);
    });

    it('recovers a consumed tab-crashed result once on proven liveness', async () => {
        const session = createWatcherSession();
        const poll = vi.fn()
            .mockResolvedValueOnce(crashedResult())
            .mockImplementationOnce(async (_deps, _vendor, current) => {
                updateSession(current.sessionId, { status: 'complete', answer: 'new answer', completedAt: new Date().toISOString() });
                return { ok: true, status: 'complete', answerText: 'new answer' };
            });
        const recovery = recoveryFakes(poll, { endpointReachable: true, targetFound: true });

        const result = await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);

        expect(result).toMatchObject({ status: 'complete', answerText: 'new answer', terminal: true });
        expect(recovery.probeCdpLiveness).toHaveBeenCalledOnce();
        expect(recovery.reattachSessionPage).toHaveBeenCalledOnce();
        expect(poll).toHaveBeenCalledTimes(2);
        expect(getSession(session.sessionId).cdpRecovery.fingerprint).toContain('target-1:connection closed');
    });

    it.each([
        ['endpoint-dead', { endpointReachable: false, targetFound: null, error: 'refused' }],
        ['target-missing', { endpointReachable: true, targetFound: false }],
        ['list-error', { endpointReachable: true, targetFound: null, error: 'list failed' }],
    ])('does not reattach when liveness proof is %s', async (_label, liveness) => {
        const session = createWatcherSession();
        const poll = vi.fn().mockResolvedValue(crashedResult());
        const recovery = recoveryFakes(poll, liveness);
        const result = await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);
        expect(result.status).toBe('tab-crashed');
        expect(recovery.reattachSessionPage).not.toHaveBeenCalled();
        expect(getSession(session.sessionId).lastError.evidence.recoverable).toBe(false);
    });

    it('persists the one-attempt bound across two watchSessionOnce calls', async () => {
        const session = createWatcherSession();
        const poll = vi.fn().mockResolvedValue(crashedResult());
        const recovery = recoveryFakes(poll, { endpointReachable: false, targetFound: null });
        await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);
        updateSession(session.sessionId, { status: 'polling' });
        await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);
        expect(recovery.probeCdpLiveness).toHaveBeenCalledOnce();
        expect(recovery.reattachSessionPage).not.toHaveBeenCalled();
    });

    it('re-reads the finalization checkpoint and skips the second poll', async () => {
        const session = createWatcherSession();
        const poll = vi.fn().mockResolvedValueOnce(crashedResult());
        const recovery = recoveryFakes(poll, { endpointReachable: true, targetFound: true });
        recovery.reattachSessionPage.mockImplementationOnce(async () => {
            updateSession(session.sessionId, { status: 'complete', answer: 'persisted', completedAt: new Date().toISOString() });
            return { page: tabState.page, targetId: 'target-1', session: getSession(session.sessionId) };
        });
        const result = await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);
        expect(result).toMatchObject({ status: 'complete', answerText: 'persisted' });
        expect(poll).toHaveBeenCalledOnce();
    });

    it('recovery preserves the session baseline so an older assistant snapshot cannot complete it', async () => {
        const session = createWatcherSession({ envelopeSummary: { assistantCount: 2 } });
        const poll = vi.fn()
            .mockResolvedValueOnce(crashedResult())
            .mockImplementationOnce(async (_deps, _vendor, current) => {
                expect(current.envelopeSummary.assistantCount).toBe(2);
                return { ok: true, status: 'polling', answerText: '' };
            });
        const recovery = recoveryFakes(poll, { endpointReachable: true, targetFound: true });
        const result = await watchSessionOnce(baseDeps(), { session: session.sessionId }, recovery);
        expect(result).toMatchObject({ status: 'polling', answerText: '', terminal: false });
        expect(getSession(session.sessionId).answer).toBeNull();
    });
});

function createWatcherSession(meta = {}) {
    const session = createSession({ vendor: 'chatgpt', prompt: 'test' }, {
        targetId: 'target-1',
        originalUrl: 'https://chatgpt.com/c/1',
        conversationUrl: 'https://chatgpt.com/c/1',
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        ...meta,
    });
    return updateSession(session.sessionId, { status: 'polling' });
}

function baseDeps() {
    return { getPort: () => 9222 };
}

function crashedResult() {
    return { ok: false, status: 'tab-crashed', error: 'Connection closed while polling', warnings: ['tab-crashed-during-poll'] };
}

function recoveryFakes(callVendorPoll, liveness) {
    return {
        probeCdpLiveness: vi.fn(async () => liveness),
        reattachSessionPage: vi.fn(async (_deps, sessionId) => ({
            page: tabState.page, targetId: 'target-1', session: getSession(sessionId),
        })),
        callVendorPoll,
    };
}

function fakeWatcherPage() {
    return {
        url: () => 'https://chatgpt.com/c/1',
        locator: () => ({
            first: () => ({
                isVisible: async () => false,
                waitFor: async () => undefined,
            }),
        }),
        evaluate: async () => '',
    };
}
