// @ts-check
import { getSession, updateSession } from './session.mjs';
import { MAX_TRACE_STEPS, MAX_TRACE_BYTES } from './constants.mjs';

const REDACTION_PATTERNS = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /sk-proj-[a-zA-Z0-9_-]{20,}/g,
    /Bearer\s+[a-zA-Z0-9._-]+/gi,
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
];

/**
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactSensitive(value) {
    if (typeof value === 'string') {
        let redacted = value;
        for (const pattern of REDACTION_PATTERNS) {
            redacted = redacted.replace(pattern, '[REDACTED]');
        }
        return redacted;
    }
    if (Array.isArray(value)) {
        return value.map(redactSensitive);
    }
    if (value && typeof value === 'object') {
        /** @type {Record<string, unknown>} */
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            result[k] = redactSensitive(v);
        }
        return result;
    }
    return value;
}

/**
 * @param {string} sessionId
 * @param {unknown[]|null|undefined} steps
 * @returns {void}
 */
export function appendTraceToSession(sessionId, steps) {
    if (!steps?.length) return;
    const redacted = /** @type {unknown[]} */ (redactSensitive(steps));

    const session = getSession(sessionId);
    if (!session) return;

    const trace = session.trace || [];
    trace.push(...redacted);

    while (trace.length > MAX_TRACE_STEPS) {
        trace.shift();
    }
    while (JSON.stringify(trace).length > MAX_TRACE_BYTES && trace.length > 0) {
        trace.shift();
    }

    updateSession(sessionId, { trace });
}
