// @ts-check
import { editorContractForVendor } from './vendor-editor-contract.mjs';
import { buildWebAiSnapshot } from './ax-snapshot.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('./vendor-editor-contract.mjs').VendorName} VendorName */

/**
 * @typedef {Object} AuditDrift
 * @property {string} feature
 * @property {'error' | 'warn'} severity
 * @property {string} message
 */

/**
 * @typedef {Object} AuditResult
 * @property {VendorName} vendor
 * @property {string} snapshotId
 * @property {number} driftCount
 * @property {AuditDrift[]} errors
 * @property {AuditDrift[]} warnings
 * @property {AuditDrift[]} drifts
 */

/**
 * @param {Page} page
 * @param {VendorName} vendor
 * @returns {Promise<AuditResult>}
 */
export async function auditContractAgainstSnapshot(page, vendor) {
    const contract = editorContractForVendor(vendor);
    const snapshot = await buildWebAiSnapshot(page, { maxDepth: 3 });
    
    /** @type {AuditDrift[]} */
    const drifts = [];
    for (const [feature, target] of Object.entries(contract.semanticTargets || {})) {
        const matches = (/** @type {any} */ (snapshot.refs)).filter(/** @param {any} ref */ (ref) =>
            target.roles?.includes(ref.role) &&
            target.names?.some(p => p.test(ref.name))
        );
        
        if (matches.length === 0) {
            drifts.push({ feature, severity: 'error', message: `No elements match contract for ${feature}` });
        } else if (matches.length > 1) {
            drifts.push({ feature, severity: 'warn', message: `Ambiguous match: ${matches.length} elements for ${feature}` });
        }
    }
    
    return {
        vendor,
        snapshotId: snapshot.snapshotId,
        driftCount: drifts.length,
        errors: drifts.filter(d => d.severity === 'error'),
        warnings: drifts.filter(d => d.severity === 'warn'),
        drifts,
    };
}
