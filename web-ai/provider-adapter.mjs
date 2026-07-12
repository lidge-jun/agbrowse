// @ts-check

// Parity catalog 201 #7 (P2, contract-only): provider lifecycle adapter interface. agbrowse
// vendor-editor-contract.mjs is per-vendor selector *data*; this adds the behavioral runtime
// contract (waitForUi/selectMode/typePrompt/submitPrompt/waitForResponse/diagnose) plus a
// disabled-adapter factory for vendors whose live runtime is not yet enabled. Reverse port
// of cli-jaw web-ai/provider-adapter.ts; the disabled error is a WebAiError
// (provider.runtime-disabled), agbrowse's error idiom, not a plain Error.

import { WebAiError } from './errors.mjs';

/**
 * @typedef {'chatgpt'|'gemini'|'grok'|'perplexity'} WebAiVendorId
 *
 * @typedef {Object} WaitForResponseOptions
 * @property {number} timeoutMs
 * @property {number} [minTurnIndex]
 * @property {boolean} [allowCopyMarkdownFallback]
 *
 * @typedef {Object} ResponseCaptureResult
 * @property {boolean} ok
 * @property {string} [answerText]
 * @property {{ kind: 'opened', reason?: string }} [canvas]
 * @property {unknown[]} [resolverTrace]
 * @property {string[]} usedFallbacks
 * @property {string[]} warnings
 * @property {{ status: 'conversation-mismatch'|'tab-crashed', reason: string, recoverable?: boolean }} [drift]
 *
 * @typedef {Object} WebAiProviderAdapter
 * @property {WebAiVendorId} vendor
 * @property {boolean} mutationAllowed
 * @property {() => Promise<void>} waitForUi
 * @property {(name?: string) => Promise<void>} [selectMode]
 * @property {(text: string) => Promise<void>} typePrompt
 * @property {() => Promise<void>} submitPrompt
 * @property {(options: WaitForResponseOptions) => Promise<ResponseCaptureResult>} waitForResponse
 * @property {() => Promise<unknown>} [extractArtifacts]
 * @property {() => Promise<void>} [stop]
 * @property {(stage: string) => Promise<unknown>} [diagnose]
 */

export class ProviderRuntimeDisabledError extends WebAiError {
    /**
     * @param {WebAiVendorId} vendor
     * @param {string} [stage]
     */
    constructor(vendor, stage = 'provider-select-mode') {
        super({
            errorCode: 'provider.runtime-disabled',
            stage,
            vendor,
            retryHint: 'enable-or-skip',
            mutationAllowed: false,
            message: `provider runtime disabled: ${vendor} (contract-only). stage=${stage}`,
        });
        this.name = 'ProviderRuntimeDisabledError';
    }
}

/**
 * Build a contract-only adapter that rejects every mutation. Used for vendors whose live
 * runtime is not yet enabled.
 * @param {WebAiVendorId} vendor
 * @returns {WebAiProviderAdapter}
 */
export function createDisabledProviderAdapter(vendor) {
    return {
        vendor,
        mutationAllowed: false,
        async waitForUi() { throw new ProviderRuntimeDisabledError(vendor, 'status'); },
        async typePrompt() { throw new ProviderRuntimeDisabledError(vendor, 'composer-insert'); },
        async submitPrompt() { throw new ProviderRuntimeDisabledError(vendor, 'send-click'); },
        async waitForResponse() { throw new ProviderRuntimeDisabledError(vendor, 'poll-timeout'); },
    };
}
