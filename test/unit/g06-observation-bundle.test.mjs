// @ts-check
import { describe, it, expect } from 'vitest';
import { buildObservationBundle, formatObservationBundle, OBSERVATION_BUNDLE_SCHEMA_VERSION } from '../../web-ai/observation-bundle.mjs';

const baseInput = {
    url: 'https://example.com/login',
    title: 'Sign in — Example',
    viewport: { width: 1280, height: 800 },
    dpr: 2,
    snapshotNodes: [
        { ref: '@e1', role: 'heading', name: 'Sign in', depth: 1 },
        { ref: '@e2', role: 'textbox', name: 'Email', depth: 2 },
        { ref: '@e3', role: 'textbox', name: 'Password', depth: 2 },
        { ref: '@e4', role: 'button', name: 'Sign in', depth: 2 },
        { ref: '...', role: 'note', name: '5 of 50 shown', depth: 0 },
    ],
    boxes: {
        '@e2': { x: 100, y: 200, width: 200, height: 30 },
        '@e4': { x: 100, y: 400, width: 80, height: 32 },
    },
    screenshotPath: '/tmp/screenshot.png',
    textSummary: 'Sign in to Example. Email Password Sign in',
    capturedAt: '2026-05-06T13:00:00.000Z',
};

describe('G06 — observation-bundle ObservationBundleV1', () => {
    it('emits schemaVersion observation-bundle-v1', () => {
        const b = buildObservationBundle(baseInput);
        expect(b.schemaVersion).toBe('observation-bundle-v1');
        expect(OBSERVATION_BUNDLE_SCHEMA_VERSION).toBe('observation-bundle-v1');
    });

    it('drops ellipsis/non-@ refs and preserves ordering', () => {
        const b = buildObservationBundle(baseInput);
        expect(b.refs.map((r) => r.ref)).toEqual(['@e1', '@e2', '@e3', '@e4']);
        expect(b.refs.find((r) => r.ref === '...')).toBeUndefined();
    });

    it('attaches boxes to refs that have them and leaves others without', () => {
        const b = buildObservationBundle(baseInput);
        const map = Object.fromEntries(b.refs.map((r) => [r.ref, r]));
        expect(map['@e2'].box).toEqual({ x: 100, y: 200, width: 200, height: 30 });
        expect(map['@e4'].box).toEqual({ x: 100, y: 400, width: 80, height: 32 });
        expect(map['@e1'].box).toBeUndefined();
        expect(b.stats.boxCount).toBe(2);
    });

    it('clamps textSummary to maxTextChars', () => {
        const big = 'x'.repeat(5000);
        const b = buildObservationBundle({ ...baseInput, textSummary: big, maxTextChars: 100 });
        expect(b.textSummary.length).toBe(100);
        expect(b.textSummary.endsWith('...')).toBe(true);
        expect(b.stats.textChars).toBe(100);
    });

    it('reports stats correctly', () => {
        const b = buildObservationBundle(baseInput);
        expect(b.stats.refCount).toBe(4);
        expect(b.stats.boxCount).toBe(2);
        expect(b.stats.hasScreenshot).toBe(true);
        expect(b.screenshot).toBe('/tmp/screenshot.png');
    });

    it('handles missing screenshot/boxes gracefully', () => {
        const b = buildObservationBundle({
            url: 'https://x.test/',
            viewport: { width: 800, height: 600 },
            snapshotNodes: [{ ref: '@e1', role: 'button', name: 'Go' }],
        });
        expect(b.screenshot).toBeNull();
        expect(b.stats.hasScreenshot).toBe(false);
        expect(b.stats.boxCount).toBe(0);
        expect(b.dpr).toBe(1);
        expect(b.title).toBe('');
    });

    it('throws on missing url/viewport/snapshotNodes', () => {
        expect(() => buildObservationBundle(/** @type {any} */ ({}))).toThrow();
        expect(() => buildObservationBundle(/** @type {any} */ ({ url: 'x' }))).toThrow();
        expect(() => buildObservationBundle(/** @type {any} */ ({ url: 'x', viewport: { width: 1, height: 1 } }))).toThrow();
    });

    it('formatObservationBundle produces a readable summary', () => {
        const b = buildObservationBundle(baseInput);
        const text = formatObservationBundle(b);
        expect(text).toMatch(/observation-bundle-v1/);
        expect(text).toMatch(/refs=4/);
        expect(text).toMatch(/boxes=2/);
        expect(text).toMatch(/@e2.*box=100,200,200x30/);
    });
});
