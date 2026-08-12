import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
});

function options(stillActive = () => true) {
    return {
        vendor: 'chatgpt',
        session: {
            sessionId: 'session-1',
            targetId: 'target-1',
            vendor: 'chatgpt',
            conversationUrl: 'https://chatgpt.com/c/async',
        },
        page: { url: () => 'https://chatgpt.com/c/async' },
        answerText: 'answer',
        archiveFlag: 'always',
        stillActive,
    };
}

describe('deadline-aware tab finalizer writes', () => {
    it('keeps writes and external phases in finalization order', async () => {
        const calls = [];
        const DEADLINE_PASSED = Symbol('deadline');
        const updateSessionAsync = vi.fn(async (_id, patch) => {
            calls.push(patch.archived ? 'archived-write' : 'complete-write');
            return {};
        });
        const appendArtifactRecordAsync = vi.fn(async () => { calls.push('artifact-append'); return {}; });
        const archiveConversation = vi.fn(async () => { calls.push('archive'); return { ok: true }; });
        const poolTab = vi.fn(async () => { calls.push('pool'); return { pooled: true }; });

        vi.doMock('../../web-ai/session.mjs', () => ({ updateSessionAsync, DEADLINE_PASSED }));
        vi.doMock('../../web-ai/session-artifacts.mjs', () => ({
            trySaveTranscript: () => ({ ok: true, descriptor: descriptor('transcript', 'transcript.md', 1) }),
            appendArtifactRecordAsync,
        }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', () => ({
            resolveArchivePolicy: () => ({ shouldArchive: true }),
            archiveConversation,
        }));
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        await finalizeProviderTab({ getPort: () => 9222 }, options());

        expect(calls).toEqual(['complete-write', 'artifact-append', 'archive', 'archived-write']);
        expect(poolTab).not.toHaveBeenCalled();
    });

    it('reaches pooling only after the complete, artifact, and archive phases', async () => {
        const calls = [];
        const DEADLINE_PASSED = Symbol('deadline');
        vi.doMock('../../web-ai/session.mjs', () => ({
            DEADLINE_PASSED,
            updateSessionAsync: vi.fn(async () => { calls.push('complete-write'); return {}; }),
        }));
        vi.doMock('../../web-ai/session-artifacts.mjs', () => ({
            trySaveTranscript: () => ({ ok: true, descriptor: descriptor('transcript', 'transcript.md', 1) }),
            appendArtifactRecordAsync: vi.fn(async () => { calls.push('artifact-append'); return {}; }),
        }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', () => ({
            resolveArchivePolicy: () => ({ shouldArchive: true }),
            archiveConversation: vi.fn(async () => { calls.push('archive'); return { ok: false }; }),
        }));
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({
            poolTab: vi.fn(async () => { calls.push('pool'); return { pooled: true }; }),
        }));

        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        await finalizeProviderTab({ getPort: () => 9222 }, options());

        expect(calls).toEqual(['complete-write', 'artifact-append', 'archive', 'pool']);
    });

    it('stops after the complete write when the deadline crosses there', async () => {
        let active = true;
        const DEADLINE_PASSED = Symbol('deadline');
        const updateSessionAsync = vi.fn(async () => {
            active = false;
            return {};
        });
        const appendArtifactRecordAsync = vi.fn();
        const archiveConversation = vi.fn();
        const poolTab = vi.fn();
        const trySaveTranscript = vi.fn();

        vi.doMock('../../web-ai/session.mjs', () => ({ updateSessionAsync, DEADLINE_PASSED }));
        vi.doMock('../../web-ai/session-artifacts.mjs', () => ({ trySaveTranscript, appendArtifactRecordAsync }));
        vi.doMock('../../web-ai/chatgpt-archive.mjs', () => ({
            resolveArchivePolicy: vi.fn(() => ({ shouldArchive: true })),
            archiveConversation,
        }));
        vi.doMock('../../web-ai/tab-pool.mjs', () => ({ poolTab }));

        const { finalizeProviderTab } = await import('../../web-ai/tab-finalizer.mjs');
        const result = await finalizeProviderTab({ getPort: () => 9222 }, options(() => active));

        expect(result).toEqual({
            finalized: true,
            pool: null,
            archiveSkippedReason: 'poll-deadline-exceeded',
        });
        expect(updateSessionAsync).toHaveBeenCalledTimes(1);
        expect(trySaveTranscript).not.toHaveBeenCalled();
        expect(appendArtifactRecordAsync).not.toHaveBeenCalled();
        expect(archiveConversation).not.toHaveBeenCalled();
        expect(poolTab).not.toHaveBeenCalled();
    });
});

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
