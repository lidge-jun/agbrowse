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

// ---- Parity catalog 201 #6 (P2): richer diagnostics stage taxonomy + stage-typed envelope.
// agbrowse's capture above is slim; cli-jaw web-ai/diagnostics.ts carries a stage vocabulary,
// a selectorCounts/sendButtonStates envelope shape, text redaction, and a typed error
// envelope. Folded in here (additive — the capture path above is unchanged).

/**
 * @typedef {'status'|'composer-focus'|'composer-insert'|'composer-verify'|'send-click'|'prompt-commit'|'poll-timeout'|'attachment-preflight'|'attachment-upload'|'capability-preflight'|'provider-select-model'|'provider-select-mode'|'provider-interstitial'|'session-reattach'|'connect'|'poll'|'commit-verify'|'composer-prereq'|'context-preflight'|'attachment-verify'|'unknown'} WebAiFailureStage
 *
 * @typedef {Object} WebAiDiagnostics
 * @property {WebAiFailureStage} stage
 * @property {string} [url]
 * @property {string} [title]
 * @property {Record<string, number>} selectorCounts
 * @property {number} visibleComposerCandidates
 * @property {Array<'enabled'|'disabled'|'absent'>} sendButtonStates
 * @property {number} conversationTurnCount
 * @property {number} assistantTurnCount
 * @property {boolean} stopVisible
 * @property {Record<string, number|boolean>} uploadSignals
 * @property {number} [promptLengthOnly]
 * @property {string[]} usedFallbacks
 * @property {string[]} artifactRefs
 * @property {string[]} warnings
 */

const KNOWN_STAGES = new Set([
    'status', 'composer-focus', 'composer-insert', 'composer-verify', 'send-click',
    'prompt-commit', 'poll-timeout', 'attachment-preflight', 'attachment-upload',
    'capability-preflight', 'provider-select-model', 'provider-select-mode',
    'provider-interstitial', 'session-reattach', 'connect', 'poll', 'commit-verify',
    'composer-prereq', 'context-preflight', 'attachment-verify', 'unknown',
]);

/**
 * Normalize an arbitrary value to a known failure stage (or 'unknown').
 * @param {unknown} stage
 * @returns {WebAiFailureStage}
 */
export function normalizeFailureStage(stage) {
    if (typeof stage === 'string' && KNOWN_STAGES.has(stage)) {
        return /** @type {WebAiFailureStage} */ (stage);
    }
    return 'unknown';
}

const DEFAULT_DIAG_MAX_CHARS = 1024;
const REDACT_PATTERNS = [
    { pattern: /bearer\s+[A-Za-z0-9._\-]+/gi, replacement: 'bearer [redacted]' },
    { pattern: /sk-[A-Za-z0-9_\-]{8,}/g, replacement: 'sk-[redacted]' },
    { pattern: /[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement: '[email redacted]' },
    { pattern: /\b[A-Fa-f0-9]{32,}\b/g, replacement: '[hex redacted]' },
];

/**
 * Redact tokens/emails/hex blobs from diagnostic text and cap its length.
 * @param {unknown} value
 * @param {{ maxChars?: number, stripCodeFences?: boolean }} [options]
 * @returns {string}
 */
export function redactDiagnosticText(value, options = {}) {
    let text = value === undefined || value === null ? '' : String(value);
    if (options.stripCodeFences) {
        text = text.replace(/```[\s\S]*?```/g, '[code redacted]');
    }
    for (const rule of REDACT_PATTERNS) {
        text = text.replace(rule.pattern, rule.replacement);
    }
    const cap = Math.max(64, options.maxChars ?? DEFAULT_DIAG_MAX_CHARS);
    if (text.length > cap) text = text.slice(0, cap) + '…[truncated]';
    return text;
}

/**
 * An empty diagnostics envelope at the given stage.
 * @param {WebAiFailureStage} [stage]
 * @returns {WebAiDiagnostics}
 */
export function emptyDiagnostics(stage = 'unknown') {
    return {
        stage: normalizeFailureStage(stage),
        selectorCounts: {},
        visibleComposerCandidates: 0,
        sendButtonStates: [],
        conversationTurnCount: 0,
        assistantTurnCount: 0,
        stopVisible: false,
        uploadSignals: {},
        usedFallbacks: [],
        artifactRefs: [],
        warnings: [],
    };
}

/**
 * Build a stage-typed error envelope, preserving a typed WebAiError's structured fields
 * (errorCode/retryHint/vendor/mutationAllowed/selectorsTried/evidence) so HTTP/CLI/agbrowse
 * all see the same failure shape.
 * @param {unknown} error
 * @param {WebAiFailureStage} [fallbackStage]
 * @param {WebAiDiagnostics} [diagnostics]
 */
export function toWebAiErrorEnvelope(error, fallbackStage = 'unknown', diagnostics) {
    const e = /** @type {any} */ (error);
    const typed = (e && typeof e === 'object' && e.name === 'WebAiError' && typeof e.toJSON === 'function') ? e.toJSON() : null;
    if (typed) {
        const stage = normalizeFailureStage(String(typed.stage ?? diagnostics?.stage ?? fallbackStage));
        const envelope = {
            ok: false,
            error: redactDiagnosticText(String(typed.message ?? ''), { maxChars: 512 }),
            stage,
            ...(typed.errorCode ? { errorCode: String(typed.errorCode) } : {}),
            ...(typed.retryHint ? { retryHint: String(typed.retryHint) } : {}),
            ...(typed.vendor ? { vendor: String(typed.vendor) } : {}),
            ...(typeof typed.mutationAllowed === 'boolean' ? { mutationAllowed: typed.mutationAllowed } : {}),
            ...(Array.isArray(typed.selectorsTried) ? { selectorsTried: typed.selectorsTried } : {}),
            ...(typed.evidence !== undefined ? { evidence: typed.evidence } : {}),
        };
        if (diagnostics) envelope.diagnostics = diagnostics;
        return envelope;
    }
    const message = redactDiagnosticText(e && typeof e === 'object' && 'message' in e ? e.message : String(e ?? ''), { maxChars: 512 });
    const envelope = { ok: false, error: message, stage: normalizeFailureStage(diagnostics?.stage ?? fallbackStage) };
    if (diagnostics) envelope.diagnostics = diagnostics;
    return envelope;
}
