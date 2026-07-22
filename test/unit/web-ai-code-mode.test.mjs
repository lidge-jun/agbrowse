import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codeWebAi, extractCodeArtifacts, extractConversationId } from '../../web-ai/code-mode.mjs';
import { buildCodeModePrompt } from '../../web-ai/code-mode-prompt.mjs';

const FIXTURE_ZIP_B64 = 'UEsDBAoAAAAAAO41y1w9+YHGFAAAABQAAAAHABwAUExBTi5tZFVUCQADcNspanDbKWp1eAsAAQT1AQAABBQAAAAjIFBsYW4KLSBbIF0gdmVyaWZ5ClBLAwQKAAAAAADuNctcIDA6NgYAAAAGAAAACQAcAFJFQURNRS5tZFVUCQADcNspanDbKWp1eAsAAQT1AQAABBQAAABoZWxsbwpQSwMECgAAAAAA7jXLXAfu/XEPAAAADwAAAAgAHABzcmMvYS5qc1VUCQADcNspanDbKWp1eAsAAQT1AQAABBQAAABjb25zb2xlLmxvZygxKQpQSwECHgMKAAAAAADuNctcPfmBxhQAAAAUAAAABwAYAAAAAAABAAAApIEAAAAAUExBTi5tZFVUBQADcNspanV4CwABBPUBAAAEFAAAAFBLAQIeAwoAAAAAAO41y1wgMDo2BgAAAAYAAAAJABgAAAAAAAEAAACkgVUAAABSRUFETUUubWRVVAUAA3DbKWp1eAsAAQT1AQAABBQAAABQSwECHgMKAAAAAADuNctcB+79cQ8AAAAPAAAACAAYAAAAAAABAAAApIGeAAAAc3JjL2EuanNVVAUAA3DbKWp1eAsAAQT1AQAABBQAAABQSwUGAAAAAAMAAwDqAAAA7wAAAAAA';

function conversationFixture() {
    return {
        mapping: {
            a: { message: { id: 'mid-code', content: { content_type: 'code', text: 'zip ...' } } },
            b: { message: { id: 'mid-final', content: { content_type: 'text', parts: ['/mnt/data/result.zip'] } } },
        },
    };
}

// Page whose evaluate serves conversation JSON, a presigned URL, and the binary.
function makePage(url) {
    return {
        url: () => url,
        evaluate: async (_fn, arg) => {
            if (typeof arg === 'string' && arg.startsWith('http')) return { status: 200, base64: FIXTURE_ZIP_B64 };
            if (typeof arg === 'string') return conversationFixture();
            if (arg && typeof arg === 'object' && 'messageId' in arg) return 'https://chatgpt.com/estuary?sig=1';
            return null;
        },
    };
}

describe('extractConversationId', () => {
    it('pulls the id from a chatgpt conversation url', () => {
        expect(extractConversationId('https://chatgpt.com/c/6a29932e-4848-83aa-871b-3850096c0224')).toBe('6a29932e-4848-83aa-871b-3850096c0224');
        expect(extractConversationId('6a29932e-4848-83aa-871b-3850096c0224')).toBe('6a29932e-4848-83aa-871b-3850096c0224');
        expect(extractConversationId('https://chatgpt.com/')).toBeNull();
        expect(extractConversationId(null)).toBeNull();
    });
});

describe('extractCodeArtifacts', () => {
    const outputZip = join(tmpdir(), 'code-extract-test', 'out.zip');

    it('retrieves from an existing conversation URL without sending a prompt', async () => {
        rmSync(outputZip, { force: true });
        let gotoUrl = null;
        const page = {
            url: () => 'https://example.com/',
            goto: async (url) => { gotoUrl = url; },
            evaluate: async (_fn, arg) => {
                if (typeof arg === 'string' && arg.startsWith('http')) return { status: 200, base64: FIXTURE_ZIP_B64 };
                if (typeof arg === 'string') return conversationFixture();
                if (arg && typeof arg === 'object' && 'messageId' in arg) return 'https://chatgpt.com/estuary?sig=1';
                return null;
            },
        };
        const result = await extractCodeArtifacts({ getPage: async () => page }, {
            vendor: 'chatgpt',
            url: 'https://chatgpt.com/c/conv-abc',
            outputZip,
        });
        expect(result.ok).toBe(true);
        expect(gotoUrl).toBe('https://chatgpt.com/c/conv-abc');
        expect(result.conversationId).toBe('conv-abc');
        expect(result.artifact.files).toContain('src/a.js');
        expect(existsSync(outputZip)).toBe(true);
    });

    it('retrieves from the current ChatGPT tab when only the assistant text contains the zip path', async () => {
        rmSync(outputZip, { force: true });
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const result = await extractCodeArtifacts({ getPage: async () => page }, {
            vendor: 'chatgpt',
            outputZip,
        });
        expect(result.ok).toBe(true);
        expect(result.artifact.zipPath).toBe('/mnt/data/result.zip');
        expect(existsSync(outputZip)).toBe(true);
    });

    it('reports a clear error when no conversation id is available', async () => {
        const page = makePage('https://chatgpt.com/');
        const result = await extractCodeArtifacts({ getPage: async () => page }, { vendor: 'chatgpt', outputZip });
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('code-extract.conversation-id-missing');
    });

    it('wraps navigation failures in a structured extraction error', async () => {
        const page = {
            url: () => 'https://example.com/',
            goto: async () => { throw new Error('navigation timeout'); },
            evaluate: async () => null,
        };
        const result = await extractCodeArtifacts({ getPage: async () => page }, {
            vendor: 'chatgpt',
            url: 'https://chatgpt.com/c/conv-abc',
            outputZip,
        });
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('code-extract.navigation-failed');
        expect(result.errorMessage).toContain('navigation timeout');
    });
});

describe('codeWebAi', () => {
    const outputZip = join(tmpdir(), 'code-mode-test', 'out.zip');

    function services(queryResult) {
        return {
            queryWebAi: async () => queryResult,
            getSession: () => ({ conversationUrl: 'https://chatgpt.com/c/conv-abc' }),
        };
    }

    it('rejects non-chatgpt vendors', async () => {
        await expect(codeWebAi({}, { vendor: 'gemini', prompt: 'x' }, services({ ok: true })))
            .rejects.toThrow(/ChatGPT-only/);
    });

    it('runs query then retrieves and verifies the artifact', async () => {
        rmSync(outputZip, { force: true });
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const deps = { getPage: async () => page };
        const result = await codeWebAi(deps, { vendor: 'chatgpt', prompt: 'ping API', outputZip }, services({
            ok: true, sessionId: 's1', answerText: '/mnt/data/result.zip', warnings: [],
        }));
        expect(result.ok).toBe(true);
        expect(result.artifact.files).toContain('src/a.js');
        expect(result.artifact.hasPlanArtifact).toBe(true);
        expect(result.codeContextAttached).toBe(true);
        expect(result.codeContextZip).toMatch(/gpt-dev-agent-context\.zip$/);
        expect(result.compliance.compliant).toBe(true);
        expect(existsSync(outputZip)).toBe(true);
        expect(readFileSync(outputZip).length).toBe(result.artifact.sizeBytes);
    });

    it('prepends the automatic context zip before caller-provided files', async () => {
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const deps = { getPage: async () => page };
        let sentInput = null;
        const result = await codeWebAi(deps, {
            vendor: 'chatgpt',
            prompt: 'ping API',
            outputZip,
            filePaths: ['/tmp/user.png', '/tmp/spec.txt'],
        }, {
            queryWebAi: async (_deps, input) => {
                sentInput = input;
                return { ok: true, sessionId: 's1', answerText: '/mnt/data/result.zip', warnings: [] };
            },
            getSession: () => ({ conversationUrl: 'https://chatgpt.com/c/conv-abc' }),
        });
        expect(result.ok).toBe(true);
        expect(sentInput.inlineOnly).toBe(false);
        expect(sentInput.attachmentPolicy).toBe('upload');
        expect(sentInput.filePaths[0]).toMatch(/gpt-dev-agent-context\.zip$/);
        expect(sentInput.filePaths.slice(1)).toEqual(['/tmp/user.png', '/tmp/spec.txt']);
    });

    it('keeps Repomix CLI preparation aligned with the code-mode prompt contract', async () => {
        const requirements = 'fullstack parity fixture';
        let sentInput = null;
        await codeWebAi({}, { vendor: 'chatgpt', prompt: requirements, multiZip: true }, {
            queryWebAi: async (_deps, input) => {
                sentInput = input;
                return { ok: false, errorCode: 'test-stop' };
            },
            getSession: () => null,
        });

        expect(sentInput).toMatchObject({
            prompt: buildCodeModePrompt(requirements, { multiZip: true }),
            inlineOnly: false,
        });

        const cliSource = readFileSync(new URL('../../web-ai/cli.mjs', import.meta.url), 'utf8');
        const precomputeBlock = cliSource.match(
            /input\.preparedContextPack = await prepareContextForBrowser\(\{[\s\S]*?\n\s*\}\);/,
        )?.[0] || '';
        expect(precomputeBlock).toMatch(
            /prompt:\s*command === 'code'\s*\?\s*buildCodeModePrompt\(input\.prompt, \{ multiZip: input\.multiZip === true \}\)\s*:\s*input\.prompt/,
        );
        expect(precomputeBlock).toContain("inlineOnly: command === 'code' ? false : input.inlineOnly");
    });

    it('skips the context zip on a continuation turn (existing conversation url)', async () => {
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const deps = { getPage: async () => page };
        let sentInput = null;
        const result = await codeWebAi(deps, {
            vendor: 'chatgpt',
            prompt: 'next drop',
            url: 'https://chatgpt.com/c/conv-abc',
            outputZip,
            filePaths: ['/tmp/tree.zip'],
        }, {
            queryWebAi: async (_deps, input) => {
                sentInput = input;
                return { ok: true, sessionId: 's1', answerText: '/mnt/data/result.zip', warnings: [] };
            },
            getSession: () => ({ conversationUrl: 'https://chatgpt.com/c/conv-abc' }),
        });
        expect(result.ok).toBe(true);
        expect(result.codeContextAttached).toBe(false);
        expect(result.codeContextZip).toBeNull();
        expect(sentInput.filePaths).toEqual(['/tmp/tree.zip']);
        expect(sentInput.attachmentPolicy).toBe('upload');
    });

    it('skips the context zip when resuming a recorded session, with inline-only fallback when no files remain', async () => {
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const deps = { getPage: async () => page };
        let sentInput = null;
        const result = await codeWebAi(deps, {
            vendor: 'chatgpt',
            prompt: 'follow-up question',
            session: '01SESSION',
            outputZip,
        }, {
            queryWebAi: async (_deps, input) => {
                sentInput = input;
                return { ok: true, sessionId: 's1', answerText: '/mnt/data/result.zip', warnings: [] };
            },
            getSession: () => ({ conversationUrl: 'https://chatgpt.com/c/conv-abc' }),
        });
        expect(result.ok).toBe(true);
        expect(result.codeContextAttached).toBe(false);
        expect(sentInput.filePaths).toEqual([]);
        expect(sentInput.attachmentPolicy).toBe('inline-only');
    });

    it('re-attaches the context zip on continuation when contextRefresh is forced', async () => {
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const deps = { getPage: async () => page };
        let sentInput = null;
        const result = await codeWebAi(deps, {
            vendor: 'chatgpt',
            prompt: 'next drop',
            url: 'https://chatgpt.com/c/conv-abc',
            contextRefresh: true,
            outputZip,
        }, {
            queryWebAi: async (_deps, input) => {
                sentInput = input;
                return { ok: true, sessionId: 's1', answerText: '/mnt/data/result.zip', warnings: [] };
            },
            getSession: () => ({ conversationUrl: 'https://chatgpt.com/c/conv-abc' }),
        });
        expect(result.ok).toBe(true);
        expect(result.codeContextAttached).toBe(true);
        expect(sentInput.filePaths[0]).toMatch(/gpt-dev-agent-context\.zip$/);
    });

    it('flags contract drift when the answer is chatty but still retrieves', async () => {
        const page = makePage('https://chatgpt.com/c/conv-abc');
        const deps = { getPage: async () => page };
        const result = await codeWebAi(deps, { vendor: 'chatgpt', prompt: 'ping API', outputZip }, services({
            ok: true, sessionId: 's1', answerText: 'Done! see /mnt/data/result.zip', warnings: [],
        }));
        expect(result.ok).toBe(true);
        expect(result.warnings).toContain('code-mode:contract-drift');
    });

    it('passes through a failed query result untouched', async () => {
        const result = await codeWebAi({ getPage: async () => makePage('') }, { vendor: 'chatgpt', prompt: 'x' }, services({ ok: false, errorCode: 'provider.timeout' }));
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('provider.timeout');
    });

    it('retrieves multiple zips into outputDir when multiZip is set', async () => {
        const outputDir = join(tmpdir(), 'code-mode-multi');
        rmSync(outputDir, { force: true, recursive: true });
        const conversation = { mapping: {
            a: { message: { id: 'mid-code', content: { content_type: 'code', text: '/mnt/data/a.zip /mnt/data/b.zip' } } },
            b: { message: { id: 'mid-final', content: { content_type: 'text', parts: ['/mnt/data/a.zip\n/mnt/data/b.zip'] } } },
        } };
        let lastSandbox = null;
        const page = {
            url: () => 'https://chatgpt.com/c/conv-abc',
            evaluate: async (_fn, arg) => {
                if (typeof arg === 'string' && arg.startsWith('http')) return { status: 200, base64: FIXTURE_ZIP_B64 };
                if (typeof arg === 'string') return conversation;
                if (arg && typeof arg === 'object' && 'sandboxPath' in arg) { lastSandbox = arg.sandboxPath; return 'https://chatgpt.com/e?p=' + lastSandbox; }
                return null;
            },
        };
        const deps = { getPage: async () => page };
        const result = await codeWebAi(deps, { vendor: 'chatgpt', prompt: 'fullstack', multiZip: true, outputDir }, {
            queryWebAi: async () => ({ ok: true, sessionId: 's1', answerText: '/mnt/data/a.zip\n/mnt/data/b.zip', warnings: [] }),
            getSession: () => ({ conversationUrl: 'https://chatgpt.com/c/conv-abc' }),
        });
        expect(result.ok).toBe(true);
        expect(result.artifacts).toHaveLength(2);
        expect(existsSync(join(outputDir, 'a.zip'))).toBe(true);
        expect(existsSync(join(outputDir, 'b.zip'))).toBe(true);
    });

    it('errors when no conversation id can be resolved', async () => {
        const page = makePage('https://chatgpt.com/');
        const deps = { getPage: async () => page };
        const result = await codeWebAi(deps, { vendor: 'chatgpt', prompt: 'x', outputZip }, {
            queryWebAi: async () => ({ ok: true, sessionId: 's1', answerText: '/mnt/data/result.zip', warnings: [] }),
            getSession: () => ({ conversationUrl: null, url: null }),
        });
        expect(result.ok).toBe(false);
        expect(result.errorCode).toBe('code-mode.conversation-id-missing');
    });
});
