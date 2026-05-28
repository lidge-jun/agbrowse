import { describe, expect, it } from 'vitest';
import {
    extractRunwayOutputUrl,
    inferRunwayAssetType,
    normalizeRunwayOutputPath,
} from '../../skills/browser/runway-download.mjs';

function makePage(evaluateResult) {
    return {
        url: () => 'https://app.runwayml.com/ai-tools/generate?mode=tools',
        title: async () => 'Runway',
        evaluate: async () => evaluateResult,
    };
}

describe('extractRunwayOutputUrl', () => {
    it('extracts video URL from page', async () => {
        const page = makePage({
            url: 'https://cdn.runwayml.com/video-previews/abc123.mp4',
            type: 'video',
        });
        const result = await extractRunwayOutputUrl(page, 0);
        expect(result.url).toContain('video-previews');
        expect(result.type).toBe('video');
    });

    it('extracts image URL from page', async () => {
        const page = makePage({
            url: 'https://cdn.runwayml.com/result/img456.png',
            type: 'image',
        });
        const result = await extractRunwayOutputUrl(page, 0);
        expect(result.url).toContain('result');
        expect(result.type).toBe('image');
    });

    it('prefers video assets when expectedType is video', async () => {
        const originalDocument = globalThis.document;
        globalThis.document = {
            querySelectorAll: () => [
                {
                    tagName: 'VIDEO',
                    getAttribute: name => name === 'src' ? 'https://cdn.runwayml.com/video-previews/clip.mp4' : '',
                },
                {
                    tagName: 'IMG',
                    getAttribute: name => name === 'src' ? 'https://cdn.runwayml.com/result/thumb.png' : '',
                },
            ],
        };
        try {
            const page = {
                evaluate: async (fn, arg) => fn(arg),
            };
            const result = await extractRunwayOutputUrl(page, 0, { expectedType: 'video' });
            expect(result.url).toContain('clip.mp4');
            expect(result.type).toBe('video');
        } finally {
            globalThis.document = originalDocument;
        }
    });

    it('returns null when no output found', async () => {
        const page = makePage({ url: null, type: 'unknown' });
        const result = await extractRunwayOutputUrl(page, 0);
        expect(result.url).toBeNull();
    });

    it('handles evaluate errors gracefully', async () => {
        const page = {
            evaluate: async () => { throw new Error('page crashed'); },
        };
        const result = await extractRunwayOutputUrl(page, 0);
        expect(result.url).toBeNull();
        expect(result.error).toContain('page crashed');
    });

    it('infers asset type from content type and normalizes mismatched output extension', () => {
        const asset = inferRunwayAssetType('https://example.com/result.png?tok=abc', 'image/png');
        expect(asset).toEqual({ type: 'image', ext: '.png' });
        expect(normalizeRunwayOutputPath('/tmp/runway-result.mp4', asset)).toBe('/tmp/runway-result.png');
    });
});
