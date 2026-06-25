import { describe, expect, it } from 'vitest';
import { bm25Filter } from '../../skills/browser/adaptive-fetch/bm25-filter.mjs';

// Parity catalog 203.5 (P2): BM25 lexical reranker.
describe('adaptive fetch BM25 filter', () => {
    it('returns text unchanged when paragraph count is within topK', () => {
        const text = 'one paragraph here\n\nsecond paragraph here';
        expect(bm25Filter(text, { query: 'paragraph' })).toBe(text);
    });

    it('returns text unchanged for an empty query', () => {
        const paras = Array.from({ length: 20 }, (_, i) => `paragraph number ${i} about things`).join('\n\n');
        expect(bm25Filter(paras, { query: '', topK: 3 })).toBe(paras);
    });

    it('selects the most query-relevant paragraphs in document order', () => {
        const text = [
            'apples and oranges grow on trees in the orchard',
            'the quantum computer uses superconducting qubits for computation',
            'bananas are a popular yellow fruit eaten worldwide',
            'a second note on quantum qubits and quantum error correction',
            'grapes ferment into wine over many months in barrels',
        ].join('\n\n');
        const out = bm25Filter(text, { query: 'quantum qubits', topK: 2 });
        const kept = out.split('\n\n');
        expect(kept.length).toBe(2);
        // both kept paragraphs are the quantum ones, and original order is preserved
        expect(kept[0]).toMatch(/quantum computer uses superconducting/);
        expect(kept[1]).toMatch(/quantum error correction/);
    });

    it('drops paragraphs below minScore', () => {
        const text = [
            'zebra zebra zebra striped animal of the savanna grasslands',
            'completely unrelated text about baking sourdough bread at home',
            'more unrelated musings on gardening tomatoes and basil herbs',
            'another off-topic note about repairing bicycles and oiling chains',
        ].join('\n\n');
        const out = bm25Filter(text, { query: 'zebra', topK: 3, minScore: 0.5 });
        // only the zebra paragraph clears minScore
        expect(out).toMatch(/zebra striped animal/);
        expect(out).not.toMatch(/sourdough/);
    });
});
