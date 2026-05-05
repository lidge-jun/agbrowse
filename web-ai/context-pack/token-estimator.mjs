// @ts-check
import {
    DEFAULT_BROWSER_INLINE_CHAR_BUDGET,
    DEFAULT_MODEL_INPUT_BUDGETS,
    DEFAULT_TOKEN_WARNING_RATIO,
} from './constants.mjs';

const SECTION_OVERHEAD_TOKENS = 16;

/**
 * @param {string} [text]
 * @param {number} [sectionCount]
 * @returns {number}
 */
export function estimateTokens(text = '', sectionCount = 1) {
    const chars = String(text || '').length;
    return Math.ceil(chars / 3) + Math.max(0, sectionCount) * SECTION_OVERHEAD_TOKENS;
}

/**
 * @typedef {{ maxInput?: number, vendor?: string, model?: string, inlineCharLimit?: number }} BudgetInput
 */

/**
 * @param {BudgetInput} [input]
 * @returns {number}
 */
export function resolveMaxInputTokens(input = {}) {
    const explicit = Number(input.maxInput || 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);

    const vendor = String(input.vendor || 'chatgpt').toLowerCase();
    const model = String(input.model || 'default').toLowerCase();
    /** @type {Record<string, Record<string, number>>} */
    const allBudgets = DEFAULT_MODEL_INPUT_BUDGETS;
    const vendorBudgets = allBudgets[vendor] || allBudgets.chatgpt;
    return vendorBudgets[model] || vendorBudgets.default || allBudgets.chatgpt.default;
}

/**
 * @typedef {{
 *   status: 'ok'|'warning'|'over-budget',
 *   estimatedTokens: number,
 *   maxInputTokens: number,
 *   inlineChars: number,
 *   inlineCharLimit: number,
 * }} BudgetReport
 */

/**
 * @param {BudgetInput} [input]
 * @param {string} [composerText]
 * @param {unknown[]} [files]
 * @returns {BudgetReport}
 */
export function buildBudgetReport(input = {}, composerText = '', files = []) {
    const maxInputTokens = resolveMaxInputTokens(input);
    const estimatedTokens = estimateTokens(composerText, files.length + 2);
    const inlineCharLimit = Number(input.inlineCharLimit || DEFAULT_BROWSER_INLINE_CHAR_BUDGET);
    const inlineChars = composerText.length;
    const status = estimatedTokens > maxInputTokens || inlineChars > inlineCharLimit
        ? 'over-budget'
        : estimatedTokens >= maxInputTokens * DEFAULT_TOKEN_WARNING_RATIO
            ? 'warning'
            : 'ok';

    return {
        status,
        estimatedTokens,
        maxInputTokens,
        inlineChars,
        inlineCharLimit,
    };
}
