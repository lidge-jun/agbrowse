import { VALIDATION_THRESHOLD } from './constants.mjs';
import { resolveIntentFeature } from './self-heal.mjs';
import { semanticTargetsForVendor } from './vendor-editor-contract.mjs';

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
        testIds: [...(semanticTarget.testIds || [])],
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

export function serializeActionIntent(intent) {
    const normalized = createActionIntent(intent);
    const { semanticTarget: _semanticTarget, ...serializable } = normalized;
    return serializable;
}

function requiredEvidenceForOperation(operation) {
    if (operation === 'fill') return ['visible', 'enabled', 'editable'];
    if (operation === 'click') return ['visible', 'enabled'];
    return ['visible'];
}

function patternToHint(pattern) {
    if (pattern instanceof RegExp) return pattern.source;
    return String(pattern);
}
