import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-finalizer-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    vi.resetModules();
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
});

describe('web-ai tab finalizer artifact-before-archive contract', () => {
    it('archive policy skips provider archive when required artifact save failed', async () => {
        const { resolveArchivePolicy } = await import('../../web-ai/chatgpt-archive.mjs');

        expect(resolveArchivePolicy({
            archiveFlag: 'always',
            artifactStatus: { required: true, ok: false, stage: 'artifact-transcript' },
            session: {
                conversationUrl: 'https://chatgpt.com/c/abc123',
                status: 'complete',
            },
        })).toEqual({ shouldArchive: false, reason: 'artifact-save-failed' });
    });

    it('finalizeProviderTab does not call archive after transcript save failure', async () => {
        const archiveConversation = vi.fn(async () => ({ ok: true }));
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession } = await import('../../web-ai/session.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            {
                targetId: 'target-1',
                conversationUrl: 'https://chatgpt.com/c/abc123',
            },
        );
        writeFileSync(join(tmpHome, 'sessions'), 'not a directory');

        const result = await finalizeProviderTab({
            getPort: () => 9222,
        }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/abc123' },
            answerText: 'final answer',
            archiveFlag: 'always',
        });

        expect(result.finalized).toBe(true);
        expect(result.archived).toBe(false);
        expect(result.archiveSkippedReason).toBe('artifact-save-failed');
        expect(archiveConversation).not.toHaveBeenCalled();
        expect(poolTab).toHaveBeenCalled();
    });
});

/**
 * A run that lost its deadline race must not keep finalizing.
 *
 * Checking `stillActive` once at entry is not enough: every phase below it can
 * block long enough for the deadline to pass inside it. The session write takes
 * the store lock, which retries up to 200 times at 25ms, and the archive drives
 * the provider UI. These tests expire the run at a chosen phase boundary and
 * assert nothing after it happened.
 */
describe('a finalizer whose caller already timed out stops at the next phase', () => {
    it('writes no transcript when the deadline passes during the session write', async () => {
        const archiveConversation = vi.fn(async () => ({ ok: true }));
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            { targetId: 'target-late', conversationUrl: 'https://chatgpt.com/c/late' },
        );

        // Alive for the entry check, expired from then on — the shape of a
        // deadline that passes while the first write waits on the store lock.
        let checks = 0;
        const stillActive = () => { checks += 1; return checks <= 1; };

        const result = await finalizeProviderTab({ getPort: () => 9222 }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/late' },
            answerText: 'late answer',
            archiveFlag: 'always',
            stillActive,
        });

        // The entry write is allowed: it is the phase the caller's own gate
        // cleared. Everything after it is not.
        expect(getSession(session.sessionId).artifacts ?? []).toEqual([]);
        // Checked on disk too. The session record and the file are separate
        // effects, so asserting only the record would miss a file-only leak.
        expect(existsSync(join(resolveArtifactsDir(session.sessionId), 'transcript.md'))).toBe(false);
        expect(archiveConversation).not.toHaveBeenCalled();
        expect(poolTab).not.toHaveBeenCalled();
        expect(result.archiveSkippedReason).toBe('poll-deadline-exceeded');
        expect(getSession(session.sessionId).archived ?? false).toBe(false);
    });

    it('registers no artifact when the deadline passes during the transcript save', async () => {
        const archiveConversation = vi.fn(async () => ({ ok: true }));
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            { targetId: 'target-mid', conversationUrl: 'https://chatgpt.com/c/mid' },
        );

        // Expires the moment the transcript file exists — the deadline passing
        // DURING the save. The file write and the session record that points at
        // it are separate effects, so a check placed only before the save lets
        // the record through.
        const transcriptPath = join(resolveArtifactsDir(session.sessionId), 'transcript.md');
        const stillActive = () => !existsSync(transcriptPath);

        await finalizeProviderTab({ getPort: () => 9222 }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/mid' },
            answerText: 'late answer',
            archiveFlag: 'always',
            stillActive,
        });

        expect(getSession(session.sessionId).artifacts ?? []).toEqual([]);
        expect(archiveConversation).not.toHaveBeenCalled();
        expect(poolTab).not.toHaveBeenCalled();
    });

    it('does not pool the tab when the deadline passes before pooling', async () => {
        const archiveConversation = vi.fn(async () => ({ ok: true }));
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession } = await import('../../web-ai/session.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            { targetId: 'target-pool', conversationUrl: 'https://chatgpt.com/c/pool' },
        );

        // `archiveFlag: 'never'` keeps the archive branch out of the way, so
        // this test lands squarely on the pooling boundary: alive through the
        // session write and the artifact record, expired before pooling.
        // Pooling persists a lease and can close overflow tabs.
        let checks = 0;
        const stillActive = () => { checks += 1; return checks <= 3; };

        const result = await finalizeProviderTab({ getPort: () => 9222 }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/pool' },
            answerText: 'late answer',
            archiveFlag: 'never',
            stillActive,
        });

        expect(poolTab).not.toHaveBeenCalled();
        expect(result.archiveSkippedReason).toBe('poll-deadline-exceeded');
    });

    it('does not click Archive when the deadline passes before it', async () => {
        const archiveConversation = vi.fn(async () => ({ ok: true }));
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            { targetId: 'target-late2', conversationUrl: 'https://chatgpt.com/c/late2' },
        );

        // Expires at the archive boundary, keyed on the PHASE rather than on a
        // check count. The count version broke silently: adding an `expired()`
        // between the transcript and the archive moved this test's exit point
        // above the gate it was written for, and it kept passing while proving
        // nothing. The artifact record is written in the phase immediately
        // before the archive, so its presence marks that boundary.
        const stillActive = () => (getSession(session.sessionId).artifacts ?? []).length === 0;

        const result = await finalizeProviderTab({ getPort: () => 9222 }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/late2' },
            answerText: 'late answer',
            archiveFlag: 'always',
            stillActive,
        });

        expect(archiveConversation).not.toHaveBeenCalled();
        expect(poolTab).not.toHaveBeenCalled();
        expect(result.archiveSkippedReason).toBe('poll-deadline-exceeded');
    });

    it('does not mark the session archived when the deadline passes during the archive', async () => {
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        // Expires INSIDE the archive. It drives the provider UI across several
        // clicks and waits, so this is the realistic case: the run was alive
        // when the archive started and is not when it returns.
        let archiving = false;
        const archiveConversation = vi.fn(async () => { archiving = true; return { ok: true }; });
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            { targetId: 'target-during', conversationUrl: 'https://chatgpt.com/c/during' },
        );

        await finalizeProviderTab({ getPort: () => 9222 }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/during' },
            answerText: 'late answer',
            archiveFlag: 'always',
            stillActive: () => !archiving,
        });

        expect(archiveConversation).toHaveBeenCalled();
        // The archive itself could not be prevented — it had already started.
        // What must not happen is the session write claiming it succeeded.
        expect(getSession(session.sessionId).archived ?? false).toBe(false);
        expect(poolTab).not.toHaveBeenCalled();
    });

    it('still finalizes normally when the run is active throughout', async () => {
        const archiveConversation = vi.fn(async () => ({ ok: true }));
        const poolTab = vi.fn(async () => ({ ok: true, pooled: true }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', async () => {
            const actual = await vi.importActual('../../web-ai/chatgpt-archive.mjs');
            return { ...actual, archiveConversation };
        });
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const session = createSession(
            { vendor: 'chatgpt', prompt: 'hello', attachmentPolicy: 'inline-only' },
            { targetId: 'target-live', conversationUrl: 'https://chatgpt.com/c/live' },
        );

        // The paired assertion: without it, a gate that always refuses would
        // pass both tests above and break every real finalize.
        const result = await finalizeProviderTab({ getPort: () => 9222 }, {
            vendor: 'chatgpt',
            session,
            page: { url: () => 'https://chatgpt.com/c/live' },
            answerText: 'real answer',
            archiveFlag: 'always',
            stillActive: () => true,
        });

        expect(result.finalized).toBe(true);
        expect(archiveConversation).toHaveBeenCalled();
        expect(getSession(session.sessionId).answer).toBe('real answer');
        expect((getSession(session.sessionId).artifacts ?? []).map(a => a.kind)).toContain('transcript');
    });
});
