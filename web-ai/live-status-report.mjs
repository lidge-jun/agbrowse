// @ts-check

// Parity catalog 203.8 (P2): typed standalone live-status report struct
// (vendor/status/runtimeEnabled/notes/sources), reusable by status + health. agbrowse
// returned a raw capability list with no typed report symbol. Reverse port of cli-jaw
// gemini-live.ts:GeminiLiveStatusReport/reportGeminiLiveStatus, generalized to any vendor.
// buildLiveStatusReport is pure (page signals passed in) — fully unit-testable.

/**
 * @typedef {Object} LiveStatusReport
 * @property {string} vendor
 * @property {string} status
 * @property {boolean} runtimeEnabled
 * @property {string[]} notes
 * @property {string[]} sources
 */

/**
 * Build a typed live-status report from gathered page signals. Precedence: wrong provider
 * URL → unavailable; signed-out link visible → signed-out; composer not visible →
 * unavailable; otherwise ready.
 * @param {{ vendor: string, isProviderUrl: boolean, url?: string, signedOut?: boolean, composerVisible?: boolean, sources?: string[], readyStatus?: string, unavailableStatus?: string }} signals
 * @returns {LiveStatusReport}
 */
export function buildLiveStatusReport({
    vendor,
    isProviderUrl,
    url = '',
    signedOut = false,
    composerVisible = false,
    sources = [],
    readyStatus = 'ready',
    unavailableStatus = `${vendor}-unavailable`,
}) {
    const base = { vendor, runtimeEnabled: /** @type {const} */ (true), sources: [...sources] };
    if (!isProviderUrl) {
        return { ...base, status: unavailableStatus, notes: [`active tab is not ${vendor} (${url})`] };
    }
    if (signedOut) {
        return { ...base, status: 'signed-out', notes: ['sign-in link visible — user is not signed in'] };
    }
    if (!composerVisible) {
        return { ...base, status: unavailableStatus, notes: [`${vendor} composer not visible — page may be loading or restricted`] };
    }
    return { ...base, status: readyStatus, notes: [`${vendor} composer visible`] };
}

/**
 * Convenience: is the report a healthy/ready state?
 * @param {LiveStatusReport} report
 * @returns {boolean}
 */
export function isLiveStatusReady(report) {
    return report.status === 'ready';
}
