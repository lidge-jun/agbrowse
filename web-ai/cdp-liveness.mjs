// @ts-check

/**
 * @typedef {{ endpointReachable: boolean, targetFound: boolean|null, matchedUrl?: string, error?: string }} CdpLiveness
 */

/**
 * Probe Chrome independently from the Playwright/CDP client that disconnected.
 * @param {{ port: number, targetId?: string|null, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<CdpLiveness>}
 */
export async function probeCdpLiveness(options) {
    const port = Number(options.port);
    const targetId = options.targetId?.trim() || '';
    if (!Number.isFinite(port) || port <= 0) {
        return { endpointReachable: false, targetFound: null, error: 'missing debug port' };
    }
    if (!targetId) {
        return { endpointReachable: false, targetFound: null, error: 'missing target id' };
    }

    const fetchImpl = options.fetchImpl || fetch;
    const timeoutMs = options.timeoutMs || 1_500;
    try {
        const versionResponse = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!versionResponse.ok) {
            return { endpointReachable: false, targetFound: null, error: `DevTools version HTTP ${versionResponse.status}` };
        }
    } catch (err) {
        return { endpointReachable: false, targetFound: null, error: errorMessage(err) };
    }

    try {
        const listResponse = await fetchImpl(`http://127.0.0.1:${port}/json/list`, {
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!listResponse.ok) {
            return { endpointReachable: true, targetFound: null, error: `DevTools list HTTP ${listResponse.status}` };
        }
        const targets = await listResponse.json();
        if (!Array.isArray(targets)) {
            return { endpointReachable: true, targetFound: null, error: 'DevTools target list is not an array' };
        }
        const match = targets.find(target => target?.id === targetId || target?.targetId === targetId);
        return match
            ? { endpointReachable: true, targetFound: true, matchedUrl: typeof match.url === 'string' ? match.url : undefined }
            : { endpointReachable: true, targetFound: false };
    } catch (err) {
        return { endpointReachable: true, targetFound: null, error: errorMessage(err) };
    }
}

/** @param {CdpLiveness} liveness */
export function isRecoverableCdpDisconnect(liveness) {
    return liveness.endpointReachable === true && liveness.targetFound === true;
}

/** @param {unknown} err */
function errorMessage(err) {
    return String((/** @type {any} */ (err))?.message || err);
}
