// @ts-check

/**
 * @typedef {'composer.fill' | 'upload.open' | 'send.click' | 'copy.click'} EvalTargetIntent
 */

/**
 * @typedef {{
 *   status: 'resolved' | 'ambiguous' | 'missing' | 'unsupported',
 *   refId: string|null,
 *   selector: string|null,
 *   confidence: number,
 *   evidence: { provider: string, intent: string, variant: string, matches?: number },
 *   error: string|null,
 * }} EvalTargetProbeResult
 */

/** @type {EvalTargetIntent[]} */
export const EVAL_TARGET_INTENTS = [
    'composer.fill',
    'upload.open',
    'send.click',
    'copy.click',
];

/**
 * @param {string} html
 * @param {{ provider?: string, intent?: string, variant?: string }} [options]
 * @returns {EvalTargetProbeResult}
 */
export function probeEvalTargetIntentFromHtml(html, { provider = 'chatgpt', intent = '', variant = 'baseline' } = {}) {
    if (!EVAL_TARGET_INTENTS.includes(/** @type {EvalTargetIntent} */ (intent))) {
        return {
            status: 'unsupported',
            refId: null,
            selector: null,
            confidence: 0,
            evidence: { provider, intent, variant },
            error: `unsupported eval intent: ${intent}`,
        };
    }
    const selector = `[data-eval-intent="${intent}"]`;
    const marker = `data-eval-intent="${escapeRegExp(intent)}"`;
    const matches = [...String(html).matchAll(new RegExp(marker, 'g'))];
    if (matches.length === 1) {
        const tagMatch = String(html).match(new RegExp(`<[^>]*data-eval-intent="${escapeRegExp(intent)}"[^>]*>`, 'i'));
        const refIdMatch = tagMatch?.[0]?.match(/\bdata-eval-ref="([^"]+)"/i);
        return {
            status: 'resolved',
            refId: refIdMatch?.[1] || null,
            selector,
            confidence: 1,
            evidence: { provider, intent, variant, matches: matches.length },
            error: null,
        };
    }
    if (matches.length > 1) {
        return {
            status: 'ambiguous',
            refId: null,
            selector,
            confidence: 0.2,
            evidence: { provider, intent, variant, matches: matches.length },
            error: `ambiguous eval target: ${intent}`,
        };
    }
    return {
        status: 'missing',
        refId: null,
        selector,
        confidence: 0,
        evidence: { provider, intent, variant, matches: 0 },
        error: `missing eval target: ${intent}`,
    };
}

/**
 * @param {string | { content?: () => Promise<string> }} pageOrHtml
 * @param {{ provider?: string, intent?: string, variant?: string }} [options]
 * @returns {Promise<EvalTargetProbeResult>}
 */
export async function probeEvalTargetIntent(pageOrHtml, options = {}) {
    if (typeof pageOrHtml === 'string') return probeEvalTargetIntentFromHtml(pageOrHtml, options);
    const html = typeof pageOrHtml?.content === 'function'
        ? await pageOrHtml.content()
        : String(pageOrHtml || '');
    return probeEvalTargetIntentFromHtml(html, options);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
