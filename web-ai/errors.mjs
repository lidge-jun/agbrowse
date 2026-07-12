// @ts-check
// Typed error taxonomy for agbrowse web-ai.
//
// Phase 2 PR1 — class shape, helpers, and JSON serializer only. PR2 converts
// every `throw new Error(` call site in `web-ai/**` to `WebAiError`.
//
// Catalog (devlog/_fin/mvp/01_foundation/03_phase2_errors.md is the source of truth):
//
//   cdp.unreachable                 connect              start-or-check-port
//   cdp.target-mismatch             connect|poll|target-resolution
//                                                        tab-switch|poll-session
//   session.target-ambiguous        target-resolution    pass-session
//   provider.composer-not-visible   composer-prereq      re-snapshot
//   provider.model-mismatch         provider-select-mode model-fallback
//   provider.attachment-preflight   attachment-preflight inline-only-or-file
//   provider.attachment-evidence-missing
//                                   attachment-verify    re-upload
//   provider.commit-not-verified    commit-verify        re-snapshot
//   provider.poll-timeout           poll                 poll-or-resume
//   provider.runtime-disabled       provider-runtime-gate enable-or-skip
//   capability.unsupported          capability-preflight feature-fallback
//   context.over-budget             context-preflight    reduce-files
//   context.symlink-rejected        context-preflight    path-list
//   grok.context-pack-not-allowed   grok-context-pack-not-allowed
//                                                        inline-only-or-allow-flag
//   internal.unhandled              internal             report

/**
 * @typedef {{
 *   message?: string,
 *   errorCode?: string,
 *   stage?: string,
 *   retryHint?: string,
 *   vendor?: string,
 *   mutationAllowed?: boolean,
 *   selectorsTried?: string[],
 *   evidence?: unknown,
 *   traceId?: string,
 *   ruleId?: string,
 *   cause?: unknown,
 * }} WebAiErrorInit
 */

/** @type {Array<keyof (WebAiError & { name: string })>} */
const TO_JSON_KEYS = /** @type {any} */ ([
    'name',
    'errorCode',
    'stage',
    'message',
    'retryHint',
    'vendor',
    'mutationAllowed',
    'selectorsTried',
    'evidence',
    'traceId',
    'ruleId',
]);

export class WebAiError extends Error {
    /** @param {WebAiErrorInit} [init] */
    constructor(init = {}) {
        super(init.message || init.errorCode || 'web-ai error');
        /** @type {string} */
        this.name = 'WebAiError';
        /** @type {string} */
        this.errorCode = init.errorCode || 'internal.unhandled';
        /** @type {string} */
        this.stage = init.stage || 'internal';
        /** @type {string} */
        this.retryHint = init.retryHint || 'report';
        /** @type {string|undefined} */
        this.vendor = init.vendor;
        /** @type {boolean} */
        this.mutationAllowed = init.mutationAllowed === true;
        /** @type {string[]} */
        this.selectorsTried = Array.isArray(init.selectorsTried) ? init.selectorsTried : [];
        /** @type {unknown} */
        this.evidence = init.evidence ?? null;
        /** @type {string|undefined} */
        this.traceId = init.traceId;
        /** @type {string|undefined} */
        this.ruleId = init.ruleId;
        if (init.cause) this.cause = init.cause;
    }

    toJSON() {
        return toErrorJson(this);
    }
}

/**
 * @param {unknown} err
 * @param {WebAiErrorInit} [fallback]
 * @returns {WebAiError}
 */
export function wrapError(err, fallback = {}) {
    if (err instanceof WebAiError) return err;
    if (err && typeof err === 'object' && typeof /** @type {{ errorCode?: unknown }} */ (err).errorCode === 'string') {
        const e = /** @type {{ message?: string, errorCode?: string, stage?: string, retryHint?: string, vendor?: string, mutationAllowed?: boolean, selectorsTried?: string[], evidence?: unknown, traceId?: string, ruleId?: string }} */ (err);
        return new WebAiError({
            errorCode: e.errorCode,
            stage: e.stage,
            retryHint: e.retryHint,
            vendor: e.vendor,
            mutationAllowed: e.mutationAllowed,
            selectorsTried: e.selectorsTried,
            evidence: e.evidence,
            traceId: e.traceId,
            ruleId: e.ruleId,
            message: e.message,
            ...fallback,
            cause: err,
        });
    }
    const e = /** @type {{ message?: string }} */ (err);
    return new WebAiError({
        errorCode: 'internal.unhandled',
        stage: 'internal',
        retryHint: 'report',
        message: e?.message || String(err),
        ...fallback,
        cause: err,
    });
}

/**
 * @param {string|undefined} vendor
 * @param {WebAiErrorInit} [init]
 * @returns {WebAiError}
 */
export function providerError(vendor, init = {}) {
    return new WebAiError({ ...init, vendor });
}

/**
 * @param {WebAiErrorInit} [init]
 * @returns {WebAiError}
 */
export function contextError(init = {}) {
    return new WebAiError(init);
}

/**
 * @param {WebAiError | (Error & Record<string, unknown>) | null | undefined} err
 * @returns {Record<string, unknown>}
 */
export function toErrorJson(err) {
    /** @type {Record<string, unknown>} */
    const out = {};
    const errRecord = /** @type {Record<string, unknown>} */ (err || {});
    for (const key of TO_JSON_KEYS) {
        if (err && errRecord[key] !== undefined) out[key] = errRecord[key];
    }
    if (!out.name) out.name = 'WebAiError';
    return out;
}


/** @param {string} vendor @param {string|null|undefined} model @param {Record<string, unknown>} [evidence] */
export function modelMismatchError(vendor, model, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.model-mismatch',
        stage: 'provider-select-mode',
        retryHint: 'model-fallback',
        message: model ? `unsupported ${vendor} model: ${model}` : `invalid ${vendor} model selection request`,
        mutationAllowed: false,
        evidence: { model: model ?? null, ...evidence },
    });
}

/** @param {string} vendor @param {string} model @param {Record<string, unknown>} [evidence] */
export function modelEntitlementError(vendor, model, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.model-entitlement',
        stage: 'provider-select-mode',
        retryHint: 'choose-unlocked-model',
        message: `${vendor} model is locked: ${model}`,
        mutationAllowed: false,
        evidence: { model, ...evidence },
    });
}

/** @param {string} vendor @param {string|null|undefined} model @param {string|null|undefined} effort @param {Record<string, unknown>} [evidence] */
export function modeUnavailableError(vendor, model, effort, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.mode-unavailable',
        stage: 'provider-select-mode',
        retryHint: 'omit-effort-or-change-model',
        message: `${vendor} Thinking control is unavailable${model ? ` for ${model}` : ''}`,
        mutationAllowed: false,
        evidence: { model: model ?? null, effort: effort ?? null, ...evidence },
    });
}

/** @param {string} vendor @param {string} effort @param {Record<string, unknown>} [evidence] */
export function invalidEffortError(vendor, effort, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.invalid-effort',
        stage: 'provider-input-validation',
        retryHint: 'use-on-off-effort-aliases',
        message: `unsupported ${vendor} effort: ${effort}`,
        mutationAllowed: false,
        evidence: { effort, ...evidence },
    });
}

/** @param {string} vendor @param {string} primaryName @param {unknown} primaryValue @param {unknown} aliasValue @param {Record<string, unknown>} [evidence] */
export function optionConflictError(vendor, primaryName, primaryValue, aliasValue, evidence = {}) {
    return providerError(vendor, {
        errorCode: 'provider.option-conflict',
        stage: 'provider-input-validation',
        retryHint: 'remove-conflicting-option',
        message: `conflicting ${vendor} options: --${primaryName}`,
        mutationAllowed: false,
        evidence: { primaryName, primaryValue, aliasValue, ...evidence },
    });
}

/** @param {string} requestedProvider @param {string} sessionVendor @param {string|null|undefined} sessionId */
export function sessionVendorMismatchError(requestedProvider, sessionVendor, sessionId) {
    return providerError(requestedProvider, {
        errorCode: 'provider.session-vendor-mismatch',
        stage: 'session-resolve',
        retryHint: 'use-matching-provider-or-session',
        message: `requested provider ${requestedProvider} does not match session vendor ${sessionVendor}`,
        mutationAllowed: false,
        evidence: { requestedProvider, sessionVendor, sessionId: sessionId ?? null },
    });
}
