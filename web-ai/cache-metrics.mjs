// @ts-check
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const METRICS_FILE = 'web-ai-metrics.jsonl';

/**
 * @typedef {{
 *   type?: string,
 *   source?: string,
 *   durationMs?: number,
 *   ts?: string|number,
 *   [key: string]: unknown,
 * }} CacheEvent
 */

/**
 * @typedef {{
 *   totalLookups: number,
 *   cacheHitsValid: number,
 *   cacheHitsRejected: number,
 *   cacheMisses: number,
 *   resolutionSources: Record<string, number>,
 *   falseHeals: number,
 *   avgDurationMs: number,
 *   p95DurationMs: number,
 *   cacheHitRate: number,
 *   selfHealRate: number,
 * }} CacheMetricsReport
 */

/**
 * @param {string} homeDir
 * @param {CacheEvent} event
 */
export function recordCacheEvent(homeDir, event) {
    mkdirSync(homeDir, { recursive: true });
    const path = join(homeDir, METRICS_FILE);
    const line = JSON.stringify({ ...event, ts: new Date().toISOString() }) + '\n';
    const tmpPath = path + `.tmp.${process.pid}.${Date.now()}`;
    let existing = '';
    if (existsSync(path)) {
        existing = readFileSync(path, 'utf8');
    }
    writeFileSync(tmpPath, existing + line);
    renameSync(tmpPath, path);
}

/**
 * @param {string} homeDir
 * @returns {CacheMetricsReport|null}
 */
export function reportCacheMetricsFromEvents(homeDir) {
    const path = join(homeDir, METRICS_FILE);
    if (!existsSync(path)) return null;

    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    /** @type {CacheEvent[]} */
    const events = lines
        .map((l) => /** @type {CacheEvent} */ (JSON.parse(l)))
        .filter((e) => typeof e.ts === 'string' && e.ts > new Date(Date.now() - 7 * 86400000).toISOString());

    let totalLookups = 0;
    let cacheHitsValid = 0;
    let cacheHitsRejected = 0;
    let cacheMisses = 0;
    /** @type {Record<string, number>} */
    const resolutionSources = {};
    let falseHeals = 0;

    /** @type {number[]} */
    const durations = [];
    for (const ev of events) {
        if (ev.type === 'lookup') totalLookups++;
        if (ev.type === 'cache-hit-valid') cacheHitsValid++;
        if (ev.type === 'cache-hit-rejected') cacheHitsRejected++;
        if (ev.type === 'cache-miss') cacheMisses++;
        if (ev.type === 'resolved' && typeof ev.source === 'string') {
            resolutionSources[ev.source] = (resolutionSources[ev.source] || 0) + 1;
        }
        if (ev.type === 'false-heal') falseHeals++;
        if (typeof ev.durationMs === 'number') durations.push(ev.durationMs);
    }

    let avgDurationMs = 0;
    let p95DurationMs = 0;
    if (durations.length) {
        avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
        const sorted = [...durations].sort((a, b) => a - b);
        p95DurationMs = sorted[Math.ceil(sorted.length * 0.95) - 1] || sorted[sorted.length - 1];
    }

    const cacheHitRate = totalLookups > 0 ? cacheHitsValid / totalLookups : 0;
    const totalResolved = Object.values(resolutionSources).reduce((a, b) => a + b, 0);
    const selfHealRate = totalResolved > 0 ? (totalResolved - cacheHitsValid) / totalResolved : 0;

    return {
        totalLookups,
        cacheHitsValid,
        cacheHitsRejected,
        cacheMisses,
        resolutionSources,
        falseHeals,
        avgDurationMs,
        p95DurationMs,
        cacheHitRate,
        selfHealRate,
    };
}

/**
 * @param {{ sink: (event: CacheEvent) => void }} options
 */
export function createMetricsCollector({ sink }) {
    return {
        /** @param {CacheEvent} event */
        record(event) {
            sink({ ...event, ts: Date.now() });
        },
    };
}
