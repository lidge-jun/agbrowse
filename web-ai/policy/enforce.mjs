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
 *   clipboardWriteIntercept?: boolean,
 *   explicitClipboardWriteIntercept?: boolean,
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
    const { policy } = await loadPolicy(input.policyPath);
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
    if (action.clipboardWriteIntercept && !allowsClipboardWriteIntercept(policy, action)) {
        throw policyError('policy.clipboard-write-intercept-denied', 'policy-enforce', 'provider copy capture denied by policy', { ruleId: 'allowClipboardWrite' });
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
 * @param {WebAiPolicy} policy
 * @param {PolicyAction} action
 * @returns {boolean}
 */
function allowsClipboardWriteIntercept(policy, action) {
    if (action.unsafeAllow?.includes('clipboard-write-intercept')) return true;
    if (action.unsafeAllow?.includes('clipboard-read')) return true;
    if (policy.allowClipboardRead === true) return true;
    if (policy.allowClipboardWrite === true) return true;
    return policy.allowClipboardWrite === 'explicit-only'
        && action.explicitClipboardWriteIntercept === true;
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

/**
 * Enforce policy on navigation actions (e.g. page.goto, navigate command).
 * Checks domain allowlist/blocklist and cross-origin navigation policy.
 *
 * @param {unknown} policyInput
 * @param {{ url: string, currentOrigin?: string|null }} action
 * @returns {{ ok: true, policy: import('./schema.mjs').WebAiPolicy }}
 */
export function enforceNavigationPolicy(policyInput, action) {
    const policy = normalizePolicy(policyInput);
    const targetOrigin = originOf(action.url);

    if (!targetOrigin) {
        throw policyError('policy.navigation-invalid-url', 'policy-enforce',
            'cannot enforce navigation policy: invalid URL', { ruleId: 'navigation', url: action.url });
    }

    if (policy.deniedOrigins.length && policy.deniedOrigins.includes(targetOrigin)) {
        throw policyError('policy.navigation-origin-denied', 'policy-enforce',
            'navigation to denied origin: ' + targetOrigin, { ruleId: 'deniedOrigins', origin: targetOrigin });
    }

    if (policy.allowedOrigins.length && !policy.allowedOrigins.includes(targetOrigin)) {
        throw policyError('policy.navigation-origin-not-allowed', 'policy-enforce',
            'navigation to origin not in allowlist: ' + targetOrigin, { ruleId: 'allowedOrigins', origin: targetOrigin });
    }

    if (action.currentOrigin && targetOrigin !== action.currentOrigin) {
        if (policy.allowCrossOriginNavigation === false) {
            throw policyError('policy.cross-origin-navigation-denied', 'policy-enforce',
                'cross-origin navigation denied by policy', { ruleId: 'crossOriginNavigation', from: action.currentOrigin, to: targetOrigin });
        }
    }

    return { ok: true, policy };
}

/**
 * Enforce policy on form/destructive actions (submit, payment, delete).
 *
 * @param {unknown} policyInput
 * @param {{ actionType: string, url?: string, formId?: string }} action
 * @returns {{ ok: true, allowed: boolean, policy: import('./schema.mjs').WebAiPolicy }}
 */
export function enforceFormActionPolicy(policyInput, action) {
    const policy = normalizePolicy(policyInput);

    const destructivePatterns = ['submit', 'delete', 'remove', 'cancel', 'checkout', 'pay', 'purchase', 'order', 'transfer'];
    const isDestructive = destructivePatterns.some(p => action.actionType.toLowerCase().includes(p));

    if (isDestructive && policy.destructiveFormPolicy === 'deny') {
        throw policyError('policy.destructive-form-denied', 'policy-enforce',
            'destructive form action denied by policy: ' + action.actionType,
            { ruleId: 'destructiveFormPolicy', actionType: action.actionType });
    }

    return { ok: true, allowed: true, policy };
}
