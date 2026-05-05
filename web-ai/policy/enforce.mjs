// @ts-check
import { loadPolicy, normalizePolicy, policyError } from './schema.mjs';

/**
 * @typedef {import('./schema.mjs').WebAiPolicy} WebAiPolicy
 */

/**
 * @typedef {{
 *   url?: string,
 *   upload?: boolean,
 *   explicitUpload?: boolean,
 *   clipboardRead?: boolean,
 *   evaluate?: boolean,
 *   fileAccess?: boolean,
 *   unsafeAllow?: string[],
 *   [extra: string]: unknown,
 * }} PolicyAction
 */

/**
 * @param {{ policyPath?: string|null }} [input]
 * @param {PolicyAction} [action]
 * @returns {Promise<WebAiPolicy>}
 */
export async function loadAndEnforcePolicy(input = {}, action = {}) {
    const policy = await loadPolicy(input.policyPath);
    enforcePolicy(policy, action);
    return policy;
}

/**
 * @param {unknown} [policyInput]
 * @param {PolicyAction} [action]
 * @returns {{ ok: true, policy: WebAiPolicy }}
 */
export function enforcePolicy(policyInput = {}, action = {}) {
    const policy = normalizePolicy(policyInput);
    const origin = originOf(action.url);
    if (!origin && (policy.deniedOrigins.length || policy.allowedOrigins.length)) {
        throw policyError('policy.origin-unavailable', 'policy-enforce', 'origin is required when origin policy is configured', { ruleId: 'originPolicy' });
    }
    if (origin && policy.deniedOrigins.includes(origin)) {
        throw policyError('policy.origin-denied', 'policy-enforce', `origin denied by policy: ${origin}`, { ruleId: 'deniedOrigins', origin });
    }
    if (policy.allowedOrigins.length && origin && !policy.allowedOrigins.includes(origin)) {
        throw policyError('policy.origin-not-allowed', 'policy-enforce', `origin not allowed by policy: ${origin}`, { ruleId: 'allowedOrigins', origin });
    }
    if (action.upload && policy.allowUploads === 'explicit-only' && action.explicitUpload !== true) {
        throw policyError('policy.upload-explicit-required', 'policy-enforce', 'uploads require explicit user request', { ruleId: 'allowUploads' });
    }
    if (action.upload && policy.allowUploads !== true && policy.allowUploads !== 'explicit-only') {
        throw policyError('policy.upload-denied', 'policy-enforce', 'uploads denied by policy', { ruleId: 'allowUploads' });
    }
    if (action.clipboardRead && policy.allowClipboardRead !== true && !action.unsafeAllow?.includes('clipboard-read')) {
        throw policyError('policy.clipboard-read-denied', 'policy-enforce', 'clipboard read denied by policy', { ruleId: 'allowClipboardRead' });
    }
    if (action.evaluate && policy.allowEvaluate !== true && !action.unsafeAllow?.includes('evaluate')) {
        throw policyError('policy.evaluate-denied', 'policy-enforce', 'evaluate denied by policy', { ruleId: 'allowEvaluate' });
    }
    if (action.fileAccess && policy.allowFileAccess !== true && !action.unsafeAllow?.includes('file-access')) {
        throw policyError('policy.file-access-denied', 'policy-enforce', 'file access denied by policy', { ruleId: 'allowFileAccess' });
    }
    return { ok: true, policy };
}

/**
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
function originOf(url) {
    try {
        return url ? new URL(url).origin : null;
    } catch {
        return null;
    }
}
