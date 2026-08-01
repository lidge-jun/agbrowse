import fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWebAiCli } from '../../web-ai/cli.mjs';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-policy-cli-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
});

describe('web-ai policy CLI', () => {
    it('allows provider copy capture when the CLI fallback flag is explicitly set', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('now browser may be reached'); }) };
        await expect(runWebAiCli([
            'poll',
            '--vendor', 'chatgpt',
            '--allow-copy-markdown-fallback',
            '--json',
        ], deps)).rejects.toThrow(/now browser may be reached/);
        expect(deps.getPage).toHaveBeenCalled();
    });

    it('fails before browser mutation when policy explicitly disables provider copy capture', async () => {
        await fs.writeFile('tmp-deny-copy-policy.json', JSON.stringify({
            version: 1,
            allowClipboardWrite: false,
        }));
        try {
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'poll',
                '--vendor', 'chatgpt',
                '--allow-copy-markdown-fallback',
                '--policy', 'tmp-deny-copy-policy.json',
                '--json',
            ], deps)).rejects.toThrow(/provider copy capture denied/);
            expect(deps.getPage).not.toHaveBeenCalled();
        } finally {
            await fs.rm('tmp-deny-copy-policy.json', { force: true });
        }
    });

    it('allows provider copy capture with the legacy clipboard-read unsafe allowance', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('now browser may be reached'); }) };
        await expect(runWebAiCli([
            'poll',
            '--vendor', 'chatgpt',
            '--allow-copy-markdown-fallback',
            '--unsafe-allow', 'clipboard-read',
            '--json',
        ], deps)).rejects.toThrow(/now browser may be reached/);
        expect(deps.getPage).toHaveBeenCalled();
    });

    it('allows provider copy capture with clipboard-write-intercept unsafe allowance', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('reached browser via new alias'); }) };
        await expect(runWebAiCli([
            'poll',
            '--vendor', 'chatgpt',
            '--allow-copy-markdown-fallback',
            '--unsafe-allow', 'clipboard-write-intercept',
            '--json',
        ], deps)).rejects.toThrow(/reached browser via new alias/);
        expect(deps.getPage).toHaveBeenCalled();
    });

    it('enforces denied vendor default origin before browser mutation', async () => {
        await fs.writeFile('tmp-deny-chatgpt-policy.json', JSON.stringify({
            version: 1,
            deniedOrigins: ['https://chatgpt.com'],
        }));
        try {
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'send',
                '--vendor', 'chatgpt',
                '--inline-only',
                '--prompt', 'hello',
                '--policy', 'tmp-deny-chatgpt-policy.json',
                '--json',
            ], deps)).rejects.toThrow(/origin denied/);
            expect(deps.getPage).not.toHaveBeenCalled();
        } finally {
            await fs.rm('tmp-deny-chatgpt-policy.json', { force: true });
        }
    });

    /**
     * `--require-file-artifacts` only has a completion path to enforce on
     * ChatGPT send/query/poll/watch. Everywhere else the flag would be accepted
     * and quietly do nothing, which is the same silence the contract removes.
     * Rejection has to happen before the browser is touched: reporting it after
     * the prompt was sent would already have mutated provider state.
     */
    describe('--require-file-artifacts support matrix', () => {
        /** @param {string[]} argv */
        const runRejected = async (argv) => {
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli(argv, deps)).rejects.toThrow(/require-file-artifacts/);
            expect(deps.getPage).not.toHaveBeenCalled();
        };

        it('S1: rejects a non-ChatGPT provider before reaching the browser', async () => {
            await runRejected([
                'send', '--vendor', 'gemini', '--inline-only',
                '--prompt', 'hi', '--require-file-artifacts', '--json',
            ]);
        });

        it('S2: rejects a command with no file capture path', async () => {
            await runRejected([
                'code', '--vendor', 'chatgpt',
                '--prompt', 'hi', '--require-file-artifacts', '--json',
            ]);
        });

        it('S3: rejects deep research', async () => {
            await runRejected([
                'send', '--vendor', 'chatgpt', '--inline-only', '--research', 'deep',
                '--prompt', 'hi', '--require-file-artifacts', '--json',
            ]);
        });

        it('S4: rejects a session-less poll, which has nowhere to save', async () => {
            await runRejected([
                'poll', '--vendor', 'chatgpt', '--require-file-artifacts', '--json',
            ]);
        });

        it('S5: a supported combination is NOT rejected', async () => {
            // The paired assertion: over-blocking would be as wrong as silence.
            // It fails on the unknown session id instead, which is precisely the
            // point — the support guard let it through.
            const deps = { getPage: vi.fn(() => { throw new Error('now browser may be reached'); }) };
            await expect(runWebAiCli([
                'poll', '--vendor', 'chatgpt', '--session', 'sess-1',
                '--require-file-artifacts', '--json',
            ], deps)).rejects.toThrow(/Session not found/);
        });

        it('S6: rejects a non-ChatGPT session even when --vendor is omitted', async () => {
            // The bypass: with no `--vendor` the input reads as chatgpt, so a
            // guard that trusts it lets a Gemini session through to browser
            // startup and only applies the stored vendor afterwards.
            const { createSession } = await import('../../web-ai/session.mjs');
            const session = createSession(
                { vendor: 'gemini', prompt: 'p', attachmentPolicy: 'inline-only' },
                { targetId: 't-gem', conversationUrl: 'https://gemini.google.com/app/x' },
            );
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'poll', '--session', session.sessionId, '--require-file-artifacts', '--json',
            ], deps)).rejects.toThrow(/require-file-artifacts/);
            expect(deps.getPage).not.toHaveBeenCalled();
        });

        it('S7: an explicit --vendor cannot override the stored one', async () => {
            // The session's own vendor is restored once the browser is up, so
            // trusting `--vendor chatgpt` here would let the guard pass and the
            // strict policy then be ignored by a Gemini poll.
            const { createSession } = await import('../../web-ai/session.mjs');
            const session = createSession(
                { vendor: 'gemini', prompt: 'p', attachmentPolicy: 'inline-only' },
                { targetId: 't-gem2', conversationUrl: 'https://gemini.google.com/app/y' },
            );
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'poll', '--vendor', 'chatgpt', '--session', session.sessionId,
                '--require-file-artifacts', '--json',
            ], deps)).rejects.toThrow(/require-file-artifacts/);
            expect(deps.getPage).not.toHaveBeenCalled();
        });

        it('S8: a positional sessions resume id is still checked', async () => {
            // `sessions resume <id>` passes the id positionally, so a guard that
            // only reads `--session` never sees the stored record at all.
            const { createSession } = await import('../../web-ai/session.mjs');
            const session = createSession(
                { vendor: 'gemini', prompt: 'p', attachmentPolicy: 'inline-only' },
                { targetId: 't-gem3', conversationUrl: 'https://gemini.google.com/app/z' },
            );
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'sessions', 'resume', session.sessionId, '--require-file-artifacts', '--json',
            ], deps)).rejects.toThrow(/require-file-artifacts/);
            expect(deps.getPage).not.toHaveBeenCalled();
        });

        it('S9: a stored deep-research session is rejected too', async () => {
            const { createSession, updateSession } = await import('../../web-ai/session.mjs');
            const session = createSession(
                { vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' },
                { targetId: 't-dr', conversationUrl: 'https://chatgpt.com/c/dr' },
            );
            // Set the way the deep-research path sets it, not via createSession:
            // that option is not persisted, so seeding it there tests nothing.
            updateSession(session.sessionId, { researchMode: 'deep' });
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'sessions', 'resume', session.sessionId, '--require-file-artifacts', '--json',
            ], deps)).rejects.toThrow(/require-file-artifacts/);
            expect(deps.getPage).not.toHaveBeenCalled();
        });

        it('S10: two different session ids are rejected instead of guessing', async () => {
            // `sessions resume` prefers its positional argument while the guard
            // preferred `--session`, so passing both let the check inspect one
            // session and the resume run the other.
            const { createSession } = await import('../../web-ai/session.mjs');
            const gemini = createSession(
                { vendor: 'gemini', prompt: 'p', attachmentPolicy: 'inline-only' },
                { targetId: 't-gem4', conversationUrl: 'https://gemini.google.com/app/w' },
            );
            const chatgpt = createSession(
                { vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' },
                { targetId: 't-cg', conversationUrl: 'https://chatgpt.com/c/w' },
            );
            const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
            await expect(runWebAiCli([
                'sessions', 'resume', gemini.sessionId,
                '--session', chatgpt.sessionId,
                '--require-file-artifacts', '--json',
            ], deps)).rejects.toThrow(/require-file-artifacts/);
            expect(deps.getPage).not.toHaveBeenCalled();
        });
    });
});
