// @ts-check
import { createActionIntent, serializeActionIntent } from './action-intent.mjs';
import { resolveActionTarget } from './self-heal.mjs';

/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('./action-intent.mjs').ActionIntentInput} ActionIntentInput */

/**
 * @param {Page} page
 * @param {ActionIntentInput} [intentInput]
 * @param {Record<string, any>} [options]
 */
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

/**
 * @param {ActionIntentInput} [actionIntentInput]
 * @param {{ ok?: boolean, attempts?: Array<{ validation?: { ok?: boolean, confidence?: number }, source?: string }>, target?: { confidence?: number, resolution?: string } | null, errorCode?: string | null, required?: boolean }} [resolution]
 */
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
