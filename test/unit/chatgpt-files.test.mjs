import { describe, expect, it } from 'vitest';
import {
    normalizeChatGptFileDownloadUrl,
    normalizeChatGptSandboxUrl,
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
