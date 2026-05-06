// @ts-check
/**
 * G08 — WebVoyager eval adapter (dry-run only).
 *
 * Converts WebVoyager-format JSONL tasks into agbrowse trajectory jobs
 * WITHOUT making score claims, calling external services, or leaving the
 * local sandbox. The adapter is a translation layer: JSONL row → local
 * trajectory descriptor (id, url, instruction, expectedAction).
 *
 * Forbidden invariants (binding):
 *   - never publishes scores or success rates
 *   - never auto-uploads results
 *   - dry-run = no real browser navigation, just descriptor materialisation
 */

export const EVAL_ADAPTER_VERSION = 'webvoyager-adapter-v1';

/** @typedef {{ id: string, web_name?: string, web?: string, url?: string, ques?: string, instruction?: string }} WebVoyagerRow */
/** @typedef {{ adapter: 'webvoyager', schemaVersion: 'webvoyager-adapter-v1', taskId: string, url: string, instruction: string, scoreClaim: null }} TrajectoryDescriptor */

/**
 * @param {string} jsonl
 * @returns {WebVoyagerRow[]}
 */
export function parseWebVoyagerJsonl(jsonl) {
    /** @type {WebVoyagerRow[]} */
    const rows = [];
    for (const line of jsonl.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            const row = JSON.parse(trimmed);
            if (row && typeof row === 'object' && typeof row.id === 'string') {
                rows.push(row);
            }
        } catch (e) {
            throw Object.assign(new Error(`malformed WebVoyager JSONL line: ${trimmed.slice(0, 80)}`), { code: 'eval.malformed' });
        }
    }
    return rows;
}

/**
 * @param {WebVoyagerRow} row
 * @returns {TrajectoryDescriptor}
 */
export function rowToDescriptor(row) {
    const url = row.url || row.web || '';
    const instruction = row.instruction || row.ques || '';
    if (!url || !instruction) {
        throw Object.assign(
            new Error(`WebVoyager row ${row.id} missing url/instruction`),
            { code: 'eval.incomplete' },
        );
    }
    return {
        adapter: 'webvoyager',
        schemaVersion: 'webvoyager-adapter-v1',
        taskId: row.id,
        url,
        instruction,
        scoreClaim: null,
    };
}

/**
 * @param {string} jsonl
 * @param {{ limit?: number }} [opts]
 * @returns {{ adapter: 'webvoyager', total: number, materialised: number, descriptors: TrajectoryDescriptor[], scoreClaim: null }}
 */
export function dryRunWebVoyager(jsonl, opts = {}) {
    const rows = parseWebVoyagerJsonl(jsonl);
    const limit = typeof opts.limit === 'number' && opts.limit > 0 ? opts.limit : rows.length;
    const slice = rows.slice(0, limit);
    const descriptors = slice.map(rowToDescriptor);
    return {
        adapter: 'webvoyager',
        total: rows.length,
        materialised: descriptors.length,
        descriptors,
        scoreClaim: null,
    };
}
