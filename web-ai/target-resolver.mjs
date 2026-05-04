import { createActionIntent, serializeActionIntent } from './action-intent.mjs';
import { resolveActionTarget } from './self-heal.mjs';

export async function resolveTargetForIntent(page, intentInput = {}, options = {}) {
    const actionIntent = createActionIntent(intentInput);
    const resolution = await resolveActionTarget(page, {
        ...options,
        provider: actionIntent.provider,
        intent: actionIntent.intentId,
        actionKind: actionIntent.operation,
        feature: actionIntent.feature,
        semanticTargetOverride: actionIntent.semanticTarget,
        selectors: actionIntent.cssFallbacks,
    });
    return formatResolverResult(actionIntent, resolution);
}

export function formatResolverResult(actionIntentInput = {}, resolution = {}) {
    const actionIntent = serializeActionIntent(actionIntentInput);
    const selectedAttempt = resolution.attempts?.find(attempt => attempt.validation?.ok) || null;
    return {
        ok: resolution.ok === true,
        intent: actionIntent,
        target: resolution.target || null,
        confidence: resolution.target?.confidence ?? selectedAttempt?.validation?.confidence ?? null,
        resolutionSource: resolution.target?.resolution || selectedAttempt?.source || null,
        attempts: resolution.attempts || [],
        errorCode: resolution.errorCode || null,
        required: resolution.required === true || actionIntent.required === true,
    };
}
