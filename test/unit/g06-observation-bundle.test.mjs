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
        { ref: 'e5', role: 'button', name: 'Browser ref', depth: 2 },
        { ref: '...', role: 'note', name: '5 of 50 shown', depth: 0 },
        { ref: 'note-1', role: 'note', name: 'Non element ref', depth: 0 },
    ],
    boxes: {
        '@e2': { x: 100, y: 200, width: 200, height: 30 },
        '@e4': { x: 100, y: 400, width: 80, height: 32 },
        'e5': { x: 220, y: 400, width: 90, height: 32 },
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

    it('drops non-element refs and preserves @eN/eN ordering', () => {
        const b = buildObservationBundle(baseInput);
        expect(b.refs.map((r) => r.ref)).toEqual(['@e1', '@e2', '@e3', '@e4', 'e5']);
        expect(b.refs.find((r) => r.ref === '...')).toBeUndefined();
        expect(b.refs.find((r) => r.ref === 'note-1')).toBeUndefined();
    });

    it('attaches boxes to refs that have them and leaves others without', () => {
        const b = buildObservationBundle(baseInput);
        const map = Object.fromEntries(b.refs.map((r) => [r.ref, r]));
        expect(map['@e2'].box).toEqual({ x: 100, y: 200, width: 200, height: 30 });
        expect(map['@e4'].box).toEqual({ x: 100, y: 400, width: 80, height: 32 });
        expect(map.e5.box).toEqual({ x: 220, y: 400, width: 90, height: 32 });
        expect(map['@e1'].box).toBeUndefined();
        expect(b.stats.boxCount).toBe(3);
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
        expect(b.observationId).toBeTruthy();
        expect(b.basis).toMatchObject({
            url: baseInput.url,
            viewport: baseInput.viewport,
            dpr: 2,
            capturedAt: baseInput.capturedAt,
        });
        expect(b.stats.refCount).toBe(5);
        expect(b.stats.boxCount).toBe(3);
        expect(b.stats.hasScreenshot).toBe(true);
        expect(b.screenshot).toBe('/tmp/screenshot.png');
    });

    it('preserves explicit observationId and targetId', () => {
        const b = buildObservationBundle({
            ...baseInput,
            observationId: 'obs-explicit',
            targetId: 'target-1',
        });
        expect(b.observationId).toBe('obs-explicit');
        expect(b.targetId).toBe('target-1');
        expect(b.basis.targetId).toBe('target-1');
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
        expect(text).toMatch(/refs=5/);
        expect(text).toMatch(/boxes=3/);
        expect(text).toMatch(/@e2.*box=100,200,200x30/);
        expect(text).toMatch(/e5.*box=220,400,90x32/);
    });
});
