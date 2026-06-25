// @ts-check

import { buildRouteUrl, chooseKoreanRoute, detectSourceHints, needsBrowseEscalation } from './korean-routes.mjs';

const STOP_WORDS = [
    '찾아봐',
    '찾아줘',
    '알아봐',
    '검색해',
    '검색',
    '확인해',
    '알려줘',
    '경우',
    '문제',
    '사례',
    '해야',
    '하는',
    '있는',
    '없는',
];

/**
 * @param {string} problem
 * @param {{ maxQueries?: number }} [options]
 */
export function planKoreanResearch(problem = '', options = {}) {
    const normalized = normalizeProblem(problem);
    const sourceHints = detectSourceHints(normalized);
    const constraints = extractConstraints(normalized);
    const atomicQueries = buildAtomicQueries(normalized, constraints, sourceHints, options.maxQueries || 3);
    const browseRequired = sourceHints.includes('naver')
        || sourceHints.includes('structured')
        || needsBrowseEscalation(normalized);
    return {
        schemaVersion: 'research-plan-v1',
        problem: normalized,
        sourceHints,
        constraints,
        atomicQueries,
        followUp: {
            searchResultRole: 'url-candidates',
            fetchOriginalPages: true,
            browseRequired,
            browseReasons: browseRequired ? buildBrowseReasons(sourceHints, normalized) : [],
        },
    };
}

/**
 * @param {string} problem
 */
export function extractConstraints(problem = '') {
    const clauses = splitConstraintClauses(problem);
    const facetClauses = clauses.length === 1 ? extractFacetClauses(problem) : [];
    const finalClauses = facetClauses.length >= 2 ? facetClauses : clauses;
    return finalClauses.map((text, index) => ({
        id: `c${index + 1}`,
        text,
        mandatory: true,
        tags: detectSourceHints(text),
    }));
}

/**
 * @param {string} problem
 * @param {ReturnType<typeof extractConstraints>} constraints
 * @param {string[]} sourceHints
 * @param {number} maxQueries
 */
function buildAtomicQueries(problem, constraints, sourceHints, maxQueries) {
    const anchor = pickAnchorTerms(problem);
    const querySpecs = [];
    const route = chooseKoreanRoute(problem, sourceHints);
    const sourceTerms = sourceHintTerms(sourceHints);
    const dateTerms = extractDateTerms(problem);
    const structuredTerms = sourceHints.includes('structured') ? ['표', '목록', '항목'] : [];

    querySpecs.push({
        constraintIds: constraints.slice(0, 2).map(c => c.id),
        query: compactQuery([...anchor, ...sourceTerms, ...dateTerms, ...structuredTerms]),
        route,
        purpose: 'discovery',
    });

    if (constraints.length > 1) {
        querySpecs.push({
            constraintIds: constraints.slice(1, 4).map(c => c.id),
            query: compactQuery([...anchor.slice(0, 4), ...termsFromText(constraints.slice(1).map(c => c.text).join(' ')).slice(0, 6), ...sourceTerms]),
            route,
            purpose: 'verification',
        });
    }

    if (sourceHints.includes('official')) {
        querySpecs.push({
            constraintIds: constraints.map(c => c.id),
            query: compactQuery(['공식', '공지사항', ...anchor.slice(0, 5), ...dateTerms]),
            route: 'official_site',
            purpose: 'source-restricted-discovery',
        });
    } else if (sourceHints.includes('naver')) {
        querySpecs.push({
            constraintIds: constraints.map(c => c.id),
            query: compactQuery(['site:blog.naver.com', ...anchor.slice(0, 5), '원문']),
            route: 'naver_search',
            purpose: 'original-source-verification',
        });
    }

    // 202 A2: era-sweep for cultural-phenomenon clues (원조/최초/시초) to beat recency bias.
    if (looksLikeCulturalPhenomenon(problem)) {
        for (const spec of buildEraSweepQueries(anchor, route)) {
            querySpecs.push({ constraintIds: constraints.slice(0, 1).map(c => c.id), ...spec });
        }
    }
    // 202 A3: auto-emit a disconfirmation ("find a DIFFERENT entity") query.
    querySpecs.push({ constraintIds: [], ...buildDisconfirmQuery(anchor, route) });

    return dedupeQueries(querySpecs)
        .filter(spec => spec.query.length > 0)
        .slice(0, maxQueries)
        .map(spec => ({
            ...spec,
            url: buildRouteUrl(spec.route, spec.query),
        }));
}

const ERA_SWEEP_MARKERS = ['원조', '최초', '시초', '유래', '기원'];

/**
 * 202 A2: does the problem describe a cultural phenomenon whose origin matters (so a
 * recency-biased search would miss the original)?
 * @param {string} problem
 * @returns {boolean}
 */
export function looksLikeCulturalPhenomenon(problem = '') {
    return ERA_SWEEP_MARKERS.some(marker => problem.includes(marker)) || /밈|유행|짤|meme|trend/i.test(problem);
}

/**
 * 202 A2: era-sweep query specs — inject origin markers (+ anchor) to surface the original,
 * not the most recent, source.
 * @param {string[]} anchor
 * @param {string} [route]
 * @returns {Array<{ query: string, route: string, purpose: 'era-sweep' }>}
 */
export function buildEraSweepQueries(anchor = [], route = 'native_search') {
    const base = anchor.slice(0, 5);
    return [
        { query: compactQuery(['원조', '최초', ...base]), route, purpose: 'era-sweep' },
        { query: compactQuery(['시초', '유래', ...base]), route, purpose: 'era-sweep' },
    ].filter(spec => spec.query.length > 0);
}

/**
 * 202 A3: a disconfirmation query that actively looks for a DIFFERENT entity than the
 * leading candidate, to avoid confirmation bias.
 * @param {string[]} anchor
 * @param {string} [route]
 * @returns {{ query: string, route: string, purpose: 'disconfirm' }}
 */
export function buildDisconfirmQuery(anchor = [], route = 'native_search') {
    return { query: compactQuery([...anchor.slice(0, 5), '아닌', '다른', '비교']), route, purpose: 'disconfirm' };
}

/**
 * @param {string} problem
 */
function splitConstraintClauses(problem) {
    const normalized = normalizeProblem(problem);
    const numbered = normalized
        .split(/(?:^|\s)(?:\d+[.)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/u)
        .map(part => part.trim())
        .filter(part => part.length >= 4);
    const base = numbered.length > 1 ? numbered : normalized.split(/(?:,|;|그리고|또는|동시에|모두|이며|이고|와|과)/u);
    const clauses = base
        .map(clause => trimClause(clause))
        .filter(clause => clause.length >= 4);
    return clauses.length > 0 ? clauses.slice(0, 8) : [normalized];
}

/**
 * @param {string} problem
 */
function extractFacetClauses(problem) {
    const normalized = normalizeProblem(problem);
    const facets = [];
    const dates = normalized.match(/20\d{2}년?(?:\s*\d{1,2}월)?(?:\s*\d{1,2}일)?/g) || [];
    for (const date of dates) facets.push(date);
    const pages = normalized.match(/\d+\s*쪽|\d+\s*페이지/g) || [];
    for (const page of pages) facets.push(page.replace(/\s+/g, ''));
    if (/목차/.test(normalized)) facets.push('목차');
    if (/평점/.test(normalized)) facets.push('평점');
    if (/공지사항/.test(normalized)) facets.push('공지사항');
    if (/원문/.test(normalized)) facets.push('원문');
    const sourceTerms = termsFromText(normalized)
        .filter(term => /출판문화원|대학교|교보문고|네이버|나무위키|공식|MOOC/i.test(term))
        .slice(0, 4);
    return [...new Set([...sourceTerms, ...facets])].slice(0, 8);
}

/**
 * @param {string} text
 */
function pickAnchorTerms(text) {
    const terms = termsFromText(text);
    const rare = terms.filter(term => term.length >= 3 || /[A-Z0-9]/.test(term));
    return (rare.length ? rare : terms).slice(0, 8);
}

/**
 * @param {string} text
 */
function termsFromText(text) {
    return normalizeProblem(text)
        .replace(/[^\p{L}\p{N}:._-]+/gu, ' ')
        .split(/\s+/)
        .map(term => term.trim())
        .filter(term => term.length > 0)
        .filter(term => !STOP_WORDS.includes(term));
}

/**
 * @param {string[]} sourceHints
 */
function sourceHintTerms(sourceHints) {
    const terms = [];
    if (sourceHints.includes('naver')) terms.push('네이버');
    if (sourceHints.includes('namuwiki')) terms.push('나무위키');
    if (sourceHints.includes('official')) terms.push('공식');
    if (sourceHints.includes('bookstore')) terms.push('교보문고', 'YES24');
    if (sourceHints.includes('academic')) terms.push('논문', '학술');
    return terms;
}

/**
 * @param {string} text
 */
function extractDateTerms(text) {
    const matches = text.match(/20\d{2}년?|\d{1,2}월|\d{1,2}일|최신|현재|오늘|어제/g) || [];
    return [...new Set(matches)];
}

/**
 * @param {string[]} terms
 */
function compactQuery(terms) {
    return [...new Set(terms.map(term => term.trim()).filter(Boolean))]
        .slice(0, 12)
        .join(' ');
}

/**
 * @template {{ query: string }} T
 * @param {T[]} specs
 * @returns {T[]}
 */
function dedupeQueries(specs) {
    const seen = new Set();
    return specs.filter(spec => {
        if (seen.has(spec.query)) return false;
        seen.add(spec.query);
        return true;
    });
}

/**
 * @param {string[]} sourceHints
 * @param {string} problem
 */
function buildBrowseReasons(sourceHints, problem) {
    return [
        sourceHints.includes('naver') ? 'naver-shell-or-iframe-risk' : null,
        sourceHints.includes('structured') ? 'table-list-ordinal-requires-dom' : null,
        /동적|javascript|자바스크립트|탭|필터|페이지네이션|무한스크롤/i.test(problem) ? 'dynamic-page-state' : null,
    ].filter(Boolean);
}

/**
 * @param {string} text
 */
function trimClause(text) {
    return normalizeProblem(text).replace(/^(중|에서|의)\s+/u, '').trim();
}

/**
 * @param {string} text
 */
function normalizeProblem(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}
