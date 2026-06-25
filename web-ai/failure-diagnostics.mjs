// @ts-check
import { trySaveDiagnosticsArtifact } from './session-artifacts.mjs';

/**
 * Failure-time DOM/screenshot diagnostics (spec 34). Opt-in (verbose-gated) so
 * the normal path pays nothing. Capture NEVER throws — a diagnostics failure
 * must not mask the original automation error.
 */

/**
 * Whether failure diagnostics should be captured. Pure.
 * @param {{ diagnostics?: boolean, verbose?: boolean }} [input]
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function diagnosticsEnabled(input = {}, env = process.env) {
    return input?.diagnostics === true || input?.verbose === true || env?.AGBROWSE_DIAGNOSTICS === '1';
}

/**
 * Read a compact conversation snapshot (last N turns: role/testid/text) plus
 * page url/title/body excerpt. Read-only; returns null on failure.
 * @param {{ evaluate: Function }} page
 * @param {{ turns?: number, maxChars?: number }} [opts]
 * @returns {Promise<object|null>}
 */
export async function readConversationSnapshot(page, { turns = 6, maxChars = 2000 } = {}) {
    try {
        return await page.evaluate(({ t, m }) => {
            const sel = 'article[data-testid^="conversation-turn"], [data-message-author-role], [data-turn]';
            const nodes = Array.from(document.querySelectorAll(sel)).slice(-t);
            return {
                url: location.href,
                title: document.title,
                turns: nodes.map((n) => ({
                    role: n.getAttribute('data-message-author-role') || n.getAttribute('data-turn') || null,
                    testid: n.getAttribute('data-testid') || null,
                    text: (n.innerText || '').slice(0, m),
                })),
                bodyText: (document.body?.innerText || '').slice(0, 5000),
            };
        }, { t: turns, m: maxChars });
    } catch {
        return null;
    }
}

/**
 * Capture failure diagnostics for a session: a conversation DOM snapshot and,
 * when CDP is available, a screenshot — persisted as a `kind:'diagnostics'`
 * artifact. Best-effort and non-throwing; the caller still surfaces the original
 * error. Gate with diagnosticsEnabled() before calling to avoid normal-path cost.
 * @param {{ getCdpSession?: () => Promise<any> }} deps
 * @param {{ sessionId?: string|null, context?: string, page?: any }} opts
 * @returns {Promise<{ saved: boolean, reason?: string, descriptor?: import('./session-artifacts.mjs').ArtifactDescriptor }>}
 */
export async function captureFailureDiagnostics(deps, { sessionId, context, page } = {}) {
    try {
        if (!sessionId || !page) return { saved: false, reason: 'no-session-or-page' };
        const domJson = await readConversationSnapshot(page);

        let screenshotBuffer = null;
        try {
            const cdp = await deps?.getCdpSession?.();
            if (cdp) {
                try {
                    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
                    if (shot?.data) screenshotBuffer = Buffer.from(shot.data, 'base64');
                } finally {
                    await cdp.detach?.().catch(() => undefined);
                }
            }
        } catch {
            // screenshot is best-effort; DOM snapshot still persists
        }

        const res = trySaveDiagnosticsArtifact(sessionId, { context: context || 'failure', domJson, screenshotBuffer });
        if (!res.ok) return { saved: false, reason: res.stage };
        return { saved: true, descriptor: res.descriptor };
    } catch (err) {
        return { saved: false, reason: `diagnostics-error:${/** @type {any} */ (err)?.message || 'unknown'}` };
    }
}
