// @ts-check

// Parity catalog 201 #9 (P2): freshness gate. Process-enforcement guard for a docs-first
// posture — a capability cannot be trusted until official-doc retrieval evidence is
// recorded (retrieval date, official sources used, visible updated dates, feature
// changes, UI-authoritative plan limits). Reverse port of cli-jaw web-ai/capability-freshness.ts.

/**
 * @typedef {Object} FreshnessGateRecord
 * @property {string} retrievalDate
 * @property {string[]} vendorDocsSearched
 * @property {string[]} officialSourcesUsed
 * @property {Record<string,string>} visibleUpdatedDates
 * @property {string[]} featureChangesSincePriorPrd
 * @property {string[]} contradictionsOrUnstableLimits
 * @property {boolean} uiAuthoritativeForPlanLimits
 * @property {string[]} implementationImpact
 * @property {string[]} testsUpdatedBecauseOfDocs
 */

/**
 * Validate a freshness-gate record, throwing when a required field is missing, no
 * official source is recorded, or UI authority for plan limits is not asserted.
 * @param {Partial<FreshnessGateRecord>} record
 * @returns {FreshnessGateRecord}
 */
export function validateFreshnessGate(record) {
    /** @type {(keyof FreshnessGateRecord)[]} */
    const required = [
        'retrievalDate',
        'vendorDocsSearched',
        'officialSourcesUsed',
        'visibleUpdatedDates',
        'featureChangesSincePriorPrd',
        'contradictionsOrUnstableLimits',
        'uiAuthoritativeForPlanLimits',
        'implementationImpact',
        'testsUpdatedBecauseOfDocs',
    ];
    for (const key of required) {
        if (record[key] === undefined || record[key] === null) {
            throw new Error(`freshness gate missing field: ${String(key)}`);
        }
    }
    if (!Array.isArray(record.officialSourcesUsed) || record.officialSourcesUsed.length === 0) {
        throw new Error('freshness gate requires at least one official source');
    }
    if (!record.uiAuthoritativeForPlanLimits) {
        throw new Error('freshness gate requires uiAuthoritativeForPlanLimits=true');
    }
    return /** @type {FreshnessGateRecord} */ (record);
}
