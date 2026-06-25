import { describe, expect, it } from 'vitest';
import { buildLiveStatusReport, isLiveStatusReady } from '../../web-ai/live-status-report.mjs';

const SOURCES = ['https://support.google.com/gemini/answer/16345172'];

// Parity catalog 203.8 (P2): typed standalone live-status report struct.
describe('web-ai live status report', () => {
    it('reports unavailable when the active tab is not the provider URL', () => {
        const r = buildLiveStatusReport({ vendor: 'gemini', isProviderUrl: false, url: 'https://example.com', sources: SOURCES });
        expect(r.status).toBe('gemini-unavailable');
        expect(r.runtimeEnabled).toBe(true);
        expect(r.notes[0]).toMatch(/not gemini/);
        expect(r.sources).toEqual(SOURCES);
        expect(isLiveStatusReady(r)).toBe(false);
    });

    it('reports signed-out when a sign-in link is visible', () => {
        const r = buildLiveStatusReport({ vendor: 'gemini', isProviderUrl: true, signedOut: true });
        expect(r.status).toBe('signed-out');
        expect(r.notes[0]).toMatch(/sign-in link visible/);
    });

    it('reports unavailable when the composer is not visible', () => {
        const r = buildLiveStatusReport({ vendor: 'gemini', isProviderUrl: true, composerVisible: false });
        expect(r.status).toBe('gemini-unavailable');
        expect(r.notes[0]).toMatch(/composer not visible/);
    });

    it('reports ready when on-provider, signed-in, composer visible', () => {
        const r = buildLiveStatusReport({ vendor: 'gemini', isProviderUrl: true, composerVisible: true, sources: SOURCES });
        expect(r.status).toBe('ready');
        expect(isLiveStatusReady(r)).toBe(true);
        expect(r.notes[0]).toMatch(/composer visible/);
    });

    it('is vendor-agnostic with configurable ready/unavailable status labels', () => {
        const r = buildLiveStatusReport({ vendor: 'grok', isProviderUrl: false, unavailableStatus: 'grok-offline' });
        expect(r.vendor).toBe('grok');
        expect(r.status).toBe('grok-offline');
    });
});
