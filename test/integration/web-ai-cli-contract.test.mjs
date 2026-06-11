import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execBrowser } from '../helpers/exec-browser.mjs';

describe('web-ai CLI contract', () => {
    it('shows detailed web-ai help without requiring a prompt', async () => {
        const result = await execBrowser(['web-ai', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('Provider:');
        expect(result.stdout).toContain('--context-from-files');
        expect(result.stdout).toContain('--effort <alias>');
        expect(result.stdout).toContain('default for chatgpt: pro');
        expect(result.stdout).toContain('Tab lease policy:');
        expect(result.stdout).toContain('leaseClosedTabs');
        expect(result.stdout).toContain('mcp-server');
        expect(result.stdout).toContain('auto-start headed Chrome');
        expect(result.stdout).toContain('AGBROWSE_WEB_AI_AUTO_START=0');
        expect(result.stdout).toContain('project-sources');
        expect(result.stdout).toContain('--output-image <path>');
        expect(result.stdout).toContain('--follow-up <text>');
        expect(result.stdout).toContain('--research deep');
        expect(result.stdout).toContain('--max-upload-file-size <bytes>');
        expect(result.stdout).toContain('--max-context-file-size <bytes>');
        expect(result.stdout).toContain('out.png, out-2.png, out-3.png');
        expect(result.stdout).toContain('query --session <id> sends a new prompt');
        expect(result.stdout).toContain('--session "$SID"');
        expect(result.stdout).toMatch(/agbrowse web-ai code\s+--vendor chatgpt/);
        expect(result.stdout).toMatch(/agbrowse web-ai query\s+--vendor grok/);
    });

    it('shows command-specific code-mode help without a browser', async () => {
        const result = await execBrowser(['web-ai', 'code', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('agbrowse web-ai code --vendor chatgpt --prompt <build-spec>');
        expect(result.stdout).toContain('subcommand, not a --code flag');
        expect(result.stdout).toContain('--output-zip <path>');
        expect(result.stdout).toContain('--multi-zip');
        expect(result.stdout).toContain('PLAN.md or 00_plan.md');
        expect(result.stdout).toContain('turn_plan.update_turn_plan');
        expect(result.stdout).toContain('MACHINE: /mnt/data/result.zip');
    });

    it('shows command-specific code extraction help without a browser', async () => {
        const result = await execBrowser(['web-ai', 'code-extract', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('agbrowse web-ai code-extract --vendor chatgpt');
        expect(result.stdout).toContain('It does not send a new prompt');
        expect(result.stdout).toContain('--conversation <id|url>');
        expect(result.stdout).toContain('--session <sessionId>');
        expect(result.stdout).toContain('--multi-zip');
        expect(result.stdout).toContain('A copied /mnt/data/result.zip text line alone is not enough');
    });

    it('supports render command without a running browser', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('[USER]');
        expect(result.stdout).toContain('## Question');
    });

    it('supports Gemini render without a running browser', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'gemini', '--prompt', 'hello']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('[USER]');
        expect(result.stdout).toContain('## Question');
    });

    it('supports Grok render without a running browser', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'grok', '--prompt', 'hello']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('[USER]');
        expect(result.stdout).toContain('## Question');
    });

    it('rejects unknown vendor', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'claude', '--prompt', 'hello']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported vendor');
    });

    it('requires inline-only for send/query', async () => {
        const result = await execBrowser(['web-ai', 'send', '--vendor', 'chatgpt', '--prompt', 'hello']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('--inline-only');
    });

    it('allows send/query preflight when context packaging will upload an attachment', async () => {
        const result = await execBrowser([
            'web-ai',
            'query',
            '--vendor',
            'chatgpt',
            '--prompt',
            'hello',
            '--context-from-files',
            'web-ai/question.mjs',
            '--model',
            'deepthink',
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported ChatGPT model selection');
        expect(result.stderr).not.toContain('--inline-only');
    });

    it('defaults --model to pro for chatgpt when omitted', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello']);
        expect(result.code).toBe(0);
        // No model error and renders successfully (model selection happens at browser-mutation time, not in render).
        expect(result.stderr).not.toContain('unsupported');
        const effortDefault = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--effort', 'extended']);
        expect(effortDefault.code).toBe(0);
        expect(effortDefault.stderr).not.toContain('requires --model');
    });

    it('rejects unsupported ChatGPT model choices', async () => {
        const result = await execBrowser(['web-ai', 'query', '--vendor', 'chatgpt', '--inline-only', '--prompt', 'hello', '--model', 'deepthink']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported ChatGPT model selection');
    });

    it('accepts observed ChatGPT reasoning effort choices in CLI preflight', async () => {
        const pro = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', 'standard']);
        expect(pro.code).toBe(0);
        expect(pro.stderr).not.toContain('unsupported ChatGPT reasoning effort');

        const thinking = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'thinking', '--reasoning-effort', 'heavy']);
        expect(thinking.code).toBe(0);
        expect(thinking.stderr).not.toContain('unsupported ChatGPT reasoning effort');

        const effortOnly = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--effort', 'extended']);
        // ChatGPT now defaults --model to 'pro' when omitted, so --effort alone is accepted.
        expect(effortOnly.code).toBe(0);
        expect(effortOnly.stderr).not.toContain('reasoning effort requires --model');

        const proHeavy = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', 'heavy']);
        expect(proHeavy.code).not.toBe(0);
        expect(proHeavy.stderr).toContain('unsupported ChatGPT reasoning effort');

        const invalid = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', 'maximum']);
        expect(invalid.code).not.toBe(0);
        expect(invalid.stderr).toContain('unsupported ChatGPT reasoning effort');
    });

    it('accepts observed Gemini and Grok model choices in CLI preflight', async () => {
        const gemini = await execBrowser(['web-ai', 'render', '--vendor', 'gemini', '--prompt', 'hello', '--model', 'thinking']);
        expect(gemini.stderr).not.toContain('unsupported gemini model selection');
        expect(gemini.code).toBe(0);

        const geminiDeepThink = await execBrowser(['web-ai', 'render', '--vendor', 'gemini', '--prompt', 'hello', '--model', 'deepthink']);
        expect(geminiDeepThink.stderr).not.toContain('unsupported gemini model selection');
        expect(geminiDeepThink.code).toBe(0);

        const grok = await execBrowser(['web-ai', 'render', '--vendor', 'grok', '--prompt', 'hello', '--model', 'expert']);
        expect(grok.stderr).not.toContain('unsupported grok model selection');
        expect(grok.code).toBe(0);
    });

    it('parses copy markdown fallback flag for query preflight', async () => {
        const result = await execBrowser([
            'web-ai',
            'query',
            '--vendor',
            'chatgpt',
            '--inline-only',
            '--prompt',
            'hello',
            '--allow-copy-markdown-fallback',
            '--model',
            'deepthink',
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported ChatGPT model selection');
        expect(result.stderr).not.toContain('Unknown option');
    });

    it('parses source audit flags for query preflight', async () => {
        const result = await execBrowser([
            'web-ai',
            'query',
            '--vendor',
            'chatgpt',
            '--inline-only',
            '--prompt',
            'hello',
            '--require-source-audit',
            '--source-audit-ratio',
            '0.5',
            '--source-audit-scope',
            'official docs',
            '--source-audit-date',
            '2026-05-05',
            '--model',
            'deepthink',
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported ChatGPT model selection');
        expect(result.stderr).not.toContain('Unknown option');
    });

    it('supports context dry-run without a running browser', async () => {
        const result = await execBrowser([
            'web-ai',
            'context-dry-run',
            '--vendor',
            'chatgpt',
            '--prompt',
            'review context',
            '--context-from-files',
            'web-ai/question.mjs',
            '--json',
        ]);
        expect(result.code).toBe(0);
        const parsed = JSON.parse(result.stdout);
        expect(parsed.status).toBe('dry-run');
        expect(parsed.transport).toBe('upload');
        expect(parsed.attachments).toHaveLength(1);
        expect(parsed.files[0].relativePath).toBe('web-ai/question.mjs');
        expect(parsed.composerText).toBeUndefined();
    });

    it('supports context render with full composer text', async () => {
        const result = await execBrowser([
            'web-ai',
            'context-render',
            '--vendor',
            'chatgpt',
            '--prompt',
            'review context',
            '--context-from-files',
            'web-ai/question.mjs',
        ]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('[CONTEXT PACKAGE]');
        expect(result.stdout).toContain('### File: web-ai/question.mjs');
        expect(result.stdout).not.toContain('[USER REQUEST]');
    });

    it('rejects Deep Research combined with batch follow-ups before browser mutation', async () => {
        const result = await execBrowser([
            'web-ai',
            'render',
            '--vendor',
            'chatgpt',
            '--prompt',
            'hello',
            '--research',
            'deep',
            '--follow-up',
            'next',
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('cannot be combined with --follow-up');
    });

    it('supports project-sources dry-run without CDP', async () => {
        const tmpDir = mkdtempSync(join(tmpdir(), 'agbrowse-project-sources-cli-'));
        try {
            const file = join(tmpDir, 'source.txt');
            writeFileSync(file, 'source');
            const result = await execBrowser([
                'web-ai',
                'project-sources',
                'add',
                '--chatgpt-url',
                'https://chatgpt.com/g/project_123',
                '--file',
                file,
                '--dry-run',
                'summary',
                '--json',
            ]);
            expect(result.code).toBe(0);
            const parsed = JSON.parse(result.stdout);
            expect(parsed.ok).toBe(true);
            expect(parsed.uploads[0]).toMatchObject({ name: 'source.txt', uploaded: false });
        } finally {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
