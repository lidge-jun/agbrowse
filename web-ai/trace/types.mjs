// @ts-check
import crypto from 'node:crypto';

export const TRACE_VERSION = 1;

/**
 * @param {string} [seed]
 * @returns {string}
 */
export function createTraceId(seed = `${Date.now()}:${Math.random()}`) {
    return crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 16);
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function hashTraceValue(value) {
    if (!value) return null;
    return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

/**
 * @param {{
 *   traceId?: string,
 *   command?: string,
 *   provider?: string|null,
 *   modelAlias?: string|null,
 *   sessionId?: string|null,
 *   targetId?: string|null,
 *   url?: string|null,
 *   steps?: unknown[],
 *   artifacts?: unknown[],
 *   evidence?: Record<string, unknown>,
 *   sourceAudit?: unknown,
 *   errorEnvelope?: unknown,
 *   gitCommit?: string|null,
 *   agbrowseVersion?: string|null,
 * }} [options]
 */
export function createTraceRecord({
    traceId = createTraceId(),
    command = 'web-ai',
    provider = null,
    modelAlias = null,
    sessionId = null,
    targetId = null,
    url = null,
    steps = [],
    artifacts = [],
    evidence = {},
    sourceAudit = null,
    errorEnvelope = null,
    gitCommit = null,
    agbrowseVersion = null,
} = {}) {
    return {
        traceVersion: TRACE_VERSION,
        traceId,
        gitCommit,
        agbrowseVersion,
        command,
        provider,
        modelAlias,
        sessionIdHash: hashTraceValue(sessionId),
        targetIdHash: hashTraceValue(targetId),
        urlOrigin: originOf(url),
        evidenceHashes: createEvidenceHashes({
            sessionId,
            targetId,
            url,
            steps,
            artifacts,
            errorEnvelope,
            ...evidence,
        }),
        viewport: null,
        steps,
        artifacts,
        sourceAudit,
        errorEnvelope,
        capturedAt: new Date().toISOString(),
    };
}

/**
 * @param {Record<string, unknown>} [evidence]
 * @returns {Record<string, string|null>}
 */
export function createEvidenceHashes(evidence = {}) {
    /** @type {Record<string, string|null>} */
    const out = {};
    for (const [key, value] of Object.entries(evidence)) {
        if (value === null || value === undefined || value === '') continue;
        out[`${key}Hash`] = hashTraceValue(typeof value === 'string' ? value : JSON.stringify(value));
    }
    return out;
}

/**
 * @param {string|null|undefined} url
 * @returns {string|null}
 */
export function originOf(url) {
    try {
        return url ? new URL(url).origin : null;
    } catch {
        return null;
    }
}
