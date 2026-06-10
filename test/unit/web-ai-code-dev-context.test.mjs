import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    ensureCodeDevContextZip,
    GPT_DEV_AGENT_CONTEXT_MANIFEST_ENTRY,
    GPT_DEV_AGENT_CONTEXT_MARKDOWN_ENTRY,
    readCodeDevContextManifest,
    resolveCodeDevContextPaths,
} from '../../web-ai/code-dev-context.mjs';
import { readZipTextEntry, verifyZipBuffer } from '../../web-ai/code-artifact.mjs';

describe('code dev-agent context bundle', () => {
    it('resolves package skill-module paths without relying on caller cwd', async () => {
        const before = process.cwd();
        const outside = mkdtempSync(join(tmpdir(), 'agbrowse-non-cwd-'));
        try {
            process.chdir(outside);
            const paths = resolveCodeDevContextPaths();
            expect(paths.markdownPath).toMatch(/skills\/web-ai\/modules\/gpt-dev-agent-context\.md$/);
            expect(paths.zipPath).toMatch(/skills\/web-ai\/modules\/gpt-dev-agent-context\.zip$/);
            expect(await readFile(paths.markdownPath, 'utf8')).toContain('GPT Dev-Agent Context');
        } finally {
            process.chdir(before);
            rmSync(outside, { recursive: true, force: true });
        }
    });

    it('ensures a saved zip with markdown and manifest entries', async () => {
        const result = await ensureCodeDevContextZip();
        expect(result.path).toMatch(/gpt-dev-agent-context\.zip$/);
        expect((await stat(result.path)).size).toBeGreaterThan(100);

        const buffer = await readFile(result.path);
        const verified = verifyZipBuffer(buffer);
        expect(verified.files).toContain(GPT_DEV_AGENT_CONTEXT_MARKDOWN_ENTRY);
        expect(verified.files).toContain(GPT_DEV_AGENT_CONTEXT_MANIFEST_ENTRY);
        const contextMarkdown = readZipTextEntry(buffer, GPT_DEV_AGENT_CONTEXT_MARKDOWN_ENTRY);
        expect(contextMarkdown).toContain('Linux sandbox');
        expect(contextMarkdown).toContain('turn_plan.update_turn_plan');
        expect(contextMarkdown).toContain('visible todo UI may disappear');

        const manifest = await readCodeDevContextManifest(result.path);
        expect(manifest.name).toBe('gpt-dev-agent-context');
        expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
});
