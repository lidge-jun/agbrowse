// @ts-check

// Parity catalog 203.7 (P3): lane-classified candidate discovery at fetch time. Ranks
// discovered URLs into lanes (official/package/academic/community/realtime/archive/fetch)
// with SSRF rejection, tracking-param normalization, dedup, and scoring. Reverse port of
// cli-jaw adaptive-fetch/candidate-discovery.ts. Pure.

import { validateFetchUrl } from './safety.mjs';

/**
 * @typedef {'official'|'community'|'realtime'|'academic'|'package'|'archive'|'fetch'} CandidateDiscoveryLane
 * @typedef {{ url: string, title?: string, snippet?: string, source?: string, lane?: CandidateDiscoveryLane }} CandidateDiscoveryInput
 * @typedef {{ url: string, normalizedUrl: string, hostname: string, title: string, snippet: string, source: string, lane: CandidateDiscoveryLane, score: number, reasons: string[] }} RankedDiscoveryCandidate
 * @typedef {{ officialDomains?: string[], maxCandidates?: number }} CandidateDiscoveryOptions
 * @typedef {{ candidates: RankedDiscoveryCandidate[], lanes: Record<CandidateDiscoveryLane, RankedDiscoveryCandidate[]>, rejected: { url: string, reason: string }[] }} CandidateDiscoveryResult
 */

/** @type {CandidateDiscoveryLane[]} */
const LANE_ORDER = ['official', 'package', 'academic', 'community', 'realtime', 'archive', 'fetch'];
/** @type {Record<CandidateDiscoveryLane, number>} */
const LANE_BASE_SCORE = {
    official: 80,
    package: 72,
    academic: 70,
    community: 58,
    realtime: 54,
    archive: 45,
    fetch: 40,
};

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractCandidateUrlsFromText(text) {
    const urls = [...text.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)]
        .map((match) => match[0].replace(/[.,;:!?]+$/g, ''));
    return [...new Set(urls)];
}

/**
 * @param {CandidateDiscoveryInput[]} inputs
 * @param {CandidateDiscoveryOptions} [options]
 * @returns {CandidateDiscoveryResult}
 */
export function rankDiscoveredCandidates(inputs, options = {}) {
    /** @type {{ url: string, reason: string }[]} */
    const rejected = [];
    /** @type {Map<string, RankedDiscoveryCandidate>} */
    const byUrl = new Map();
    for (const input of inputs) {
        const parsed = parsePublicUrl(input.url, rejected);
        if (!parsed) continue;
        const normalizedUrl = normalizeCandidateUrl(parsed);
        const lane = input.lane || classifyCandidateLane(parsed, input, options);
        const reasons = scoreReasons(parsed, lane, input, options);
        /** @type {RankedDiscoveryCandidate} */
        const candidate = {
            url: parsed.href,
            normalizedUrl,
            hostname: parsed.hostname,
            title: input.title || '',
            snippet: input.snippet || '',
            source: input.source || 'native_search',
            lane,
            score: LANE_BASE_SCORE[lane] + reasons.length * 3 + (parsed.protocol === 'https:' ? 2 : 0),
            reasons,
        };
        const existing = byUrl.get(normalizedUrl);
        if (!existing || candidate.score > existing.score) byUrl.set(normalizedUrl, candidate);
    }

    const candidates = [...byUrl.values()]
        .sort((a, b) => b.score - a.score || LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane))
        .slice(0, options.maxCandidates || 12);
    return { candidates, lanes: groupByLane(candidates), rejected };
}

/**
 * @param {string} url
 * @param {{ url: string, reason: string }[]} rejected
 * @returns {URL|null}
 */
function parsePublicUrl(url, rejected) {
    try {
        return validateFetchUrl(url, { allowPrivateNetwork: false });
    } catch (error) {
        rejected.push({ url, reason: (/** @type {Error} */ (error)).message || 'invalid-url' });
        return null;
    }
}

/**
 * @param {URL} url
 * @param {CandidateDiscoveryInput} input
 * @param {CandidateDiscoveryOptions} options
 * @returns {CandidateDiscoveryLane}
 */
function classifyCandidateLane(url, input, options) {
    const host = url.hostname.replace(/^www\./, '');
    const haystack = `${input.title || ''}\n${input.snippet || ''}\n${host}`.toLowerCase();
    if ((options.officialDomains || []).some((domain) => domainMatch(host, domain))) return 'official';
    if (/^(docs?|developer|dev|api)\./i.test(host) || /\bofficial\b|\bdocs?\b|\bapi reference\b/.test(haystack)) return 'official';
    if (/github\.com|npmjs\.com|pypi\.org|crates\.io|pkg\.go\.dev|packagist\.org|rubygems\.org$/i.test(host)) return 'package';
    if (/arxiv\.org|doi\.org|crossref\.org|pubmed\.ncbi\.nlm\.nih\.gov|semanticscholar\.org|scholar\.google\./i.test(host)) return 'academic';
    if (/reddit\.com|stackoverflow\.com|stackexchange\.com|news\.ycombinator\.com|lobste\.rs|dev\.to|v2ex\.com/i.test(host)) return 'community';
    if (/x\.com|twitter\.com|bsky\.app|mastodon\.social|threads\.net/i.test(host)) return 'realtime';
    if (/webcache|archive\.org|web\.archive\.org/i.test(host)) return 'archive';
    return 'fetch';
}

/**
 * @param {URL} url
 * @param {CandidateDiscoveryLane} lane
 * @param {CandidateDiscoveryInput} input
 * @param {CandidateDiscoveryOptions} options
 * @returns {string[]}
 */
function scoreReasons(url, lane, input, options) {
    const reasons = [lane];
    const host = url.hostname.replace(/^www\./, '');
    if ((options.officialDomains || []).some((domain) => domainMatch(host, domain))) reasons.push('official-domain-match');
    if (input.title) reasons.push('title-present');
    if (input.snippet) reasons.push('snippet-present');
    if (!hasTrackingParams(url)) reasons.push('clean-url');
    if (url.pathname && url.pathname !== '/') reasons.push('deep-link');
    return reasons;
}

/** @param {URL} url @returns {string} */
function normalizeCandidateUrl(url) {
    const copy = new URL(url.href);
    copy.hash = '';
    for (const key of [...copy.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|mc_cid|mc_eid)/i.test(key)) copy.searchParams.delete(key);
    }
    copy.hostname = copy.hostname.replace(/^www\./, '');
    return copy.href.replace(/\/$/, '');
}

/** @param {URL} url @returns {boolean} */
function hasTrackingParams(url) {
    return [...url.searchParams.keys()].some((key) => /^(utm_|fbclid|gclid|mc_cid|mc_eid)/i.test(key));
}

/**
 * @param {RankedDiscoveryCandidate[]} candidates
 * @returns {Record<CandidateDiscoveryLane, RankedDiscoveryCandidate[]>}
 */
function groupByLane(candidates) {
    const lanes = LANE_ORDER.reduce((acc, lane) => {
        acc[lane] = [];
        return acc;
    }, /** @type {Record<CandidateDiscoveryLane, RankedDiscoveryCandidate[]>} */ ({}));
    for (const candidate of candidates) lanes[candidate.lane].push(candidate);
    return lanes;
}

/** @param {string} host @param {string} domain @returns {boolean} */
function domainMatch(host, domain) {
    const clean = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || domain;
    return host === clean || host.endsWith(`.${clean}`);
}
