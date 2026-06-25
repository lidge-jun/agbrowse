import { describe, expect, it } from 'vitest';
import { buildAnnotatedScreenshot, hashImageBytes, summarizeScreenshotForDoctor } from '../../web-ai/annotated-screenshot.mjs';
import { WebAiError } from '../../web-ai/errors.mjs';

function fakePage(boxesPerRef = true) {
    return {
        url: () => 'https://chatgpt.com/c/1',
        screenshot: async () => Buffer.from('fake-png-bytes'),
        evaluate: async (_fn, refs) => (boxesPerRef ? refs.map((_r, i) => ({ x: i, y: i, width: 10, height: 10 })) : []),
        locator: () => ({ boundingBox: async () => null }),
    };
}

// Parity catalog 201 #3 (P1): annotated / set-of-mark screenshot.
describe('web-ai annotated screenshot', () => {
    it('hashImageBytes is a deterministic sha256 prefix', () => {
        const a = hashImageBytes(Buffer.from('hello'));
        const b = hashImageBytes(Buffer.from('hello'));
        expect(a).toBe(b);
        expect(a).toMatch(/^sha256:[0-9a-f]{16}$/);
        expect(hashImageBytes(Buffer.from('world'))).not.toBe(a);
    });

    it('builds a descriptor with png format, deterministic hash, and highlight count', async () => {
        const result = await buildAnnotatedScreenshot(fakePage(), { provider: 'chatgpt', highlightRefs: ['e1', 'e2'] });
        expect(result.format).toBe('png');
        expect(result.provider).toBe('chatgpt');
        expect(result.url).toBe('https://chatgpt.com/c/1');
        expect(result.highlightCount).toBe(2);
        expect(result.imageHash).toBe(hashImageBytes(Buffer.from('fake-png-bytes')));
        expect(result.screenshotId).toMatch(/^scr-/);
        expect(typeof result.timestamp).toBe('string');
    });

    it('throws a typed WebAiError when page.screenshot is unavailable', async () => {
        try {
            await buildAnnotatedScreenshot({ url: () => 'x' });
            expect.fail('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(WebAiError);
            expect(err.errorCode).toBe('screenshot.unavailable');
            expect(err.stage).toBe('visual-fallback');
        }
    });

    it('summarizeScreenshotForDoctor maps a result or a null fallback', () => {
        expect(summarizeScreenshotForDoctor(null)).toEqual({
            enabled: true, screenshotId: null, imageHash: null, width: 0, height: 0, highlightCount: 0,
        });
        const summary = summarizeScreenshotForDoctor({
            screenshotId: 'scr-1', imageHash: 'sha256:abc', width: 5, height: 6, highlightCount: 2,
            provider: null, url: null, format: 'png', timestamp: 't',
        });
        expect(summary.screenshotId).toBe('scr-1');
        expect(summary.highlightCount).toBe(2);
    });
});
