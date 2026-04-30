// Typed error taxonomy for agbrowse web-ai.
//
// Phase 2 PR1 — class shape, helpers, and JSON serializer only. PR2 converts
// every `throw new Error(` call site in `web-ai/**` to `WebAiError`.
//
// Catalog (devlog/03_phase2_errors.md is the source of truth):
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

const TO_JSON_KEYS = [
    'name',
    'errorCode',
    'stage',
    'message',
    'retryHint',
    'vendor',
    'mutationAllowed',
    'selectorsTried',
    'evidence',
];

export class WebAiError extends Error {
    constructor(init = {}) {
        super(init.message || init.errorCode || 'web-ai error');
        this.name = 'WebAiError';
        this.errorCode = init.errorCode || 'internal.unhandled';
        this.stage = init.stage || 'internal';
        this.retryHint = init.retryHint || 'report';
        this.vendor = init.vendor;
        this.mutationAllowed = init.mutationAllowed === true;
        this.selectorsTried = Array.isArray(init.selectorsTried) ? init.selectorsTried : [];
        this.evidence = init.evidence ?? null;
        if (init.cause) this.cause = init.cause;
    }

    toJSON() {
        return toErrorJson(this);
    }
}

export function wrapError(err, fallback = {}) {
    if (err instanceof WebAiError) return err;
    return new WebAiError({
        errorCode: 'internal.unhandled',
        stage: 'internal',
        retryHint: 'report',
        message: err?.message || String(err),
        ...fallback,
        cause: err,
    });
}

export function providerError(vendor, init = {}) {
    return new WebAiError({ ...init, vendor });
}

export function contextError(init = {}) {
    return new WebAiError(init);
}

export function toErrorJson(err) {
    const out = {};
    for (const key of TO_JSON_KEYS) {
        if (err && err[key] !== undefined) out[key] = err[key];
    }
    if (!out.name) out.name = 'WebAiError';
    return out;
}
