import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    attachLocalFileLive,
    attachLocalFilesLive,
    buildAttachmentReadyExpression,
    isImageAttachmentPath,
    preflightAttachment,
    scoreFileInputCandidate,
    sendButtonTimeoutMs,
    UPLOAD_BUTTON_SELECTORS,
} from '../../web-ai/chatgpt-attachments.mjs';
import { resolveAttachmentUploadTimeoutMs } from '../../web-ai/chatgpt-upload-surface.mjs';

describe('ChatGPT attachment upload surface', () => {
    it('tracks the current ChatGPT plus button label for upload capability probes', () => {
        expect(UPLOAD_BUTTON_SELECTORS).toContain('button[aria-label="Add files and more"]');
    });

    it('prefers a resolver-selected upload target before scanning legacy selectors', async () => {
        const page = createUploadPage();
        const result = await attachLocalFileLive(page, {
            path: '/tmp/example.txt',
            basename: 'example.txt',
            sizeBytes: 12,
        }, {
            uploadTarget: { selector: 'button[aria-label*="Attach" i]', resolution: 'css-fallback' },
        });

        expect(result).toMatchObject({
            ok: true,
            stage: 'attachment-uploaded',
            chipVisible: true,
        });
        expect(result.fileCount).toBeGreaterThan(0);
        expect(page.clickedUploadSelector).toBe('button[aria-label*="Attach" i]');
        expect(page.filePath).toBe('/tmp/example.txt');
    });

    it('opens the new ChatGPT plus menu and handles Add photos & files file chooser', async () => {
        const page = createUploadPage({ twoStepUploadMenu: true, menuItemFileChooser: true });
        const result = await attachLocalFileLive(page, {
            path: '/tmp/context.txt',
            basename: 'context.txt',
            sizeBytes: 12,
        });

        expect(result).toMatchObject({
            ok: true,
            stage: 'attachment-uploaded',
            chipVisible: true,
        });
        expect(page.clickedUploadSelector).toBe('[data-testid="composer-plus-btn"]');
        expect(page.clickedMenuItem).toBe('Add photos & files');
        expect(page.waitedForFileChooser).toBe(true);
        expect(page.filePath).toBe('/tmp/context.txt');
    });

    it('passes explicit upload timeout through upload-menu file chooser', async () => {
        const page = createUploadPage({ twoStepUploadMenu: true, menuItemFileChooser: true });
        const result = await attachLocalFileLive(page, {
            path: '/tmp/context.txt',
            basename: 'context.txt',
            sizeBytes: 12,
        }, {
            attachmentUploadTimeoutMs: 123_456,
        });

        expect(result.ok).toBe(true);
        expect(page.fileTimeout).toBe(123_456);
    });

    it('uploads several mixed-type files through one setInputFiles array', async () => {
        const page = createUploadPage();
        const result = await attachLocalFilesLive(page, [
            { path: '/tmp/backend.zip', basename: 'backend.zip', sizeBytes: 200 },
            { path: '/tmp/pixel.png', basename: 'pixel.png', sizeBytes: 70 },
            { path: '/tmp/notes.txt', basename: 'notes.txt', sizeBytes: 12 },
        ], { uploadTarget: { selector: 'button[aria-label*="Attach" i]', resolution: 'css-fallback' } });

        expect(result.ok).toBe(true);
        expect(result.stage).toBe('attachment-uploaded');
        // all three paths handed to setInputFiles in one call
        expect(page.filePath).toEqual(['/tmp/backend.zip', '/tmp/pixel.png', '/tmp/notes.txt']);
    });

    it('passes explicit upload timeout through direct batch setInputFiles', async () => {
        const page = createUploadPage();
        const result = await attachLocalFilesLive(page, [
            { path: '/tmp/backend.zip', basename: 'backend.zip', sizeBytes: 200 },
            { path: '/tmp/notes.txt', basename: 'notes.txt', sizeBytes: 12 },
        ], {
            uploadTarget: { selector: 'button[aria-label*="Attach" i]', resolution: 'css-fallback' },
            attachmentUploadTimeoutMs: 98_765,
        });

        expect(result.ok).toBe(true);
        expect(page.fileTimeout).toBe(98_765);
    });

    it('delegates a single-element batch to the single-file path', async () => {
        const page = createUploadPage();
        const result = await attachLocalFilesLive(page, [
            { path: '/tmp/only.txt', basename: 'only.txt', sizeBytes: 5 },
        ], { uploadTarget: { selector: 'button[aria-label*="Attach" i]', resolution: 'css-fallback' } });
        expect(result.ok).toBe(true);
        expect(page.filePath).toBe('/tmp/only.txt');
    });

    it('rejects an empty file batch', async () => {
        const result = await attachLocalFilesLive(createUploadPage(), []);
        expect(result.ok).toBe(false);
        expect(result.stage).toBe('attachment-preflight');
    });

    it('keeps polling when ChatGPT hides sent-turn attachment evidence after upload acceptance', () => {
        const chatgptSrc = readFileSync(join(process.cwd(), 'web-ai', 'chatgpt.mjs'), 'utf8');

        expect(chatgptSrc).toContain('sent-attachment-evidence-unavailable');
        expect(chatgptSrc).toContain('sent attachment evidence unavailable after submit');
        expect(chatgptSrc).not.toMatch(/if \\(!sentAttachment\\.ok\\) throw/);
    });

    it('applies explicit live upload caps during preflight', () => {
        const result = preflightAttachment({
            path: '/tmp/large.txt',
            basename: 'large.txt',
            sizeBytes: 101,
        }, {
            maxUploadBytes: 100,
        });

        expect(result.ok).toBe(false);
        expect(result.rejectedReason).toContain('cap 100');
    });

    it('scores image-only file inputs only for image attachments', () => {
        expect(isImageAttachmentPath('/tmp/photo.png')).toBe(true);
        expect(isImageAttachmentPath('/tmp/archive.zip')).toBe(false);
        expect(scoreFileInputCandidate({ accept: 'image/png,image/jpeg' }, { isImageAttachment: false })).toBe(Number.NEGATIVE_INFINITY);
        expect(scoreFileInputCandidate({ accept: 'image/png,image/jpeg' }, { isImageAttachment: true })).toBeGreaterThan(0);
    });

    it('uses longer send readiness timeout when attachments are present', () => {
        expect(sendButtonTimeoutMs([])).toBe(20_000);
        expect(sendButtonTimeoutMs(['context.pdf'])).toBe(45_000);
    });

    it('resolves attachment upload timeout from explicit value or env fallback', () => {
        const previous = process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS;
        try {
            delete process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS;
            expect(resolveAttachmentUploadTimeoutMs(null)).toBe(60_000);
            process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS = '77777';
            expect(resolveAttachmentUploadTimeoutMs(undefined)).toBe(77_777);
            expect(resolveAttachmentUploadTimeoutMs('88888')).toBe(88_888);
            expect(resolveAttachmentUploadTimeoutMs('invalid')).toBe(60_000);
        } finally {
            if (previous === undefined) delete process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS;
            else process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS = previous;
        }
    });

    it('builds scoped attachment readiness expression with nested label and count fallback terms', () => {
        const expression = buildAttachmentReadyExpression(['context.pdf']);
        expect(expression).toContain('Remove attachment');
        expect(expression).toContain('removeCount');
        expect(expression).toContain('contenteditable');
        expect(expression).toContain('context.pdf');
    });
});

function createUploadPage(options = {}) {
    const page = {
        ...options,
        clickedUploadSelector: null,
        clickedMenuItem: null,
        fileInputAvailable: false,
        filePath: null,
        fileTimeout: null,
        chipVisible: false,
        menuOpen: false,
        waitedForFileChooser: false,
        pendingFileChooser: null,
        waitForTimeout: async () => undefined,
        keyboard: { press: async () => { page.menuOpen = false; } },
        mouse: { click: async () => undefined },
        waitForEvent: options.menuItemFileChooser
            ? async eventName => {
                if (eventName !== 'filechooser') return null;
                page.waitedForFileChooser = true;
                return new Promise(resolve => {
                    page.pendingFileChooser = resolve;
                });
            }
            : undefined,
        locator: selector => createUploadLocator(page, selector),
    };
    return page;
}

function createUploadLocator(page, selector) {
    const isUploadButton = selector.includes('Attach') || selector.includes('Upload') || selector.includes('plus') || selector.includes('Add files');
    const isFileInput = selector.includes('input[type="file"]');
    const isChip = selector.includes('attachment') || selector.includes('file') || selector.includes('.txt');
    const isMenuCandidateQuery = selector.includes('[role="menuitem"]') || selector.includes('[role="option"]');
    return {
        first: () => createUploadLocator(page, selector),
        all: async () => (isMenuCandidateQuery && page.menuOpen ? [createUploadMenuItemLocator(page)] : []),
        count: async () => {
            if (isFileInput) return page.fileInputAvailable ? 1 : 0;
            if (isChip) return page.chipVisible ? 1 : 0;
            if (isUploadButton) return 1;
            return 0;
        },
        isVisible: async () => isUploadButton,
        isEnabled: async () => true,
        click: async () => {
            if (!isUploadButton) return;
            page.clickedUploadSelector = selector;
            if (page.twoStepUploadMenu && selector.includes('plus')) page.menuOpen = true;
            else page.fileInputAvailable = true;
        },
        setInputFiles: async (filePath, options = {}) => {
            if (!isFileInput) throw new Error('not a file input');
            page.filePath = filePath;
            page.fileTimeout = options.timeout;
            page.chipVisible = true;
        },
    };
}

function createUploadMenuItemLocator(page) {
    return {
        isVisible: async () => true,
        innerText: async () => 'Add photos & files',
        click: async () => {
            page.clickedMenuItem = 'Add photos & files';
            page.menuOpen = false;
            if (page.menuItemFileChooser && page.pendingFileChooser) {
                page.pendingFileChooser({
                    setFiles: async (filePath, options = {}) => {
                        page.filePath = filePath;
                        page.fileTimeout = options.timeout;
                        page.chipVisible = true;
                    },
                });
                page.pendingFileChooser = null;
                return;
            }
            page.fileInputAvailable = true;
        },
    };
}
