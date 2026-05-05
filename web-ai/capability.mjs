// @ts-check
// Phase 3 capability runtime.
//
// IDs use cli-jaw's hyphenated convention so the two repos can converge
// on a shared catalog (cli-jaw `src/browser/web-ai/capability-registry.ts`
// is the source of truth — agbrowse mirrors a small subset for its
// pre-mutation gate). Initial probes cover host verification and composer
// visibility per Pro Phase 3 PR1 plan; PR2 will add model/upload/copy/
// streaming probes.
//
// A capability row has the shape:
//   { capabilityId, state: 'ok'|'warn'|'fail'|'unknown', evidence, next }
// `state` aggregates worst → best. `next` is the recommended retry hint.
//
// Side-effect contract: probes MAY open and read DOM but MUST NOT submit
// prompts or mutate model selection. Probes that open menus must close
// them before resolving.

/**
 * @typedef {{ state: string, evidence: unknown, next: string }} CapabilityProbeResult
 * @typedef {{ capabilityId: string, probeFn: (deps: unknown, input: Record<string, unknown>) => Promise<CapabilityProbeResult> }} CapabilityDef
 * @typedef {{ capabilityId: string, state: string, evidence: unknown, next: string }} CapabilityRow
 */

/**
 * @param {string} capabilityId
 * @param {CapabilityDef['probeFn']} probeFn
 * @returns {CapabilityDef}
 */
export function defineCapability(capabilityId, probeFn) {
    if (typeof probeFn !== 'function') throw new Error(`capability ${capabilityId} requires a probe function`);
    return { capabilityId, probeFn };
}

/**
 * @param {unknown} deps
 * @param {CapabilityDef[]} capabilities
 * @param {{ probe?: string, [k: string]: unknown }} [input]
 * @returns {Promise<CapabilityRow[]>}
 */
export async function runCapabilities(deps, capabilities, input = {}) {
    /** @type {CapabilityRow[]} */
    const rows = [];
    for (const cap of capabilities) {
        if (input.probe && input.probe !== cap.capabilityId) continue;
        try {
            const probeResult = await cap.probeFn(deps, input);
            rows.push({ capabilityId: cap.capabilityId, ...normalizeRow(probeResult) });
        } catch (err) {
            const e = /** @type {{ message?: string }} */ (err);
            rows.push({
                capabilityId: cap.capabilityId,
                state: 'unknown',
                evidence: { error: e?.message || String(err) },
                next: 're-snapshot',
            });
        }
    }
    return rows;
}

/**
 * @param {CapabilityRow[]} rows
 * @returns {string}
 */
export function worstCapabilityState(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return 'unknown';
    if (rows.some((r) => r.state === 'fail')) return 'fail';
    if (rows.some((r) => r.state === 'warn')) return 'warn';
    if (rows.every((r) => r.state === 'ok')) return 'ok';
    return 'unknown';
}

/**
 * @param {Partial<CapabilityProbeResult>} [probeResult]
 * @returns {{ state: string, evidence: unknown, next: string }}
 */
function normalizeRow(probeResult = {}) {
    return {
        state: probeResult.state || 'unknown',
        evidence: probeResult.evidence ?? null,
        next: probeResult.next || 'send',
    };
}

/**
 * @param {{ url?: () => string }|null|undefined} page
 * @param {Set<string>} expectedHosts
 */
export async function probeHostMatches(page, expectedHosts) {
    try {
        const url = page?.url?.() || '';
        const host = new URL(url).hostname.replace(/^www\./, '');
        if (expectedHosts.has(host)) return { state: 'ok', evidence: { url, host }, next: 'send' };
        return { state: 'fail', evidence: { url, host, expected: [...expectedHosts] }, next: 'tab-switch' };
    } catch {
        return { state: 'fail', evidence: { url: page?.url?.() || null }, next: 'tab-switch' };
    }
}

/**
 * @param {any} page
 * @param {string[]} selectors
 * @param {{ timeoutMs?: number, okNext?: string, failState?: string, failNext?: string }} [options]
 */
export async function probeFirstVisibleSelector(page, selectors, options = {}) {
    const timeoutMs = options.timeoutMs ?? 1500;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        for (const selector of selectors) {
            try {
                const locator = page.locator(selector).first();
                if (typeof locator.isVisible !== 'function') continue;
                const visible = await locator.isVisible().catch(() => false);
                if (visible) return { state: 'ok', evidence: { matched: selector, visible: true }, next: options.okNext || 'send' };
            } catch { /* keep trying */ }
        }
        if (Date.now() >= deadline) break;
        await page.waitForTimeout?.(100).catch(() => undefined);
    }
    return { state: options.failState || 'fail', evidence: { selectorsTried: selectors }, next: options.failNext || 're-snapshot' };
}
