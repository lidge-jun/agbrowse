// @ts-check

import { parseArgs } from 'node:util';
import { validateFetchUrl, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS } from './safety.mjs';
import { appendAttempt, createAttemptTrace, summarizeAttempts } from './trace.mjs';
import { resolvePublicEndpointCandidates } from './endpoint-resolvers.mjs';
import { fetchTextCandidate } from './fetcher.mjs';
import { fromFetchResult } from './reader-adapters.mjs';
import { chooseBestReaderCandidate, scoreReaderCandidate } from './content-scorer.mjs';

/**
 * @typedef {'strong_ok'|'weak_ok'|'blocked'|'auth_required'|'challenge'|'paywall'|'browser_required'|'unsupported'|'error'} AdaptiveFetchVerdict
 * @typedef {'public_endpoint'|'fetch'|'reader'|'metadata'|'third_party_reader'|'browser'|'network_api'|'validation'} AdaptiveFetchSource
 * @typedef {'auto'|'never'|'required'} BrowserMode
 * @typedef {'none'|'isolated'|'existing'} BrowserSessionMode
 */

const BROWSER_MODES = new Set(['auto', 'never', 'required']);
const BROWSER_SESSIONS = new Set(['none', 'isolated', 'existing']);

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeAdaptiveFetchOptions(raw = {}) {
    const browserMode = normalizeEnum(raw.browserMode || raw.browser, BROWSER_MODES, 'auto', 'browser');
    const browserSession = normalizeEnum(raw.browserSession, BROWSER_SESSIONS, browserMode === 'never' ? 'none' : 'isolated', 'browserSession');
    return {
        url: typeof raw.url === 'string' ? raw.url : '',
        json: Boolean(raw.json),
        trace: Boolean(raw.trace),
        browserMode,
        browserSession,
        maxBytes: positiveInteger(raw.maxBytes, DEFAULT_MAX_BYTES),
        timeoutMs: positiveInteger(raw.timeoutMs, DEFAULT_TIMEOUT_MS),
        selector: typeof raw.selector === 'string' ? raw.selector : null,
        publicEndpoints: raw.publicEndpoints !== false,
        allowPrivateNetwork: Boolean(raw.allowPrivateNetwork),
        allowThirdPartyReader: Boolean(raw.allowThirdPartyReader),
        allowArchive: Boolean(raw.allowArchive),
    };
}

/**
 * @param {Record<string, unknown>} input
 * @param {Record<string, unknown>} [deps]
 */
export async function runAdaptiveFetch(input, deps = {}) {
    const options = normalizeAdaptiveFetchOptions(input);
    const trace = createAttemptTrace({
        url: options.url,
        browserMode: options.browserMode,
        browserSession: options.browserSession,
    });
    const fetchImpl = /** @type {typeof fetch | undefined} */ (deps.fetch || input.fetchImpl);
    const parsed = validateFetchUrl(options.url, { allowPrivateNetwork: options.allowPrivateNetwork });
    appendAttempt(trace, {
        source: 'validation',
        verdict: 'weak_ok',
        url: parsed.href,
        reason: 'url-valid',
    });
    /** @type {any[]} */
    const candidateUrls = [];
    if (options.publicEndpoints) {
        candidateUrls.push(...resolvePublicEndpointCandidates(parsed).map(candidate => ({
            ...candidate,
            source: 'public_endpoint',
        })));
    }
    candidateUrls.push({ label: 'direct-fetch', url: parsed.href, source: 'fetch' });
    /** @type {any[]} */
    const readerCandidates = [];
    for (const candidate of candidateUrls) {
        const fetched = await fetchTextCandidate(candidate.url, {
            maxBytes: options.maxBytes,
            timeoutMs: options.timeoutMs,
            allowPrivateNetwork: options.allowPrivateNetwork,
            fetchImpl,
        });
        const readerCandidate = fromFetchResult(fetched, {
            source: candidate.source,
            label: candidate.label,
        });
        const scored = scoreReaderCandidate(readerCandidate);
        appendAttempt(trace, {
            source: readerCandidate.source,
            verdict: scored.verdict,
            url: fetched.finalUrl,
            status: fetched.status,
            reason: `score:${scored.score}`,
            evidence: scored.evidence,
            warnings: readerCandidate.warnings,
        });
        if (readerCandidate.text || readerCandidate.title) readerCandidates.push(readerCandidate);
    }
    const best = chooseBestReaderCandidate(readerCandidates);
    if (best) return finishResult(resultFromReaderCandidate(best), options, trace);
    return finishResult({
        ok: false,
        verdict: 'blocked',
        source: 'fetch',
        finalUrl: parsed.href,
        title: null,
        content: '',
        summary: 'No public endpoint, fetch, or metadata attempt produced readable content.',
        reason: 'no-readable-content',
        evidence: [],
        warnings: [],
    }, options, trace);
}

/**
 * @param {string[]} args
 * @param {Record<string, unknown>} [deps]
 */
export async function runAdaptiveFetchCli(args, deps = {}) {
    const { values, positionals } = parseArgs({
        args,
        allowPositionals: true,
        strict: false,
        options: {
            json: { type: 'boolean', default: false },
            trace: { type: 'boolean', default: false },
            browser: { type: 'string', default: 'auto' },
            'browser-session': { type: 'string' },
            'max-bytes': { type: 'string' },
            'timeout-ms': { type: 'string' },
            selector: { type: 'string' },
            'no-public-endpoints': { type: 'boolean', default: false },
            'allow-third-party-reader': { type: 'boolean', default: false },
            'allow-archive': { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    if (values.help || positionals.length === 0) {
        console.log(formatAdaptiveFetchHelp());
        return;
    }
    const result = await runAdaptiveFetch({
        url: positionals[0],
        json: values.json,
        trace: values.trace,
        browser: values.browser,
        browserSession: values['browser-session'],
        maxBytes: values['max-bytes'],
        timeoutMs: values['timeout-ms'],
        selector: values.selector,
        publicEndpoints: !values['no-public-endpoints'],
        allowThirdPartyReader: values['allow-third-party-reader'],
        allowArchive: values['allow-archive'],
    }, deps);
    if (values.json) {
        const { _traceSummary, ...jsonResult } = result;
        console.log(JSON.stringify(jsonResult, null, 2));
    } else {
        console.log(formatAdaptiveFetchHuman(result));
    }
}

export function formatAdaptiveFetchHelp() {
    return `agbrowse fetch <url> [--json] [--trace] [--browser auto|never|required]

Read one URL or search-result URL through public endpoints, fetch, metadata,
optional public readers, and browser escalation. Not generic search.

Options:
  --json                         Output JSON
  --trace                        Include attempt trace
  --browser auto|never|required  Browser escalation mode
  --browser-session none|isolated|existing
  --allow-third-party-reader     Allow opt-in public reader services
  --no-public-endpoints          Skip known public endpoint resolvers
`;
}

/**
 * @param {Record<string, any>} result
 */
export function formatAdaptiveFetchHuman(result) {
    return [
        `ok: ${result.ok}`,
        `verdict: ${result.verdict}`,
        `source: ${result.source}`,
        `final_url: ${result.finalUrl}`,
        `browser: ${result.browserMode}/${result.browserSession}`,
        `summary: ${result.summary}`,
    ].join('\n');
}

/**
 * @param {unknown} value
 * @param {Set<string>} allowed
 * @param {string} fallback
 * @param {string} name
 */
function normalizeEnum(value, allowed, fallback, name) {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value);
    if (!allowed.has(text)) throw new Error(`invalid ${name}: ${text}`);
    return text;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function positiveInteger(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * @param {ReturnType<typeof scoreReaderCandidate>} scored
 */
function resultFromReaderCandidate(scored) {
    const candidate = scored.candidate;
    return {
        ok: ['strong_ok', 'weak_ok'].includes(scored.verdict),
        verdict: scored.verdict,
        source: candidate.source,
        finalUrl: candidate.finalUrl,
        title: candidate.title || null,
        content: candidate.text || '',
        summary: `${candidate.label || candidate.source} selected with ${scored.verdict} (score ${scored.score}).`,
        reason: `score:${scored.score}`,
        evidence: scored.evidence,
        warnings: candidate.warnings || [],
        metadata: candidate.metadata || null,
    };
}

/**
 * @param {any} result
 * @param {any} options
 * @param {{ attempts: object[] }} trace
 */
function finishResult(result, options, trace) {
    return {
        ok: result.ok,
        verdict: result.verdict,
        source: result.source,
        finalUrl: result.finalUrl,
        browserMode: options.browserMode,
        browserSession: options.browserSession,
        chromeUsed: false,
        chromeRequired: options.browserMode === 'required' && !result.ok,
        title: result.title,
        content: result.content,
        summary: result.summary,
        attempts: options.trace ? trace.attempts : [],
        safetyFlags: [],
        evidence: result.evidence || [],
        warnings: result.warnings || [],
        metadata: result.metadata || null,
        _traceSummary: summarizeAttempts(trace.attempts),
    };
}
