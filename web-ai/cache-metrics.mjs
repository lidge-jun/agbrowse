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
 *   cacheHitRate?: number,
 *   selfHealRate?: number,
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

    /** @type {CacheMetricsReport} */
    const report = {
        totalLookups: 0,
        cacheHitsValid: 0,
        cacheHitsRejected: 0,
        cacheMisses: 0,
        resolutionSources: {},
        falseHeals: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
    };

    /** @type {number[]} */
    const durations = [];
    for (const ev of events) {
        if (ev.type === 'lookup') report.totalLookups++;
        if (ev.type === 'cache-hit-valid') report.cacheHitsValid++;
        if (ev.type === 'cache-hit-rejected') report.cacheHitsRejected++;
        if (ev.type === 'cache-miss') report.cacheMisses++;
        if (ev.type === 'resolved' && typeof ev.source === 'string') {
            report.resolutionSources[ev.source] = (report.resolutionSources[ev.source] || 0) + 1;
        }
        if (ev.type === 'false-heal') report.falseHeals++;
        if (typeof ev.durationMs === 'number') durations.push(ev.durationMs);
    }

    if (durations.length) {
        report.avgDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
        const sorted = [...durations].sort((a, b) => a - b);
        report.p95DurationMs = sorted[Math.ceil(sorted.length * 0.95) - 1] || sorted[sorted.length - 1];
    }

    report.cacheHitRate = report.totalLookups > 0 ? report.cacheHitsValid / report.totalLookups : 0;
    const totalResolved = Object.values(report.resolutionSources).reduce((a, b) => a + b, 0);
    report.selfHealRate = totalResolved > 0 ? (totalResolved - report.cacheHitsValid) / totalResolved : 0;

    return report;
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
