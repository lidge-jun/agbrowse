// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import {
    CDP_INJECTION_THRESHOLD_BYTES,
    computeAttachmentTimeouts,
    setInputFilesResilient,
    setInputFilesViaCdp,
} from '../../web-ai/chatgpt-upload-surface.mjs';
import {
    attachLocalFileLive,
    sendButtonTimeoutMs,
    waitForAttachmentAcceptedLive,
    verifySentTurnAttachmentLive,
} from '../../web-ai/chatgpt-attachments.mjs';

const MIB = 1024 * 1024;

afterEach(() => {
    delete process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS;
    delete process.env.AGBROWSE_ATTACHMENT_ACCEPT_TIMEOUT_MS;
});

describe('computeAttachmentTimeouts (size-aware budgets)', () => {
    it('keeps small files at the legacy floors', () => {
        const budgets = computeAttachmentTimeouts([{ sizeBytes: 4096 }]);
        expect(budgets.handoffMs).toBeGreaterThanOrEqual(60_000);
        expect(budgets.handoffMs).toBeLessThan(61_000);
        expect(budgets.acceptanceMs).toBeGreaterThanOrEqual(45_000);
        expect(budgets.acceptanceMs).toBeLessThan(46_000);
        expect(budgets.sendReadyMs).toBeGreaterThanOrEqual(45_000);
        expect(budgets.sendReadyMs).toBeLessThan(46_000);
    });

    it('scales the acceptance budget past 45s for a 100MB file', () => {
        const budgets = computeAttachmentTimeouts([{ sizeBytes: 100 * MIB }]);
        expect(budgets.acceptanceMs).toBeGreaterThan(45_000);
        expect(budgets.acceptanceMs).toBeGreaterThan(400_000); // ~45s + 100MiB / 250KiBps
        expect(budgets.acceptanceMs).toBeLessThanOrEqual(900_000);
    });

    it('clamps the acceptance budget at the 15 minute ceiling', () => {
        const budgets = computeAttachmentTimeouts([{ sizeBytes: 512 * MIB }]);
        expect(budgets.acceptanceMs).toBe(900_000);
    });

    it('uses the multi-file base and total bytes for batches', () => {
        const single = computeAttachmentTimeouts([{ sizeBytes: 0 }]);
        const batch = computeAttachmentTimeouts([{ sizeBytes: 0 }, { sizeBytes: 0 }]);
        expect(single.acceptanceMs).toBe(45_000);
        expect(batch.acceptanceMs).toBe(60_000);
        const sized = computeAttachmentTimeouts([{ sizeBytes: 30 * MIB }, { sizeBytes: 30 * MIB }]);
        expect(sized.totalBytes).toBe(60 * MIB);
        expect(sized.acceptanceMs).toBeGreaterThan(batch.acceptanceMs);
    });

    it('lets an explicit attachment upload timeout own the handoff budget', () => {
        const budgets = computeAttachmentTimeouts([{ sizeBytes: 200 * MIB }], { attachmentUploadTimeoutMs: 123_456 });
        expect(budgets.handoffMs).toBe(123_456);
    });

    it('treats AGBROWSE_ATTACHMENT_ACCEPT_TIMEOUT_MS as an acceptance floor', () => {
        process.env.AGBROWSE_ATTACHMENT_ACCEPT_TIMEOUT_MS = '600000';
        const budgets = computeAttachmentTimeouts([{ sizeBytes: 1024 }]);
        expect(budgets.acceptanceMs).toBe(600_000);
    });
});

describe('sendButtonTimeoutMs (size-aware)', () => {
    it('keeps the legacy shape without a size argument', () => {
        expect(sendButtonTimeoutMs([])).toBe(20_000);
        expect(sendButtonTimeoutMs(['context.pdf'])).toBe(45_000);
    });

    it('grows with total attachment bytes and clamps at 300s', () => {
        expect(sendButtonTimeoutMs(['big.zip'], 100 * MIB)).toBeGreaterThan(45_000);
        expect(sendButtonTimeoutMs(['huge.zip'], 5 * 1024 * MIB)).toBe(300_000);
    });
});

describe('setInputFilesViaCdp / setInputFilesResilient', () => {
    it('degrades gracefully when the page has no CDP session', async () => {
        const result = await setInputFilesViaCdp({}, 'input[type="file"]', '/tmp/a.bin');
        expect(result.ok).toBe(false);
    });

    it('injects local paths through DOM.setFileInputFiles', async () => {
        const { page, cdpCalls } = createCdpPage();
        const result = await setInputFilesViaCdp(page, 'input[type="file"]', ['/tmp/a.bin']);
        expect(result.ok).toBe(true);
        const setCall = cdpCalls.find(call => call.method === 'DOM.setFileInputFiles');
        expect(setCall?.params?.files).toEqual(['/tmp/a.bin']);
        expect(setCall?.params?.nodeId).toBe(7);
    });

    it('prefers CDP injection for batches at or above the 45MB threshold', async () => {
        const { page, cdpCalls } = createCdpPage();
        const usedFallbacks = [];
        const result = await setInputFilesResilient(page, 'input[type="file"]', '/tmp/big.bin', {
            totalBytes: CDP_INJECTION_THRESHOLD_BYTES,
            usedFallbacks,
        });
        expect(result).toEqual({ ok: true, method: 'cdp' });
        expect(cdpCalls.some(call => call.method === 'DOM.setFileInputFiles')).toBe(true);
        expect(page.setInputFilesCalls).toBe(0);
        expect(usedFallbacks).toContain('attachment-cdp-set-file-input');
    });

    it('falls back to CDP when Playwright rejects a >50MB transfer', async () => {
        const { page, cdpCalls } = createCdpPage({
            setInputFilesError: new Error('Cannot transfer files larger than 50Mb'),
        });
        const usedFallbacks = [];
        const result = await setInputFilesResilient(page, 'input[type="file"]', '/tmp/big.bin', {
            totalBytes: 10 * MIB,
            usedFallbacks,
        });
        expect(result).toEqual({ ok: true, method: 'cdp' });
        expect(page.setInputFilesCalls).toBe(1);
        expect(cdpCalls.some(call => call.method === 'DOM.setFileInputFiles')).toBe(true);
    });

    it('keeps plain setInputFiles for small batches', async () => {
        const { page, cdpCalls } = createCdpPage();
        const result = await setInputFilesResilient(page, 'input[type="file"]', '/tmp/small.bin', {
            totalBytes: 1 * MIB,
        });
        expect(result).toEqual({ ok: true, method: 'input' });
        expect(page.setInputFilesCalls).toBe(1);
        expect(cdpCalls.length).toBe(0);
    });
});

describe('attachLocalFileLive large-file CDP-first end to end', () => {
    it('uploads a 100MB file through CDP without streaming setInputFiles', async () => {
        const { page, cdpCalls } = createCdpPage({ acceptedFileName: 'big.zip' });
        const result = await attachLocalFileLive(page, {
            path: '/tmp/big.zip',
            basename: 'big.zip',
            sizeBytes: 100 * MIB,
        });
        expect(result.ok).toBe(true);
        expect(page.setInputFilesCalls).toBe(0);
        expect(cdpCalls.some(call => call.method === 'DOM.setFileInputFiles')).toBe(true);
        expect(result.usedFallbacks).toContain('attachment-cdp-set-file-input');
    });
});

describe('waitForAttachmentAcceptedLive strict evidence', () => {
    it('does not accept a bare chip without filename or remove-control evidence', async () => {
        const page = {
            evaluate: async () => ({ ok: false, matched: [], chipCount: 1, removeCount: 0, progressCount: 0, errorCount: 0 }),
            waitForTimeout: async () => undefined,
        };
        const result = await waitForAttachmentAcceptedLive(page, { timeoutMs: 40, fileNames: ['report.pdf'] });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('matched 0/1');
    });

    it('rejects while an upload error indicator is present', async () => {
        const page = {
            evaluate: async () => ({ ok: false, matched: ['report.pdf'], chipCount: 1, removeCount: 1, progressCount: 0, errorCount: 1 }),
            waitForTimeout: async () => undefined,
        };
        const result = await waitForAttachmentAcceptedLive(page, { timeoutMs: 40, fileNames: ['report.pdf'] });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('errors 1');
    });

    it('accepts on filename evidence', async () => {
        const page = {
            evaluate: async () => ({ ok: true, matched: ['report.pdf'], chipCount: 1, removeCount: 1, progressCount: 0, errorCount: 0 }),
            waitForTimeout: async () => undefined,
        };
        const result = await waitForAttachmentAcceptedLive(page, { timeoutMs: 1_000, fileNames: ['report.pdf'] });
        expect(result.ok).toBe(true);
    });
});

describe('verifySentTurnAttachmentLive evidence scoping', () => {
    it('no longer counts generic img nodes for non-image attachments', async () => {
        const page = createSentTurnPage({ text: 'please review', attachmentNodes: 0, imageNodes: 2 });
        const result = await verifySentTurnAttachmentLive(page, { path: '/tmp/report.pdf', basename: 'report.pdf' });
        expect(result.ok).toBe(false);
    });

    it('still accepts img evidence for image attachments', async () => {
        const page = createSentTurnPage({ text: 'look at this', attachmentNodes: 0, imageNodes: 1 });
        const result = await verifySentTurnAttachmentLive(page, { path: '/tmp/shot.png', basename: 'shot.png' });
        expect(result.ok).toBe(true);
    });

    it('accepts attachment markers for documents', async () => {
        const page = createSentTurnPage({ text: 'here', attachmentNodes: 1, imageNodes: 0 });
        const result = await verifySentTurnAttachmentLive(page, { path: '/tmp/report.pdf', basename: 'report.pdf' });
        expect(result.ok).toBe(true);
    });
});

/**
 * Fake page exposing a composer file input plus a recording CDP session.
 * @param {{ setInputFilesError?: Error, acceptedFileName?: string }} [options]
 */
function createCdpPage(options = {}) {
    /** @type {Array<{ method: string, params?: any }>} */
    const cdpCalls = [];
    const session = {
        send: async (/** @type {string} */ method, /** @type {any} */ params) => {
            cdpCalls.push({ method, params });
            if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
            if (method === 'DOM.querySelector') return { nodeId: 7 };
            return {};
        },
        detach: async () => undefined,
    };
    const page = {
        setInputFilesCalls: 0,
        context: () => ({ newCDPSession: async () => session }),
        locator: (/** @type {string} */ selector) => createInputLocator(page, selector, options),
        evaluate: options.acceptedFileName
            ? async () => ({ ok: true, matched: [options.acceptedFileName], chipCount: 1, removeCount: 1, progressCount: 0, errorCount: 0 })
            : undefined,
        waitForTimeout: async () => undefined,
    };
    return { page, cdpCalls };
}

/** @param {any} page @param {string} selector @param {{ setInputFilesError?: Error }} options */
function createInputLocator(page, selector, options) {
    const isFileInput = selector.includes('input[type="file"]');
    const locator = {
        first: () => locator,
        count: async () => (isFileInput ? 1 : 0),
        getAttribute: async () => null,
        isVisible: async () => false,
        setInputFiles: async () => {
            page.setInputFilesCalls += 1;
            if (options.setInputFilesError) throw options.setInputFilesError;
        },
    };
    return locator;
}

/** @param {{ text: string, attachmentNodes: number, imageNodes: number }} config */
function createSentTurnPage(config) {
    const turn = {
        count: async () => 1,
        innerText: async () => config.text,
        locator: (/** @type {string} */ selector) => ({
            count: async () => {
                const wantsImages = selector.includes('img');
                return config.attachmentNodes + (wantsImages ? config.imageNodes : 0);
            },
        }),
    };
    return {
        locator: () => ({ last: () => turn }),
    };
}
