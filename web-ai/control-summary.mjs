// @ts-check

/**
 * @typedef {Object} ControlSummaryInput
 * @property {number} [cdpPort]
 * @property {string} [tabSource]
 * @property {boolean} [sessionReuse]
 * @property {string} [recoveryUrl]
 * @property {boolean} [chromeVisible]
 * @property {boolean} [remoteChrome]
 */

/**
 * Format a browser control state summary for stderr.
 * Never includes prompt text, file contents, or model info.
 * @param {ControlSummaryInput} opts
 * @returns {string}
 */
export function formatControlSummary({
    cdpPort = 9222,
    tabSource = 'new',
    sessionReuse = false,
    recoveryUrl,
    chromeVisible = true,
    remoteChrome = false,
} = {}) {
    const lines = [];

    const chromeMode = remoteChrome
        ? `remote CDP on port ${cdpPort}`
        : `attached to running Chrome on port ${cdpPort}`;
    lines.push(`[browser] cdp=localhost:${cdpPort} (${chromeMode})`);

    const tabDesc = tabSource === 'pooled'
        ? 'pooled (reusing warm session tab)'
        : tabSource === 'new-tab'
            ? 'new (fresh tab created)'
            : 'active (existing active tab)';
    lines.push(`[browser] tab=${tabDesc}`);

    if (sessionReuse && recoveryUrl) {
        lines.push(`[browser] session=recovered from ${recoveryUrl}`);
    } else {
        lines.push('[browser] session=new');
    }

    if (chromeVisible) {
        lines.push('[browser] chrome=visible (may focus window)');
    } else {
        lines.push('[browser] chrome=headless');
    }

    return lines.join('\n');
}

/**
 * Print control summary to stderr if conditions are met.
 * @param {ControlSummaryInput} opts
 * @param {{ controlSummary?: boolean, json?: boolean }} flags
 */
export function emitControlSummary(opts, { controlSummary = false, json = false } = {}) {
    if (!controlSummary || json) return;
    const text = formatControlSummary(opts);
    process.stderr.write(text + '\n');
}
