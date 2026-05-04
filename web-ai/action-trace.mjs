import { randomUUID } from 'node:crypto';

const MAX_TRACE_STEPS = 200;

export function createTraceContext(sessionId) {
    const steps = [];
    return {
        sessionId,
        snapshotHashBefore: null,
        steps,
        record(step) {
            if (steps.length >= MAX_TRACE_STEPS) return;
            steps.push({
                stepId: randomUUID().replace(/-/g, '').slice(0, 16),
                ts: new Date().toISOString(),
                ...step,
            });
        },
        setSnapshotHashBefore(hash) {
            this.snapshotHashBefore = hash;
        },
    };
}

export function recordTraceStep(ctx, step) {
    if (!ctx) return;
    ctx.record(step);
}

export function getSessionTrace(ctx) {
    if (!ctx) return [];
    return [...ctx.steps];
}

export function summarizeTrace(ctx) {
    if (!ctx) return null;
    return summarizeTraceSteps(ctx.sessionId, ctx.steps);
}

export function summarizeTraceSteps(sessionId, steps = []) {
    if (!steps.length) return null;
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
