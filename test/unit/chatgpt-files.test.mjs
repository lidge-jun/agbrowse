import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    normalizeChatGptFileDownloadUrl,
    normalizeChatGptSandboxUrl,
    buildDownloadableFileDetectionExpression,
    dedupeDownloadCandidates,
    sanitizeDownloadFilename,
    filenameFromContentDisposition,
    resolveDownloadFilename,
    readAssistantDownloadableFiles,
} from '../../web-ai/chatgpt-files.mjs';

describe('normalizeChatGptFileDownloadUrl — allowed endpoints', () => {
    it('accepts /backend-api/files/<id>/download', () => {
        const out = normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/files/file_abc-123/download');
        expect(out).toBe('https://chatgpt.com/backend-api/files/file_abc-123/download');
    });

    it('accepts /backend-api/files/<id>/content', () => {
        const out = normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/files/file_abc/content');
        expect(out).toBe('https://chatgpt.com/backend-api/files/file_abc/content');
    });

    it('accepts /backend-api/estuary/content?id=file_...', () => {
        const out = normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/estuary/content?id=file_XYZ_9');
        expect(out).toBe('https://chatgpt.com/backend-api/estuary/content?id=file_XYZ_9');
    });

    it('accepts /backend-api/sandbox/download?path=/mnt/data/...', () => {
        const out = normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/sandbox/download?path=/mnt/data/result.csv');
        expect(out).not.toBeNull();
        const u = new URL(/** @type {string} */ (out));
        expect(u.pathname).toBe('/backend-api/sandbox/download');
        expect(u.searchParams.get('path')).toBe('/mnt/data/result.csv');
    });

    it('accepts the chat.openai.com host', () => {
        const out = normalizeChatGptFileDownloadUrl('https://chat.openai.com/backend-api/files/file_a/download');
        expect(out).toBe('https://chat.openai.com/backend-api/files/file_a/download');
    });

    it('resolves a root-relative href on the ChatGPT origin', () => {
        const out = normalizeChatGptFileDownloadUrl('/backend-api/files/file_rel/download');
        expect(out).toBe('https://chatgpt.com/backend-api/files/file_rel/download');
    });
});

describe('normalizeChatGptFileDownloadUrl — rejections', () => {
    it('rejects external hosts', () => {
        expect(normalizeChatGptFileDownloadUrl('https://evil.com/backend-api/files/file_a/download')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com.evil.com/backend-api/files/file_a/download')).toBeNull();
    });

    it('rejects non-HTTPS URLs', () => {
        expect(normalizeChatGptFileDownloadUrl('http://chatgpt.com/backend-api/files/file_a/download')).toBeNull();
    });

    it('rejects explicit ports', () => {
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com:8443/backend-api/files/file_a/download')).toBeNull();
    });

    it('rejects blob: and other schemes', () => {
        expect(normalizeChatGptFileDownloadUrl('blob:https://chatgpt.com/abc-def')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('data:text/csv;base64,AAA')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('file:///etc/passwd')).toBeNull();
    });

    it('rejects unknown ChatGPT paths', () => {
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/conversation/abc')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/')).toBeNull();
    });

    it('rejects path traversal (raw and encoded) in the sandbox path', () => {
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/sandbox/download?path=/mnt/data/../secret')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/sandbox/download?path=/mnt/data/%2e%2e/secret')).toBeNull();
    });

    it('rejects sandbox paths outside /mnt/data/', () => {
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/sandbox/download?path=/etc/passwd')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/sandbox/download')).toBeNull();
    });

    it('rejects backslashes and null bytes', () => {
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/files/file_a\\..\\x/download')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/files/file_a\0/download')).toBeNull();
    });

    it('rejects a malformed estuary id', () => {
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/estuary/content?id=notafile')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('https://chatgpt.com/backend-api/estuary/content')).toBeNull();
    });

    it('rejects non-string and empty input', () => {
        // @ts-expect-error intentional wrong type
        expect(normalizeChatGptFileDownloadUrl(null)).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('')).toBeNull();
        expect(normalizeChatGptFileDownloadUrl('   ')).toBeNull();
    });
});

describe('normalizeChatGptSandboxUrl', () => {
    it('converts sandbox:/mnt/data/<file> to a safe download URL', () => {
        const out = normalizeChatGptSandboxUrl('sandbox:/mnt/data/result.csv');
        expect(out).not.toBeNull();
        const u = new URL(/** @type {string} */ (out));
        expect(u.origin).toBe('https://chatgpt.com');
        expect(u.pathname).toBe('/backend-api/sandbox/download');
        expect(u.searchParams.get('path')).toBe('/mnt/data/result.csv');
    });

    it('rejects sandbox paths with traversal or outside /mnt/data/', () => {
        expect(normalizeChatGptSandboxUrl('sandbox:/mnt/data/../../etc/passwd')).toBeNull();
        expect(normalizeChatGptSandboxUrl('sandbox:/etc/passwd')).toBeNull();
        expect(normalizeChatGptSandboxUrl('sandbox:/mnt/data/x\\y')).toBeNull();
    });

    it('rejects non-sandbox input', () => {
        expect(normalizeChatGptSandboxUrl('https://chatgpt.com/backend-api/files/file_a/download')).toBeNull();
        // @ts-expect-error intentional wrong type
        expect(normalizeChatGptSandboxUrl(42)).toBeNull();
    });

    it('is reachable through normalizeChatGptFileDownloadUrl', () => {
        const viaMain = normalizeChatGptFileDownloadUrl('sandbox:/mnt/data/out.pdf');
        const direct = normalizeChatGptSandboxUrl('sandbox:/mnt/data/out.pdf');
        expect(viaMain).toBe(direct);
        expect(viaMain).not.toBeNull();
    });
});

describe('buildDownloadableFileDetectionExpression', () => {
    it('embeds the baseline assistant index', () => {
        expect(buildDownloadableFileDetectionExpression(3)).toContain('MIN_ASSISTANT_INDEX = 3');
    });

    it('clamps NaN and negative baselines to 0', () => {
        expect(buildDownloadableFileDetectionExpression(-5)).toContain('MIN_ASSISTANT_INDEX = 0');
        // @ts-expect-error intentional wrong type
        expect(buildDownloadableFileDetectionExpression('x')).toContain('MIN_ASSISTANT_INDEX = 0');
        expect(buildDownloadableFileDetectionExpression()).toContain('MIN_ASSISTANT_INDEX = 0');
    });

    it('scans conversation/assistant turns and anchors', () => {
        const expr = buildDownloadableFileDetectionExpression(0);
        expect(expr).toContain('conversation-turn');
        expect(expr).toContain('data-message-author-role');
        expect(expr).toContain("querySelectorAll('a[href], a[download]')");
    });
});

describe('dedupeDownloadCandidates', () => {
    it('keeps one entry per normalized URL and preserves download/text', () => {
        const out = dedupeDownloadCandidates([
            { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.csv', text: 'CSV' },
            { href: '/backend-api/files/file_a/download', download: 'a.csv', text: 'dup' },
            { href: 'https://chatgpt.com/backend-api/files/file_b/content', download: '', text: 'B' },
        ]);
        expect(out).toHaveLength(2);
        expect(out[0]).toEqual({
            sourceUrl: 'https://chatgpt.com/backend-api/files/file_a/download',
            download: 'a.csv',
            text: 'CSV',
        });
        expect(out[1].sourceUrl).toBe('https://chatgpt.com/backend-api/files/file_b/content');
    });

    it('drops disallowed hrefs', () => {
        const out = dedupeDownloadCandidates([
            { href: 'https://evil.com/backend-api/files/file_a/download' },
            { href: 'blob:https://chatgpt.com/abc' },
            { href: '#' },
        ]);
        expect(out).toEqual([]);
    });

    it('tolerates non-array input', () => {
        // @ts-expect-error intentional wrong type
        expect(dedupeDownloadCandidates(null)).toEqual([]);
    });
});

describe('sanitizeDownloadFilename', () => {
    it('strips directories and traversal', () => {
        expect(sanitizeDownloadFilename('a/b/c.csv')).toBe('c.csv');
        expect(sanitizeDownloadFilename('a\\b\\c.csv')).toBe('c.csv');
        expect(sanitizeDownloadFilename('../../etc/passwd')).toBe('passwd');
    });

    it('removes leading dots, reserved chars, and null bytes', () => {
        expect(sanitizeDownloadFilename('...hidden.txt')).toBe('hidden.txt');
        expect(sanitizeDownloadFilename('a<b>c.txt')).toBe('a_b_c.txt');
        expect(sanitizeDownloadFilename('x\0y.txt')).toBe('xy.txt');
    });

    it('returns empty for unusable names', () => {
        expect(sanitizeDownloadFilename('')).toBe('');
        expect(sanitizeDownloadFilename('.')).toBe('');
        // @ts-expect-error intentional wrong type
        expect(sanitizeDownloadFilename(null)).toBe('');
    });
});

describe('filenameFromContentDisposition', () => {
    it('parses a plain filename', () => {
        expect(filenameFromContentDisposition('attachment; filename="report.pdf"')).toBe('report.pdf');
    });

    it('prefers RFC 5987 filename* and decodes it', () => {
        expect(filenameFromContentDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")).toBe('résumé.pdf');
    });

    it('strips any path in the header filename', () => {
        expect(filenameFromContentDisposition('attachment; filename="../../etc/passwd"')).toBe('passwd');
    });

    it('returns null when no filename present', () => {
        expect(filenameFromContentDisposition('attachment')).toBeNull();
        expect(filenameFromContentDisposition('')).toBeNull();
        // @ts-expect-error intentional wrong type
        expect(filenameFromContentDisposition(null)).toBeNull();
    });
});

describe('resolveDownloadFilename', () => {
    it('prefers Content-Disposition over everything', () => {
        expect(resolveDownloadFilename({
            contentDisposition: 'attachment; filename="cd.csv"',
            downloadAttr: 'attr.csv',
            sourceUrl: 'https://chatgpt.com/backend-api/sandbox/download?path=/mnt/data/url.csv',
            index: 0,
        })).toBe('cd.csv');
    });

    it('falls back to the DOM download attribute', () => {
        expect(resolveDownloadFilename({ downloadAttr: 'attr.csv', sourceUrl: 'https://chatgpt.com/backend-api/files/file_a/download' })).toBe('attr.csv');
    });

    it('falls back to the sandbox path basename', () => {
        expect(resolveDownloadFilename({ sourceUrl: 'https://chatgpt.com/backend-api/sandbox/download?path=/mnt/data/data.zip' })).toBe('data.zip');
    });

    it('uses a generated name when nothing else is available', () => {
        expect(resolveDownloadFilename({ sourceUrl: 'https://chatgpt.com/backend-api/files/file_a/download', index: 2 })).toBe('chatgpt-file-3');
    });
});

describe('readAssistantDownloadableFiles', () => {
    const fakeCdp = (value) => ({ send: async () => ({ result: { value } }) });

    it('normalizes + dedupes returnByValue array results', async () => {
        const cdp = fakeCdp([
            { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.csv', text: 'A' },
            { href: '/backend-api/files/file_a/download', download: 'a.csv', text: 'dup' },
            { href: 'https://evil.com/x', download: '', text: 'bad' },
        ]);
        const out = await readAssistantDownloadableFiles(cdp, { baselineAssistantCount: 0 });
        expect(out).toHaveLength(1);
        expect(out[0].sourceUrl).toBe('https://chatgpt.com/backend-api/files/file_a/download');
    });

    it('parses a JSON-string value', async () => {
        const cdp = fakeCdp(JSON.stringify([{ href: 'https://chatgpt.com/backend-api/estuary/content?id=file_z' }]));
        const out = await readAssistantDownloadableFiles(cdp);
        expect(out).toHaveLength(1);
    });

    it('returns [] on malformed value', async () => {
        expect(await readAssistantDownloadableFiles(fakeCdp('not json'))).toEqual([]);
        expect(await readAssistantDownloadableFiles(fakeCdp(undefined))).toEqual([]);
    });
});

describe('saveAssistantDownloadableFiles', () => {
    let tmpHome;
    const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;

    beforeEach(async () => {
        const { mkdtempSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-files-'));
        process.env.BROWSER_AGENT_HOME = tmpHome;
        vi.resetModules();
    });

    afterEach(async () => {
        const { rmSync } = await import('node:fs');
        if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
        else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
        rmSync(tmpHome, { recursive: true, force: true });
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    /** Fake CDP session: candidates from Runtime.evaluate, cookies from Network.getCookies. */
    const fakeCdp = (candidates) => ({
        send: async (method) => {
            if (method === 'Network.getCookies') return { cookies: [{ name: 's', value: '1' }] };
            return { result: { value: candidates } };
        },
    });

    const okResponse = (body, headers = {}) => ({
        ok: true,
        headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
        arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    });

    it('downloads sequentially and saves file artifacts', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        vi.stubGlobal('fetch', vi.fn(async (url) => {
            if (String(url).includes('files/file_a')) return okResponse('a,b\n1,2', { 'content-disposition': 'attachment; filename="report.csv"', 'content-type': 'text/csv' });
            return okResponse('PKzip', { 'content-type': 'application/zip' });
        }));

        const cdp = fakeCdp([
            { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: '', text: 'csv' },
            { href: 'https://chatgpt.com/backend-api/sandbox/download?path=/mnt/data/data.zip', download: '', text: 'zip' },
        ]);
        const out = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, baselineAssistantCount: 0 });
        expect(out.ok).toBe(true);
        expect(out.files.map((f) => f.path)).toEqual(['report.csv', 'data.zip']);
        expect(getSession(session.sessionId).artifacts).toHaveLength(2);
    });

    it('stops attribution after a timeout (late completions not attached to next file)', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        vi.stubGlobal('fetch', vi.fn((url, opts) => {
            if (String(url).includes('file_a')) return Promise.resolve(okResponse('ok', { 'content-type': 'text/plain' }));
            // file_b hangs until aborted by the per-download timeout
            return new Promise((_, reject) => {
                opts.signal.addEventListener('abort', () => {
                    const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
                });
            });
        }));

        const cdp = fakeCdp([
            { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' },
            { href: 'https://chatgpt.com/backend-api/files/file_b/download', download: 'b.txt', text: '' },
            { href: 'https://chatgpt.com/backend-api/files/file_c/download', download: 'c.txt', text: '' },
        ]);
        const out = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, perDownloadTimeoutMs: 20 });
        expect(out.files.map((f) => f.path)).toEqual(['a.txt']);
        expect(out.warnings.some((w) => w.startsWith('file-artifact-timeout:'))).toBe(true);
        expect(out.warnings.some((w) => w.startsWith('file-artifact-skipped-after-timeout:'))).toBe(true);
    });

    it('warns and saves nothing without a sessionId', async () => {
        const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
        vi.stubGlobal('fetch', vi.fn(async () => okResponse('x')));
        const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download' }]);
        const out = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: null });
        expect(out.files).toEqual([]);
        expect(out.warnings).toContain('file-artifact-no-session');
    });

    it('warns on a non-ok fetch and skips that file', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) })));
        const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download' }]);
        const out = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId });
        expect(out.files).toEqual([]);
        expect(out.warnings.some((w) => w.startsWith('file-artifact-fetch-failed:'))).toBe(true);
    });

    /**
     * `strict` is the require-all path. The assertions below are about the
     * DIFFERENCE from the opportunistic path above: same inputs, different
     * verdicts, because the caller asked for the files.
     */
    describe('strict (require-all)', () => {
        it('F1: a malformed detection is a failure, not an empty answer', async () => {
            const { createSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            const out = await saveAssistantDownloadableFiles(fakeCdp('not json'), {}, {
                sessionId: session.sessionId, strict: true,
            });
            expect(out.ok).toBe(false);
            expect(out.errors[0].reason).toBe('detection-malformed');
        });

        it('F2: finding no candidates is an unmet request', async () => {
            const { createSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            const out = await saveAssistantDownloadableFiles(fakeCdp([]), {}, {
                sessionId: session.sessionId, strict: true,
            });
            expect(out.ok).toBe(false);
            expect(out.errors[0].reason).toBe('no-candidates');
            // The paired case: the same emptiness is fine without the flag.
            const lenient = await saveAssistantDownloadableFiles(fakeCdp([]), {}, { sessionId: session.sessionId });
            expect(lenient.ok).toBe(true);
        });

        it('F3: one failed download rolls the whole batch back', async () => {
            const { createSession, getSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const { readdirSync, existsSync } = await import('node:fs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

            vi.stubGlobal('fetch', vi.fn(async (url) => {
                if (String(url).includes('file_a')) return okResponse('first', { 'content-type': 'text/plain' });
                return { ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
            }));
            const cdp = fakeCdp([
                { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' },
                { href: 'https://chatgpt.com/backend-api/files/file_b/download', download: 'b.txt', text: '' },
            ]);
            const out = await saveAssistantDownloadableFiles(cdp, {}, {
                sessionId: session.sessionId, strict: true,
            });

            expect(out.ok).toBe(false);
            expect(out.errors[0].reason).toBe('fetch-failed');
            // Nothing published, and no staging leftovers.
            expect(getSession(session.sessionId).artifacts || []).toHaveLength(0);
            const dir = resolveArtifactsDir(session.sessionId);
            if (existsSync(dir)) expect(readdirSync(dir)).toEqual([]);
        });

        it('F4: rollback leaves an artifact from an earlier run untouched', async () => {
            // The failure mode this guards: the deterministic basename means a
            // second capture of `a.txt` would overwrite the first, so deleting
            // "the file we wrote" on failure would destroy the earlier one.
            const { createSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { saveFileArtifact, resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const { readFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

            const existing = saveFileArtifact(session.sessionId, {
                filename: 'a.txt', buffer: Buffer.from('ORIGINAL'), mimeType: 'text/plain',
            });
            const existingPath = join(resolveArtifactsDir(session.sessionId), existing.path);

            vi.stubGlobal('fetch', vi.fn(async (url) => {
                if (String(url).includes('file_a')) return okResponse('REPLACEMENT', { 'content-type': 'text/plain' });
                return { ok: false, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
            }));
            const cdp = fakeCdp([
                { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' },
                { href: 'https://chatgpt.com/backend-api/files/file_b/download', download: 'b.txt', text: '' },
            ]);
            const out = await saveAssistantDownloadableFiles(cdp, {}, {
                sessionId: session.sessionId, strict: true,
            });

            expect(out.ok).toBe(false);
            expect(readFileSync(existingPath, 'utf8')).toBe('ORIGINAL');
        });

        it('F5: a second attempt reuses what the first one saved', async () => {
            const { createSession, getSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            const fetchSpy = vi.fn(async () => okResponse('body', { 'content-type': 'text/plain' }));
            vi.stubGlobal('fetch', fetchSpy);
            const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }]);

            const first = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            expect(first.ok).toBe(true);
            const downloadsAfterFirst = fetchSpy.mock.calls.length;

            const second = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            expect(second.ok).toBe(true);
            expect(second.savedCount).toBe(1);
            // No re-download, no duplicate artifact.
            expect(fetchSpy.mock.calls.length).toBe(downloadsAfterFirst);
            expect(getSession(session.sessionId).artifacts).toHaveLength(1);
        });

        it('F6: a recorded artifact whose file is gone is not reused', async () => {
            // Trusting the session record alone would report success with
            // nothing on disk — the same fail-open shape in a new place.
            const { createSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const { rmSync } = await import('node:fs');
            const { join } = await import('node:path');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            const fetchSpy = vi.fn(async () => okResponse('body', { 'content-type': 'text/plain' }));
            vi.stubGlobal('fetch', fetchSpy);
            const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }]);

            const first = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            expect(first.ok).toBe(true);
            rmSync(join(resolveArtifactsDir(session.sessionId), first.files[0].path), { force: true });

            const second = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            expect(second.ok).toBe(true);
            // Re-downloaded rather than counted from the stale record.
            expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
        });

        it('F7: a losing run stops before it writes anything', async () => {
            const { createSession, getSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const { readdirSync, existsSync } = await import('node:fs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            vi.stubGlobal('fetch', vi.fn(async () => okResponse('body', { 'content-type': 'text/plain' })));
            const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }]);

            const out = await saveAssistantDownloadableFiles(cdp, {}, {
                sessionId: session.sessionId, strict: true, stillActive: () => false,
            });

            expect(out.ok).toBe(false);
            expect(out.errors[0].reason).toBe('deadline-exceeded');
            expect(getSession(session.sessionId).artifacts || []).toHaveLength(0);
            const dir = resolveArtifactsDir(session.sessionId);
            if (existsSync(dir)) expect(readdirSync(dir)).toEqual([]);
        });

        it('F8: two candidates that resolve to the same filename both survive', async () => {
            // Different URLs can both be `data.csv`. Keying the staging path on
            // the name alone let the second write clobber the first, and the
            // commit then failed renaming a file that was gone — so an ordinary
            // two-file request failed.
            const { createSession, getSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

            vi.stubGlobal('fetch', vi.fn(async (url) => okResponse(
                String(url).includes('file_a') ? 'FIRST' : 'SECOND',
                { 'content-disposition': 'attachment; filename="same.txt"', 'content-type': 'text/plain' },
            )));
            const cdp = fakeCdp([
                { href: 'https://chatgpt.com/backend-api/files/file_a/download', download: '', text: '' },
                { href: 'https://chatgpt.com/backend-api/files/file_b/download', download: '', text: '' },
            ]);

            const out = await saveAssistantDownloadableFiles(cdp, {}, {
                sessionId: session.sessionId, strict: true,
            });

            expect(out.ok).toBe(true);
            expect(out.savedCount).toBe(2);
            // Published under distinct names, not one overwriting the other.
            expect(new Set(out.files.map(f => f.path)).size).toBe(2);
            expect(getSession(session.sessionId).artifacts).toHaveLength(2);
        });

        it('F9: a fetch still in flight at the deadline writes nothing', async () => {
            // The contract case: not "already expired at entry" but a download
            // that is pending WHEN the deadline passes, then resolves.
            const { createSession, getSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const { readdirSync, existsSync } = await import('node:fs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

            let active = true;
            let release = () => {};
            const inFlight = new Promise(resolve => { release = resolve; });
            vi.stubGlobal('fetch', vi.fn(async () => {
                // The deadline passes while this is outstanding.
                active = false;
                await inFlight;
                return okResponse('late body', { 'content-type': 'text/plain' });
            }));
            const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }]);

            const pending = saveAssistantDownloadableFiles(cdp, {}, {
                sessionId: session.sessionId, strict: true, stillActive: () => active,
            });
            release();
            const out = await pending;

            expect(out.ok).toBe(false);
            expect(out.errors[0].reason).toBe('deadline-exceeded');
            expect(getSession(session.sessionId).artifacts || []).toHaveLength(0);
            const dir = resolveArtifactsDir(session.sessionId);
            if (existsSync(dir)) expect(readdirSync(dir)).toEqual([]);
        });

        it('F10: a tampered file is re-downloaded rather than counted', async () => {
            // F6 covers a deleted file; this covers one whose bytes changed.
            // Matching on the record alone would return stale content as fresh.
            const { createSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const { writeFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            const fetchSpy = vi.fn(async () => okResponse('body', { 'content-type': 'text/plain' }));
            vi.stubGlobal('fetch', fetchSpy);
            const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }]);

            const first = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            expect(first.ok).toBe(true);
            writeFileSync(join(resolveArtifactsDir(session.sessionId), first.files[0].path), 'TAMPERED');

            const second = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            expect(second.ok).toBe(true);
            expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
        });

        it('F11: a failed session write leaves no published files behind', async () => {
            // The session update takes a store lock that can throw. Leaving it
            // outside the rollback published the files while recording nothing.
            const { createSession } = await import('../../web-ai/session.mjs');
            const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
            const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
            const sessionModule = await import('../../web-ai/session.mjs');
            const { readdirSync, existsSync } = await import('node:fs');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

            vi.stubGlobal('fetch', vi.fn(async () => okResponse('body', { 'content-type': 'text/plain' })));
            const cdp = fakeCdp([{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }]);
            const spy = vi.spyOn(sessionModule, 'updateSession').mockImplementation(() => {
                throw new Error('store lock unavailable');
            });

            let out;
            try {
                out = await saveAssistantDownloadableFiles(cdp, {}, { sessionId: session.sessionId, strict: true });
            } finally {
                spy.mockRestore();
            }

            expect(out.ok).toBe(false);
            const dir = resolveArtifactsDir(session.sessionId);
            const left = existsSync(dir) ? readdirSync(dir) : [];
            expect(left).toEqual([]);
        });

        it('F12: publishing never replaces an artifact another run just wrote', async () => {
            // Scope, stated plainly: two synchronous commits cannot interleave
            // in one process, so this asserts the PRIMITIVE that makes the
            // cross-process race safe — publishing claims a name only if it is
            // still free, and never overwrites what is already there. A bare
            // `rename` replaces the destination silently, which is how the
            // loser's bytes ended up under the winner's descriptor hash.
            const { createSession } = await import('../../web-ai/session.mjs');
            const { stageFileArtifact, commitStagedArtifacts, resolveArtifactsDir } =
                await import('../../web-ai/session-artifacts.mjs');
            const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import('node:fs');
            const { join } = await import('node:path');
            const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
            const dir = resolveArtifactsDir(session.sessionId);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

            // Stands in for the file a concurrent run published between this
            // run choosing the name and reaching the write.
            writeFileSync(join(dir, 'race.txt'), 'WINNER');

            const staged = stageFileArtifact(session.sessionId, {
                filename: 'race.txt', buffer: Buffer.from('LOSER'), mimeType: 'text/plain', txId: 'tx', slot: 0,
            });
            const result = commitStagedArtifacts(session.sessionId, [staged]);

            expect(result.ok).toBe(true);
            expect(result.files[0].path).not.toBe('race.txt');
            expect(readFileSync(join(dir, 'race.txt'), 'utf8')).toBe('WINNER');
            expect(readFileSync(join(dir, result.files[0].path), 'utf8')).toBe('LOSER');
        });
    });
});
