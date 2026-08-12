import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-shared-target-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    vi.resetModules();
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../../skills/browser/tab-manager.mjs');
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
});

describe('web-ai shared target lock guard', () => {
    it('vendor-scopes active candidates and fails closed on 2+ active sessions', async () => {
        const { createSession, updateSession } = await import('../../web-ai/session.mjs');
        const { resolveImplicitSessionSelection } = await import('../../web-ai/session-target-guard.mjs');
        const expired = new Date(Date.now() - 60_000).toISOString();
        const a = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, { targetId: 'target-a', conversationUrl: 'https://chatgpt.com/c/a' });
        const b = createSession({ vendor: 'chatgpt', prompt: 'b', attachmentPolicy: 'inline-only' }, { targetId: 'target-b', conversationUrl: 'https://chatgpt.com/c/b' });
        const completed = createSession({ vendor: 'chatgpt', prompt: 'done', attachmentPolicy: 'inline-only' }, { targetId: 'target-done', conversationUrl: 'https://chatgpt.com/c/done' });
        createSession({ vendor: 'chatgpt', prompt: 'expired', attachmentPolicy: 'inline-only' }, { deadlineAt: expired, targetId: 'target-expired', conversationUrl: 'https://chatgpt.com/c/expired' });
        createSession({ vendor: 'gemini', prompt: 'g', attachmentPolicy: 'inline-only' }, { targetId: 'target-g', conversationUrl: 'https://gemini.google.com/app/g' });
        updateSession(completed.sessionId, { status: 'completed' });

        let captured;
        try {
            resolveImplicitSessionSelection({ command: 'poll', vendor: 'chatgpt', port: 9222 });
        } catch (err) {
            captured = err;
        }

        expect(captured?.errorCode).toBe('session.target-ambiguous');
        expect(captured?.stage).toBe('target-resolution');
        expect(captured?.retryHint).toBe('pass-session');
        expect(captured?.evidence).toMatchObject({
            command: 'poll',
            vendor: 'chatgpt',
            port: 9222,
        });
        expect(captured.evidence.candidates.map(candidate => candidate.sessionId)).toEqual([a.sessionId, b.sessionId]);
        expect(JSON.stringify(captured.evidence.candidates)).not.toContain('target-done');
        expect(JSON.stringify(captured.evidence.candidates)).not.toContain('target-expired');
        expect(JSON.stringify(captured.evidence.candidates)).not.toContain('target-g');
    });

    it('auto-binds exactly one active provider session and keeps zero-session legacy routing', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { resolveImplicitSessionSelection } = await import('../../web-ai/session-target-guard.mjs');

        expect(resolveImplicitSessionSelection({ command: 'poll', vendor: 'chatgpt', port: 9222 }))
            .toMatchObject({ action: 'none', sessionId: null, candidates: [] });

        const only = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, { targetId: 'target-a', conversationUrl: 'https://chatgpt.com/c/a' });

        expect(resolveImplicitSessionSelection({ command: 'stop', vendor: 'chatgpt', port: 9222 }))
            .toMatchObject({ action: 'auto-bind', sessionId: only.sessionId, candidates: [{ targetId: 'target-a' }] });
    });

    it('documents that stop --session bypasses active-command and session-command locks', async () => {
        const cliSrc = await readSource('web-ai/cli.mjs');
        const runBoundStart = cliSrc.indexOf('async function runBoundCommand');
        const runBoundEnd = cliSrc.indexOf('function isRecoverableTabCrash');
        const runBoundSection = cliSrc.slice(runBoundStart, runBoundEnd);
        const stopStart = runBoundSection.indexOf("if (command === 'stop' && input.session)");
        const pollStart = runBoundSection.indexOf("if (command === 'poll' && input.session)");
        const stopBranch = runBoundSection.slice(stopStart, pollStart);

        expect(cliSrc).toContain('runSessionStopInterrupt');
        expect(stopBranch).toContain('runSessionStopInterrupt');
        expect(stopBranch).not.toContain('withSessionCommandLock');
        expect(stopBranch).not.toContain('withWebAiActiveCommand');
    });

    it('stop --session does not release the existing active-command owner row', async () => {
        const page = createMockChatGptPage('https://chatgpt.com/c/stop');
        mockTabManagerPage(page);
        const { createSession } = await import('../../web-ai/session.mjs');
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const { listActiveCommands, registerActiveCommand } = await import('../../web-ai/active-command-store.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, { targetId: 'target-stop', conversationUrl: 'https://chatgpt.com/c/stop' });
        await registerActiveCommand({
            commandId: 'owner-command',
            command: 'web-ai poll',
            provider: 'chatgpt',
            sessionId: session.sessionId,
            targetId: 'target-stop',
            owner: 'cli',
            browserProfileKey: '9222',
            ttlMs: 60_000,
        });

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        let result;
        try {
            result = await runWebAiCli(['stop', '--vendor', 'chatgpt', '--session', session.sessionId, '--json'], {
                getPort: () => 9222,
                getBrowserStatus: async () => ({ running: true }),
                readBrowserState: () => ({ headless: false }),
            });
        } finally {
            logSpy.mockRestore();
        }
        const rows = await listActiveCommands({ browserProfileKey: '9222', active: true });
        expect(result).toMatchObject({ ok: true, interrupt: true, sessionId: session.sessionId, targetId: 'target-stop' });
        expect(page.keyboard.press).toHaveBeenCalledWith('Escape');
        expect(rows).toMatchObject([{ commandId: 'owner-command', status: 'running', targetId: 'target-stop' }]);
    });

    it('stop --session resolves the provider from the stored session when --vendor is omitted', async () => {
        const page = createMockChatGptPage('https://gemini.google.com/app/gemini-stop');
        mockTabManagerPage(page);
        const { createSession } = await import('../../web-ai/session.mjs');
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const session = createSession({ vendor: 'gemini', prompt: 'g', attachmentPolicy: 'inline-only' }, {
            targetId: 'target-gemini',
            conversationUrl: 'https://gemini.google.com/app/gemini-stop',
        });

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        let result;
        try {
            result = await runWebAiCli(['stop', '--session', session.sessionId, '--json'], {
                getPort: () => 9222,
                getBrowserStatus: async () => ({ running: true }),
                readBrowserState: () => ({ headless: false }),
            });
        } finally {
            logSpy.mockRestore();
        }

        expect(result).toMatchObject({ ok: true, vendor: 'gemini', interrupt: true, targetId: 'target-gemini' });
        expect(page.keyboard.press).toHaveBeenCalledWith('Escape');
    });

    it('session target-resolution mismatch exposes expected/actual/recovery evidence', async () => {
        const page = createMockChatGptPage('https://chatgpt.com/c/live');
        mockTabManagerPage(page);
        const { createSession } = await import('../../web-ai/session.mjs');
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, {
            targetId: 'target-drift',
            conversationUrl: 'https://chatgpt.com/c/expected',
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            await expect(runWebAiCli(['stop', '--session', session.sessionId, '--json'], {
                getPort: () => 9222,
                getBrowserStatus: async () => ({ running: true }),
                readBrowserState: () => ({ headless: false }),
            })).rejects.toMatchObject({
                errorCode: 'cdp.target-mismatch',
                stage: 'target-resolution',
                evidence: {
                    expectedTargetId: 'target-drift',
                    actualTargetId: 'target-drift',
                    port: 9222,
                    recovery: `agbrowse web-ai stop --vendor chatgpt --session ${session.sessionId} --navigate --json`,
                    targetMismatch: {
                        expectedTargetId: 'target-drift',
                        actualTargetId: 'target-drift',
                        port: 9222,
                    },
                },
            });
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('a page death whose recovery cannot verify liveness stays retryable', async () => {
        // `withSessionPage` guards liveness twice: once on entry, once after the
        // callback dies. Only the second one is exercised here — the first probe
        // must succeed so the callback runs at all.
        const page = createMockChatGptPage('https://chatgpt.com/c/live');
        let probes = 0;
        vi.doMock('../../skills/browser/tab-manager.mjs', () => ({
            createTab: vi.fn(async () => { throw new Error('must not create a tab'); }),
            getPageByTargetId: vi.fn(async () => page),
            isTabAlive: vi.fn(async () => true),
            probeTabAlive: vi.fn(async () => {
                probes += 1;
                return probes === 1 ? 'alive' : 'unknown';
            }),
            listManagedTabs: vi.fn(async () => []),
            waitForPageByTargetId: vi.fn(async () => page),
        }));
        const { createSession } = await import('../../web-ai/session.mjs');
        const { withSessionPage } = await import('../../web-ai/tab-recovery.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, {
            targetId: 'target-dies',
            conversationUrl: 'https://chatgpt.com/c/live',
        });

        const failure = await withSessionPage(
            { getPort: () => 9222 },
            session.sessionId,
            async () => { throw new Error('Target closed'); },
        ).then(() => null, err => err);

        expect(probes).toBeGreaterThan(1);
        expect(failure).toMatchObject({
            errorCode: 'cdp.unreachable',
            retryHint: 'retry',
            evidence: { liveness: 'unknown' },
        });
    });

    it('unverified liveness is reported as retryable, not as a wrong tab', async () => {
        // The CLI maps resolver outcomes to public errors independently of the
        // resolver itself, so this branch needs its own coverage: advising
        // `--navigate` here would replace a tab we merely could not read.
        const page = createMockChatGptPage('https://chatgpt.com/c/live');
        mockTabManagerUnreadable(page);
        const { createSession } = await import('../../web-ai/session.mjs');
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, {
            targetId: 'target-unreadable',
            conversationUrl: 'https://chatgpt.com/c/live',
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            const failure = await runWebAiCli(['stop', '--session', session.sessionId, '--json'], {
                getPort: () => 9222,
                getBrowserStatus: async () => ({ running: true }),
                readBrowserState: () => ({ headless: false }),
            }).then(() => null, err => err);

            expect(failure).toMatchObject({
                errorCode: 'cdp.unreachable',
                stage: 'target-resolution',
                retryHint: 'retry',
                evidence: { liveness: 'unknown' },
            });
            // Recovery advice belongs to a tab we know is wrong, not one we
            // could not observe.
            expect(JSON.stringify(failure.evidence || {})).not.toContain('--navigate');
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('ChatGPT target-mismatch result exposes structured recovery evidence', async () => {
        const { createSession, sessionToBaseline } = await import('../../web-ai/session.mjs');
        const { buildTargetMismatchResult } = await import('../../web-ai/session-target-guard.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, { targetId: 'expected-target', conversationUrl: 'https://chatgpt.com/c/a' });
        const result = buildTargetMismatchResult({
            vendor: 'chatgpt',
            session,
            actualTargetId: 'actual-target',
            port: 9222,
            url: 'https://chatgpt.com/c/other',
            baseline: sessionToBaseline(session),
        });

        expect(result).toMatchObject({
            ok: false,
            status: 'target-mismatch',
            sessionId: session.sessionId,
            expectedTargetId: 'expected-target',
            actualTargetId: 'actual-target',
            port: 9222,
            recovery: `agbrowse web-ai poll --vendor chatgpt --session ${session.sessionId} --navigate --json`,
            targetMismatch: {
                expectedTargetId: 'expected-target',
                actualTargetId: 'actual-target',
                port: 9222,
            },
        });
    });
});

async function readSource(path) {
    const fs = await import('node:fs/promises');
    return fs.readFile(path, 'utf8');
}

function createMockChatGptPage(url) {
    return {
        url: vi.fn(() => url),
        goto: vi.fn(async () => null),
        keyboard: {
            press: vi.fn(async () => null),
        },
        context: vi.fn(() => ({
            newCDPSession: vi.fn(async () => ({})),
        })),
    };
}

function mockTabManagerPage(page) {
    vi.doMock('../../skills/browser/tab-manager.mjs', () => ({
        createTab: vi.fn(),
        getPageByTargetId: vi.fn(async () => page),
        isTabAlive: vi.fn(async () => true),
        probeTabAlive: vi.fn(async () => 'alive'),
        listManagedTabs: vi.fn(async () => []),
        waitForPageByTargetId: vi.fn(async () => page),
    }));
}

/**
 * The tab list cannot be read, so liveness is unknown for every target.
 *
 * @param {any} page
 * @param {{ pageLookupFails?: boolean }} [options]
 */
function mockTabManagerUnreadable(page, options = {}) {
    vi.doMock('../../skills/browser/tab-manager.mjs', () => ({
        createTab: vi.fn(async () => { throw new Error('must not create a tab'); }),
        getPageByTargetId: vi.fn(async () => (options.pageLookupFails ? null : page)),
        isTabAlive: vi.fn(async () => false),
        probeTabAlive: vi.fn(async () => 'unknown'),
        listManagedTabs: vi.fn(async () => []),
        waitForPageByTargetId: vi.fn(async () => page),
    }));
}
