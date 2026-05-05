// @ts-check
import { VALIDATION_THRESHOLD } from './constants.mjs';
import { resolveIntentFeature } from './self-heal.mjs';
import { semanticTargetsForVendor } from './vendor-editor-contract.mjs';

/** @typedef {import('./vendor-editor-contract.mjs').VendorName} VendorName */
/** @typedef {import('./vendor-editor-contract.mjs').SemanticTarget} SemanticTarget */

/**
 * @typedef {Object} ActionIntentInput
 * @property {string} [intentId]
 * @property {string} [intent]
 * @property {VendorName} [provider]
 * @property {string} [feature]
 * @property {SemanticTarget} [semanticTarget]
 * @property {string} [operation]
 * @property {string[]} [requiredEvidence]
 * @property {string[]} [cssFallbacks]
 * @property {string} [ambiguityPolicy]
 * @property {number | string} [confidenceThreshold]
 */

/** @type {Readonly<Record<string, string>>} */
const OPERATION_BY_INTENT = Object.freeze({
    'composer.fill': 'fill',
    'composer.click': 'click',
    'send.click': 'click',
    'copy.lastResponse': 'click',
    'modelPicker.open': 'click',
    'modelPicker.click': 'click',
    'upload.attach': 'click',
    'upload.click': 'click',
    'responseFeed.read': 'read',
    'streaming.check': 'read',
    'stop.click': 'click',
});

/**
 * @param {ActionIntentInput} [input]
 */
export function createActionIntent(input = {}) {
    const intentId = input.intentId || input.intent;
    if (!intentId) throw new Error('ActionIntent requires intentId');
    const provider = input.provider || 'chatgpt';
    const feature = input.feature || resolveIntentFeature(intentId);
    if (!feature) throw new Error(`unknown action intent: ${intentId}`);
    const semanticTarget = input.semanticTarget || semanticTargetsForVendor(provider)[feature];
    if (!semanticTarget) throw new Error(`missing semantic target for ${provider}:${feature}`);
    const operation = input.operation || OPERATION_BY_INTENT[intentId] || 'click';
    const requiredEvidence = input.requiredEvidence || requiredEvidenceForOperation(operation);

    return {
        intentId,
        provider,
        feature,
        operation,
        roleHints: [...(semanticTarget.roles || [])],
        nameHints: (semanticTarget.names || []).map(patternToHint),
        excludeNameHints: (semanticTarget.excludeNames || []).map(patternToHint),
        testIds: [...(/** @type {any} */ (semanticTarget).testIds || [])],
        cssFallbacks: [...(input.cssFallbacks || semanticTarget.cssFallbacks || [])],
        requiredEvidence,
        ambiguityPolicy: input.ambiguityPolicy || 'reject',
        required: semanticTarget.required === true,
        confidenceThreshold: Number.isFinite(Number(input.confidenceThreshold))
            ? Number(input.confidenceThreshold)
            : VALIDATION_THRESHOLD,
        semanticTarget,
    };
}

/**
 * @param {ActionIntentInput} intent
 */
export function serializeActionIntent(intent) {
    const normalized = createActionIntent(intent);
    const { semanticTarget: _semanticTarget, ...serializable } = normalized;
    return serializable;
}

/**
 * @param {string} operation
 * @returns {string[]}
 */
function requiredEvidenceForOperation(operation) {
    if (operation === 'fill') return ['visible', 'enabled', 'editable'];
    if (operation === 'click') return ['visible', 'enabled'];
    return ['visible'];
}

/**
 * @param {RegExp | string} pattern
 * @returns {string}
 */
function patternToHint(pattern) {
    if (pattern instanceof RegExp) return pattern.source;
    return String(pattern);
}
