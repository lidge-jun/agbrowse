import { describe, expect, it } from 'vitest';
import {
    createTraceContext,
    recordTraceStep,
    getSessionTrace,
    summarizeTrace,
    summarizeTraceSteps,
} from '../../web-ai/action-trace.mjs';

describe('web-ai action-trace', () => {
    describe('createTraceContext', () => {
        it('initializes with sessionId and empty steps', () => {
            const ctx = createTraceContext('sess-123');
            expect(ctx.sessionId).toBe('sess-123');
            expect(ctx.steps).toEqual([]);
            expect(ctx.snapshotHashBefore).toBeNull();
        });

        it('setSnapshotHashBefore updates hash', () => {
            const ctx = createTraceContext('sess-123');
            ctx.setSnapshotHashBefore('hash-abc');
            expect(ctx.snapshotHashBefore).toBe('hash-abc');
        });
    });

    describe('recordTraceStep', () => {
        it('adds step with UUID and timestamp', () => {
            const ctx = createTraceContext('sess-123');
            recordTraceStep(ctx, { action: 'click', target: { selector: '#btn' } });
            expect(ctx.steps).toHaveLength(1);
            expect(ctx.steps[0].action).toBe('click');
            expect(ctx.steps[0].stepId).toBeDefined();
            expect(ctx.steps[0].ts).toBeDefined();
        });

        it('enforces MAX_TRACE_STEPS limit', () => {
            const ctx = createTraceContext('sess-123');
            for (let i = 0; i < 210; i++) {
                recordTraceStep(ctx, { action: 'click' });
            }
            expect(ctx.steps.length).toBeLessThanOrEqual(200);
        });

        it('no-ops when ctx is null', () => {
            expect(() => recordTraceStep(null, { action: 'click' })).not.toThrow();
        });
    });

    describe('getSessionTrace', () => {
        it('returns defensive copy of steps', () => {
            const ctx = createTraceContext('sess-123');
            recordTraceStep(ctx, { action: 'click' });
            const trace = getSessionTrace(ctx);
            trace.push({ tampered: true });
            expect(ctx.steps).toHaveLength(1);
        });

        it('returns empty array when ctx is null', () => {
            expect(getSessionTrace(null)).toEqual([]);
        });
    });

    describe('summarizeTrace', () => {
        it('aggregates resolution sources', () => {
            const ctx = createTraceContext('sess-123');
            recordTraceStep(ctx, { action: 'click', target: { resolution: 'cache' }, status: 'ok' });
            recordTraceStep(ctx, { action: 'fill', target: { resolution: 'css-fallback' }, status: 'ok' });
            const summary = summarizeTrace(ctx);
            expect(summary.resolutionSources).toContain('cache');
            expect(summary.resolutionSources).toContain('css-fallback');
            expect(summary.totalSteps).toBe(2);
        });

        it('counts errors', () => {
            const ctx = createTraceContext('sess-123');
            recordTraceStep(ctx, { action: 'click', target: { resolution: 'cache' }, status: 'ok' });
            recordTraceStep(ctx, { action: 'click', target: {}, status: 'error' });
            const summary = summarizeTrace(ctx);
            expect(summary.errorCount).toBe(1);
        });

        it('returns time range', () => {
            const ctx = createTraceContext('sess-123');
            recordTraceStep(ctx, { action: 'click' });
            recordTraceStep(ctx, { action: 'fill' });
            const summary = summarizeTrace(ctx);
            expect(summary.firstTs).toBeDefined();
            expect(summary.lastTs).toBeDefined();
            expect(new Date(summary.lastTs).getTime()).toBeGreaterThanOrEqual(new Date(summary.firstTs).getTime());
        });

        it('returns null for empty trace', () => {
            const ctx = createTraceContext('sess-123');
            expect(summarizeTrace(ctx)).toBeNull();
            expect(summarizeTrace(null)).toBeNull();
        });

        it('summarizes persisted trace arrays', () => {
            const trace = [
                { ts: '2026-05-05T00:00:00.000Z', status: 'ok', target: { resolution: 'semantic' } },
                { ts: '2026-05-05T00:00:01.000Z', status: 'error', target: { source: 'css-fallback' } },
            ];
            expect(summarizeTraceSteps('sess-456', trace)).toMatchObject({
                sessionId: 'sess-456',
                totalSteps: 2,
                resolutionSources: ['semantic', 'css-fallback'],
                errorCount: 1,
                firstTs: '2026-05-05T00:00:00.000Z',
                lastTs: '2026-05-05T00:00:01.000Z',
            });
        });
    });
});
