// @ts-check
import fs from 'node:fs/promises';
import { redactTraceValue } from './redact.mjs';

/**
 * @typedef {{
 *   traceId: string,
 *   command: string,
 *   provider: string|null,
 *   urlOrigin: string|null,
 *   steps: Array<{ type?: string, status?: string, [extra: string]: unknown }>,
 *   errorEnvelope: { errorCode?: string, message?: string }|null,
 *   [extra: string]: unknown,
 * }} TraceRecord
 */

/**
 * @param {string} tracePath
 * @returns {Promise<string>}
 */
export async function renderTraceReport(tracePath) {
    const raw = await fs.readFile(tracePath, 'utf8');
    const records = raw.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return renderTraceRecords(records);
}

/**
 * @param {TraceRecord[]} [records]
 * @returns {string}
 */
export function renderTraceRecords(records = []) {
    const safeRecords = /** @type {TraceRecord[]} */ (redactTraceValue(records));
    const lines = ['# agbrowse trace report', ''];
    for (const record of safeRecords) {
        lines.push(`## ${record.traceId}`);
        lines.push(`- command: ${record.command || 'unknown'}`);
        lines.push(`- provider: ${record.provider || 'unknown'}`);
        lines.push(`- origin: ${record.urlOrigin || 'unknown'}`);
        lines.push(`- status: ${record.steps?.at(-1)?.status || 'unknown'}`);
        if (record.errorEnvelope) {
            lines.push(`- error: ${record.errorEnvelope.errorCode || record.errorEnvelope.message}`);
        }
        if (record.steps?.length) {
            lines.push('- steps:');
            for (const step of record.steps) lines.push(`  - ${step.type || 'step'} ${step.status || ''}`.trimEnd());
        }
        lines.push('');
    }
    return lines.join('\n');
}
