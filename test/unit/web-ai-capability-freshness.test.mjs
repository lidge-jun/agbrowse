import { describe, expect, it } from 'vitest';
import { validateFreshnessGate } from '../../web-ai/capability-freshness.mjs';

const complete = {
    retrievalDate: '2026-06-26',
    vendorDocsSearched: ['https://help.openai.com/'],
    officialSourcesUsed: ['https://help.openai.com/en/articles/8983675'],
    visibleUpdatedDates: { 'articles/8983675': '2026-05-01' },
    featureChangesSincePriorPrd: [],
    contradictionsOrUnstableLimits: [],
    uiAuthoritativeForPlanLimits: true,
    implementationImpact: ['none'],
    testsUpdatedBecauseOfDocs: [],
};

// Parity catalog 201 #9 (P2): docs-first freshness gate.
describe('web-ai capability freshness gate', () => {
    it('accepts a complete record', () => {
        expect(validateFreshnessGate(complete)).toBe(complete);
    });

    it('rejects a record missing a required field', () => {
        const { retrievalDate, ...rest } = complete;
        expect(() => validateFreshnessGate(rest)).toThrow(/missing field: retrievalDate/);
    });

    it('rejects a record with no official sources', () => {
        expect(() => validateFreshnessGate({ ...complete, officialSourcesUsed: [] })).toThrow(/at least one official source/);
    });

    it('rejects when UI is not asserted authoritative for plan limits', () => {
        expect(() => validateFreshnessGate({ ...complete, uiAuthoritativeForPlanLimits: false }))
            .toThrow(/uiAuthoritativeForPlanLimits=true/);
    });
});
