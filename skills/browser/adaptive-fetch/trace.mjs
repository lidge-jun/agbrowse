// @ts-check

import { redactHeaders, redactTraceValue } from './safety.mjs';

/**
 * @param {{ url?: string, browserMode?: string, browserSession?: string }} input
 */
export function createAttemptTrace(input = {}) {
    return {
        url: typeof input.url === 'string' ? redactTraceValue(input.url) : null,
        browserMode: input.browserMode || 'auto',
        browserSession: input.browserSession || 'none',
        createdAt: new Date().toISOString(),
        attempts: [],
    };
}

/**
 * @param {{ attempts: object[] }} trace
 * @param {Record<string, unknown>} attempt
 */
export function appendAttempt(trace, attempt) {
    const safeAttempt = sanitizeAttempt({
        ...attempt,
        at: attempt.at || new Date().toISOString(),
    });
    trace.attempts.push(safeAttempt);
    return safeAttempt;
}

/**
 * @param {object[]} attempts
 */
export function summarizeAttempts(attempts = []) {
    if (attempts.length === 0) return 'No attempts recorded.';
    const last = attempts[attempts.length - 1];
    const source = /** @type {any} */ (last).source || 'unknown';
    const verdict = /** @type {any} */ (last).verdict || 'unknown';
    return `${attempts.length} attempt(s); last source=${source} verdict=${verdict}`;
}

/**
 * @param {Record<string, unknown>} attempt
 */
export function sanitizeAttempt(attempt) {
    /** @type {Record<string, unknown>} */
    const safe = {};
    for (const [key, value] of Object.entries(attempt)) {
        if (key.toLowerCase().includes('header') && value && typeof value === 'object' && !Array.isArray(value)) {
            safe[key] = redactHeaders(/** @type {Record<string, unknown>} */ (value));
        } else if (typeof value === 'string') {
            safe[key] = redactTraceValue(value);
        } else if (Array.isArray(value)) {
            safe[key] = value.map(item => typeof item === 'string' ? redactTraceValue(item) : item);
        } else {
            safe[key] = value;
        }
    }
    return safe;
}

