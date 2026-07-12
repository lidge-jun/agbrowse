// @ts-check

/**
 * G09 (Model Adapter) — FROZEN.
 *
 * The web-ai skill (agbrowse web-ai query --vendor chatgpt|gemini|grok|perplexity) IS the
 * model-adapter surface for this release. No provider API clients are added.
 *
 * Hard cap = 1 initial attempt + 1 retry = 2 total attempts.
 * Stricter than Vercel AI SDK's default (which is 2 *retries*, i.e. 3 attempts).
 * The single retry must be DELAYED + JITTERED + Retry-After-aware. Never immediate.
 * No flag/env override. Same constant is consumed by the G01 planner loop.
 */
export const MAX_MODEL_ADAPTER_ATTEMPTS = 2;

/**
 * Transient HTTP status codes that MAY be retried (subject to MAX_MODEL_ADAPTER_ATTEMPTS).
 * Anthropic 529 = overloaded_error. All others non-retryable.
 */
export const MODEL_ADAPTER_TRANSIENT_STATUS = Object.freeze([408, 429, 500, 502, 503, 504, 529]);

/**
 * Classify whether an error is retryable under the model-adapter retry policy.
 * @param {{ statusCode?: number, transient?: boolean, idempotent?: boolean, midStream?: boolean }} err
 * @returns {boolean}
 */
export function isModelAdapterTransient(err) {
    if (!err || typeof err !== 'object') return false;
    if (err.midStream) return false; // streaming error after 200: never auto-retry
    if (err.idempotent === false) return false;
    if (err.transient === true) return true;
    if (typeof err.statusCode === 'number' && MODEL_ADAPTER_TRANSIENT_STATUS.includes(err.statusCode)) return true;
    return false;
}

export const CACHE_SCHEMA_VERSION = 2;
export const VALIDATION_THRESHOLD = 0.6;
export const MAX_TRACE_STEPS = 200;
export const MAX_TRACE_BYTES = 1024 * 1024; // 1MB

export const VALIDATION_REASONS = Object.freeze({
    NOT_FOUND: 'not-found',
    AMBIGUOUS_SELECTOR: 'ambiguous-selector',
    NOT_VISIBLE: 'not-visible',
    NOT_ENABLED: 'not-enabled',
    NOT_EDITABLE: 'not-editable',
    LOW_CONFIDENCE: 'low-confidence',
    STALE_ROLE_NAME: 'stale-role-name',
    SCHEMA_VERSION_MISMATCH: 'schema-version-mismatch',
    CONTRACT_VERSION_MISMATCH: 'contract-version-mismatch',
    FRAME_PATH_MISMATCH: 'frame-path-mismatch',
    BROWSER_CONFIG_MISMATCH: 'browser-config-mismatch',
    INSUFFICIENT_CONTRACT: 'insufficient-semantic-contract',
    REF_STALE: 'ref-stale',
    REF_INVALID: 'ref-invalid',
    REF_NO_SELECTOR: 'ref-no-selector',
    MISSING_SELECTOR: 'missing-selector',
});

export const RESOLUTION_SOURCES = Object.freeze({
    CACHE: 'cache',
    SNAPSHOT_SEMANTIC: 'snapshot-semantic',
    CSS_FALLBACK: 'css-fallback',
    OBSERVE_RANKED: 'observe-ranked',
});
