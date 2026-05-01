import { describe, expect, it } from 'vitest';
import { domHashAround, normalizeDomForHash, selectorMatchSummary } from '../../web-ai/dom-hash.mjs';

function fakePage(evalResult, locatorMap = {}) {
    return {
        evaluate: async () => evalResult,
        locator: (selector) => ({
            count: async () => locatorMap[selector]?.count ?? 0,
            nth: (i) => ({
                isVisible: async () => {
                    const entry = locatorMap[selector];
                    if (!entry) return false;
                    if (Array.isArray(entry.visibleAt)) return entry.visibleAt.includes(i);
                    return i === 0 ? (entry.visible ?? false) : false;
                },
            }),
            first: () => ({
                isVisible: async () => locatorMap[selector]?.visible ?? false,
            }),
        }),
    };
}

describe('dom-hash', () => {
    it('normalizeDomForHash strips cosmetic attributes', () => {
        const raw = '<div data-message-id="abc" aria-busy="true" style="color:red">hello  world</div>';
        expect(normalizeDomForHash(raw)).toBe('<div></div>');
    });

    it('normalizeDomForHash strips text content for structural-only hashing', () => {
        const a = normalizeDomForHash('<div><button>Copy this secret</button></div>');
        const b = normalizeDomForHash('<div><button>Copy different secret</button></div>');
        expect(a).toBe(b);
    });

    it('normalizeDomForHash preserves structural differences', () => {
        const a = normalizeDomForHash('<div><button></button></div>');
        const b = normalizeDomForHash('<div><span></span></div>');
        expect(a).not.toBe(b);
    });

    it('domHashAround returns sha256 hash', async () => {
        const page = fakePage('<div style="color:red"><button>ok</button></div>');
        const hash = await domHashAround(page, ['div.foo']);
        expect(hash).toMatch(/^sha256:[0-9a-f]{16}$/);
    });

    it('domHashAround returns stable hash for same structure', async () => {
        const page1 = fakePage('<div style="a"><button>secret1</button></div>');
        const page2 = fakePage('<div style="b"><button>secret2</button></div>');
        const h1 = await domHashAround(page1, ['div']);
        const h2 = await domHashAround(page2, ['div']);
        expect(h1).toBe(h2);
    });

    it('domHashAround returns different hash for different structure', async () => {
        const page1 = fakePage('<div><button>Copy</button></div>');
        const page2 = fakePage('<div><span>Copy</span></div>');
        const h1 = await domHashAround(page1, ['div']);
        const h2 = await domHashAround(page2, ['div']);
        expect(h1).not.toBe(h2);
    });

    it('domHashAround returns null when no element found', async () => {
        const page = fakePage(null);
        const hash = await domHashAround(page, ['div.nonexistent']);
        expect(hash).toBeNull();
    });

    it('selectorMatchSummary returns counts and visibility', async () => {
        const page = fakePage(null, {
            'button.copy': { count: 2, visible: true },
            'button.upload': { count: 0, visible: false },
        });
        const result = await selectorMatchSummary(page, ['button.copy', 'button.upload']);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ selector: 'button.copy', matched: 2, visible: true });
        expect(result[1]).toEqual({ selector: 'button.upload', matched: 0, visible: false });
    });

    it('selectorMatchSummary detects visibility on non-first match', async () => {
        const page = fakePage(null, {
            'button.copy': { count: 3, visibleAt: [2] },
        });
        const result = await selectorMatchSummary(page, ['button.copy']);
        expect(result[0].matched).toBe(3);
        expect(result[0].visible).toBe(true);
    });

    it('normalizeDomForHash strips content-bearing attributes', () => {
        const raw = '<input value="secret" title="tooltip" placeholder="type here" alt="img">';
        const normalized = normalizeDomForHash(raw);
        expect(normalized).not.toContain('secret');
        expect(normalized).not.toContain('tooltip');
        expect(normalized).not.toContain('type here');
        expect(normalized).not.toContain('img');
        expect(normalized).toContain('<input');
    });

    it('prompt/response text changes do not alter structural hash', async () => {
        const page1 = fakePage('<div contenteditable="true"><p>Write me a poem about cats</p></div>');
        const page2 = fakePage('<div contenteditable="true"><p>Write me a poem about dogs and API keys abc123</p></div>');
        const h1 = await domHashAround(page1, ['div']);
        const h2 = await domHashAround(page2, ['div']);
        expect(h1).toBe(h2);
    });
});
