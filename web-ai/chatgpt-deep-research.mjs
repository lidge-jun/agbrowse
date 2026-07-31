// @ts-check
import { updateSession, TIER_DEFAULT_TIMEOUT_SEC } from './session.mjs';
import { trySaveReport, appendArtifactRecord } from './session-artifacts.mjs';
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';
import { chooseDeepResearchReportRead } from './chatgpt-deep-research-report.mjs';
import { probeStopButton } from './chatgpt-response-dom.mjs';

/**
 * @typedef {Object} DeepResearchResult
 * @property {boolean} ok
 * @property {string} sessionId
 * @property {string} conversationUrl
 * @property {string|null} reportText
 * @property {string[]} sources
 * @property {string[]} warnings
 * @property {'complete'|'timeout'|'blocked'|'failed'} status
 */

const DEEP_RESEARCH_SELECTORS = {
    modeButton: [
        'button[data-testid="deep-research"]',
        'button[aria-label*="Deep research" i]',
        'button:has-text("Deep research")',
    ],
    progressIndicator: [
        '[data-testid="deep-research-progress"]',
        '[role="progressbar"]',
        '.deep-research-status',
        '[class*="research-progress"]',
    ],
    researchPlan: [
        '[data-testid="deep-research-plan"]',
        '[class*="research-plan"]',
    ],
    confirmButton: [
        'button[data-testid="deep-research-confirm"]',
        'button:has-text("Start research")',
        'button:has-text("Start")',
        'button:has-text("시작")',
        'button:has-text("Confirm")',
    ],
    blockIndicator: [
        '[data-testid="deep-research-blocked"]',
        'div:has-text("Deep research is not available")',
        'div:has-text("upgrade")',
    ],
};

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';

/**
 * Count assistant messages on the page.
 * @param {any} page
 * @returns {Promise<number>}
 */
async function countAssistants(page) {
    return page.locator(ASSISTANT_SELECTOR).count();
}

/**
 * Read the latest assistant message text.
 * @param {any} page
 * @returns {Promise<string>}
 */
async function readLatestAssistant(page) {
    const els = await page.locator(ASSISTANT_SELECTOR).all();
    if (!els.length) return '';
    return els[els.length - 1].innerText().catch(() => '');
}

/**
 * Is ChatGPT streaming/generating right now?
 *
 * Returns the verdict: `unknown` is not evidence of finishing, and it is not
 * evidence of research activity either.
 *
 * @param {any} page
 * @returns {Promise<'visible'|'absent'|'unknown'>}
 */
async function isStreaming(page) {
    return probeStopButton(page);
}

/**
 * Check for any progress indicator on the page.
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function hasProgressIndicator(page) {
    for (const sel of DEEP_RESEARCH_SELECTORS.progressIndicator) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
}

/**
 * Detect if the account is blocked from using Deep Research.
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function isAccountBlocked(page) {
    for (const sel of DEEP_RESEARCH_SELECTORS.blockIndicator) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
}

/**
 * Try to activate Deep Research mode via UI button.
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function activateDeepResearchMode(page) {
    for (const sel of DEEP_RESEARCH_SELECTORS.modeButton) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible().catch(() => false)) {
            await btn.click();
            await page.waitForTimeout(1000);
            return true;
        }
    }
    return false;
}

/**
 * Auto-confirm the research plan if a confirm button appears.
 * ChatGPT renders the post-submit Deep Research plan card inside the
 * Deep Research app iframe, so scan both the page and child frames.
 * @param {any} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function autoConfirmPlan(page, timeoutMs = 70_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const contexts = [page];
        if (typeof page.frames === 'function') {
            contexts.push(...page.frames());
        }

        for (const context of contexts) {
            for (const sel of DEEP_RESEARCH_SELECTORS.confirmButton) {
                const locator = context.locator?.(sel);
                const btn = typeof locator?.first === 'function' ? locator.first() : locator;
                if (!btn || typeof btn.isVisible !== 'function' || typeof btn.click !== 'function') {
                    continue;
                }
                if (await btn.isVisible().catch(() => false)) {
                    await btn.click();
                    return true;
                }
            }
        }

        await page.waitForTimeout(250);
    }
    return false;
}

// Report-selection helpers (32.1) live in ./chatgpt-deep-research-report.mjs
// (normalizeDeepResearchReportText / isIncompleteDeepResearchText /
// chooseDeepResearchReportRead) — extracted to keep this module under 500 lines.

/**
 * Extract the Deep Research report, scoped to the active page. Prefers a
 * COMPLETED page-scoped assistant (target) read over a legacy deep-research
 * frame read, and rejects planning/progress/incomplete text via
 * chooseDeepResearchReportRead (32.1). Returns null when nothing is readable.
 * @param {any} page
 * @param {any} _deps
 * @returns {Promise<{ text: string, sources: string[], from: string, completed: boolean } | null>}
 */
export async function extractResearchReport(page, _deps) {
    const assistantText = (await readLatestAssistant(page)).trim();

    const sources = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll(
            '[data-message-author-role="assistant"]:last-of-type a[href]'
        ));
        return links
            .map(a => /** @type {HTMLAnchorElement} */ (a).href)
            .filter(h => h.startsWith('http'));
    }).catch(() => []);

    const targetRead = assistantText ? { text: assistantText, sources, from: 'assistant' } : null;

    // Legacy fallback: a deep-research app iframe on THIS page (page-scoped —
    // never another tab). Only used when the target read is missing/incomplete.
    let frameRead = null;
    const frames = typeof page.frames === 'function' ? page.frames() : [];
    for (const frame of frames) {
        const frameUrl = frame.url?.() || '';
        if (frameUrl.includes('deep-research') || frameUrl.includes('research')) {
            const frameText = (await frame.evaluate(() =>
                document.body?.innerText?.trim() || ''
            ).catch(() => '')).trim();
            if (frameText) {
                frameRead = { text: frameText, sources, from: 'frame' };
                break;
            }
        }
    }

    return chooseDeepResearchReportRead(targetRead, frameRead);
}

/**
 * Execute a Deep Research query in ChatGPT.
 * @param {any} page
 * @param {any} deps
 * @param {{ prompt: string, session: any, timeoutMs?: number, skipModeActivation?: boolean }} opts
 * @returns {Promise<DeepResearchResult>}
 */
export async function sendDeepResearch(page, deps, { prompt, session, timeoutMs = TIER_DEFAULT_TIMEOUT_SEC['deep-research'] * 1000, skipModeActivation = false }) {
    const warnings = [];

    updateSession(session.sessionId, { researchMode: 'deep' });

    const modeActivated = skipModeActivation ? true : await activateDeepResearchMode(page);
    if (!modeActivated) {
        warnings.push('deep-research-mode-button-not-found-using-prompt-prefix');
    }

    if (await isAccountBlocked(page)) {
        updateSession(session.sessionId, { status: 'blocked' });
        return {
            ok: false,
            sessionId: session.sessionId,
            conversationUrl: page.url(),
            reportText: null,
            sources: [],
            warnings: ['account-blocked-for-deep-research'],
            status: 'blocked',
        };
    }

    const baselineCount = await countAssistants(page);
    // Track whether any Deep Research activity (progress UI / app frame) is ever
    // observed. If not, a final assistant answer is a normal reply, not a report.
    let researchActivityObserved = false;

    const editorOptions = {
        insertText: async (/** @type {string} */ text) => {
            const cdp = await deps.getCdpSession?.();
            if (!cdp) throw new Error('CDP session unavailable for Input.insertText');
            try {
                await cdp.send('Input.insertText', { text });
            } finally {
                await cdp.detach?.().catch(() => undefined);
            }
        },
    };
    const adapter = createChatGptEditorAdapter(page, editorOptions);
    await adapter.waitForReady();
    const commitBaseline = await adapter.getCommitBaseline();
    await adapter.insertPrompt(prompt);
    await adapter.submitPrompt({});
    await adapter.verifyPromptCommitted(prompt, commitBaseline);

    await autoConfirmPlan(page);

    const blockCheckDeadline = Date.now() + 15_000;
    while (Date.now() < blockCheckDeadline) {
        if (await isAccountBlocked(page)) {
            updateSession(session.sessionId, { status: 'blocked' });
            return {
                ok: false,
                sessionId: session.sessionId,
                conversationUrl: page.url(),
                reportText: null,
                sources: [],
                warnings: ['account-blocked-after-submit'],
                status: 'blocked',
            };
        }
        const count = await countAssistants(page);
        const progress = await hasProgressIndicator(page);
        if (progress) researchActivityObserved = true;
        // An unreadable probe leaves the startup wait — the main poll is
        // bounded — but it is NOT recorded as research activity. Counting a
        // failed read as evidence would claim work that was never observed.
        if (count > baselineCount || (await isStreaming(page)) !== 'absent' || progress) {
            break;
        }
        await page.waitForTimeout(500);
    }

    const deadline = Date.now() + timeoutMs;
    let stableText = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
        await page.waitForTimeout(2000);

        const stop = await isStreaming(page);
        const progress = await hasProgressIndicator(page);
        if (progress) researchActivityObserved = true;
        const count = await countAssistants(page);

        // Extracting a report on an unreadable probe would publish a partial
        // research run as the finished product.
        if (count > baselineCount && stop === 'absent' && !progress) {
            const latest = (await readLatestAssistant(page)).trim();
            if (latest) {
                if (latest === stableText) {
                    if (Date.now() - stableSince >= 5000) {
                        const report = await extractResearchReport(page, deps);
                        // A frame report is definitive proof DR ran.
                        if (report?.from === 'frame') researchActivityObserved = true;

                        if (!researchActivityObserved) {
                            // Stable assistant answer but no research activity ever
                            // observed → a normal reply, not a Deep Research report.
                            updateSession(session.sessionId, { status: 'failed', conversationUrl: page.url() });
                            return {
                                ok: false,
                                sessionId: session.sessionId,
                                conversationUrl: page.url(),
                                reportText: null,
                                sources: [],
                                warnings: [...warnings, 'deep-research-not-started'],
                                status: 'failed',
                            };
                        }

                        if (!report || !report.completed) {
                            // Planning/progress/incomplete text — not a final report; keep waiting.
                            if (!warnings.includes('deep-research-incomplete-report-skipped')) {
                                warnings.push('deep-research-incomplete-report-skipped');
                            }
                            stableText = '';
                            stableSince = 0;
                            continue;
                        }

                        if (report.from === 'frame') warnings.push('report-extracted-from-iframe');

                        updateSession(session.sessionId, {
                            status: 'complete',
                            answer: report.text,
                            conversationUrl: page.url(),
                        });

                        const saved = trySaveReport(session.sessionId, { text: report.text, sources: report.sources });
                        if (saved.ok) appendArtifactRecord(session.sessionId, saved.descriptor);
                        else warnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);

                        return {
                            ok: true,
                            sessionId: session.sessionId,
                            conversationUrl: page.url(),
                            reportText: report.text,
                            sources: report.sources,
                            warnings,
                            status: 'complete',
                        };
                    }
                } else {
                    stableText = latest;
                    stableSince = Date.now();
                }
            }
        } else {
            stableText = '';
            stableSince = 0;
        }
    }

    const finalReport = await extractResearchReport(page, deps);
    // On timeout, only persist a COMPLETED report — never a planning/progress
    // fragment (32.1 incomplete-rejection).
    const finalText = finalReport?.completed ? finalReport.text : null;
    updateSession(session.sessionId, {
        status: 'timeout',
        answer: finalText,
    });

    if (finalText) {
        const saved = trySaveReport(session.sessionId, { text: finalText, sources: finalReport.sources });
        if (saved.ok) appendArtifactRecord(session.sessionId, saved.descriptor);
        else warnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);
    }

    return {
        ok: false,
        sessionId: session.sessionId,
        conversationUrl: page.url(),
        reportText: finalText,
        sources: finalReport?.sources || [],
        warnings: [...warnings, 'deep-research-timeout'],
        status: 'timeout',
    };
}

/**
 * Resume an existing Deep Research session (35.2): re-bind to the saved page and
 * collect the report WITHOUT sending a new prompt. Reuses the 32.1 capture core
 * (extractResearchReport). Called by `sessions resume` when researchMode==='deep'.
 * A resumed DR session implies research already ran, so there is no
 * not-started check; incomplete text keeps waiting, only completed reports save.
 * @param {any} page
 * @param {any} deps
 * @param {{ session: any, timeoutMs?: number, stableMs?: number }} opts
 * @returns {Promise<DeepResearchResult>}
 */
export async function resumeDeepResearch(page, deps, { session, timeoutMs = TIER_DEFAULT_TIMEOUT_SEC['deep-research'] * 1000, stableMs = 5_000 }) {
    const warnings = ['deep-research-resumed'];
    const deadline = Date.now() + timeoutMs;
    let stableText = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        if ((await isStreaming(page)) !== 'absent' || await hasProgressIndicator(page)) {
            stableText = '';
            stableSince = 0;
            continue;
        }
        const latest = (await readLatestAssistant(page)).trim();
        if (!latest) continue;
        if (latest !== stableText) {
            stableText = latest;
            stableSince = Date.now();
            continue;
        }
        if (Date.now() - stableSince < stableMs) continue;

        const report = await extractResearchReport(page, deps);
        if (!report || !report.completed) {
            stableText = '';
            stableSince = 0;
            continue;
        }
        if (report.from === 'frame') warnings.push('report-extracted-from-iframe');
        updateSession(session.sessionId, { status: 'complete', answer: report.text, conversationUrl: page.url() });
        const saved = trySaveReport(session.sessionId, { text: report.text, sources: report.sources });
        if (saved.ok) appendArtifactRecord(session.sessionId, saved.descriptor);
        else warnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);
        return {
            ok: true,
            sessionId: session.sessionId,
            conversationUrl: page.url(),
            reportText: report.text,
            sources: report.sources,
            warnings,
            status: 'complete',
        };
    }

    const finalReport = await extractResearchReport(page, deps);
    const finalText = finalReport?.completed ? finalReport.text : null;
    updateSession(session.sessionId, { status: 'timeout', answer: finalText });
    if (finalText) {
        const saved = trySaveReport(session.sessionId, { text: finalText, sources: finalReport.sources });
        if (saved.ok) appendArtifactRecord(session.sessionId, saved.descriptor);
        else warnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);
    }
    return {
        ok: false,
        sessionId: session.sessionId,
        conversationUrl: page.url(),
        reportText: finalText,
        sources: finalReport?.sources || [],
        warnings: [...warnings, 'deep-research-resume-timeout'],
        status: 'timeout',
    };
}
