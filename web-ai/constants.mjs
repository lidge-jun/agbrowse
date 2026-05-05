// @ts-check
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
