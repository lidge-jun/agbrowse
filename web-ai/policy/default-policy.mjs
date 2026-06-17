// @ts-check
export const DEFAULT_WEB_AI_POLICY = Object.freeze({
    version: 1,
    allowedOrigins: [],
    deniedOrigins: [],
    allowDownloads: false,
    allowUploads: 'explicit-only',
    allowClipboardRead: false,
    allowClipboardWrite: 'explicit-only',
    allowEvaluate: true,
    allowFileAccess: false,
    allowCrossOriginNavigation: 'confirm',
    destructiveFormPolicy: 'deny',
    promptInjectionBoundary: 'strict',
});

/** @type {ReadonlySet<string>} */
const PROVIDER_FILE_ACCESS_PROVIDERS = new Set(['chatgpt', 'gemini', 'grok']);

/**
 * Apply provider-specific file-access default.
 * Only upgrades allowFileAccess when the user did NOT explicitly set it.
 * @param {string} provider
 * @param {Record<string, unknown>} policy
 * @param {{ explicitKeys: ReadonlySet<string> }} opts
 * @returns {Record<string, unknown>}
 */
export function applyProviderDefaults(provider, policy, opts) {
    if (!PROVIDER_FILE_ACCESS_PROVIDERS.has(provider)) return policy;
    if (opts.explicitKeys.has('allowFileAccess')) return policy;
    return { ...policy, allowFileAccess: true };
}
