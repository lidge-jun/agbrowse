import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-sessions-cmd-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

describe('web-ai parseDurationToMs', () => {
    it('accepts s/m/h/d/w units and defaults to days', async () => {
        const { parseDurationToMs } = await import('../../web-ai/cli.mjs');
        expect(parseDurationToMs('30')).toBe(30 * 86_400_000);
        expect(parseDurationToMs('30d')).toBe(30 * 86_400_000);
        expect(parseDurationToMs('12h')).toBe(12 * 3_600_000);
        expect(parseDurationToMs('90m')).toBe(90 * 60_000);
        expect(parseDurationToMs('600s')).toBe(600_000);
        expect(parseDurationToMs('2w')).toBe(2 * 604_800_000);
    });

    it('returns null for empty / nullish inputs', async () => {
        const { parseDurationToMs } = await import('../../web-ai/cli.mjs');
        expect(parseDurationToMs('')).toBeNull();
        expect(parseDurationToMs(null)).toBeNull();
        expect(parseDurationToMs(undefined)).toBeNull();
    });

    it('throws WebAiError for invalid input', async () => {
        const { parseDurationToMs } = await import('../../web-ai/cli.mjs');
        let captured;
        try { parseDurationToMs('abc'); } catch (e) { captured = e; }
        expect(captured?.errorCode).toBe('internal.unhandled');
        expect(captured?.message).toMatch(/invalid duration/);
    });
});

describe('web-ai sessions CLI surface (source-string contracts)', () => {
    const cliSrc = readSrc('web-ai/cli.mjs');
    const sessionsSrc = readSrc('web-ai/cli-sessions.mjs');

    it('declares sessions in COMMANDS and a sessions subcommand whitelist', () => {
        expect(cliSrc).toMatch(/COMMANDS = new Set\(\[[\s\S]*?'sessions'/);
        expect(sessionsSrc).toMatch(/SESSIONS_SUBCOMMANDS = new Set\(\['list', 'show', 'resume', 'reattach', 'doctor', 'prune'\]\)/);
    });

    it('dispatches sessions before context and runCommand', () => {
        expect(cliSrc).toMatch(/command === 'sessions'\s*\?\s*await runSessionsCommand/);
    });

    it('list/show/resume/reattach/prune subcommands are handled', () => {
        for (const sub of ['list', 'show', 'resume', 'reattach', 'doctor', 'prune']) {
            expect(sessionsSrc).toMatch(new RegExp(`sub === '${sub}'`));
        }
    });

    it('resume polls through withSessionPage and withSessionCommandLock', () => {
        expect(sessionsSrc).toContain('withSessionPage');
        expect(sessionsSrc).toContain('withSessionCommandLock');
    });

    it('reattach respects --navigate when conversationUrl differs', () => {
        expect(sessionsSrc).toMatch(/input\.navigate === true/);
        expect(sessionsSrc).toMatch(/reattach-mismatch/);
        expect(sessionsSrc).toMatch(/pass --navigate to switch tabs/);
    });

    it('prune defaults --older-than to 30d when omitted', () => {
        expect(sessionsSrc).toMatch(/30 \* 86_400_000/);
    });

    it('exposes --older-than / --status / --limit options', () => {
        expect(cliSrc).toMatch(/'older-than': \{ type: 'string' \}/);
        expect(cliSrc).toMatch(/status: \{ type: 'string' \}/);
        expect(cliSrc).toMatch(/limit: \{ type: 'string' \}/);
    });
});

describe('web-ai sessions list / show / prune via runSessionsCommand', () => {
    it('list returns persisted sessions filtered by vendor', async () => {
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const { createSession } = await import('../../web-ai/session.mjs');
        const a = createSession({ vendor: 'chatgpt', prompt: 'a', attachmentPolicy: 'inline-only' }, { conversationUrl: 'https://chatgpt.com/c/a' });
        createSession({ vendor: 'grok', prompt: 'b', attachmentPolicy: 'inline-only' }, { conversationUrl: 'https://grok.com/c/b' });
        const result = await runWebAiCli(['sessions', 'list', '--vendor', 'chatgpt', '--json']);
        expect(result.status).toBe('list');
        expect(result.sessions.length).toBe(1);
        expect(result.sessions[0].sessionId).toBe(a.sessionId);
    });

    it('show returns a single session by id', async () => {
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const { createSession } = await import('../../web-ai/session.mjs');
        const s = createSession({ vendor: 'chatgpt', prompt: 'x', attachmentPolicy: 'inline-only' });
        const result = await runWebAiCli(['sessions', 'show', s.sessionId, '--json']);
        expect(result.status).toBe('show');
        expect(result.session.sessionId).toBe(s.sessionId);
    });

    it('prune --older-than 7d removes old sessions only', async () => {
        const { runWebAiCli } = await import('../../web-ai/cli.mjs');
        const { createSession } = await import('../../web-ai/session.mjs');
        // Backdate one session to 30d ago by direct store mutation through createSession + patch.
        const oldOne = createSession({ vendor: 'chatgpt', prompt: 'old', attachmentPolicy: 'inline-only' });
        const fresh = createSession({ vendor: 'chatgpt', prompt: 'fresh', attachmentPolicy: 'inline-only' });
        const { patchSession } = await import('../../web-ai/session-store.mjs');
        const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
        patchSession(oldOne.sessionId, { createdAt: longAgo, updatedAt: longAgo });
        const result = await runWebAiCli(['sessions', 'prune', '--older-than', '7d', '--json']);
        expect(result.status).toBe('pruned');
        expect(result.removed).toBe(1);
        expect(result.remaining).toBe(1);
    });
});

function readSrc(rel) {
    return readFileSync(join(process.cwd(), rel), 'utf8');
}
