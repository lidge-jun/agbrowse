import { describe, expect, it } from 'vitest';
import { detectChatGptProductSurfaces, detectGeminiProductSurfaces } from '../../web-ai/product-surfaces.mjs';

function fakePage(visibleTexts = [], visibleSelectors = []) {
    return {
        getByText: (text) => ({ first: () => ({ isVisible: async () => visibleTexts.includes(text) }) }),
        locator: (sel) => ({ first: () => ({ isVisible: async () => visibleSelectors.includes(sel) }) }),
    };
}

// Parity catalog 201 #5 (P2): read-only product-surface detector.
describe('web-ai product surfaces', () => {
    it('detects an available ChatGPT surface by visible text, never mutates', async () => {
        const surfaces = await detectChatGptProductSurfaces(fakePage(['Projects']));
        const projects = surfaces.find((s) => s.id === 'chatgpt-projects');
        expect(projects.available).toBe(true);
        expect(projects.evidence).toContain('Projects');
        expect(surfaces.every((s) => s.mutationAllowed === false)).toBe(true);
        // a surface with no matching text is unavailable
        expect(surfaces.find((s) => s.id === 'chatgpt-apps').available).toBe(false);
    });

    it('detects canvas via selector evidence', async () => {
        const surfaces = await detectChatGptProductSurfaces(fakePage([], ['[data-testid="canvas-panel"]']));
        const canvas = surfaces.find((s) => s.id === 'canvas');
        expect(canvas.available).toBe(true);
        expect(canvas.evidence).toContain('[data-testid="canvas-panel"]');
    });

    it('returns all-unavailable surfaces for an empty page', async () => {
        const surfaces = await detectChatGptProductSurfaces(fakePage());
        expect(surfaces.length).toBe(5);
        expect(surfaces.every((s) => s.available === false && s.evidence.length === 0)).toBe(true);
    });

    it('detects Gemini deep-research surface', async () => {
        const surfaces = await detectGeminiProductSurfaces(fakePage(['Deep Research']));
        const dr = surfaces.find((s) => s.id === 'gemini-deep-research');
        expect(dr.available).toBe(true);
        expect(dr.mutationAllowed).toBe(false);
    });
});
