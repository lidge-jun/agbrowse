import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-provider-session-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

describe('web-ai resolveDeadlineAt', () => {
    it('uses explicit deadline when provided', async () => {
        const { resolveDeadlineAt } = await import('../../web-ai/session.mjs');
        const iso = '2026-12-31T00:00:00.000Z';
        expect(resolveDeadlineAt({ deadline: iso }, 'chatgpt')).toBe(iso);
    });

    it('derives from --timeout when deadline missing', async () => {
        const { resolveDeadlineAt } = await import('../../web-ai/session.mjs');
        const before = Date.now();
        const out = resolveDeadlineAt({ timeout: 60 }, 'chatgpt');
        const computed = Date.parse(out);
        expect(computed - before).toBeGreaterThanOrEqual(58_000);
        expect(computed - before).toBeLessThanOrEqual(62_000);
    });

    it('falls back to vendor default (chatgpt 1200, gemini 1200, grok 600)', async () => {
        const { resolveDeadlineAt } = await import('../../web-ai/session.mjs');
        const before = Date.now();
        const cg = Date.parse(resolveDeadlineAt({}, 'chatgpt')) - before;
        const gm = Date.parse(resolveDeadlineAt({}, 'gemini')) - before;
        const gk = Date.parse(resolveDeadlineAt({}, 'grok')) - before;
        expect(cg).toBeGreaterThanOrEqual(1199_000);
        expect(cg).toBeLessThanOrEqual(1201_000);
        expect(gm).toBeGreaterThanOrEqual(1199_000);
        expect(gm).toBeLessThanOrEqual(1201_000);
        expect(gk).toBeGreaterThanOrEqual(599_000);
        expect(gk).toBeLessThanOrEqual(601_000);
    });
});

describe('web-ai summarizeEnvelope', () => {
    it('captures model + attachmentPolicy + filePath + contextPack stats', async () => {
        const { summarizeEnvelope } = await import('../../web-ai/session.mjs');
        const summary = summarizeEnvelope(
            { model: 'pro', attachmentPolicy: 'upload', filePath: '/tmp/x.txt' },
            { files: [{}, {}], transport: 'upload' },
        );
        expect(summary).toEqual({
            model: 'pro',
            attachmentPolicy: 'upload',
            filePath: '/tmp/x.txt',
            fileCount: 2,
            contextTransport: 'upload',
        });
    });
});

describe('web-ai session timeout monotonicity', () => {
    it('does not downgrade completed sessions when a later poll times out', async () => {
        const { createSession, markSessionTimeout, updateSession, getSession } = await import('../../web-ai/session.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'x', attachmentPolicy: 'inline-only' });
        updateSession(session.sessionId, {
            status: 'complete',
            answer: 'done',
            completedAt: '2026-06-21T00:00:00.000Z',
            warnings: ['kept'],
        });

        const updated = markSessionTimeout(session.sessionId, {
            lastError: { errorCode: 'provider.poll-timeout', message: 'late timeout' },
        });

        expect(updated.status).toBe('complete');
        expect(updated.answer).toBe('done');
        expect(updated.warnings).toEqual(['kept', 'timeout-after-complete-ignored']);
        expect(getSession(session.sessionId).status).toBe('complete');
    });

    it('marks incomplete sessions as timeout with merged warning and lastError', async () => {
        const { createSession, markSessionTimeout } = await import('../../web-ai/session.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'x', attachmentPolicy: 'inline-only' });

        const updated = markSessionTimeout(session.sessionId, {
            warning: 'poll-timeout',
            lastError: { errorCode: 'provider.poll-timeout', message: 'timeout' },
        });

        expect(updated.status).toBe('timeout');
        expect(updated.warnings).toEqual(['poll-timeout']);
        expect(updated.lastError).toMatchObject({ errorCode: 'provider.poll-timeout' });
    });
});

describe('web-ai provider timeout envelope', () => {
    it('ChatGPT poll timeout remains recoverable and keeps session evidence', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { pollWebAi } = await import('../../web-ai/chatgpt.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'slow', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-1',
                conversationUrl: 'https://chatgpt.com/c/slow',
                deadlineAt: '2026-06-21T01:00:00.000Z',
                envelopeSummary: { assistantCount: 0 },
            },
        );

        const result = await pollWebAi({
            getPage: async () => createTimeoutChatGptPage(),
            getTargetId: async () => 'target-1',
        }, {
            vendor: 'chatgpt',
            session: session.sessionId,
            timeout: 1,
        });

        expect(result).toMatchObject({
            ok: false,
            vendor: 'chatgpt',
            status: 'timeout',
            sessionId: session.sessionId,
            recoverable: true,
            retryHint: 'poll-or-resume',
            deadlineAt: '2026-06-21T01:00:00.000Z',
            conversationUrl: 'https://chatgpt.com/c/slow',
        });
    });
});

describe('web-ai provider integration (source-string contracts)', () => {
    const root = process.cwd();
    const chatgptSrc = readFileSync(join(root, 'web-ai/chatgpt.mjs'), 'utf8');
    const geminiSrc = readFileSync(join(root, 'web-ai/gemini-live.mjs'), 'utf8');
    const grokSrc = readFileSync(join(root, 'web-ai/grok-live.mjs'), 'utf8');
    const finalizerSrc = readFileSync(join(root, 'web-ai/tab-finalizer.mjs'), 'utf8');

    it('all three providers create a session on send and return sessionId', () => {
        for (const src of [chatgptSrc, geminiSrc, grokSrc]) {
            // Phase 9.1: targetId may be extracted to a variable before createSession
            expect(src).toMatch(/createSession\(envelope, \{[\s\S]*?(targetId|targetId,)[\s\S]*?conversationUrl:[\s\S]*?deadlineAt: resolveDeadlineAt/);
            expect(src).toMatch(/sessionId: session\.sessionId/);
        }
    });

    it('all three providers resolve session on poll via input.session > findActiveSession', () => {
        for (const src of [chatgptSrc, geminiSrc, grokSrc]) {
            expect(src).toMatch(/input\.session\s*\?\s*getSession\(input\.session\)/);
            expect(src).toMatch(/findActiveSession\(\{[\s\S]*?vendor[\s\S]*?targetId[\s\S]*?conversationUrl/);
            expect(src).toMatch(/session && sessionToBaseline\(session\)/);
        }
    });

    it('all three providers finalize completion and markSessionTimeout on timeout', () => {
        for (const src of [chatgptSrc, geminiSrc, grokSrc]) {
            expect(src).toMatch(/finalizeProviderTab\(deps, \{[\s\S]*?session[\s\S]*?answerText/);
            expect(src).toMatch(/markSessionTimeout\(session\.sessionId/);
            expect(src).toContain("retryHint: 'poll-or-resume'");
            expect(src).toContain('recoverable: true');
        }
        expect(finalizerSrc).toMatch(/updateSession\(session\.sessionId, \{[\s\S]*?status: 'complete'/);
        expect(finalizerSrc).toMatch(/completedAt: new Date\(\)\.toISOString\(\)/);
    });

    it('queryWebAi forwards sent.sessionId into pollWebAi to keep one session record', () => {
        for (const src of [chatgptSrc, geminiSrc, grokSrc]) {
            expect(src).toMatch(/session: sent\.sessionId/);
            expect(src).toMatch(/sessionId: result\.sessionId \|\| sent\.sessionId/);
        }
    });
});

describe('web-ai cli session flags', () => {
    const cliSrc = readFileSync(join(process.cwd(), 'web-ai/cli.mjs'), 'utf8');
    it('declares --session, --deadline, --navigate options', () => {
        expect(cliSrc).toMatch(/session: \{ type: 'string' \}/);
        expect(cliSrc).toMatch(/deadline: \{ type: 'string' \}/);
        expect(cliSrc).toMatch(/navigate: \{ type: 'boolean', default: false \}/);
    });

    it('passes them into the input object as session/deadline/navigate', () => {
        expect(cliSrc).toMatch(/session: values\.session/);
        expect(cliSrc).toMatch(/deadline: values\.deadline/);
        expect(cliSrc).toMatch(/navigate: values\.navigate === true/);
    });

    it('binds send/query --session to the saved session tab instead of creating a new provider tab', () => {
        expect(cliSrc).toMatch(/async function runBoundSendOrQuery\(command, deps, input\)/);
        expect(cliSrc).toMatch(/withSessionCommandLock\(input\.session/);
        expect(cliSrc).toMatch(/withSessionPage\(deps, input\.session/);
        expect(cliSrc).toMatch(/url: undefined/);
        expect(cliSrc).toMatch(/newTab: false/);
        expect(cliSrc).toMatch(/reuseTab: true/);
        expect(cliSrc).toMatch(/const boundSendOrQuery = await runBoundSendOrQuery\(command, deps, input\)/);
    });

    it('session-bound poll retries recoverable tab crashes through tab recovery', () => {
        const recoverySrc = readFileSync(join(process.cwd(), 'web-ai/tab-recovery.mjs'), 'utf8');
        expect(cliSrc).toContain('isRecoverableTabCrash');
        expect(cliSrc).toContain('target closed during session-bound web-ai command');
        expect(recoverySrc).toContain("session.conversationUrl || session.originalUrl || 'about:blank'");
        expect(recoverySrc).toContain('(needsRecovery || forceRecover) && recoveryTargetUrl');
        expect(recoverySrc).toContain('Fall through to a fresh tab recovery');
    });

    it('keeps live post-submit conversation URLs instead of navigating back to provider root', () => {
        const recoverySrc = readFileSync(join(process.cwd(), 'web-ai/tab-recovery.mjs'), 'utf8');
        expect(recoverySrc).toContain('shouldPreferCurrentProviderUrl');
        expect(recoverySrc).toContain("savedPath === '/' && currentPath !== '/'");
        expect(recoverySrc).toContain('do not');
        expect(recoverySrc).toContain('navigate it back to the stale root');
    });

    it('wraps session-bound and provider web-ai mutations in active command ownership', () => {
        expect(cliSrc).toContain("withActiveCommand } from './active-command-store.mjs'");
        expect(cliSrc).toMatch(/async function withWebAiActiveCommand\(command, deps, input, fn\)/);
        expect(cliSrc).toMatch(/command: `web-ai \$\{command\}`/);
        expect(cliSrc).toMatch(/owner: 'cli'/);
        expect(cliSrc).toMatch(/await deps\.prepareProviderPage\?\.\(\)/);
        expect(cliSrc).toMatch(/return withWebAiActiveCommand\(command, sessionDeps, sessionInput/);
        expect(cliSrc).toMatch(/case 'send': return withWebAiActiveCommand/);
        expect(cliSrc).toMatch(/case 'query': return withWebAiActiveCommand/);
    });

    it('wraps MCP wait/resume in session command lock, session page recovery, and MCP active command', () => {
        const mcpSrc = readFileSync(join(process.cwd(), 'web-ai/mcp-server.mjs'), 'utf8');
        expect(mcpSrc).toContain("import { withSessionCommandLock } from './session-store.mjs'");
        expect(mcpSrc).toContain("import { withSessionPage } from './tab-recovery.mjs'");
        expect(mcpSrc).toMatch(/if \(name === 'web_ai_wait_response' \|\| name === 'web_ai_session_resume'\) \{[\s\S]*?return runMcpSessionPoll\(name, args, deps\)/);
        expect(mcpSrc).toMatch(/async function runMcpSessionPoll\(name, args, deps\)/);
        expect(mcpSrc).toMatch(/withSessionCommandLock\(sessionId/);
        expect(mcpSrc).toMatch(/withSessionPage\(deps, sessionId/);
        expect(mcpSrc).toMatch(/withMcpActiveCommand\(name, provider, sessionDeps, sessionArgs/);
    });

    it('reuses inactive provider tabs before creating another ChatGPT tab', () => {
        expect(cliSrc).toContain("import { createTab, listManagedTabs, waitForPageByTargetId }");
        expect(cliSrc).toMatch(/async function findReusableProviderTab\(port, vendor, targetUrl\)/);
        expect(cliSrc).toMatch(/activeCommandTargetIds\(\{ browserProfileKey: String\(port\) \}\)/);
        expect(cliSrc).toMatch(/listSessions\(\{ active: true \}\)/);
        expect(cliSrc).toMatch(/listLeases\(\)/);
        expect(cliSrc).toMatch(/!isPinned\(tab\.targetId\)/);
        expect(cliSrc).toMatch(/isReusableByLease\(tab\.targetId, leaseByTargetId\)/);
        expect(cliSrc).toMatch(/input\.forceNewTab !== true/);
        expect(cliSrc).toMatch(/const reusable = await findReusableProviderTab/);
        expect(cliSrc).toMatch(/prepareProviderPage: async \(\) =>/);
        expect(cliSrc).toMatch(/page\.goto\(vendorUrl/);
        expect(cliSrc).toMatch(/if \(input\.forceNewTab !== true\) \{\s*\/\/ Phase 9\.2: try tab pool first/s);
    });

    it('repairs bound session pages that are alive but navigated to another conversation', () => {
        const recoverySrc = readFileSync(join(process.cwd(), 'web-ai/tab-recovery.mjs'), 'utf8');
        expect(recoverySrc).toMatch(/current\.conversationUrl && page\.url\(\) !== current\.conversationUrl/);
        expect(recoverySrc).toMatch(/page\.goto\(current\.conversationUrl/);
    });

    it('exports resolveSessionPage and gates doctor as a browser-required session subcommand', () => {
        const recoverySrc = readFileSync(join(process.cwd(), 'web-ai/tab-recovery.mjs'), 'utf8');
        expect(cliSrc).toContain("BROWSER_REQUIRED_SESSION_COMMANDS = new Set(['resume', 'reattach', 'doctor'])");
        expect(recoverySrc).toContain('export async function resolveSessionPage');
    });
});

function createTimeoutChatGptPage() {
    return {
        url: () => 'https://chatgpt.com/c/slow',
        evaluate: async () => [],
        waitForTimeout: async () => undefined,
        locator: () => ({
            first: () => ({
                isVisible: async () => false,
            }),
            all: async () => [],
        }),
    };
}
