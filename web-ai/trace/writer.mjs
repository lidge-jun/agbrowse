// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTraceRecord } from './types.mjs';
import { redactTraceValue } from './redact.mjs';

/**
 * @typedef {{
 *   traceId?: string,
 *   command?: string,
 *   provider?: string|null,
 *   modelAlias?: string|null,
 *   sessionId?: string|null,
 *   targetId?: string|null,
 *   url?: string|null,
 *   urlOrigin?: string|null,
 *   status?: string,
 *   errorEnvelope?: unknown,
 *   evidence?: Record<string, unknown>,
 *   steps?: unknown[],
 *   artifacts?: unknown[],
 *   [extra: string]: unknown,
 * }} TraceWriteInput
 */

/**
 * @param {string|null|undefined} traceDir
 * @param {TraceWriteInput} record
 * @returns {Promise<string|null>}
 */
export async function appendTraceRecord(traceDir, record) {
    if (!traceDir) return null;
    const absoluteDir = path.resolve(traceDir);
    await fs.mkdir(absoluteDir, { recursive: true });
    const traceId = record.traceId || createTraceRecord(record).traceId;
    const filePath = path.join(absoluteDir, `${traceId}.jsonl`);
    const line = `${JSON.stringify(redactTraceValue(record))}\n`;
    // JSONL traces are append-only. A single append call keeps each record
    // intact without temp-file rename semantics that would drop prior records.
    await fs.appendFile(filePath, line);
    return filePath;
}

/**
 * @param {string|null|undefined} traceDir
 * @param {TraceWriteInput} [input]
 * @returns {Promise<string|null>}
 */
export async function writeCommandTrace(traceDir, {
    traceId,
    command,
    provider,
    modelAlias,
    sessionId,
    targetId,
    url,
    status,
    errorEnvelope,
    evidence = {},
    steps = [],
    artifacts = [],
} = {}) {
    if (!traceDir) return null;
    const record = createTraceRecord({
        traceId,
        command,
        provider,
        modelAlias,
        sessionId,
        targetId,
        url,
        evidence,
        steps: [
            ...steps,
            { type: 'command-result', status, at: new Date().toISOString() },
        ],
        artifacts,
        errorEnvelope,
    });
    return appendTraceRecord(traceDir, record);
}
