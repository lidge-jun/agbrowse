// @ts-check
// Typed error taxonomy for agbrowse web-ai.
//
// Phase 2 PR1 — class shape, helpers, and JSON serializer only. PR2 converts
// every `throw new Error(` call site in `web-ai/**` to `WebAiError`.
//
// Catalog (devlog/_fin/mvp/01_foundation/03_phase2_errors.md is the source of truth):
//
//   cdp.unreachable                 connect              start-or-check-port
//   cdp.target-mismatch             connect              tab-switch
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
