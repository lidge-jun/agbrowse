// @ts-check
/// <reference types="playwright-core" />

/**
 * @typedef {{
 *   roles?: string[],
 *   names?: RegExp[],
 *   excludeNames?: RegExp[],
 *   cssFallbacks?: string[],
 *   required?: boolean,
 * }} TargetSpec
 */

/**
 * @typedef {{
 *   ref: string,
 *   role: string,
 *   name?: string,
 * }} SnapshotRef
 */

/**
 * @typedef {{
 *   source: string,
 *   ref?: string,
 *   role?: string,
 *   name?: string,
 *   selector?: string,
 *   count?: number,
 *   confidence: number,
 * }} TargetCandidate
 */

/**
 * @param {import('playwright-core').Page} page
 * @param {{
 *   provider?: string|null,
 *   featureMap?: Record<string, TargetSpec> | { semanticTargets?: Record<string, TargetSpec> },
 *   snapshot?: { refs?: Record<string, SnapshotRef> } | null,
 * }} [options]
 * @returns {Promise<Record<string, TargetCandidate[]>>}
 */
export async function observeProviderTargets(page, {
    provider = null,
    featureMap = {},
    snapshot = null,
} = {}) {
    void provider;
    /** @type {Record<string, TargetSpec>} */
    const semanticTargets = /** @type {any} */ (featureMap).semanticTargets || /** @type {Record<string, TargetSpec>} */ (featureMap) || {};
    /** @type {Record<string, TargetCandidate[]>} */
    const results = {};
    for (const [feature, target] of Object.entries(semanticTargets)) {
        /** @type {TargetCandidate[]} */
        const candidates = [];
        if (snapshot?.refs) {
            for (const ref of Object.values(snapshot.refs)) {
                if (!targetMatchesRef(target, ref)) continue;
                candidates.push({
                    source: 'snapshot-ref',
                    ref: ref.ref,
                    role: ref.role,
                    name: ref.name || '',
                    confidence: scoreCandidate({ role: ref.role, name: ref.name || '' }, target),
                });
            }
        }
        for (const selector of target.cssFallbacks || []) {
            const count = await page.locator(selector).count().catch(() => 0);
            if (count > 0) {
                candidates.push({ source: 'css', selector, count, confidence: count === 1 ? 2 : 1 });
            }
        }
        results[feature] = rankTargetCandidates(candidates, {
            expectedRole: target.roles?.[0] || null,
            expectedNames: target.names || [],
        });
    }
    return results;
}

/**
 * @param {TargetCandidate[]} candidates
 * @param {{ expectedRole?: string|null, expectedNames?: RegExp[] }} [options]
 * @returns {TargetCandidate[]}
 */
export function rankTargetCandidates(candidates, { expectedRole = null, expectedNames = [] } = {}) {
    return [...(candidates || [])].sort((a, b) => {
        const aScore = Number(a.confidence || 0)
            + (expectedRole && a.role === expectedRole ? 2 : 0)
            + (expectedNames.some((pattern) => pattern.test?.(a.name || '')) ? 1 : 0)
            + (a.source === 'snapshot-ref' ? 0.5 : 0);
        const bScore = Number(b.confidence || 0)
            + (expectedRole && b.role === expectedRole ? 2 : 0)
            + (expectedNames.some((pattern) => pattern.test?.(b.name || '')) ? 1 : 0)
            + (b.source === 'snapshot-ref' ? 0.5 : 0);
        return bScore - aScore;
    });
}

/**
 * @param {TargetSpec} target
 * @param {SnapshotRef} ref
 * @returns {boolean}
 */
function targetMatchesRef(target, ref) {
    if (target.roles?.length && !target.roles.includes(ref.role)) return false;
    const name = ref.name || '';
    if (target.excludeNames?.some((pattern) => pattern.test(name))) return false;
    if (target.names?.length && !target.names.some((pattern) => pattern.test(name))) return false;
    return true;
}

/**
 * @param {{ role: string, name: string }} candidate
 * @param {TargetSpec} target
 * @returns {number}
 */
function scoreCandidate(candidate, target) {
    let score = 0;
    if (target.roles?.includes(candidate.role)) score += 2;
    if (target.names?.some((pattern) => pattern.test(candidate.name || ''))) score += 2;
    if (target.required) score += 1;
    return score;
}
