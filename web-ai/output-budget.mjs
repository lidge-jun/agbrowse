// @ts-check

/**
 * Output size budget enforcement.
 * Caps total output from observation commands to prevent token overflow.
 * @module output-budget
 */

const DEFAULT_MAX_OUTPUT_CHARS = 100_000;
const TRUNCATION_NOTICE = '\n\n[output truncated — use --max-output to increase limit]';

/**
 * @param {number} [override]
 * @returns {number}
 */
export function getMaxOutputChars(override) {
    if (override && Number.isFinite(override) && override > 0) return override;
    const envVal = Number(process.env.AGBROWSE_MAX_OUTPUT_CHARS);
    if (Number.isFinite(envVal) && envVal > 0) return envVal;
    return DEFAULT_MAX_OUTPUT_CHARS;
}

/**
 * @param {string} output
 * @param {{ maxChars?: number, label?: string }} [opts]
 * @returns {{ text: string, truncated: boolean, originalLength: number }}
 */
export function applyOutputBudget(output, opts = {}) {
    const max = getMaxOutputChars(opts.maxChars);
    const originalLength = output.length;
    if (originalLength <= max) {
        return { text: output, truncated: false, originalLength };
    }
    const label = opts.label ? ' (' + opts.label + ')' : '';
    const notice = TRUNCATION_NOTICE + label;
    const truncated = output.slice(0, max - notice.length) + notice;
    return { text: truncated, truncated: true, originalLength };
}

/**
 * @param {string} output
 * @param {number} [maxChars]
 * @returns {boolean}
 */
export function exceedsBudget(output, maxChars) {
    return output.length > getMaxOutputChars(maxChars);
}
