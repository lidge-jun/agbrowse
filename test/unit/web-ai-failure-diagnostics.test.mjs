import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnosticsEnabled, readConversationSnapshot } from '../../web-ai/failure-diagnostics.mjs';

describe('diagnosticsEnabled (pure gate)', () => {
    it('enables on diagnostics / verbose / env, defaults off', () => {
        expect(diagnosticsEnabled({ diagnostics: true }, {})).toBe(true);
        expect(diagnosticsEnabled({ verbose: true }, {})).toBe(true);
        expect(diagnosticsEnabled({}, { AGBROWSE_DIAGNOSTICS: '1' })).toBe(true);
        expect(diagnosticsEnabled({}, {})).toBe(false);
        expect(diagnosticsEnabled(undefined, {})).toBe(false);
    });
});

describe('readConversationSnapshot', () => {
    it('returns the in-page snapshot', async () => {
        const snap = { url: 'https://chatgpt.com/c/x', title: 't', turns: [], bodyText: '' };
        const page = { evaluate: async () => snap };
        expect(await readConversationSnapshot(page)).toEqual(snap);
    });
    it('returns null when evaluate throws', async () => {
        const page = { evaluate: async () => { throw new Error('detached'); } };
        expect(await readConversationSnapshot(page)).toBeNull();
    });
});

describe('captureFailureDiagnostics', () => {
    const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
    let tmpHome;

    beforeEach(() => {
        tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-diag-'));
        process.env.BROWSER_AGENT_HOME = tmpHome;
        vi.resetModules();
    });
    afterEach(() => {
        if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
        else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
        rmSync(tmpHome, { recursive: true, force: true });
        vi.resetModules();
    });

    const fakePage = { evaluate: async () => ({ url: 'https://chatgpt.com/c/x', title: 't', turns: [{ role: 'assistant', testid: null, text: 'hi' }], bodyText: 'body' }) };

    it('saves nothing without a sessionId or page', async () => {
        const { captureFailureDiagnostics } = await import('../../web-ai/failure-diagnostics.mjs');
        expect(await captureFailureDiagnostics({}, { sessionId: null, page: fakePage })).toEqual({ saved: false, reason: 'no-session-or-page' });
        expect(await captureFailureDiagnostics({}, { sessionId: 's', page: null })).toEqual({ saved: false, reason: 'no-session-or-page' });
    });

    it('persists a DOM snapshot (no screenshot when no CDP)', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
        const { captureFailureDiagnostics } = await import('../../web-ai/failure-diagnostics.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });

        const r = await captureFailureDiagnostics({}, { sessionId: session.sessionId, context: 'response-timeout', page: fakePage });
        expect(r.saved).toBe(true);
        expect(r.descriptor.kind).toBe('diagnostics');
        expect(r.descriptor.path).toBe('diagnostics-response-timeout.json');
        expect(r.descriptor.screenshotPath).toBeUndefined();
        expect(existsSync(join(resolveArtifactsDir(session.sessionId), r.descriptor.path))).toBe(true);
    });

    it('includes a screenshot when CDP is available', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { resolveArtifactsDir } = await import('../../web-ai/session-artifacts.mjs');
        const { captureFailureDiagnostics } = await import('../../web-ai/failure-diagnostics.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
        const deps = { getCdpSession: async () => ({ send: async () => ({ data: Buffer.from('PNG').toString('base64') }), detach: async () => {} }) };

        const r = await captureFailureDiagnostics(deps, { sessionId: session.sessionId, context: 'composer-commit', page: fakePage });
        expect(r.saved).toBe(true);
        expect(r.descriptor.screenshotPath).toBe('diagnostics-composer-commit.png');
        expect(existsSync(join(resolveArtifactsDir(session.sessionId), 'diagnostics-composer-commit.png'))).toBe(true);
    });

    it('never throws — a page evaluate failure still returns a result', async () => {
        const { createSession } = await import('../../web-ai/session.mjs');
        const { captureFailureDiagnostics } = await import('../../web-ai/failure-diagnostics.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'p', attachmentPolicy: 'inline-only' });
        const badPage = { evaluate: async () => { throw new Error('boom'); } };
        const r = await captureFailureDiagnostics({}, { sessionId: session.sessionId, context: 'x', page: badPage });
        // DOM snapshot is null but the artifact (empty json) still saves
        expect(r.saved).toBe(true);
    });
});
