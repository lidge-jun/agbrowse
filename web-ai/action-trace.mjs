// @ts-check
import { randomUUID } from 'node:crypto';

/**
 * @typedef {{
 *   stepId?: string,
 *   ts?: string,
 *   status?: string,
 *   target?: { resolution?: string, source?: string, [k: string]: unknown },
 *   [extra: string]: unknown,
 * }} TraceStep
 */

/**
 * @typedef {{
 *   sessionId: string|null,
 *   snapshotHashBefore: string|null,
 *   steps: TraceStep[],
 *   record(step: TraceStep): void,
 *   setSnapshotHashBefore(hash: string|null): void,
 * }} TraceContext
 */

const MAX_TRACE_STEPS = 200;

/**
 * @param {string|null} sessionId
 * @returns {TraceContext}
 */
export function createTraceContext(sessionId) {
    /** @type {TraceStep[]} */
    const steps = [];
    return {
        sessionId,
        snapshotHashBefore: null,
        steps,
        /** @param {TraceStep} step */
        record(step) {
            if (steps.length >= MAX_TRACE_STEPS) return;
            steps.push({
                stepId: randomUUID().replace(/-/g, '').slice(0, 16),
                ts: new Date().toISOString(),
                ...step,
            });
        },
        /** @param {string|null} hash */
        setSnapshotHashBefore(hash) {
            this.snapshotHashBefore = hash;
        },
    };
}

/**
 * @param {TraceContext|null|undefined} ctx
 * @param {TraceStep} step
 */
export function recordTraceStep(ctx, step) {
    if (!ctx) return;
    ctx.record(step);
}

/**
 * @param {TraceContext|null|undefined} ctx
 * @returns {TraceStep[]}
 */
export function getSessionTrace(ctx) {
    if (!ctx) return [];
    return [...ctx.steps];
}

/**
 * @param {TraceContext|null|undefined} ctx
 */
export function summarizeTrace(ctx) {
    if (!ctx) return null;
    return summarizeTraceSteps(ctx.sessionId, ctx.steps);
}

/**
 * @param {string|null} sessionId
 * @param {TraceStep[]} [steps]
 */
export function summarizeTraceSteps(sessionId, steps = []) {
    if (!steps.length) return null;
    /** @type {Set<string>} */
    const sources = new Set();
    let errors = 0;
    for (const step of steps) {
        if (step.target?.resolution) sources.add(step.target.resolution);
        if (step.target?.source) sources.add(step.target.source);
        if (step.status === 'error') errors += 1;
    }
    return {
        sessionId,
        totalSteps: steps.length,
        resolutionSources: [...sources],
        errorCount: errors,
        firstTs: steps[0]?.ts || null,
        lastTs: steps.at(-1)?.ts || null,
    };
}
