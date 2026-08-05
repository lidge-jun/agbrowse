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
