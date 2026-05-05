// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';
import { WebAiError } from '../errors.mjs';
import { DEFAULT_WEB_AI_POLICY } from './default-policy.mjs';

/**
 * @typedef {{
 *   version: 1,
 *   allowedOrigins: string[],
 *   deniedOrigins: string[],
 *   allowDownloads: boolean,
 *   allowUploads: boolean|string,
 *   allowClipboardRead: boolean,
 *   allowClipboardWrite: boolean|string,
 *   allowEvaluate: boolean,
 *   allowFileAccess: boolean,
 *   allowCrossOriginNavigation: boolean|string,
 *   destructiveFormPolicy: string,
 *   promptInjectionBoundary: string,
 * }} WebAiPolicy
 */

const POLICY_KEYS = new Set(Object.keys(DEFAULT_WEB_AI_POLICY));

/**
 * @param {string|null|undefined} policyPath
 * @returns {Promise<WebAiPolicy>}
 */
export async function loadPolicy(policyPath) {
    if (!policyPath) return { ...DEFAULT_WEB_AI_POLICY };
    const resolved = path.resolve(policyPath);
    const cwd = process.cwd();
    if (policyPath.split(/[\\/]+/).includes('..') || (resolved !== cwd && !resolved.startsWith(`${cwd}${path.sep}`))) {
        throw policyError('policy.path-traversal', 'policy-load', 'policy path escapes current working directory', { ruleId: 'policyPath', policyPath });
    }
    const raw = await fs.readFile(resolved, 'utf8');
    return normalizePolicy(JSON.parse(raw));
}

/**
 * @param {unknown} [policy]
 * @returns {WebAiPolicy}
 */
export function normalizePolicy(policy = {}) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
        throw policyError('policy.invalid-shape', 'policy-load', 'policy must be a JSON object', { ruleId: 'policySchema' });
    }
    const policyObj = /** @type {Record<string, unknown>} */ (policy);
    const unknown = Object.keys(policyObj).filter((key) => !POLICY_KEYS.has(key));
    if (unknown.length) throw policyError('policy.unknown-key', 'policy-load', `unknown policy keys: ${unknown.join(', ')}`, { ruleId: 'policySchema', unknown });
    const merged = /** @type {WebAiPolicy} */ ({ ...DEFAULT_WEB_AI_POLICY, ...policyObj });
    if (merged.version !== 1) throw policyError('policy.version-unsupported', 'policy-load', 'policy version must be 1', { ruleId: 'version', version: merged.version });
    if (!Array.isArray(merged.allowedOrigins) || !Array.isArray(merged.deniedOrigins)) {
        throw policyError('policy.invalid-shape', 'policy-load', 'allowedOrigins and deniedOrigins must be arrays', { ruleId: 'originPolicy' });
    }
    return merged;
}

/**
 * @param {string} errorCode
 * @param {string} stage
 * @param {string} message
 * @param {{ ruleId?: string, [extra: string]: unknown }} [evidence]
 * @returns {WebAiError}
 */
export function policyError(errorCode, stage, message, evidence = {}) {
    return new WebAiError({
        errorCode,
        stage,
        retryHint: 'policy',
        message,
        mutationAllowed: false,
        ruleId: evidence.ruleId,
        evidence,
    });
}
