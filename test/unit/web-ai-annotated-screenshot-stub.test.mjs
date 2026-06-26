import { describe, expect, it } from 'vitest';
import { hashImageBytes, summarizeScreenshotForDoctor } from '../../web-ai/annotated-screenshot.mjs';

describe('annotated-screenshot: stub behavior regression', () => {
    it('hashImageBytes produces a sha256 hex digest prefix', () => {
        const hash = hashImageBytes(Buffer.from('test-image'));
        expect(typeof hash).toBe('string');
        expect(hash).toMatch(/^sha256:/);
    });

    it('summarizeScreenshotForDoctor returns structured result', () => {
        const result = {
            screenshotId: 'test-id',
            provider: 'chatgpt',
            url: 'https://chatgpt.com',
            imageHash: 'abc123',
            format: 'png',
            width: 0,
            height: 0,
            highlightCount: 2,
            timestamp: '2026-06-27T00:00:00.000Z',
        };
        const summary = summarizeScreenshotForDoctor(result);
        expect(summary).toBeTruthy();
    });
});
