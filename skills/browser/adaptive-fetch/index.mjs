// @ts-check

import { parseArgs } from 'node:util';
import { validateFetchUrl, DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS } from './safety.mjs';
import { appendAttempt, createAttemptTrace, summarizeAttempts } from './trace.mjs';
import { resolvePublicEndpointCandidates } from './endpoint-resolvers.mjs';
import { fetchTextCandidate } from './fetcher.mjs';
import { fromFetchResult, fromHumanResolvedResult, fromUserSessionResult } from './reader-adapters.mjs';
import { chooseBestReaderCandidate, scoreReaderCandidate } from './content-scorer.mjs';
import { fetchThirdPartyReaderCandidate } from './third-party-readers.mjs';
import { BrowserRequiredError } from './browser-runtime.mjs';
import { collectBrowserCandidate, collectNetworkJsonCandidates } from './browser-escalation.mjs';
import { fromBrowserResult, fromNetworkCandidate } from './reader-adapters.mjs';
import { classifyChallengeType } from './challenge-detector.mjs';
import { shouldTryUserSession, navigateInUserSession } from './browser-session.mjs';
import { humanResolve } from './human-loop.mjs';

/**
 * @typedef {'strong_ok'|'weak_ok'|'blocked'|'auth_required'|'challenge'|'paywall'|'browser_required'|'unsupported'|'error'} AdaptiveFetchVerdict
 * @typedef {'public_endpoint'|'fetch'|'reader'|'metadata'|'third_party_reader'|'browser'|'browser_user'|'human_resolved'|'network_api'|'validation'} AdaptiveFetchSource
 * @typedef {'auto'|'never'|'required'} BrowserMode
 * @typedef {'none'|'isolated'|'existing'|'user'|'interactive'} BrowserSessionMode
 * @typedef {'auto'|'minimal'|'chrome'} IdentityMode
 */

const BROWSER_MODES = new Set(['auto', 'never', 'required']);
const BROWSER_SESSIONS = new Set(['none', 'isolated', 'existing', 'user', 'interactive']);
const IDENTITY_MODES = new Set(['auto', 'minimal', 'chrome']);

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeAdaptiveFetchOptions(raw = {}) {
    const browserMode = normalizeEnum(raw.browserMode || raw.browser, BROWSER_MODES, 'auto', 'browser');
    const rawSession = raw.browserSession;
    const browserSession = normalizeEnum(rawSession, BROWSER_SESSIONS, browserMode === 'never' ? 'none' : 'isolated', 'browserSession');
    const identity = normalizeEnum(raw.identity, IDENTITY_MODES, 'auto', 'identity');
    const userSessionExplicit = browserSession === 'user' || browserSession === 'interactive';
    const humanLoop = browserSession === 'interactive';
    return {
        url: typeof raw.url === 'string' ? raw.url : '',
        json: Boolean(raw.json),
        trace: Boolean(raw.trace),
        browserMode,
        browserSession: userSessionExplicit ? 'existing' : browserSession,
        identity,
        userSessionExplicit,
        humanLoop,
        browserSessionRaw: browserSession,
        maxBytes: positiveInteger(raw.maxBytes, DEFAULT_MAX_BYTES),
        timeoutMs: positiveInteger(raw.timeoutMs, DEFAULT_TIMEOUT_MS),
        selector: typeof raw.selector === 'string' ? raw.selector : null,
        publicEndpoints: raw.publicEndpoints !== false,
        allowPrivateNetwork: Boolean(raw.allowPrivateNetwork),
        allowThirdPartyReader: Boolean(raw.allowThirdPartyReader),
        allowArchive: Boolean(raw.allowArchive),
        interactive: Boolean(raw.interactive),
        optionWarnings: raw.allowArchive ? ['archive-fallback-deferred'] : [],
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
        browserSession: options.browserSessionRaw || options.browserSession,
        identity: options.identity,
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
    if (options.browserMode !== 'required' && options.publicEndpoints) {
        candidateUrls.push(...resolvePublicEndpointCandidates(parsed).map(candidate => ({
            ...candidate,
            source: 'public_endpoint',
        })));
    }
    if (options.browserMode !== 'required') {
        candidateUrls.push({ label: 'direct-fetch', url: parsed.href, source: 'fetch' });
    }

    // Phase 0+1: public endpoints + direct fetch
    /** @type {any[]} */
    const readerCandidates = [];
    const fetchedUrls = new Set();
    /** @type {string[]} */
    const discoveredFeedUrls = [];
    /** @type {string[]} */
    const discoveredOembedUrls = [];
    /** @type {any} */
    let detectedChallenge = null;

    for (const candidate of candidateUrls) {
        let fetched;
        try {
            fetched = await fetchTextCandidate(candidate.url, {
                maxBytes: options.maxBytes,
                timeoutMs: options.timeoutMs,
                allowPrivateNetwork: options.allowPrivateNetwork,
                identity: options.identity,
                fetchImpl,
            });
        } catch (error) {
            appendAttempt(trace, {
                source: candidate.source,
                verdict: 'error',
                url: candidate.url,
                reason: (/** @type {any} */ (error)).message || 'fetch-candidate-error',
            });
            continue;
        }
        fetchedUrls.add(fetched.finalUrl || candidate.url);

        // Phase 04: classify challenge from response
        if (candidate.source === 'fetch' && !fetched.ok) {
            const challengeResult = classifyChallengeType({
                status: fetched.status,
                headers: fetched.headers,
                body: fetched.text,
            });
            if (challengeResult.type) {
                detectedChallenge = challengeResult;
                appendAttempt(trace, {
                    source: candidate.source,
                    verdict: challengeResult.type,
                    url: fetched.finalUrl,
                    status: fetched.status,
                    reason: `challenge:${challengeResult.type}`,
                    waf: challengeResult.primary?.profile?.id,
                });
            }
        }

        const readerCandidate = fromFetchResult(fetched, {
            source: candidate.source,
            label: candidate.label,
        });
        if (detectedChallenge && candidate.source === 'fetch') {
            readerCandidate.challenge = detectedChallenge;
        }
        for (const feedUrl of readerCandidate.metadata?.feedUrls || []) {
            if (!fetchedUrls.has(feedUrl) && !discoveredFeedUrls.includes(feedUrl)) discoveredFeedUrls.push(feedUrl);
        }
        for (const oEmbedUrl of readerCandidate.metadata?.oEmbedUrls || []) {
            if (!fetchedUrls.has(oEmbedUrl) && !discoveredOembedUrls.includes(oEmbedUrl)) discoveredOembedUrls.push(oEmbedUrl);
        }
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

    // Phase 1b: discovered feeds + oEmbed
    if (options.browserMode !== 'required' && options.publicEndpoints) {
        for (const discovered of [
            ...discoveredFeedUrls.map(url => ({ url, label: 'rss-atom-discovered' })),
            ...discoveredOembedUrls.map(url => ({ url, label: 'oembed-discovered' })),
        ]) {
            let fetched;
            try {
                fetched = await fetchTextCandidate(discovered.url, {
                    maxBytes: options.maxBytes,
                    timeoutMs: options.timeoutMs,
                    allowPrivateNetwork: options.allowPrivateNetwork,
                    identity: options.identity,
                    fetchImpl,
                });
            } catch (error) {
                appendAttempt(trace, {
                    source: 'public_endpoint',
                    verdict: 'error',
                    url: discovered.url,
                    reason: (/** @type {any} */ (error)).message || `${discovered.label}-error`,
                });
                continue;
            }
            fetchedUrls.add(fetched.finalUrl || discovered.url);
            const readerCandidate = fromFetchResult(fetched, {
                source: 'public_endpoint',
                label: discovered.label,
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
    }

    // Phase 2: third-party readers (opt-in)
    if (options.allowThirdPartyReader) {
        let fetched = null;
        try {
            fetched = await fetchThirdPartyReaderCandidate(parsed.href, {
                allowThirdPartyReader: true,
                maxBytes: options.maxBytes,
                timeoutMs: options.timeoutMs,
                fetchImpl,
            });
        } catch (error) {
            appendAttempt(trace, {
                source: 'third_party_reader',
                verdict: 'error',
                url: parsed.href,
                reason: (/** @type {any} */ (error)).message || 'third-party-reader-error',
            });
        }
        if (fetched) {
            const readerCandidate = fromFetchResult(fetched, {
                source: 'third_party_reader',
                label: 'jina-reader',
            });
            const scored = scoreReaderCandidate(readerCandidate);
            appendAttempt(trace, {
                source: readerCandidate.source,
                verdict: scored.verdict,
                url: fetched.readerUrl || fetched.finalUrl,
                status: fetched.status,
                reason: `score:${scored.score}`,
                evidence: scored.evidence,
                warnings: readerCandidate.warnings,
            });
            if (readerCandidate.text || readerCandidate.title) readerCandidates.push(readerCandidate);
        }
    }

    let best = chooseBestReaderCandidate(readerCandidates);
    if (shouldReturnWithoutBrowser(best, options)) return finishResult(resultFromReaderCandidate(best), options, trace);

    // Phase 3: isolated browser render + network API discovery
    const browserResult = await tryBrowserEscalation(parsed.href, options, deps, trace, detectedChallenge);
    if (browserResult) {
        readerCandidates.push(fromBrowserResult(browserResult));
        for (const networkCandidate of collectNetworkJsonCandidates(browserResult)) {
            readerCandidates.push(fromNetworkCandidate(networkCandidate));
        }
        best = chooseBestReaderCandidate(readerCandidates);
        if (best && best.verdict === 'strong_ok') {
            const result = resultFromReaderCandidate(best);
            if (options.userSessionExplicit) {
                result.safetyFlags = [...(result.safetyFlags || []), 'user_session_used'];
            }
            return finishResult(result, options, trace, { chromeUsed: true });
        }
    }

    // Phase 4: user's browser session
    const sessionDecision = shouldTryUserSession(readerCandidates, { ...options, browserDeps: deps });
    if (sessionDecision === true) {
        try {
            const userResult = await navigateInUserSession(parsed.href, {
                browserDeps: deps,
                timeoutMs: options.timeoutMs,
                selector: options.selector,
                allowPrivateNetwork: options.allowPrivateNetwork,
            });
            readerCandidates.push(fromUserSessionResult(userResult));
            appendAttempt(trace, {
                source: 'browser_user',
                verdict: 'strong_ok',
                url: userResult.finalUrl,
                reason: 'user-session-render',
            });
            best = chooseBestReaderCandidate(readerCandidates);
            if (best && best.verdict === 'strong_ok') {
                return finishResult(resultFromReaderCandidate(best), options, trace, { chromeUsed: true });
            }
        } catch (error) {
            appendAttempt(trace, {
                source: 'browser_user',
                verdict: 'error',
                url: parsed.href,
                reason: (/** @type {any} */ (error)).message || 'user-session-error',
            });
        }
    }

    // Phase 5: human-in-the-loop resolution
    if (options.humanLoop && hasUnresolvedChallenge(readerCandidates, best)) {
        const challengeInfo = detectedChallenge || { type: 'challenge' };
        try {
            const humanResult = await humanResolve(parsed.href, {
                ...options,
                browserDeps: deps,
            }, challengeInfo);
            if (humanResult.ok !== false) {
                readerCandidates.push(fromHumanResolvedResult(humanResult));
                appendAttempt(trace, {
                    source: 'human_resolved',
                    verdict: 'strong_ok',
                    url: humanResult.finalUrl || parsed.href,
                    reason: 'human-resolved',
                });
                best = chooseBestReaderCandidate(readerCandidates);
                if (best) return finishResult(resultFromReaderCandidate(best), options, trace, { chromeUsed: true });
            } else {
                appendAttempt(trace, {
                    source: 'human_resolved',
                    verdict: humanResult.verdict || 'blocked',
                    url: parsed.href,
                    reason: humanResult.actionMessage || 'human-action-needed',
                });
            }
        } catch (error) {
            appendAttempt(trace, {
                source: 'human_resolved',
                verdict: 'error',
                url: parsed.href,
                reason: (/** @type {any} */ (error)).message || 'human-loop-error',
            });
        }
    }

    // Final: best of all candidates
    if (best) return finishResult(resultFromReaderCandidate(best), options, trace, { chromeUsed: Boolean(browserResult) });
    return finishResult({
        ok: false,
        verdict: options.browserMode === 'required' ? 'browser_required' : 'blocked',
        source: options.browserMode === 'required' ? 'browser' : 'fetch',
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
            identity: { type: 'string', default: 'auto' },
            'no-browser': { type: 'boolean', default: false },
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
        browser: values['no-browser'] ? 'never' : values.browser,
        browserSession: values['browser-session'],
        identity: values.identity,
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
            [--browser-session none|isolated|existing|user|interactive]
            [--identity auto|minimal|chrome]

Read one URL through a 6-phase adaptive escalation ladder.
Not generic search — use search tools to find URLs first.

Options:
  --json                         Output JSON
  --trace                        Include attempt trace
  --browser auto|never|required  Browser escalation mode
  --no-browser                   Alias for --browser never
  --browser-session <mode>       Session mode:
      none       fresh cookie jar, no browser (HTTP phases)
      isolated   fresh Chrome profile, no cookies (browser phases)
      existing   reuse existing Chrome session
      user       user's authenticated browser session (explicit opt-in)
      interactive  user session + human-in-the-loop challenge resolution
  --identity auto|minimal|chrome Request identity headers
  --max-bytes N                  Maximum response bytes per read
  --timeout-ms N                 Per-attempt timeout
  --selector CSS                 Browser text extraction selector
  --allow-third-party-reader     Allow opt-in public reader services
  --no-public-endpoints          Skip known public endpoint resolvers
  --allow-archive                Accepted but deferred; emits a warning
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
        `browser: ${result.browserMode}/${result.browserSession} identity=${result.identity}`,
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
        ok: candidate.ok !== false && ['strong_ok', 'weak_ok'].includes(scored.verdict),
        verdict: scored.verdict,
        source: candidate.source,
        finalUrl: candidate.finalUrl,
        title: candidate.title || null,
        content: candidate.text || '',
        summary: `${candidate.label || candidate.source} selected with ${scored.verdict} (score ${scored.score}).`,
        reason: `score:${scored.score}`,
        evidence: scored.evidence,
        warnings: candidate.warnings || [],
        safetyFlags: candidate.safetyFlags || [],
        metadata: candidate.metadata || null,
    };
}

/**
 * @param {any} result
 * @param {any} options
 * @param {{ attempts: object[] }} trace
 * @param {{ chromeUsed?: boolean }} [runtime]
 */
function finishResult(result, options, trace, runtime = {}) {
    return {
        ok: result.ok,
        verdict: result.verdict,
        source: result.source,
        finalUrl: result.finalUrl,
        browserMode: options.browserMode,
        browserSession: options.browserSessionRaw || options.browserSession,
        identity: options.identity || 'auto',
        chromeUsed: Boolean(runtime.chromeUsed),
        chromeRequired: result.verdict === 'browser_required' || (options.browserMode === 'required' && !result.ok),
        title: result.title,
        content: result.content,
        summary: result.summary,
        attempts: options.trace ? trace.attempts : [],
        safetyFlags: Array.isArray(result.safetyFlags) ? result.safetyFlags : [],
        evidence: result.evidence || [],
        warnings: [...(options.optionWarnings || []), ...(result.warnings || [])],
        metadata: result.metadata || null,
        _traceSummary: summarizeAttempts(trace.attempts),
    };
}

/**
 * @param {ReturnType<typeof chooseBestReaderCandidate>|null} best
 * @param {any} options
 */
function shouldReturnWithoutBrowser(best, options) {
    if (options.browserMode === 'required') return false;
    if (options.browserMode === 'never') return Boolean(best);
    return Boolean(best && best.verdict === 'strong_ok');
}

/**
 * @param {string} url
 * @param {any} options
 * @param {Record<string, unknown>} deps
 * @param {{ attempts: object[] }} trace
 * @param {any} [challengeInfo]
 */
async function tryBrowserEscalation(url, options, deps, trace, challengeInfo) {
    if (options.browserMode === 'never') return null;
    try {
        const result = await collectBrowserCandidate(url, {
            browserDeps: deps,
            browserSession: options.browserSession,
            timeoutMs: options.timeoutMs,
            selector: options.selector,
            allowPrivateNetwork: options.allowPrivateNetwork,
            challengeInfo,
        });
        const scored = scoreReaderCandidate(fromBrowserResult(result));
        appendAttempt(trace, {
            source: 'browser',
            verdict: scored.verdict,
            url: result.finalUrl,
            status: result.status,
            reason: `score:${scored.score}`,
            evidence: scored.evidence,
            warnings: result.warnings,
        });
        for (const networkCandidate of collectNetworkJsonCandidates(result)) {
            const scoredNetwork = scoreReaderCandidate(fromNetworkCandidate(networkCandidate));
            appendAttempt(trace, {
                source: 'network_api',
                verdict: scoredNetwork.verdict,
                url: networkCandidate.finalUrl,
                status: networkCandidate.status,
                reason: `score:${scoredNetwork.score}`,
                evidence: scoredNetwork.evidence,
                warnings: networkCandidate.warnings || [],
            });
        }
        return result;
    } catch (error) {
        if (error instanceof BrowserRequiredError || (/** @type {any} */ (error))?.code === 'browser_required') {
            appendAttempt(trace, {
                source: 'browser',
                verdict: 'browser_required',
                url,
                reason: (/** @type {any} */ (error)).message,
            });
            return null;
        }
        throw error;
    }
}

/**
 * @param {any[]} candidates
 * @param {any} best
 */
function hasUnresolvedChallenge(candidates, best) {
    if (best && best.verdict === 'strong_ok') return false;
    return candidates.some(c =>
        c.challenge?.type === 'challenge' ||
        c.challenge?.type === 'auth_required' ||
        c.challenge?.type === 'paywall'
    ) || (best && ['challenge', 'auth_required', 'paywall', 'blocked'].includes(best.verdict));
}
