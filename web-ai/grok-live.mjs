// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { normalizeEnvelope, renderQuestionEnvelope, renderQuestionEnvelopeWithContext } from './question.mjs';
import {
    bindSessionToTab,
    createSession,
    findActiveSession,
    getBaseline,
    getLatestBaseline,
    getSession,
    resolveDeadlineAt,
    saveBaseline,
    sessionToBaseline,
    summarizeEnvelope,
    updateSession,
} from './session.mjs';
import { hasContextPackaging, prepareContextForBrowser } from './context-pack/index.mjs';
import { WebAiError } from './errors.mjs';
import { finalizeProviderTab } from './tab-finalizer.mjs';
import { recordActiveLease } from './tab-lease-store.mjs';
import { defineCapability, probeFirstVisibleSelector, probeHostMatches, runCapabilities, worstCapabilityState } from './capability.mjs';

export const GROK_CONTEXT_PACK_WARNING = 'grok-context-pack-not-recommended: prefer inline prompts plus optional --file uploads for Grok; ChatGPT or Gemini handle context packages more reliably.';
import { attachLocalFileLive, fileInfoFromPath } from './chatgpt-attachments.mjs';
import { captureCopiedResponseText, GROK_COPY_SELECTORS, preferCopiedText } from './copy-markdown.mjs';
import { withAnswerArtifact } from './answer-artifact.mjs';
import { selectGrokModel, grokModelCapabilityProbe } from './grok-model.mjs';

const GROK_HOSTS = new Set(['grok.com']);
const COMPOSER_SELECTORS = ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"].ProseMirror'];
const NEW_CHAT_SELECTORS = ['[data-testid="new-chat"]'];
const ASSISTANT_SELECTOR = '[data-testid="assistant-message"]';
const USER_SELECTOR = '[data-testid="user-message"]';
const RESPONSE_TEXT_SELECTOR = '.response-content-markdown, .markdown, [class*="response-content"]';
const STOP_SELECTORS = ['button[aria-label*="Stop" i]', 'button:has-text("Stop")'];
const ATTACHMENT_EVIDENCE_SELECTORS = [
    '[data-testid*="attachment" i]',
    '[data-testid*="file" i]',
    '[aria-label*="attachment" i]',
    '[aria-label*="file" i]',
    '[role="img"]',
];

const GROK_UPLOAD_SELECTORS = [
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[data-testid*="plus" i]',
];

export const grokCapabilities = [
    defineCapability('grok-active-tab-verification', async (/** @type {Deps} */ deps) => probeHostMatches(await deps.getPage(), GROK_HOSTS)),
    defineCapability('grok-composer-visible', async (/** @type {Deps} */ deps) => probeFirstVisibleSelector(await deps.getPage(), COMPOSER_SELECTORS)),
    defineCapability('grok-model-alias-selectable', async (/** @type {Deps} */ deps, /** @type {Input} */ input) => grokModelCapabilityProbe(await deps.getPage(), input.model)),
    defineCapability('grok-upload-surface-visible', async (/** @type {Deps} */ deps, /** @type {Input} */ input) => {
        if (!input.filePath && input.inlineOnly !== false) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), GROK_UPLOAD_SELECTORS, { failNext: 'inline-only' });
    }),
    defineCapability('grok-copy-button-present', async (/** @type {Deps} */ deps, /** @type {Input} */ input) => {
        if (!input.allowCopyMarkdownFallback) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), GROK_COPY_SELECTORS.copyButtonSelectors, { timeoutMs: 500, failNext: 'send', failState: 'warn' });
    }),
    defineCapability('grok-response-streaming', async (/** @type {Deps} */ deps) => {
        const page = await deps.getPage();
        for (const sel of STOP_SELECTORS) {
            if (await page.locator(sel).first().isVisible().catch(() => false)) {
                return { state: 'warn', evidence: { streaming: true, selector: sel }, next: 'poll' };
            }
        }
        return { state: 'ok', evidence: { streaming: false }, next: 'send' };
    }),
];

/**
 * @param {Deps} deps
 * @param {Input} [input]
 */
export async function grokStatusWebAi(deps, input = {}) {
    const page = await deps.getPage();
    const capabilities = await runCapabilities(deps, grokCapabilities, input);
    const worst = worstCapabilityState(capabilities);
    return {
        ok: worst !== 'fail',
        vendor: 'grok',
        status: worst === 'fail' ? 'blocked' : 'ready',
        url: page.url(),
        capabilities,
        capabilityState: worst,
        warnings: [],
    };
}

/**
 * @param {Deps} deps
 * @param {Input} [input]
 */
export async function grokSendWebAi(deps, input = {}) {
    const page = await deps.getPage();
    if (input.url) await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (!isGrokUrl(page.url())) throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'connect',
        vendor: 'grok',
        retryHint: 'tab-switch',
        message: `active tab is not grok.com (${page.url()})`,
        evidence: { url: page.url() },
    });

    const envelope = normalizeEnvelope({ ...input, vendor: 'grok' });
    if (hasContextPackaging(input) && input.allowGrokContextPack !== true) {
        throw new WebAiError({
            errorCode: 'grok.context-pack-not-allowed',
            stage: 'grok-context-pack-not-allowed',
            vendor: 'grok',
            retryHint: 'inline-only-or-allow-flag',
            message: 'grok context-pack disabled by default; pass --allow-grok-context-pack to override',
        });
    }
    const contextPack = await prepareContextForBrowser({ ...input, vendor: 'grok' });
    if (contextPack?.attachments?.[0] && input.filePath) {
        throw new WebAiError({
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            vendor: 'grok',
            retryHint: 'inline-only-or-file',
            message: 'context package upload and --file upload cannot be combined yet',
        });
    }
    if (envelope.attachmentPolicy !== 'inline-only' && !input.filePath && !contextPack?.attachments?.[0]) {
        throw new WebAiError({
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            vendor: 'grok',
            retryHint: 'inline-only-or-file',
            message: 'grok upload requested without a file or context package attachment',
        });
    }
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(envelope, contextPack.composerText)
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelope(envelope);
    const warnings = [...rendered.warnings, ...(contextPack?.warnings || [])];
    if (hasContextPackaging(input) && input.allowGrokContextPack === true) {
        warnings.push(GROK_CONTEXT_PACK_WARNING);
    }

    await openFreshGrokChat(page, warnings);
    const composerSel = await findFirstSelector(page, COMPOSER_SELECTORS, 10_000);
    if (!composerSel) throw new WebAiError({
        errorCode: 'provider.composer-not-visible',
        stage: 'composer-prereq',
        vendor: 'grok',
        retryHint: 're-snapshot',
        message: 'grok composer not visible',
        selectorsTried: COMPOSER_SELECTORS,
    });
    const selectedModel = await selectGrokModel(page, input.model);

    const assistantCount = await countResponses(page);
    await insertGrokPrompt(page, composerSel, rendered.composerText);
    const uploadPath = input.filePath || contextPack?.attachments?.[0]?.path;
    if (uploadPath) {
        const uploaded = await attachLocalFileLive(page, fileInfoFromPath(uploadPath));
        if (!uploaded.ok) throw new WebAiError({
            errorCode: 'provider.attachment-evidence-missing',
            stage: 'attachment-verify',
            vendor: 'grok',
            retryHint: 're-upload',
            message: uploaded.error,
            mutationAllowed: true,
        });
        warnings.push(...uploaded.warnings);
    }
    await clickGrokSubmit(page);
    if (uploadPath) {
        const sentAttachment = await verifyGrokSentTurnAttachment(page, fileInfoFromPath(uploadPath));
        if (!sentAttachment.ok) throw new WebAiError({
            errorCode: 'provider.attachment-evidence-missing',
            stage: 'attachment-verify',
            vendor: 'grok',
            retryHint: 're-upload',
            message: sentAttachment.error,
            mutationAllowed: true,
        });
    }

    const baseline = saveBaseline({
        vendor: 'grok',
        url: page.url(),
        envelope,
        assistantCount,
        textHash: String((await page.innerText('body').catch(() => '')).length),
    });
    const targetId = await deps.getTargetId?.().catch(() => null) || null;
    const session = createSession(envelope, {
        targetId,
        originalUrl: input.url || page.url(),
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt(input, 'grok'),
        envelopeSummary: { ...summarizeEnvelope(input, contextPack), assistantCount },
    });
    if (targetId) bindSessionToTab(session.sessionId, targetId);
    if (targetId) await recordActiveLease({
        owner: 'web-ai',
        vendor: 'grok',
        sessionType: 'send-poll',
        sessionId: session.sessionId,
        targetId,
        url: page.url(),
        port: deps.getPort?.() || 9222,
    });
    return {
        ok: true,
        vendor: 'grok',
        status: 'sent',
        url: page.url(),
        sessionId: session.sessionId,
        baseline,
        contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
        usedFallbacks: selectedModel?.usedFallbacks || [],
        warnings: [
            ...warnings,
            ...(selectedModel ? [`model selected: ${selectedModel.selected}${selectedModel.alreadySelected ? ' (already selected)' : ''}`] : []),
            ...(contextPack?.attachments?.[0] ? [`context package attached: ${contextPack.attachments[0].displayPath}`] : []),
        ],
    };
}

/**
 * @param {Deps} deps
 * @param {Input} [input]
 */
export async function grokPollWebAi(deps, input = {}) {
    const page = await deps.getPage();
    if (!isGrokUrl(page.url())) throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'connect',
        vendor: 'grok',
        retryHint: 'tab-switch',
        message: `active tab is not grok.com (${page.url()})`,
        evidence: { url: page.url() },
    });
    const session = input.session
        ? getSession(input.session)
        : findActiveSession({
            vendor: 'grok',
            targetId: await deps.getTargetId?.().catch(() => null) || null,
            conversationUrl: page.url(),
        });
    const baseline = (session && sessionToBaseline(session))
        || getBaseline('grok', page.url())
        || getLatestBaseline('grok');
    if (!baseline) throw new WebAiError({
        errorCode: 'provider.poll-timeout',
        stage: 'poll',
        vendor: 'grok',
        retryHint: 'poll-or-resume',
        message: 'baseline required. Run web-ai send --vendor grok first.',
    });
    const timeout = Math.max(1, Number(input.timeout || input.thinkingTime || 600)) * 1000;
    const deadline = Date.now() + timeout;
    let stableText = '';
    let stableSince = 0;
    while (Date.now() < deadline) {
        const answers = await readResponses(page);
        const latest = answers.slice(baseline.assistantCount).at(-1) || '';
        const streaming = await isStreaming(page);
        if (latest && !streaming) {
            if (latest === stableText) {
                if (Date.now() - stableSince >= 1500) {
                    let answerText = latest;
                    const usedFallbacks = [];
                    const warnings = [];
                    if (input.allowCopyMarkdownFallback === true) {
                        const copied = await captureCopiedResponseText(page, GROK_COPY_SELECTORS);
                        const copiedText = preferCopiedText(latest, copied);
                        if (copiedText) {
                            answerText = cleanGrokResponseText(copiedText);
                            usedFallbacks.push('copy-markdown');
                        } else {
                            warnings.push(`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`);
                        }
                    }
                    if (session) {
                        await finalizeProviderTab(deps, { vendor: 'grok', session: /** @type {any} */ (session), page, answerText, warnings });
                    }
                    return withAnswerArtifact({
                        ok: true,
                        vendor: 'grok',
                        status: 'complete',
                        url: page.url(),
                        ...(session ? { sessionId: session.sessionId } : {}),
                        answerText,
                        baseline,
                        usedFallbacks,
                        warnings,
                        responseStableMs: Date.now() - stableSince,
                    });
                }
            } else {
                stableText = latest;
                stableSince = Date.now();
            }
        } else {
            stableText = '';
            stableSince = 0;
        }
        await page.waitForTimeout(500).catch(() => undefined);
    }
    if (session) updateSession(session.sessionId, { status: 'timeout' });
    return { ok: false, vendor: 'grok', status: 'timeout', url: page.url(), ...(session ? { sessionId: session.sessionId } : {}), baseline, warnings: [], usedFallbacks: [], error: 'timed out waiting for grok response' };
}

/**
 * @param {Deps} deps
 * @param {Input} [input]
 */
export async function grokQueryWebAi(deps, input = {}) {
    const sent = await grokSendWebAi(deps, input);
    const result = await grokPollWebAi(deps, {
        timeout: input.timeout || input.thinkingTime,
        session: sent.sessionId,
        allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
    });
    return {
        ...result,
        sessionId: result.sessionId || sent.sessionId,
        usedFallbacks: [...(sent.usedFallbacks || []), ...(result.usedFallbacks || [])],
        warnings: [...(sent.warnings || []), ...(result.warnings || [])],
    };
}

/**
 * @param {Deps} deps
 */
export async function grokStopWebAi(deps) {
    const page = await deps.getPage();
    await page.keyboard.press('Escape').catch(() => undefined);
    return { ok: true, vendor: 'grok', status: 'blocked', url: page.url(), warnings: ['sent Escape'] };
}

/**
 * @param {string} url
 */
function isGrokUrl(url) {
    try { return GROK_HOSTS.has(new URL(url).hostname.replace(/^www\./, '')); }
    catch { return false; }
}

/**
 * @param {Page} page
 * @param {any[]} warnings
 */
async function openFreshGrokChat(page, warnings) {
    const existingTurns = await countResponses(page);
    if (existingTurns === 0) return;
    const newChatSel = await findFirstSelector(page, NEW_CHAT_SELECTORS, 5_000);
    if (!newChatSel) throw new WebAiError({
        errorCode: 'provider.composer-not-visible',
        stage: 'composer-prereq',
        vendor: 'grok',
        retryHint: 're-snapshot',
        message: 'grok new chat control not visible',
        selectorsTried: NEW_CHAT_SELECTORS,
    });
    const beforeUrl = page.url();
    await page.locator(newChatSel).first().click({ timeout: 5_000 });
    await findFirstSelector(page, COMPOSER_SELECTORS, 10_000);
    const remainingTurns = await countResponses(page);
    if (page.url() === beforeUrl && remainingTurns > 0) {
        warnings.push('grok new chat URL did not change; continuing because composer is visible');
    }
}

/**
 * @param {Page} page
 * @param {string} composerSel
 * @param {string} text
 */
async function insertGrokPrompt(page, composerSel, text) {
    const composer = page.locator(composerSel).first();
    await composer.click({ timeout: 5_000 }).catch(() => composer.click({ timeout: 2_000, force: true }));
    await page.evaluate((/** @type {{selector:string,value:string}} */ {selector, value}) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`selector not found: ${selector}`);
        /** @type {any} */ (el).focus();
        document.execCommand('selectAll', false, /** @type {any} */ (null));
        document.execCommand('insertText', false, value);
        el.dispatchEvent(new InputEvent('input', { data: value, inputType: 'insertText', bubbles: true }));
    }, { selector: composerSel, value: text });
}

/**
 * @param {Page} page
 */
async function clickGrokSubmit(page) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        const buttons = await page.locator('button').all().catch(() => []);
        for (const button of buttons) {
            if (!await button.isVisible().catch(() => false)) continue;
            const text = (await button.innerText().catch(() => '')).trim();
            const aria = (await button.getAttribute('aria-label').catch(() => '') || '').trim();
            const disabled = await button.isDisabled().catch(() => false);
            if (!disabled && (/^Submit$/i.test(text) || /^Submit$/i.test(aria))) {
                // Scroll into view + force click to bypass "element is not stable"
                await button.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => {});
                await button.click({ timeout: 3_000, force: true });
                return;
            }
        }
        await page.waitForTimeout(250).catch(() => undefined);
    }
    throw new WebAiError({
        errorCode: 'provider.commit-not-verified',
        stage: 'commit-verify',
        vendor: 'grok',
        retryHint: 're-snapshot',
        message: 'grok submit button not visible',
        mutationAllowed: true,
    });
}

/**
 * @param {Page} page
 * @param {any} expectedFile
 */
async function verifyGrokSentTurnAttachment(page, expectedFile) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const result = await readGrokSentTurnAttachmentEvidence(page, expectedFile);
        if (result.ok || result.error !== 'Grok sent turn has no attachment evidence') return result;
        await page.waitForTimeout(250).catch(() => undefined);
    }
    return readGrokSentTurnAttachmentEvidence(page, expectedFile);
}

/**
 * @param {Page} page
 * @param {any} expectedFile
 */
async function readGrokSentTurnAttachmentEvidence(page, expectedFile) {
    const turn = page.locator(USER_SELECTOR).last();
    if ((await turn.count().catch(() => 0)) === 0) {
        return { ok: false, error: 'no Grok user turn visible after send' };
    }
    const text = await turn.innerText().catch(() => '');
    if (text.includes(expectedFile.basename) || text.includes(stripExtension(expectedFile.basename))) {
        return { ok: true };
    }
    const siblingEvidence = await turn.evaluate((/** @type {any} */ el, /** @type {string[]} */ selectors) => {
        const root = el.closest('[id^="response-"]') || el.parentElement;
        if (!root) return false;
        const selectorList = selectors.join(',');
        const matches = Array.from(root.querySelectorAll(selectorList));
        return matches.some((node) => {
            const text = String(node.innerText || node.textContent || '').trim();
            const aria = String(node.getAttribute('aria-label') || '');
            return Boolean(text || aria);
        });
    }, ATTACHMENT_EVIDENCE_SELECTORS).catch(() => false);
    if (siblingEvidence) return { ok: true };
    for (const selector of ATTACHMENT_EVIDENCE_SELECTORS) {
        if (await turn.locator(selector).count().catch(() => 0) > 0) return { ok: true };
    }
    return { ok: false, error: 'Grok sent turn has no attachment evidence' };
}

/**
 * @param {Page} page
 * @param {string[]} selectors
 * @param {number} [timeoutMs]
 */
async function findFirstSelector(page, selectors, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if (await loc.count().catch(() => 0) > 0 && await loc.isVisible().catch(() => false)) return sel;
        }
        await page.waitForTimeout(250).catch(() => undefined);
    }
    return null;
}

/**
 * @param {Page} page
 */
async function countResponses(page) {
    return (await readResponses(page)).length;
}

/**
 * @param {Page} page
 */
async function readResponses(page) {
    return await page.locator(ASSISTANT_SELECTOR).evaluateAll((/** @type {any[]} */ turns, /** @type {string} */ textSelector) => {
        return turns
            .map((/** @type {any} */ turn) => {
                const textNodes = Array.from(turn.querySelectorAll(String(textSelector)));
                const candidates = textNodes.length ? textNodes : [turn];
                return candidates
                    .map((el) => String(el.innerText || el.textContent || '').trim())
                    .find(Boolean) || '';
            })
            .filter(Boolean);
    }, RESPONSE_TEXT_SELECTOR).then((/** @type {any[]} */ items) => items.map(cleanGrokResponseText).filter(Boolean)).catch(() => []);
}

/**
 * @param {Page} page
 */
async function isStreaming(page) {
    for (const selector of STOP_SELECTORS) {
        if (await page.locator(selector).first().isVisible().catch(() => false)) return true;
    }
    return false;
}

/**
 * @param {string} text
 */
function cleanGrokResponseText(text) {
    return String(text || '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !/^Thought for\s+\d+s$/i.test(line) && !/^\d+(?:\.\d+)?(?:ms|s)$/i.test(line))
        .join('\n')
        .trim();
}

/**
 * @param {string} name
 */
function stripExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? name : name.slice(0, idx);
}

/**
 * @param {any} contextPack
 */
function summarizeContextPack(contextPack) {
    if (!contextPack) return undefined;
    return {
        transport: contextPack.transport,
        totalBytes: contextPack.totalBytes,
        totalEstimatedTokens: contextPack.totalEstimatedTokens,
        includedFiles: contextPack.includedFiles?.length || 0,
        truncatedFiles: contextPack.truncatedFiles?.length || 0,
        attachments: contextPack.attachments?.map((/** @type {any} */ attachment) => ({ path: attachment.displayPath || attachment.path, bytes: attachment.bytes })) || [],
    };
}
