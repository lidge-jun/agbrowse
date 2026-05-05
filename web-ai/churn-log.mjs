// @ts-check
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_HOME = process.env.BROWSER_AGENT_HOME || join(homedir(), '.browser-agent');
const LOG_NAME = 'churn-log.jsonl';
const DEFAULT_COMPACT_LIMIT = 500;

/**
 * @typedef {{
 *   key: string,
 *   vendor: string,
 *   feature: string,
 *   domHash: string,
 *   previousHash: string|null,
 *   state?: string,
 *   capturedAt: string,
 *   healing?: unknown,
 * }} ChurnRecord
 */

/**
 * @typedef {{
 *   vendor?: string,
 *   capturedAt?: string,
 *   features?: Array<{ feature: string, domHash?: string, state?: string, healing?: unknown }>,
 * }} ChurnReport
 */

/**
 * @param {string} [homeDir]
 * @returns {string}
 */
export function churnLogPath(homeDir = DEFAULT_HOME) {
    return join(homeDir, LOG_NAME);
}

/**
 * @param {string} [homeDir]
 * @returns {ChurnRecord[]}
 */
export function readChurnLog(homeDir = DEFAULT_HOME) {
    const path = churnLogPath(homeDir);
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf8').trim();
    if (!raw) return [];
    /** @type {ChurnRecord[]} */
    const records = [];
    for (const line of raw.split('\n')) {
        if (!line) continue;
        try { records.push(JSON.parse(line)); } catch { /* skip malformed line */ }
    }
    return records;
}

/**
 * @param {ChurnRecord} record
 * @param {string} [homeDir]
 */
export function appendChurnRecord(record, homeDir = DEFAULT_HOME) {
    const path = churnLogPath(homeDir);
    mkdirSync(homeDir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(record)}\n`);
}

/**
 * @param {string} [homeDir]
 * @param {number} [limit]
 * @returns {number}
 */
export function compactChurnLog(homeDir = DEFAULT_HOME, limit = DEFAULT_COMPACT_LIMIT) {
    const records = readChurnLog(homeDir);
    if (records.length <= limit) return records.length;
    const kept = records.slice(-limit);
    const path = churnLogPath(homeDir);
    writeFileSync(path, kept.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return kept.length;
}

/**
 * @param {ChurnReport} report
 * @param {string} [homeDir]
 * @returns {ChurnRecord[]}
 */
export function maybeRecordChurn(report, homeDir = DEFAULT_HOME) {
    if (process.env.AGBROWSE_CHURN_LOG !== '1') return [];
    const prior = readChurnLog(homeDir);
    const records = changedFeatureRecords(report, prior);
    for (const record of records) appendChurnRecord(record, homeDir);
    if (records.length > 0) compactChurnLog(homeDir);
    return records;
}

/**
 * @param {ChurnReport} report
 * @param {ChurnRecord[]} priorRecords
 * @returns {ChurnRecord[]}
 */
function changedFeatureRecords(report, priorRecords) {
    if (!report?.features?.length) return [];
    /** @type {ChurnRecord[]} */
    const changed = [];
    for (const f of report.features) {
        if (!f.domHash) continue;
        const key = `${report.vendor}:${f.feature}`;
        const last = findLastByKey(priorRecords, key);
        if (last && last.domHash === f.domHash) continue;
        changed.push({
            key,
            vendor: String(report.vendor),
            feature: f.feature,
            domHash: f.domHash,
            previousHash: last?.domHash || null,
            state: f.state,
            capturedAt: report.capturedAt || new Date().toISOString(),
            ...(f.healing ? { healing: f.healing } : {}),
        });
    }
    return changed;
}

/**
 * @param {ChurnRecord[]} records
 * @param {string} key
 * @returns {ChurnRecord|null}
 */
function findLastByKey(records, key) {
    for (let i = records.length - 1; i >= 0; i -= 1) {
        if (records[i].key === key) return records[i];
    }
    return null;
}
