import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execBrowser } from '../helpers/exec-browser.mjs';
import { installProjectLocalFakeRepomix } from '../helpers/fake-repomix-project.mjs';

const execFileAsync = promisify(execFile);
const BROWSER_SCRIPT = fileURLToPath(new URL('../../skills/browser/browser.mjs', import.meta.url));

async function execBrowserFromCwd(args, cwd, env = {}) {
    try {
        const result = await execFileAsync(process.execPath, [BROWSER_SCRIPT, ...args], {
            cwd,
            env: {
                ...process.env,
                AGBROWSE_UPDATE_CHECK: '0',
                ...env,
            },
            timeout: 45_000,
            maxBuffer: 1024 * 1024,
        });
        return { code: 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
    } catch (error) {
        return {
            code: error.status ?? (typeof error.code === 'number' ? error.code : 1),
            stdout: String(error.stdout || '').trim(),
            stderr: String(error.stderr || '').trim(),
        };
    }
}

describe('web-ai CLI contract', () => {
    it('shows detailed web-ai help without requiring a prompt', async () => {
        const result = await execBrowser(['web-ai', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('Agent skill setup:');
        expect(result.stdout).toContain('agbrowse skills get web-ai');
        expect(result.stdout).toContain('agbrowse skills install --target <dir>');
        expect(result.stdout).toContain('Provider:');
        expect(result.stdout).toContain('--context-from-files');
        expect(result.stdout).toContain('--effort <alias>');
        expect(result.stdout).toContain('--family <alias>');
        expect(result.stdout).toContain('ChatGPT: instant, thinking, pro');
        expect(result.stdout).toContain('Tab lease policy:');
        expect(result.stdout).toContain('leaseClosedTabs');
        expect(result.stdout).toContain('mcp-server');
        expect(result.stdout).toContain('auto-start headed Chrome');
        expect(result.stdout).toContain('AGBROWSE_WEB_AI_AUTO_START=0');
        expect(result.stdout).toContain('project-sources');
        expect(result.stdout).toContain('--output-image <path>');
        expect(result.stdout).toContain('--follow-up <text>');
        expect(result.stdout).toContain('--research deep');
        expect(result.stdout).toContain("Keeps Deep Research's default source state");
        expect(result.stdout).toContain('Apps/Sites/connectors are not configured');
        expect(result.stdout).toContain('--max-upload-file-size <bytes>');
        expect(result.stdout).toContain('--attachment-upload-timeout-ms <ms>');
        expect(result.stdout).toContain('--max-context-file-size <bytes>');
        expect(result.stdout).toContain('--context-transform <raw|repomix>');
        expect(result.stdout).toContain('(default: raw)');
        expect(result.stdout).toContain('context.transform-invalid');
        expect(result.stdout).toContain('context.transform-failed');
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
        expect(result.stdout).toContain('--context-transform <raw|repomix>');
        expect(result.stdout).toContain('Default: raw');
        expect(result.stdout).toContain('PLAN.md or 00_plan.md');
        expect(result.stdout).toContain('turn_plan.update_turn_plan');
        expect(result.stdout).toContain('MACHINE: /mnt/data/result.zip');
    });

    it('shows the context transform option in root help', async () => {
        const result = await execBrowser(['--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('--context-transform <raw|repomix>');
        expect(result.stdout).toContain('Default raw');
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

    it('rejects non-ChatGPT code mode before browser startup with a structured JSON error', async () => {
        const result = await execBrowser(['web-ai', 'code', '--vendor', 'gemini', '--prompt', 'x', '--json'], {
            env: { AGBROWSE_WEB_AI_AUTO_START: '0' },
        });
        expect(result.code).not.toBe(0);
        const parsed = JSON.parse(result.stderr);
        expect(parsed.error.errorCode).toBe('code-mode.vendor-unsupported');
        expect(parsed.error.retryHint).toBe('use-chatgpt');
        expect(parsed.error.mutationAllowed).toBe(false);
    });

    it('rejects non-ChatGPT code extraction before browser startup with a structured JSON error', async () => {
        const result = await execBrowser(['web-ai', 'code-extract', '--vendor', 'grok', '--conversation', 'conv-abc', '--json'], {
            env: { AGBROWSE_WEB_AI_AUTO_START: '0' },
        });
        expect(result.code).not.toBe(0);
        const parsed = JSON.parse(result.stderr);
        expect(parsed.error.errorCode).toBe('code-mode.vendor-unsupported');
        expect(parsed.error.stage).toBe('code-extract');
        expect(parsed.error.mutationAllowed).toBe(false);
    });

    it('rejects code mode without a prompt before browser startup', async () => {
        const result = await execBrowser(['web-ai', 'code', '--vendor', 'chatgpt', '--json'], {
            env: { AGBROWSE_WEB_AI_AUTO_START: '0' },
        });
        expect(result.code).not.toBe(0);
        const parsed = JSON.parse(result.stderr);
        expect(parsed.error.errorCode).toBe('code-mode.prompt-missing');
        expect(parsed.error.retryHint).toBe('add-prompt');
    });

    it('rejects multi-zip with output-zip before browser startup', async () => {
        const result = await execBrowser(['web-ai', 'code', '--vendor', 'chatgpt', '--prompt', 'x', '--multi-zip', '--output-zip', './result.zip', '--json'], {
            env: { AGBROWSE_WEB_AI_AUTO_START: '0' },
        });
        expect(result.code).not.toBe(0);
        const parsed = JSON.parse(result.stderr);
        expect(parsed.error.errorCode).toBe('code-mode.output-conflict');
        expect(parsed.error.retryHint).toBe('use-output-dir');
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

    it('allows repomix cwd packing through send/query preflight without file selectors', async () => {
        const result = await execBrowser([
            'web-ai',
            'query',
            '--vendor',
            'chatgpt',
            '--prompt',
            'hello',
            '--context-transform',
            'repomix',
            '--model',
            'deepthink',
        ]);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported ChatGPT model selection');
        expect(result.stderr).not.toContain('--inline-only');
    });

    it('rejects Repomix for Grok before browser startup without changing raw Grok render', async () => {
        const repomix = await execBrowser([
            'web-ai',
            'render',
            '--vendor',
            'grok',
            '--prompt',
            'hello',
            '--context-transform',
            'repomix',
            '--json',
        ], { env: { AGBROWSE_WEB_AI_AUTO_START: '0' } });
        const raw = await execBrowser([
            'web-ai',
            'render',
            '--vendor',
            'grok',
            '--prompt',
            'hello',
            '--context-transform',
            'raw',
            '--json',
        ]);

        expect(repomix.code).not.toBe(0);
        expect(JSON.parse(repomix.stderr).error).toMatchObject({
            errorCode: 'capability.unsupported',
            stage: 'context-transform',
            vendor: 'grok',
            mutationAllowed: false,
        });
        expect(raw.code).toBe(0);
        expect(JSON.parse(raw.stdout).contextTransform).toBeUndefined();
    });

    it('fails Repomix preparation before browser startup or tab mutation', async () => {
        const projectDir = mkdtempSync(join(tmpdir(), 'agbrowse-repomix-prebrowser-'));
        const browserHome = join(projectDir, '.browser-home');
        try {
            writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'fixture-project', private: true }));
            await installProjectLocalFakeRepomix(projectDir, { incompatible: true });

            const result = await execBrowserFromCwd([
                'web-ai',
                'query',
                '--vendor',
                'chatgpt',
                '--prompt',
                'hello',
                '--context-transform',
                'repomix',
                '--json',
            ], projectDir, {
                BROWSER_AGENT_HOME: browserHome,
                AGBROWSE_WEB_AI_AUTO_START: '0',
            });

            expect(result.code).not.toBe(0);
            expect(JSON.parse(result.stderr).error).toMatchObject({
                errorCode: 'context.transform-failed',
                stage: 'context-transform',
            });
            expect(result.stderr).not.toContain('headed Chrome');
        } finally {
            rmSync(projectDir, { recursive: true, force: true });
        }
    });

    it('does not default --model for chatgpt when omitted', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello']);
        expect(result.code).toBe(0);
        expect(result.stderr).not.toContain('unsupported');

        const effortWithoutModel = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--effort', 'extended']);
        expect(effortWithoutModel.code).toBe(0);
        expect(effortWithoutModel.stderr).not.toContain('reasoning effort requires --model');
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
        expect(effortOnly.code).toBe(0);
        expect(effortOnly.stderr).not.toContain('reasoning effort requires --model');

        const proHeavy = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', 'heavy']);
        expect(proHeavy.code).not.toBe(0);
        expect(proHeavy.stderr).toContain('unsupported ChatGPT reasoning effort');

        const invalid = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', 'maximum']);
        expect(invalid.code).not.toBe(0);
        expect(invalid.stderr).toContain('unsupported ChatGPT reasoning effort');
    });

    it('accepts canonical ChatGPT effort values medium/high/xhigh for thinking', async () => {
        for (const effort of ['medium', 'high', 'xhigh']) {
            const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'thinking', '--effort', effort]);
            expect(result.code).toBe(0);
            expect(result.stderr).not.toContain('unsupported');
        }
    });

    it('accepts legacy effort aliases for thinking: light/low/standard/normal/regular/default/extended/heavy/extra-high', async () => {
        for (const effort of ['light', 'low', 'standard', 'normal', 'regular', 'default', 'extended', 'heavy', 'extra-high']) {
            const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'thinking', '--effort', effort]);
            expect(result.code).toBe(0);
            expect(result.stderr).not.toContain('unsupported');
        }
    });

    it('accepts Pro legacy efforts standard/normal/regular/default/extended but rejects medium/high/xhigh/light/heavy', async () => {
        for (const effort of ['standard', 'normal', 'regular', 'default', 'extended']) {
            const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', effort]);
            expect(result.code).toBe(0);
        }
        for (const effort of ['medium', 'high', 'xhigh', 'light', 'heavy']) {
            const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'pro', '--effort', effort]);
            expect(result.code).not.toBe(0);
            expect(result.stderr).toContain('unsupported');
        }
    });

    it('rejects instant with any effort', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'instant', '--effort', 'medium']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported');
    });

    it('rejects --model gpt-5.6-sol (should use --family)', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--model', 'gpt-5.6-sol']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('unsupported ChatGPT model selection');
    });

    it('parses ChatGPT --family independently from the tier model', async () => {
        const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hello', '--family', 'gpt-5.6-sol', '--model', 'thinking']);
        expect(result.code).toBe(0);
        expect(result.stderr).not.toContain('unsupported');

        const cliSrc = readFileSync(join(process.cwd(), 'web-ai', 'cli.mjs'), 'utf8');
        expect(cliSrc).toContain('model: values.model');
        expect(cliSrc).toContain('family: values.family');
    });

    it('keeps model-less effort ChatGPT-only', async () => {
        for (const vendor of ['gemini', 'grok']) {
            const result = await execBrowser(['web-ai', 'render', '--vendor', vendor, '--prompt', 'hello', '--effort', 'high']);
            expect(result.code).not.toBe(0);
            expect(result.stderr).toContain('reasoning effort requires --model');
        }
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
        expect(parsed.contextTransform).toBeUndefined();
        expect(parsed.attachments).toHaveLength(1);
        expect(parsed.files[0].relativePath).toBe('web-ai/question.mjs');
        expect(parsed.composerText).toBeUndefined();
    });

    it('normalizes omitted context transform to byte-identical explicit raw JSON', async () => {
        const args = [
            'web-ai',
            'context-dry-run',
            '--vendor',
            'chatgpt',
            '--prompt',
            'review context',
            '--context-from-files',
            'web-ai/question.mjs',
            '--context-transport',
            'inline',
            '--json',
        ];
        const omitted = await execBrowser(args);
        const explicitRaw = await execBrowser([...args, '--context-transform', 'raw']);

        expect(omitted.code).toBe(0);
        expect(explicitRaw.code).toBe(0);
        expect(explicitRaw.stdout).toBe(omitted.stdout);
        expect(JSON.parse(omitted.stdout).contextTransform).toBeUndefined();
    });

    it('rejects an invalid context transform before context processing with structured JSON', async () => {
        const result = await execBrowser([
            'web-ai',
            'context-dry-run',
            '--prompt',
            'review context',
            '--context-from-files',
            'does-not-exist.mjs',
            '--context-transform',
            'brotli',
            '--json',
        ]);

        expect(result.code).not.toBe(0);
        const parsed = JSON.parse(result.stderr);
        expect(parsed.error.errorCode).toBe('context.transform-invalid');
        expect(parsed.error.stage).toBe('context-transform');
        const evidence = JSON.stringify(parsed.error.evidence);
        expect(evidence).toContain('brotli');
        expect(evidence).toContain('raw');
        expect(evidence).toContain('repomix');
        expect(evidence).not.toContain('does-not-exist.mjs');
    });

    it('rejects an explicitly empty context transform before context processing', async () => {
        const result = await execBrowser([
            'web-ai',
            'context-dry-run',
            '--prompt',
            'review context',
            '--context-from-files',
            'does-not-exist.mjs',
            '--context-transform=',
            '--json',
        ]);

        expect(result.code).not.toBe(0);
        const parsed = JSON.parse(result.stderr);
        expect(parsed.error).toMatchObject({
            errorCode: 'context.transform-invalid',
            stage: 'context-transform',
            evidence: {
                supplied: '',
                supported: ['raw', 'repomix'],
            },
        });
        expect(result.stderr).not.toContain('does-not-exist.mjs');
    });

    it('adds a human summary transform line only for repomix', async () => {
        const projectDir = mkdtempSync(join(tmpdir(), 'agbrowse-context-transform-cli-'));
        const browserHome = join(projectDir, '.browser-home');
        try {
            writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'fixture-project', private: true }));
            writeFileSync(join(projectDir, 'sample.js'), 'export function sample() { return 1; }\n');
            await installProjectLocalFakeRepomix(projectDir, {
                outputs: [{ name: 'configured-context.md', content: '# packed context\n' }],
            });

            const args = [
                'web-ai',
                'context-dry-run',
                '--prompt',
                'review context',
                '--context-from-files',
                'sample.js',
                '--context-transport',
                'inline',
            ];
            const raw = await execBrowserFromCwd(args, projectDir, { BROWSER_AGENT_HOME: browserHome });
            const repomix = await execBrowserFromCwd(
                [...args, '--context-transform', 'repomix'],
                projectDir,
                { BROWSER_AGENT_HOME: browserHome },
            );
            const deepRender = await execBrowserFromCwd([
                'web-ai',
                'render',
                '--prompt',
                'review context',
                '--research',
                'deep',
                '--context-from-files',
                'sample.js',
                '--context-transport',
                'inline',
                '--context-transform',
                'repomix',
            ], projectDir, { BROWSER_AGENT_HOME: browserHome });

            expect(raw.code).toBe(0);
            expect(raw.stdout).not.toContain('[context-dry-run] transform:');
            expect(repomix.code).toBe(0);
            expect(repomix.stdout).toContain('[context-dry-run] transform: repomix');
            expect(deepRender.code).toBe(0);
            expect(deepRender.stdout).toContain('export function sample()');
            expect(deepRender.stdout).not.toContain('[CONTEXT TRANSFORM]');
            expect(deepRender.stdout).not.toContain('# packed context');
        } finally {
            rmSync(projectDir, { recursive: true, force: true });
        }
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

// 04: Work send CLI contract
describe('web-ai work send CLI', () => {
    it('rejects work send without --prompt', async () => {
        const result = await execBrowser(['web-ai', 'work', 'send', '--power', '3']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('--prompt is required');
    });

    it('rejects work send without --power', async () => {
        const result = await execBrowser(['web-ai', 'work', 'send', '--prompt', 'hello']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('--power is required');
    });

    it('rejects invalid power (0)', async () => {
        const result = await execBrowser(['web-ai', 'work', 'send', '--prompt', 'hello', '--power', '0']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('1..6');
    });

    it('rejects invalid power (7)', async () => {
        const result = await execBrowser(['web-ai', 'work', 'send', '--prompt', 'hello', '--power', '7']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('1..6');
    });

    it('rejects invalid speed', async () => {
        const result = await execBrowser(['web-ai', 'work', 'send', '--prompt', 'hello', '--power', '3', '--speed', 'turbo']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('standard');
    });

    it('rejects unknown work subcommand', async () => {
        const result = await execBrowser(['web-ai', 'work', 'query']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('Unknown work subcommand');
    });
});
