// @ts-check

// Parity catalog 203.3 (P2): Camoufox stealth-browser fallback (hardened fingerprint).
// agbrowse escalated only to its own CDP Chrome; this adds a Python Camoufox render lane.
// Reverse port of cli-jaw adaptive-fetch/camoufox-session.ts. Spawn-based (no-op without
// python3 + camoufox); bails before spawning when the caller's deadline already fired.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Headroom the lane allows on top of the per-attempt page budget so a browser
 * launch is not counted against the page's own time.
 */
export const CAMOUFOX_LAUNCH_HEADROOM_MS = 30_000;

/**
 * The wall-clock budget for one camoufox attempt: the process timeout below and
 * the caller's abort signal must agree, so both derive from this. The seconds
 * rounding matters — the Python script takes whole seconds, and computing the
 * signal from raw `timeoutMs` instead left it firing up to 999ms early.
 *
 * Clamped to the `AbortSignal.timeout` ceiling: without it a `timeoutMs` near
 * 2^32 turns the added headroom into a cause-less RangeError.
 *
 * @param {number} [timeoutMs]
 */
export function camoufoxBudgetMs(timeoutMs) {
    const seconds = Math.ceil((timeoutMs || 30_000) / 1000);
    return Math.min(seconds * 1000 + CAMOUFOX_LAUNCH_HEADROOM_MS, 2_147_483_647);
}

/** @type {string|null|undefined} */
let cachedPython;
/** @type {boolean|undefined} */
let cachedAvailable;

/** @returns {Promise<string|null>} */
async function detectPython() {
    if (cachedPython !== undefined) return cachedPython;
    for (const name of ['python3', 'python']) {
        try {
            const { stdout } = await execFileAsync(name, ['--version']);
            if (stdout.includes('Python 3')) {
                cachedPython = name;
                return name;
            }
        } catch { /* not found */ }
    }
    cachedPython = null;
    return null;
}

/** @returns {Promise<boolean>} */
async function detectCamoufox() {
    if (cachedAvailable !== undefined) return cachedAvailable;
    const python = await detectPython();
    if (!python) { cachedAvailable = false; return false; }
    try {
        await execFileAsync(python, ['-c', 'from camoufox.sync_api import Camoufox; print("ok")'], { timeout: 10_000 });
        cachedAvailable = true;
        return true;
    } catch {
        cachedAvailable = false;
        return false;
    }
}

/**
 * @typedef {{ ok: boolean, html: string, title: string, url: string }} CamoufoxResult
 */

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, signal?: AbortSignal, execFileImpl?: typeof execFileAsync, detect?: () => Promise<boolean> }} [options]
 * @returns {Promise<CamoufoxResult|null>}
 */
export async function fetchViaCamoufox(url, options) {
    // P0-6: bail before spawning if the caller's deadline already fired. The
    // caller budgets this signal with `camoufoxBudgetMs`, the same value the
    // execFile timeout below uses — `timeoutMs` alone would abort mid-launch.
    if (options?.signal?.aborted) return null;
    // Injected the way `deps.fetch` is injected in the scheduler: without it the
    // spawn-failure paths can only be exercised on a machine that has camoufox.
    const available = options?.detect ? await options.detect() : await detectCamoufox();
    if (!available) return null;

    const python = /** @type {string} */ (cachedPython || 'python3');
    const runFile = options?.execFileImpl || execFileAsync;
    const timeout = Math.ceil((options?.timeoutMs || 30_000) / 1000);
    const script = [
        'import json, sys',
        'from camoufox.sync_api import Camoufox',
        `url = ${JSON.stringify(url)}`,
        `timeout = ${timeout * 1000}`,
        'with Camoufox(headless=True) as browser:',
        '    page = browser.new_page()',
        '    page.goto(url, timeout=timeout)',
        '    title = page.title()',
        '    html = page.content()',
        '    print(json.dumps({"ok": True, "title": title, "html": html, "url": url}))',
    ].join('\n');

    try {
        const { stdout } = await runFile(python, ['-c', script], {
            timeout: camoufoxBudgetMs(options?.timeoutMs),
            maxBuffer: 10_000_000,
            // P0-6: kill the Camoufox subprocess if the caller's deadline fires.
            ...(options?.signal ? { signal: options.signal } : {}),
        });
        return JSON.parse(stdout.trim().split('\n').pop() || '{}');
    } catch (error) {
        // An abort is the caller's own deadline firing, not "this source had
        // nothing". Returning null here made the lane vanish without a trace;
        // let the scheduler record why.
        if ((/** @type {any} */ (error))?.name === 'AbortError'
            || (/** @type {any} */ (error))?.code === 'ABORT_ERR') throw error;
        return null;
    }
}

export { detectCamoufox, detectPython };
