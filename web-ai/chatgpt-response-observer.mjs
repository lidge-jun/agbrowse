// @ts-check
/**
 * Response-capture short-circuit + 3rd-tier recovery (spec 33).
 *
 * Per the locked decision the poller in chatgpt.mjs stays AUTHORITATIVE: this
 * module only (a) wakes the poll loop early when the DOM settles (a MutationObserver
 * short-circuit, so capture latency drops without changing any decision) and
 * (b) provides a best-effort last-turn re-read when the poller times out.
 *
 * Self-contained (no import from chatgpt.mjs) to avoid a cycle; the placeholder
 * predicate is injected so the recovery path matches chatgpt.mjs isFinalAnswer.
 */
import {
    CHATGPT_ASSISTANT_SELECTORS,
    CHATGPT_STOP_SELECTORS,
    readTopLevelAssistantTexts,
} from './chatgpt-response-dom.mjs';

const DEFAULT_QUIET_MS = 1_200;
const DEFAULT_OBSERVER_TIMEOUT_MS = 30_000;

/**
 * Build the in-page expression: a MutationObserver that resolves once a new
 * assistant turn (beyond `baselineAssistantCount`) has been quiet for `quietMs`
 * with the stop button gone, or resolves `null` after `timeoutMs` (never
 * rejects — it must lose a race silently).
 * @param {{ baselineAssistantCount?: number, quietMs?: number, timeoutMs?: number }} [opts]
 * @returns {string}
 */
export function buildResponseObserverExpression({ baselineAssistantCount = 0, quietMs = DEFAULT_QUIET_MS, timeoutMs = DEFAULT_OBSERVER_TIMEOUT_MS } = {}) {
    const minIdx = Number.isFinite(Number(baselineAssistantCount)) ? Math.max(0, Math.floor(Number(baselineAssistantCount))) : 0;
    const quiet = Number.isFinite(Number(quietMs)) ? Math.max(200, Math.floor(Number(quietMs))) : DEFAULT_QUIET_MS;
    const timeout = Number.isFinite(Number(timeoutMs)) ? Math.max(1_000, Math.floor(Number(timeoutMs))) : DEFAULT_OBSERVER_TIMEOUT_MS;
    const assistantSelector = CHATGPT_ASSISTANT_SELECTORS.join(', ');
    const stopSelector = CHATGPT_STOP_SELECTORS.join(', ');
    return `(() => new Promise((resolve) => {
        const MIN = ${minIdx};
        const QUIET = ${quiet};
        const HARD = ${timeout};
        const ASSIST = ${JSON.stringify(assistantSelector)};
        const STOP = ${JSON.stringify(stopSelector)};
        let quietTimer = null;
        let done = false;
        const topLevelAssistantCount = () => {
            const matched = Array.from(document.querySelectorAll(ASSIST));
            return matched.filter(el => !matched.some(other => other !== el && other.contains(el))).length;
        };
        const newAssistant = () => topLevelAssistantCount() > MIN;
        const stopGone = () => !document.querySelector(STOP);
        const finish = (val) => {
            if (done) return;
            done = true;
            try { obs.disconnect(); } catch (e) {}
            clearTimeout(quietTimer);
            clearTimeout(hardTimer);
            resolve(val);
        };
        const scheduleQuiet = () => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => { if (newAssistant() && stopGone()) finish({ settled: true }); }, QUIET);
        };
        const obs = new MutationObserver(() => { if (newAssistant()) scheduleQuiet(); });
        try { obs.observe(document.body, { childList: true, subtree: true, characterData: true }); } catch (e) {}
        const hardTimer = setTimeout(() => finish(null), HARD);
        if (newAssistant() && stopGone()) scheduleQuiet();
    })())`;
}

/**
 * Run the observer expression as an early-wake signal. Resolves `{ settled }` on
 * settle, or `null` on timeout/abort/error. Never throws.
 * @param {{ evaluate: Function, waitForTimeout?: Function, locator?: Function }} page
 * @param {{ baselineAssistantCount?: number, timeoutMs?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<{ settled: true } | null>}
 */
export async function observeAssistantResponse(page, { baselineAssistantCount = 0, timeoutMs = DEFAULT_OBSERVER_TIMEOUT_MS, signal } = {}) {
    if (signal?.aborted) return null;
    try {
        const evalP = page.evaluate(buildResponseObserverExpression({ baselineAssistantCount, timeoutMs }));
        if (!signal) return await evalP;
        const abortP = new Promise((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true }));
        return await Promise.race([evalP, abortP]);
    } catch {
        return null;
    }
}

/**
 * 3rd-tier recovery: re-read the latest assistant turn after the baseline once,
 * rejecting placeholders via the injected `isFinalAnswer` predicate. Read-only;
 * never throws. Returns `null` when there is no usable final answer.
 * @param {{ evaluate: Function, waitForTimeout?: Function, locator?: Function }} page
 * @param {{ baselineAssistantCount?: number, isFinalAnswer?: (text: string) => boolean, readStreaming?: () => Promise<boolean>|boolean, readFinished?: () => Promise<boolean>|boolean, stabilityWindowMs?: number }} [opts]
 * @returns {Promise<{ from: 'recovery', text: string, recovered: true, streaming: boolean, finished: boolean, responseStableMs: number } | null>}
 */
export async function recoverAssistantResponse(page, { baselineAssistantCount = 0, isFinalAnswer, readStreaming, readFinished, stabilityWindowMs } = {}) {
    const minIdx = Math.max(0, Math.floor(Number(baselineAssistantCount) || 0));
    const readCandidates = async () => {
        let texts;
        try {
            texts = await page.evaluate(readTopLevelAssistantTexts, CHATGPT_ASSISTANT_SELECTORS);
        } catch {
            return [];
        }
        if (!Array.isArray(texts) || !texts.length) return [];
        return texts.slice(minIdx).filter(text => {
            if (!text) return false;
            return typeof isFinalAnswer === 'function' ? isFinalAnswer(text) : true;
        });
    };

    const candidates = await readCandidates();
    if (!candidates.length) return null;
    let latest = candidates.at(-1) || '';
    if (!latest) return null;

    let streaming = await readStreamingState(page, readStreaming);
    if (streaming) {
        return { from: 'recovery', text: latest, recovered: true, streaming: true, finished: false, responseStableMs: 0 };
    }

    let finished = await readFinishedState(readFinished);
    let responseStableMs = finished ? 1 : 0;
    if (!finished) {
        const waitMs = recoveryStabilityWindowMs(latest, stabilityWindowMs);
        if (waitMs > 0 && typeof page.waitForTimeout === 'function') {
            const startedAt = Date.now();
            await page.waitForTimeout(waitMs).catch(() => undefined);
            const afterStreaming = await readStreamingState(page, readStreaming);
            if (afterStreaming) {
                return { from: 'recovery', text: latest, recovered: true, streaming: true, finished: false, responseStableMs: 0 };
            }
            const reread = await readCandidates();
            const stableLatest = reread.at(-1) || '';
            if (stableLatest && stableLatest === latest) {
                responseStableMs = Math.max(1, Date.now() - startedAt);
                finished = await readFinishedState(readFinished);
            } else if (stableLatest) {
                latest = stableLatest;
            }
        }
    }

    return { from: 'recovery', text: latest, recovered: true, streaming: false, finished, responseStableMs };
}

/**
 * @param {any} page
 * @param {(() => Promise<boolean>|boolean)|undefined} readStreaming
 */
async function readStreamingState(page, readStreaming) {
    if (typeof readStreaming === 'function') {
        try {
            return Boolean(await readStreaming());
        } catch {
            return false;
        }
    }
    try {
        for (const selector of CHATGPT_STOP_SELECTORS) {
            const first = page.locator?.(selector)?.first?.();
            if (typeof first?.isVisible === 'function' && await first.isVisible().catch(() => false)) return true;
        }
    } catch {
        return false;
    }
    return false;
}

/**
 * @param {(() => Promise<boolean>|boolean)|undefined} readFinished
 */
async function readFinishedState(readFinished) {
    if (typeof readFinished !== 'function') return false;
    try {
        return Boolean(await readFinished());
    } catch {
        return false;
    }
}

/**
 * @param {string} text
 * @param {number|undefined} overrideMs
 */
function recoveryStabilityWindowMs(text, overrideMs) {
    if (Number.isFinite(Number(overrideMs))) return Math.max(0, Math.floor(Number(overrideMs)));
    return String(text || '').length < 500 ? 3000 : 5000;
}
