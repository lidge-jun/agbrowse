import { describe, expect, it } from 'vitest';
import {
    looksLikeCulturalPhenomenon,
    buildEraSweepQueries,
    buildDisconfirmQuery,
    planKoreanResearch,
} from '../../skills/browser/search-research/search-strategy.mjs';

// Parity catalog 202 A2 (era-sweep) + A3 (disconfirmation query).
describe('search strategy era-sweep + disconfirm', () => {
    it('looksLikeCulturalPhenomenon detects origin/meme/trend markers', () => {
        expect(looksLikeCulturalPhenomenon('이 밈의 원조가 뭐야')).toBe(true);
        expect(looksLikeCulturalPhenomenon('최초로 시작한 곳')).toBe(true);
        expect(looksLikeCulturalPhenomenon('the origin of this meme')).toBe(true);
        expect(looksLikeCulturalPhenomenon('오늘 날씨 어때')).toBe(false);
    });

    it('buildEraSweepQueries injects origin markers around the anchor', () => {
        const specs = buildEraSweepQueries(['댄스', '챌린지']);
        expect(specs.length).toBe(2);
        expect(specs.every(s => s.purpose === 'era-sweep')).toBe(true);
        expect(specs[0].query).toMatch(/원조/);
        expect(specs[0].query).toMatch(/최초/);
        expect(specs[1].query).toMatch(/시초|유래/);
    });

    it('buildDisconfirmQuery looks for a different entity', () => {
        const spec = buildDisconfirmQuery(['후보군']);
        expect(spec.purpose).toBe('disconfirm');
        expect(spec.query).toMatch(/아닌|다른|비교/);
    });

    it('planKoreanResearch emits era-sweep + disconfirm purposes for a cultural query', () => {
        const plan = planKoreanResearch('이 유행 밈의 원조와 시초를 찾아줘', { maxQueries: 8 });
        const purposes = plan.atomicQueries.map(q => q.purpose);
        expect(purposes).toContain('era-sweep');
        expect(purposes).toContain('disconfirm');
        // every emitted query still carries a route URL (unchanged contract)
        expect(plan.atomicQueries.every(q => typeof q.url === 'string')).toBe(true);
    });

    it('a non-cultural query still emits a disconfirm but no era-sweep', () => {
        const plan = planKoreanResearch('서울 지하철 2호선 막차 시간', { maxQueries: 8 });
        const purposes = plan.atomicQueries.map(q => q.purpose);
        expect(purposes).toContain('disconfirm');
        expect(purposes).not.toContain('era-sweep');
    });
});
