// @ts-check
import { describe, it, expect, afterEach } from 'vitest';
import { getMaxOutputChars, applyOutputBudget, exceedsBudget } from '../../web-ai/output-budget.mjs';

describe('output-budget (H-010)', () => {
    afterEach(() => {
        delete process.env.AGBROWSE_MAX_OUTPUT_CHARS;
    });

    it('uses default of 100000 chars', () => {
        expect(getMaxOutputChars()).toBe(100000);
    });

    it('respects env override', () => {
        process.env.AGBROWSE_MAX_OUTPUT_CHARS = '5000';
        expect(getMaxOutputChars()).toBe(5000);
    });

    it('per-command override wins over env', () => {
        process.env.AGBROWSE_MAX_OUTPUT_CHARS = '5000';
        expect(getMaxOutputChars(2000)).toBe(2000);
    });

    it('does not truncate output under budget', () => {
        const result = applyOutputBudget('short text', { maxChars: 1000 });
        expect(result.truncated).toBe(false);
        expect(result.text).toBe('short text');
    });

    it('truncates output over budget with notice', () => {
        const long = 'x'.repeat(200);
        const result = applyOutputBudget(long, { maxChars: 100 });
        expect(result.truncated).toBe(true);
        expect(result.text.length).toBeLessThanOrEqual(100);
        expect(result.text).toContain('[output truncated');
        expect(result.originalLength).toBe(200);
    });

    it('exceedsBudget returns correct boolean', () => {
        expect(exceedsBudget('short', 1000)).toBe(false);
        expect(exceedsBudget('x'.repeat(200), 100)).toBe(true);
    });
});
