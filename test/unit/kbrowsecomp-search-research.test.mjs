import { describe, expect, it } from 'vitest';
import { createConstraintLedger, summarizeLedger, updateLedgerWithEvidence } from '../../skills/browser/search-research/constraint-ledger.mjs';
import { enrichSearchResultsWithFetch } from '../../skills/browser/search-research/fetch-enrichment.mjs';
import { buildRouteUrl, chooseKoreanRoute, detectSourceHints, needsBrowseEscalation } from '../../skills/browser/search-research/korean-routes.mjs';
import { normalizeSearchResults } from '../../skills/browser/search-research/normalizer.mjs';
import { planKoreanResearch } from '../../skills/browser/search-research/search-strategy.mjs';

describe('K-BrowseComp search research planning', () => {
    it('rewrites a Korean policy freshness prompt into focused official URL-candidate queries', () => {
        const plan = planKoreanResearch('2026년 한국 전기차 보조금 지자체별 차이 최신 기준 찾아봐');
        expect(plan.schemaVersion).toBe('research-plan-v1');
        expect(plan.sourceHints).toEqual(expect.arrayContaining(['official', 'date']));
        expect(plan.atomicQueries.length).toBeGreaterThanOrEqual(2);
        expect(plan.atomicQueries.length).toBeLessThanOrEqual(3);
        expect(plan.atomicQueries[0].query).toContain('2026');
        expect(plan.atomicQueries.some(query => query.query.includes('공식'))).toBe(true);
        expect(plan.followUp.searchResultRole).toBe('url-candidates');
        expect(plan.followUp.fetchOriginalPages).toBe(true);
    });

    it('marks Naver original review checks as requiring browse verification after candidate discovery', () => {
        const plan = planKoreanResearch('네이버 블로그 글에서 특정 후기 원문 확인이 필요한 경우 검색 결과만으로 충분한가');
        expect(plan.sourceHints).toContain('naver');
        expect(plan.atomicQueries.some(query => query.query.includes('site:blog.naver.com'))).toBe(true);
        expect(plan.followUp.browseRequired).toBe(true);
        expect(plan.followUp.browseReasons).toContain('naver-shell-or-iframe-risk');
    });

    it('splits K-BrowseComp-style multi-constraint prompts instead of searching the full problem once', () => {
        const plan = planKoreanResearch('한국 영화 중 신인 감독상과 신인 여우상 조건이 모두 맞고, 뮤지컬화 여부와 네이버 영화 평점을 확인해야 하는 사례를 찾아봐');
        expect(plan.constraints.length).toBeGreaterThanOrEqual(3);
        expect(plan.atomicQueries.length).toBeGreaterThanOrEqual(2);
        expect(plan.atomicQueries.every(query => query.query.length < plan.problem.length)).toBe(true);
        expect(new Set(plan.atomicQueries.flatMap(query => query.constraintIds)).size).toBeGreaterThanOrEqual(2);
    });

    it('routes source hints to Korean-specific routes and URLs', () => {
        expect(detectSourceHints('교보문고 2024년 출판 도서 목차')).toEqual(expect.arrayContaining(['bookstore', 'date']));
        expect(chooseKoreanRoute('나무위키 인물 정보')).toBe('namuwiki');
        expect(buildRouteUrl('naver_search', '네이버 블로그 후기')).toContain('search.naver.com');
        expect(needsBrowseEscalation('표에서 n번째 항목을 확인')).toBe(true);
    });

    it('keeps the constraint ledger pending until original evidence supports every mandatory condition', () => {
        const plan = planKoreanResearch('고려대학교출판문화원 2024년 12월 27일 540쪽 MOOC 목차');
        let ledger = createConstraintLedger(plan.constraints);
        ledger = updateLedgerWithEvidence(ledger, {
            url: 'https://example.com/book',
            title: '고려대학교출판문화원 MOOC 도서',
            text: '고려대학교출판문화원에서 출판한 MOOC 도서 소개입니다.',
            candidate: 'MOOC 도서',
        });
        expect(summarizeLedger(ledger).ready).toBe(false);
        ledger = updateLedgerWithEvidence(ledger, {
            url: 'https://example.com/book-detail',
            title: 'MOOC 목차',
            text: '2024년 12월 27일 출간, 540쪽, 목차 제공.',
            candidate: 'MOOC 도서',
        });
        const summary = summarizeLedger(ledger);
        expect(summary.status).toBe('complete');
        expect(summary.pending).toEqual([]);
    });

    it('normalizes provider result shapes into URL candidates without treating snippets as evidence', () => {
        const normalized = normalizeSearchResults({
            backend: 'tavily',
            query: '교보문고 MOOC 목차',
            results: [
                { url: 'https://example.com/book#section', title: 'Book', content: '목차 일부' },
                { link: 'https://example.com/book', title: 'Duplicate', snippet: 'same URL' },
                { href: 'https://example.com/review', name: 'Review', publishedDate: '2026-01-01' },
                { title: 'No URL', snippet: 'drop me' },
            ],
        });
        expect(normalized.schemaVersion).toBe('search-results-v1');
        expect(normalized.backend).toBe('tavily');
        expect(normalized.results).toHaveLength(2);
        expect(normalized.results[0]).toMatchObject({
            url: 'https://example.com/book',
            title: 'Book',
            snippet: '목차 일부',
            rank: 1,
        });
        expect(normalized.results[1].date).toBe('2026-01-01');
        expect(normalized.dropped.map(row => row.reason)).toEqual([
            'duplicate-url',
            'missing-or-invalid-url',
        ]);
        expect(normalized.evidencePolicy).toBe('snippets-are-not-final-evidence');
    });

    it('normalizes bare Exa-like arrays and preserves raw diagnostic fields', () => {
        const normalized = normalizeSearchResults([
            { url: 'https://example.org/a', title: 'A', text: 'exa text', score: 0.82 },
            { url: 'ftp://example.org/b', title: 'Invalid scheme' },
        ], { backend: 'exa', query: '한국어 쿼리' });
        expect(normalized.backend).toBe('exa');
        expect(normalized.query).toBe('한국어 쿼리');
        expect(normalized.results).toHaveLength(1);
        expect(normalized.results[0].raw).toMatchObject({ score: 0.82 });
        expect(normalized.dropped[0].reason).toBe('missing-or-invalid-url');
    });

    it('enriches URL candidates by fetch and keeps snippets out of the evidence ledger', async () => {
        const plan = planKoreanResearch('고려대학교출판문화원 2024년 12월 27일 540쪽 MOOC 목차');
        const normalized = normalizeSearchResults({
            backend: 'exa',
            query: plan.atomicQueries[0].query,
            results: [
                {
                    url: 'https://example.com/book',
                    title: 'Search snippet title',
                    snippet: '2024년 12월 27일 540쪽 목차가 있다는 검색 스니펫',
                },
            ],
        });
        const enriched = await enrichSearchResultsWithFetch(plan, normalized, {}, {
            runAdaptiveFetch: async input => ({
                ok: true,
                verdict: 'strong_ok',
                source: 'fetch',
                finalUrl: input.url,
                title: '도서 소개',
                content: '이 페이지는 일반적인 도서 소개 본문입니다.',
                evidence: ['readable-text'],
                warnings: [],
            }),
        });
        expect(enriched.schemaVersion).toBe('research-fetch-enrichment-v1');
        expect(enriched.candidates[0].discoveryConstraintIds.length).toBeGreaterThan(0);
        expect(enriched.candidates[0].constraintIds).not.toEqual(
            expect.arrayContaining(enriched.candidates[0].discoveryConstraintIds)
        );
        expect(enriched.summary.ready).toBe(false);
        expect(enriched.summary.pending.length).toBeGreaterThan(0);
        expect(enriched.nextStep.type).toBe('browse-candidates');
    });

    it('updates the ledger only when fetched original text supports the remaining constraints', async () => {
        const plan = planKoreanResearch('고려대학교출판문화원 2024년 12월 27일 540쪽 MOOC 목차');
        const normalized = normalizeSearchResults({
            query: plan.atomicQueries[0].query,
            results: [
                { url: 'https://example.com/book', title: 'MOOC book', snippet: 'diagnostic only' },
            ],
        });
        const enriched = await enrichSearchResultsWithFetch(plan, normalized, { browser: 'never' }, {
            runAdaptiveFetch: async input => ({
                ok: true,
                verdict: 'strong_ok',
                source: 'fetch',
                finalUrl: input.url,
                title: '고려대학교출판문화원 MOOC 목차',
                content: '2024년 12월 27일 출간, 540쪽, 목차 제공.',
                evidence: ['original-page-text'],
                warnings: [],
            }),
        });
        expect(enriched.fetchPolicy.browser).toBe('never');
        expect(enriched.summary.status).toBe('complete');
        expect(enriched.summary.pending).toEqual([]);
        expect(enriched.candidates[0].constraintIds).toEqual(expect.arrayContaining(plan.constraints.map(constraint => constraint.id)));
        expect(enriched.nextStep.type).toBe('finalize-ready');
    });

    it('does not let search result titles satisfy constraints when fetched page evidence is empty', async () => {
        const plan = planKoreanResearch('고려대학교출판문화원 2024년 12월 27일 540쪽 MOOC 목차');
        const normalized = normalizeSearchResults({
            query: plan.atomicQueries[0].query,
            results: [
                {
                    url: 'https://example.com/book',
                    title: '고려대학교출판문화원 2024년 12월 27일 540쪽 MOOC 목차',
                    snippet: '검색 결과 메타데이터는 진단용일 뿐입니다.',
                },
            ],
        });
        const enriched = await enrichSearchResultsWithFetch(plan, normalized, {}, {
            runAdaptiveFetch: async input => ({
                ok: true,
                verdict: 'strong_ok',
                source: 'fetch',
                finalUrl: input.url,
                title: null,
                content: 'irrelevant fetched body',
                evidence: [],
                warnings: [],
            }),
        });
        expect(enriched.summary.status).toBe('insufficient-evidence');
        expect(enriched.summary.ready).toBe(false);
        expect(enriched.summary.supported).toEqual([]);
        expect(enriched.candidates[0].constraintIds).toEqual([]);
    });
});
