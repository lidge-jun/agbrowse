import fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { runWebAiCli } from '../../web-ai/cli.mjs';

describe('web-ai policy CLI', () => {
    it('fails before browser mutation when policy denies provider copy capture', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        await expect(runWebAiCli([
            'poll',
            '--vendor', 'chatgpt',
            '--allow-copy-markdown-fallback',
            '--unsafe-allow', 'noop',
            '--json',
        ], deps)).rejects.toThrow(/provider copy capture denied/);
        expect(deps.getPage).not.toHaveBeenCalled();
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
});
