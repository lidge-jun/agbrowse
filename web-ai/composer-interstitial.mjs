// @ts-check
// Shared composer-readiness interstitial classification (G13b).
//
// ChatGPT already does this inline (`waitForChatGptComposerReady`); this module
// gives Grok and Gemini the same behavior: when the composer never appears, ask
// a bounded provider-scoped probe whether an interstitial is the reason, and
// only then replace the composer error with a typed `provider.interstitial`
// carrying the detector's own retry hint.

import { detectInterstitial, INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER } from './interstitial.mjs';
import { WebAiError } from './errors.mjs';

/**
 * Re-classify a composer-readiness failure as a provider interstitial when a
 * bounded, provider-scoped probe finds one.
 *
 * Returns the interstitial error to throw, or `null` when the original failure
 * should stand. A detector that returns nothing useful — including one that
 * throws or rejects — always yields `null`: a probe failure must never replace
 * the real composer error.
 *
 * @param {any} page
 * @param {'chatgpt'|'grok'|'gemini'} vendor
 * @param {unknown} cause
 * @param {{ detect?: typeof detectInterstitial }} [options]
 * @returns {Promise<WebAiError|null>}
 */
export async function classifyComposerInterstitial(page, vendor, cause, { detect } = {}) {
    const shellSelectors = INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER[vendor];
    if (!shellSelectors) return null;
    // An injected non-function (a caller-supplied value, a stray flag) must not
    // turn a composer error into a TypeError.
    const probe = typeof detect === 'function' ? detect : detectInterstitial;
    const verdict = await Promise.resolve()
        .then(() => probe(page, { shellSelectors }))
        .catch(() => null);
    if (!verdict || verdict.kind === 'none') return null;
    return new WebAiError({
        errorCode: 'provider.interstitial',
        stage: 'provider-interstitial',
        vendor,
        retryHint: verdict.retryHint,
        message: `${vendor} interstitial blocked composer readiness: ${verdict.kind}`,
        evidence: verdict,
        cause,
    });
}
