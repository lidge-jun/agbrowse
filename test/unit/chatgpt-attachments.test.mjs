import { describe, expect, it } from 'vitest';
import { attachLocalFileLive } from '../../web-ai/chatgpt-attachments.mjs';

describe('ChatGPT attachment upload surface', () => {
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
});

function createUploadPage() {
    const page = {
        clickedUploadSelector: null,
        fileInputAvailable: false,
        filePath: null,
        chipVisible: false,
        waitForTimeout: async () => undefined,
        locator: selector => createUploadLocator(page, selector),
    };
    return page;
}

function createUploadLocator(page, selector) {
    const isUploadButton = selector.includes('Attach') || selector.includes('Upload') || selector.includes('plus');
    const isFileInput = selector.includes('input[type="file"]');
    const isChip = selector.includes('attachment') || selector.includes('file') || selector.includes('.txt');
    return {
        first: () => createUploadLocator(page, selector),
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
            page.fileInputAvailable = true;
        },
        setInputFiles: async filePath => {
            if (!isFileInput) throw new Error('not a file input');
            page.filePath = filePath;
            page.chipVisible = true;
        },
    };
}
