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
        const result = commitStagedArtifacts(session.sessionId, [staged]);

        expect(result.ok).toBe(false);
        // The name has to appear: it is the only way anyone learns which file
        // was left behind.
        expect(result.rollbackFailed).toContain('stuck.txt');
    });

    it('R2: the strict result leads with the rollback failure', async () => {
        // Ordering matters. The original failure can be retried; a file left on
        // disk cannot, so it is the condition that needs acting on.
        //
        // Scope: with every removal failing, the staging sweep in `abort` also
        // reports a rollback failure, so this pins the ORDER of the public
        // errors rather than isolating the commit-level branch. R1 covers that
        // branch directly.
        const realFs = await vi.importActual('node:fs');
        vi.doMock('node:fs', () => ({
            ...realFs,
            default: realFs,
            rmSync: () => { throw new Error('EACCES'); },
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
});
