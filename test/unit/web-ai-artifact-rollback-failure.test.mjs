import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The branch where a rollback ITSELF fails.
 *
 * `publishStaged` links the final name, and if it then cannot remove the
 * staging entry it undoes the link. When that undo also fails the file exists
 * under a name the caller never learned, so nothing downstream can remove it —
 * the only correct response is to say so.
 *
 * A real filesystem cannot produce this: making the destination unwritable so
 * the undo fails would also block the `link` that has to succeed first. The
 * failure is injected at `node:fs` instead, in its own file so the mock cannot
 * leak into the suites that exercise real artifact writes.
 */
describe('a rollback that cannot finish is reported (#88)', () => {
    const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
    let tmpHome;

    beforeEach(() => {
        tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-rollback-'));
        process.env.BROWSER_AGENT_HOME = tmpHome;
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock('node:fs');
        vi.resetModules();
        if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
        else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
        rmSync(tmpHome, { recursive: true, force: true });
    });

    it('R1: an orphaned link is named in rollbackFailed', async () => {
        const realFs = await vi.importActual('node:fs');
        // Every removal fails, so the staging entry survives AND the undo of the
        // link cannot run. Everything else stays real, including `linkSync`.
        vi.doMock('node:fs', () => ({
            ...realFs,
            default: realFs,
            rmSync: () => { const err = new Error('EACCES'); throw err; },
        }));

        const { createSession } = await import('../../web-ai/session.mjs');
        const { stageFileArtifact, commitStagedArtifacts } = await import('../../web-ai/session-artifacts.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        const staged = stageFileArtifact(session.sessionId, {
            filename: 'stuck.txt', buffer: Buffer.from('BODY'), mimeType: 'text/plain', txId: 'tx', slot: 0,
        });
        const result = await commitStagedArtifacts(session.sessionId, [staged]);

        expect(result.ok).toBe(false);
        // The name has to appear: it is the only way anyone learns which file
        // was left behind.
        expect(result.rollbackFailed).toContain('stuck.txt');
    });

    it('R2: the strict result leads with the rollback failure', async () => {
        // Ordering matters. The original failure can be retried; a file left on
        // disk cannot, so it is the condition that needs acting on.
        //
        // Only the FIRST two removals fail — the staging entry and the undo of
        // the link, which together produce EROLLBACK. Everything after that
        // succeeds, so the staging sweep in `abort` reports nothing and the
        // leading `rollback-failed` can only come from the commit's own result.
        // Failing every removal instead would let that branch be deleted while
        // the sweep supplied an identical-looking error.
        const realFs = await vi.importActual('node:fs');
        let removals = 0;
        vi.doMock('node:fs', () => ({
            ...realFs,
            default: realFs,
            rmSync: (...args) => {
                removals += 1;
                if (removals <= 2) throw new Error('EACCES');
                return (/** @type {any} */ (realFs)).rmSync(...args);
            },
        }));

        const { createSession } = await import('../../web-ai/session.mjs');
        const { saveAssistantDownloadableFiles } = await import('../../web-ai/chatgpt-files.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/plain' : null) },
            arrayBuffer: async () => new TextEncoder().encode('body').buffer,
        })));
        const cdp = {
            send: async (method) => {
                if (method === 'Network.getCookies') return { cookies: [{ name: 's', value: '1' }] };
                return { result: { value: [{ href: 'https://chatgpt.com/backend-api/files/file_a/download', download: 'a.txt', text: '' }] } };
            },
        };

        const out = await saveAssistantDownloadableFiles(cdp, {}, {
            sessionId: session.sessionId, strict: true,
        });

        expect(out.ok).toBe(false);
        expect(out.errors[0].reason).toBe('rollback-failed');
        // The original cause is kept behind it, not replaced by it.
        expect(out.errors.some(e => e.reason !== 'rollback-failed')).toBe(true);
        vi.unstubAllGlobals();
    });

    it('R3: a deadline that passes while waiting for the lock stops the write', async () => {
        // Making the lock awaitable created this window. The check before the
        // commit no longer says anything about the moment the write happens,
        // because the wait for the lock sits between them.
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { stageFileArtifact, commitStagedArtifacts, resolveArtifactsDir } =
            await import('../../web-ai/session-artifacts.mjs');
        const { existsSync, readdirSync } = await import('node:fs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        const staged = stageFileArtifact(session.sessionId, {
            filename: 'late.txt', buffer: Buffer.from('LATE'), mimeType: 'text/plain', txId: 'tx', slot: 0,
        });
        // Expired by the time the lock is held, which is where the re-check is.
        const result = await commitStagedArtifacts(session.sessionId, [staged], {
            stillActive: () => false,
        });

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('deadline-exceeded');
        expect(getSession(session.sessionId).artifacts || []).toHaveLength(0);
        const dir = resolveArtifactsDir(session.sessionId);
        const left = existsSync(dir) ? readdirSync(dir).filter(f => !f.startsWith('.')) : [];
        expect(left).toEqual([]);
    });

    it('R4: nothing is published while the commit waits for the lock', async () => {
        // R3 expires before the commit starts, so it never exercises the wait.
        // Here the lock is held by someone else, and the question is what a
        // caller who times out DURING that wait can see: publishing before
        // taking the lock left the files on disk for its whole duration, and
        // the undo that follows runs after the race is already decided.
        const { createSession } = await import('../../web-ai/session.mjs');
        const { stageFileArtifact, commitStagedArtifacts, resolveArtifactsDir } =
            await import('../../web-ai/session-artifacts.mjs');
        const { existsSync, readdirSync, openSync, closeSync, writeFileSync: write, rmSync: remove } =
            await import('node:fs');
        const { join } = await import('node:path');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
        const dir = resolveArtifactsDir(session.sessionId);

        const staged = stageFileArtifact(session.sessionId, {
            filename: 'held.txt', buffer: Buffer.from('HELD'), mimeType: 'text/plain', txId: 'tx', slot: 0,
        });

        // A live holder, so the commit has to wait.
        const lockPath = `${join(tmpHome, 'web-ai-sessions.json')}.lock`;
        const fd = openSync(lockPath, 'wx');
        write(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        closeSync(fd);

        const pending = commitStagedArtifacts(session.sessionId, [staged], { stillActive: () => true });
        // Look at the directory while the wait is still in progress — this is
        // the moment a timed-out caller would see.
        await new Promise(resolve => setTimeout(resolve, 120));
        const visibleDuringWait = existsSync(dir)
            ? readdirSync(dir).filter(f => !f.startsWith('.'))
            : [];

        remove(lockPath, { force: true });
        await pending;

        expect(visibleDuringWait).toEqual([]);
    }, 30_000);
});
