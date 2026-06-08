// @ts-check

import { runAdaptiveFetch } from '../adaptive-fetch/index.mjs';
import { createConstraintLedger, summarizeLedger, updateLedgerWithEvidence } from './constraint-ledger.mjs';

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TEXT_EXCERPT_CHARS = 800;

/**
 * @param {ReturnType<import('./search-strategy.mjs').planKoreanResearch>} plan
 * @param {ReturnType<import('./normalizer.mjs').normalizeSearchResults>} normalizedResults
 * @param {{
 *   maxResults?: number,
 *   browser?: 'auto'|'never'|'required',
 *   trace?: boolean,
 *   timeoutMs?: number,
 *   maxBytes?: number
 * }} [options]
 * @param {{ runAdaptiveFetch?: typeof runAdaptiveFetch }} [deps]
 */
export async function enrichSearchResultsWithFetch(plan, normalizedResults, options = {}, deps = {}) {
    const maxResults = nonNegativeInteger(options.maxResults, DEFAULT_MAX_RESULTS);
    const browser = normalizeBrowserMode(options.browser || 'never');
    const fetchRunner = deps.runAdaptiveFetch || runAdaptiveFetch;
    let ledger = createConstraintLedger(plan.constraints || []);
    const candidates = [];
    const rows = Array.isArray(normalizedResults.results) ? normalizedResults.results.slice(0, maxResults) : [];

    for (const result of rows) {
        const beforeSupported = new Set(ledger.supported || []);
        const discoveryConstraintIds = findDiscoveryConstraintIds(plan, normalizedResults.query);
        const fetched = await fetchRunner({
            url: result.url,
            json: true,
            trace: Boolean(options.trace),
            browser,
            timeoutMs: options.timeoutMs,
            maxBytes: options.maxBytes,
        });
        const text = typeof fetched.content === 'string' ? fetched.content : '';
        ledger = updateLedgerWithEvidence(ledger, {
            url: fetched.finalUrl || result.url,
            title: fetched.title || '',
            text,
            candidate: result.title || result.url,
            source: fetched.source || 'fetch',
        });
        const supportedConstraintIds = (ledger.supported || []).filter(id => !beforeSupported.has(id));
        candidates.push({
            rank: result.rank || candidates.length + 1,
            url: result.url,
            title: result.title || '',
            snippet: result.snippet || '',
            date: result.date || null,
            discoveryConstraintIds,
            constraintIds: supportedConstraintIds,
            fetch: compactFetchResult(fetched, result.url),
        });
    }

    const summary = summarizeLedger(ledger);
    return {
        schemaVersion: 'research-fetch-enrichment-v1',
        planSchemaVersion: plan.schemaVersion || 'unknown',
        resultSchemaVersion: normalizedResults.schemaVersion || 'unknown',
        query: normalizedResults.query || '',
        fetchPolicy: {
            browser,
            maxResults,
            trace: Boolean(options.trace),
        },
        candidates,
        ledger,
        summary,
        nextStep: buildNextStep(plan, candidates, summary),
    };
}

/**
 * @param {ReturnType<import('./search-strategy.mjs').planKoreanResearch>} plan
 * @param {string} query
 */
function findDiscoveryConstraintIds(plan, query = '') {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];
    const matched = (plan.atomicQueries || [])
        .find(item => normalizeText(item.query) === normalizedQuery);
    return matched?.constraintIds || [];
}

/**
 * @param {any} fetched
 * @param {string} fallbackUrl
 */
function compactFetchResult(fetched, fallbackUrl) {
    return {
        ok: Boolean(fetched.ok),
        verdict: fetched.verdict || 'unknown',
        source: fetched.source || 'fetch',
        finalUrl: fetched.finalUrl || fallbackUrl,
        title: fetched.title || null,
        textExcerpt: excerpt(fetched.content || ''),
        warnings: Array.isArray(fetched.warnings) ? fetched.warnings : [],
        evidence: Array.isArray(fetched.evidence) ? fetched.evidence : [],
        chromeRequired: Boolean(fetched.chromeRequired),
        chromeUsed: Boolean(fetched.chromeUsed),
    };
}

/**
 * @param {ReturnType<import('./search-strategy.mjs').planKoreanResearch>} plan
 * @param {Array<{ fetch: { ok: boolean, verdict: string, chromeRequired: boolean } }>} candidates
 * @param {ReturnType<typeof summarizeLedger>} summary
 */
function buildNextStep(plan, candidates, summary) {
    const fetchInsufficient = !summary.ready || candidates.some(candidate => (
        !candidate.fetch.ok
        || ['weak_ok', 'blocked', 'auth_required', 'challenge', 'paywall', 'browser_required', 'unsupported', 'error'].includes(candidate.fetch.verdict)
        || candidate.fetch.chromeRequired
    ));
    if (plan.followUp?.browseRequired || fetchInsufficient) {
        return {
            type: 'browse-candidates',
            reason: plan.followUp?.browseRequired
                ? 'plan-requires-browse-verification'
                : 'fetch-insufficient-or-constraints-pending',
        };
    }
    return {
        type: 'finalize-ready',
        reason: 'all-mandatory-constraints-supported-by-fetched-pages',
    };
}

/**
 * @param {string} text
 */
function excerpt(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > DEFAULT_TEXT_EXCERPT_CHARS
        ? `${value.slice(0, DEFAULT_TEXT_EXCERPT_CHARS)}...`
        : value;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function nonNegativeInteger(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * @param {string} value
 */
function normalizeBrowserMode(value) {
    if (['auto', 'never', 'required'].includes(value)) return /** @type {'auto'|'never'|'required'} */ (value);
    throw new Error(`invalid browser mode: ${value}`);
}

/**
 * @param {string} value
 */
function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}
