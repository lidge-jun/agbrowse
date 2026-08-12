import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-async-artifacts-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    vi.resetModules();
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
});

function holdStoreLock() {
    const path = join(tmpHome, 'web-ai-sessions.json.lock');
    const fd = openSync(path, 'wx');
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    closeSync(fd);
    return () => rmSync(path, { force: true });
}

function descriptor(kind, path, sizeBytes) {
    return {
        kind,
        label: path,
        path,
        mimeType: 'text/plain',
        sizeBytes,
        sha256: `sha-${sizeBytes}`,
        savedAt: new Date().toISOString(),
    };
}

describe('deadline-aware artifact helpers', () => {
    it('re-checks append activity after waiting for the store lock', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { appendArtifactRecordAsync } = await import('../../web-ai/session-artifacts.mjs');
        const { DEADLINE_PASSED } = await import('../../web-ai/session-store.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' });
        const before = getSession(session.sessionId);
        const release = holdStoreLock();
        let active = true;

        const pending = appendArtifactRecordAsync(session.sessionId, descriptor('file', 'late.txt', 1), () => active);
        active = false;
        release();

        expect(await pending).toBe(DEADLINE_PASSED);
        expect(getSession(session.sessionId)).toEqual(before);
    });

    it('replaces an existing record with the same kind and path', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { appendArtifactRecordAsync } = await import('../../web-ai/session-artifacts.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' });

        await appendArtifactRecordAsync(session.sessionId, descriptor('file', 'same.txt', 1), () => true);
        await appendArtifactRecordAsync(session.sessionId, descriptor('image', 'same.txt', 2), () => true);
        await appendArtifactRecordAsync(session.sessionId, descriptor('file', 'same.txt', 3), () => true);

        const artifacts = getSession(session.sessionId).artifacts;
        expect(artifacts).toHaveLength(2);
        expect(artifacts.find((item) => item.kind === 'file').sizeBytes).toBe(3);
        expect(artifacts.find((item) => item.kind === 'image').sizeBytes).toBe(2);
    });

    it('trims async traces with the same semantics as the sync helper', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { appendTraceToSession, appendTraceToSessionAsync } = await import('../../web-ai/trace-persistence.mjs');
        const syncSession = createSession({ vendor: 'chatgpt', prompt: 'sync', attachmentPolicy: 'inline-only' });
        const asyncSession = createSession({ vendor: 'chatgpt', prompt: 'async', attachmentPolicy: 'inline-only' });
        const steps = Array.from({ length: 240 }, (_, index) => ({ index, secret: 'test@example.com' }));

        appendTraceToSession(syncSession.sessionId, steps);
        await appendTraceToSessionAsync(asyncSession.sessionId, steps, () => true);

        expect(getSession(asyncSession.sessionId).trace).toEqual(getSession(syncSession.sessionId).trace);
        expect(getSession(asyncSession.sessionId).trace).toHaveLength(200);
    });

    it('does not append a trace when activity expires while the lock is held', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { appendTraceToSessionAsync } = await import('../../web-ai/trace-persistence.mjs');
        const { DEADLINE_PASSED } = await import('../../web-ai/session-store.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' });
        const before = getSession(session.sessionId);
        const release = holdStoreLock();
        let active = true;

        const pending = appendTraceToSessionAsync(session.sessionId, [{ step: 'late' }], () => active);
        active = false;
        release();

        expect(await pending).toBe(DEADLINE_PASSED);
        expect(getSession(session.sessionId)).toEqual(before);
    });
});

describe('refused appends leave no artifact on disk', () => {
    it('removes the image file when the deadline passes between save and append', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
        const { downloadGeneratedImages } = await import('../../web-ai/chatgpt-images.mjs');
        const { existsSync, readdirSync } = await import('node:fs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' });

        // Alive until the save has happened, expired at the locked append: the
        // save-side pre-check passes, the post-lock re-check refuses. The undo
        // must then remove the file the save just wrote.
        let checks = 0;
        const stillActive = () => { checks += 1; return checks <= 1; };

        const originalFetch = globalThis.fetch;
        globalThis.fetch = /** @type {any} */ (async () => new Response(Buffer.from('png-bytes'), {
            status: 200, headers: { 'content-type': 'image/png' },
        }));
        try {
            const results = await downloadGeneratedImages(
                /** @type {any} */ ({ send: async () => ({ cookies: [] }) }),
                // A URL the allowlist accepts — a rejected one is skipped
                // before the save and would keep this test green with the
                // cleanup deleted.
                [{ url: 'https://chatgpt.com/backend-api/estuary/content?id=file_deadline1', fileId: 'file_deadline1' }],
                { sessionId: session.sessionId, stillActive },
            );
            expect(results).toEqual([]);
            // The predicate must have been consulted twice: once before the
            // save (passed) and once inside the locked append (refused).
            // One check would mean the candidate never reached the save.
            expect(checks).toBeGreaterThanOrEqual(2);
            const dir = resolveArtifactsDir(session.sessionId);
            const leftover = existsSync(dir) ? readdirSync(dir).filter((name) => name.startsWith('image-')) : [];
            expect(leftover).toEqual([]);
            expect(getSession(session.sessionId).artifacts ?? []).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('removes the downloaded file when the non-strict append is refused', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
        const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
        const { existsSync, readdirSync } = await import('node:fs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' });

        // Alive before the save, expired inside the locked append — the
        // PRODUCTION path must undo the file it just saved. Doing the rm in
        // the test would keep it green with the production cleanup deleted.
        let checks = 0;
        const stillActive = () => { checks += 1; return checks <= 1; };

        // CDP detection returns one candidate; the download itself is fetched.
        const cdpSession = /** @type {any} */ ({
            send: async (method) => {
                if (method === 'Runtime.evaluate') {
                    return { result: { value: [{ href: 'https://chatgpt.com/backend-api/estuary/content?id=file_dl1', download: 'report.txt', text: 'report.txt' }] } };
                }
                if (method === 'Network.getCookies') return { cookies: [] };
                return {};
            },
        });
        const originalFetch = globalThis.fetch;
        globalThis.fetch = /** @type {any} */ (async () => new Response(Buffer.from('late-bytes'), {
            status: 200, headers: { 'content-type': 'text/plain' },
        }));
        try {
            const out = await saveAssistantDownloadableFiles(cdpSession, {}, {
                sessionId: session.sessionId, baselineAssistantCount: 0, stillActive,
            });
            expect(out.files).toEqual([]);
            expect(out.warnings).toContain('file-artifact-deadline-exceeded');
            expect(checks).toBeGreaterThanOrEqual(2);
            const dir = resolveArtifactsDir(session.sessionId);
            const leftover = existsSync(dir) ? readdirSync(dir) : [];
            expect(leftover).toEqual([]);
            expect(getSession(session.sessionId).artifacts ?? []).toEqual([]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});
