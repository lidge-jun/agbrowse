// @ts-check
import { updateSession } from './session.mjs';
import { trySaveReport, appendArtifactRecord } from './session-artifacts.mjs';
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';

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
        'button:has-text("Confirm")',
    ],
    blockIndicator: [
        '[data-testid="deep-research-blocked"]',
        'div:has-text("Deep research is not available")',
        'div:has-text("upgrade")',
    ],
};

const ASSISTANT_SELECTOR = '[data-message-author-role="assistant"]';
const STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
];

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
 * Check if ChatGPT is currently streaming/generating.
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function isStreaming(page) {
    for (const sel of STOP_SELECTORS) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
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
 * @param {any} page
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function autoConfirmPlan(page, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const sel of DEEP_RESEARCH_SELECTORS.confirmButton) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible().catch(() => false)) {
                await btn.click();
                return true;
            }
        }
        await page.waitForTimeout(500);
    }
    return false;
}

/**
 * Extract the research report from the page.
 * Checks assistant content first, then looks for Deep Research iframes.
 * @param {any} page
 * @param {any} deps
 * @returns {Promise<{ text: string, sources: string[], fromIframe: boolean }>}
 */
async function extractResearchReport(page, deps) {
    const text = (await readLatestAssistant(page)).trim();

    const sources = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll(
            '[data-message-author-role="assistant"]:last-of-type a[href]'
        ));
        return links
            .map(a => /** @type {HTMLAnchorElement} */ (a).href)
            .filter(h => h.startsWith('http'));
    }).catch(() => []);

    if (text) {
        return { text, sources, fromIframe: false };
    }

    const frames = page.frames();
    for (const frame of frames) {
        const frameUrl = frame.url();
        if (frameUrl.includes('deep-research') || frameUrl.includes('research')) {
            const frameText = await frame.evaluate(() =>
                document.body?.innerText?.trim() || ''
            ).catch(() => '');
            if (frameText) {
                return { text: frameText, sources, fromIframe: true };
            }
        }
    }

    return { text: '', sources, fromIframe: false };
}

/**
 * Execute a Deep Research query in ChatGPT.
 * @param {any} page
 * @param {any} deps
 * @param {{ prompt: string, session: any, timeoutMs?: number, skipModeActivation?: boolean }} opts
 * @returns {Promise<DeepResearchResult>}
 */
export async function sendDeepResearch(page, deps, { prompt, session, timeoutMs = 1_200_000, skipModeActivation = false }) {
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
        if (count > baselineCount || await isStreaming(page) || await hasProgressIndicator(page)) {
            break;
        }
        await page.waitForTimeout(500);
    }

    const deadline = Date.now() + timeoutMs;
    let stableText = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
        await page.waitForTimeout(2000);

        const streaming = await isStreaming(page);
        const progress = await hasProgressIndicator(page);
        const count = await countAssistants(page);

        if (count > baselineCount && !streaming && !progress) {
            const latest = (await readLatestAssistant(page)).trim();
            if (latest) {
                if (latest === stableText) {
                    if (Date.now() - stableSince >= 5000) {
                        const report = await extractResearchReport(page, deps);
                        if (report.fromIframe) warnings.push('report-extracted-from-iframe');

                        updateSession(session.sessionId, {
                            status: 'complete',
                            answer: report.text,
                            conversationUrl: page.url(),
                        });

                        const saved = trySaveReport(session.sessionId, report);
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
    updateSession(session.sessionId, {
        status: 'timeout',
        answer: finalReport.text || null,
    });

    if (finalReport.text) {
        const saved = trySaveReport(session.sessionId, finalReport);
        if (saved.ok) appendArtifactRecord(session.sessionId, saved.descriptor);
        else warnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);
    }

    return {
        ok: false,
        sessionId: session.sessionId,
        conversationUrl: page.url(),
        reportText: finalReport.text || null,
        sources: finalReport.sources,
        warnings: [...warnings, 'deep-research-timeout'],
        status: 'timeout',
    };
}
