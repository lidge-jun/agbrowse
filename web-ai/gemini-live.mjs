// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { basename } from 'node:path';
import { statSync } from 'node:fs';
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
import { prepareContextForBrowser } from './context-pack/index.mjs';
import { captureCopiedResponseText, GEMINI_COPY_SELECTORS, preferCopiedText } from './copy-markdown.mjs';
import { withAnswerArtifact } from './answer-artifact.mjs';
import { selectGeminiModel, geminiModelCapabilityProbe } from './gemini-model.mjs';
import { preflightAttachment } from './chatgpt-attachments.mjs';
import { WebAiError } from './errors.mjs';
import { finalizeProviderTab } from './tab-finalizer.mjs';
import { recordActiveLease } from './tab-lease-store.mjs';
import { defineCapability, probeFirstVisibleSelector, probeHostMatches, runCapabilities, worstCapabilityState } from './capability.mjs';

const GEMINI_HOSTS = new Set(['gemini.google.com']);
const INPUT_SELECTORS = [
    'rich-textarea .ql-editor',
    '[role="textbox"][aria-label*="prompt" i]',
    '[role="textbox"][aria-label*="Gemini" i]',
    'div[contenteditable="true"]',
];
const NEW_CHAT_SELECTORS = [
    'button[aria-label="New chat"]:not([aria-disabled="true"]):not(.disabled)',
    '.side-nav-action-collapsed-button[aria-label="New chat"]:not([aria-disabled="true"]):not(.disabled)',
    'a[aria-label="New chat"]:not([aria-disabled="true"]):not(.disabled)',
];
const TOOLS_SELECTORS = ['button[aria-label="Tools"]', 'button[aria-label*="Tools" i]', 'button.toolbox-drawer-button'];
const DEEP_THINK_SELECTORS = [
    '[role="menuitemcheckbox"]:has-text("Deep think")',
    '[role="menuitemcheckbox"]:has-text("Deep Think")',
    '[role="menuitem"]:has-text("Deep think")',
    '[role="menuitem"]:has-text("Deep Think")',
    'button:has-text("Deep think")',
    'button:has-text("Deep Think")',
];
const DEEP_THINK_ACTIVE_SELECTORS = ['button[aria-label*="Deselect Deep think" i]', 'button[aria-label*="Deselect Deep Think" i]', '.toolbox-drawer-item-deselect-button:has-text("Deep think")'];
const SEND_SELECTORS = ['button.send-button', 'button[aria-label*="Send message" i]', 'button[aria-label*="메시지 보내기" i]'];
const RESPONSE_SELECTORS = ['model-response', '[data-response-index]'];
const RESPONSE_TEXT_SELECTORS = ['message-content', '.markdown', '[class*="response-content"]'];
const COMPLETION_SELECTORS = ['.response-footer.complete', 'message-actions', '[aria-label*="Good response" i]'];

const GEMINI_UPLOAD_SELECTORS = [
    'button[aria-label="Open upload file menu"]',
    'button[aria-label*="upload file menu" i]',
];

export const geminiCapabilities = [
    defineCapability('gemini-active-tab-verification', async (/** @type {any} */ deps) => probeHostMatches(await deps.getPage(), GEMINI_HOSTS)),
    defineCapability('gemini-composer-visible', async (/** @type {any} */ deps) => probeFirstVisibleSelector(await deps.getPage(), INPUT_SELECTORS)),
    defineCapability('gemini-model-alias-selectable', async (/** @type {any} */ deps, /** @type {any} */ input) => geminiModelCapabilityProbe(await deps.getPage(), input.model)),
    defineCapability('gemini-upload-surface-visible', async (/** @type {any} */ deps, /** @type {any} */ input) => {
        if (!input.filePath && input.inlineOnly !== false) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), GEMINI_UPLOAD_SELECTORS, { failNext: 'inline-only' });
    }),
    defineCapability('gemini-copy-button-present', async (/** @type {any} */ deps, /** @type {any} */ input) => {
        if (!input.allowCopyMarkdownFallback) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), GEMINI_COPY_SELECTORS.copyButtonSelectors, { timeoutMs: 500, failNext: 'send', failState: 'warn' });
    }),
    defineCapability('gemini-response-streaming', async (/** @type {any} */ deps) => {
        const page = await deps.getPage();
        for (const sel of COMPLETION_SELECTORS) {
            if (await page.locator(sel).first().isVisible().catch(() => false)) {
                return { state: 'ok', evidence: { streaming: false, completionSelector: sel }, next: 'send' };
            }
        }
        const hasResponse = await page.locator(RESPONSE_SELECTORS[0]).first().isVisible().catch(() => false);
        if (hasResponse) return { state: 'warn', evidence: { streaming: true }, next: 'poll' };
        return { state: 'ok', evidence: { streaming: false }, next: 'send' };
    }),
];

/**
 * @param {any} deps
 * @param {any} input
 */
export async function geminiStatusWebAi(deps, input = {}) {
    const page = await deps.getPage();
    const capabilities = await runCapabilities(deps, geminiCapabilities, input);
    const worst = worstCapabilityState(capabilities);
    return {
        ok: worst !== 'fail',
        vendor: 'gemini',
        status: worst === 'fail' ? 'blocked' : 'ready',
        url: page.url(),
        capabilities,
        capabilityState: worst,
        warnings: [],
    };
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function geminiSendWebAi(deps, input = {}) {
    const page = await deps.getPage();
    if (input.url) {
        await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    if (!isGeminiUrl(page.url())) throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'connect',
        vendor: 'gemini',
        retryHint: 'tab-switch',
        message: `active tab is not gemini.google.com (${page.url()})`,
        evidence: { url: page.url() },
    });
    const envelope = normalizeEnvelope({ ...input, vendor: 'gemini' });
    const contextPack = await prepareContextForBrowser({ ...input, vendor: 'gemini' });
    if (contextPack?.attachments?.[0] && input.filePath) {
        throw new WebAiError({
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            vendor: 'gemini',
            retryHint: 'inline-only-or-file',
            message: 'context package upload and --file upload cannot be combined yet',
        });
    }
    if (envelope.attachmentPolicy !== 'inline-only' && !input.filePath && !contextPack?.attachments?.[0]) {
        throw new WebAiError({
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            vendor: 'gemini',
            retryHint: 'inline-only-or-file',
            message: 'gemini upload requested without a file or context package attachment',
        });
    }
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(envelope, contextPack.composerText)
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelopeWithContext(envelope, undefined);
    /** @type {any[]} */
    const usedFallbacks = [];
    const warnings = [...rendered.warnings, ...(contextPack?.warnings || [])];

    await openFreshGeminiChat(page, warnings);
    const inputSel = await findFirstSelector(page, INPUT_SELECTORS, 10_000);
    if (!inputSel) throw new WebAiError({
        errorCode: 'provider.composer-not-visible',
        stage: 'composer-prereq',
        vendor: 'gemini',
        retryHint: 're-snapshot',
        message: 'gemini composer not visible',
        selectorsTried: INPUT_SELECTORS,
    });

    const selectedModel = await selectGeminiModel(page, input.model);
    if (selectedModel) {
        usedFallbacks.push(...selectedModel.usedFallbacks);
        warnings.push(`model selected: ${selectedModel.selected}${selectedModel.alreadySelected ? ' (already selected)' : ''}`);
    } else {
        const deepThinkActivated = await ensureDeepThinkMode(page, usedFallbacks, warnings);
        if (!deepThinkActivated) {
            throw new WebAiError({
                errorCode: 'provider.model-mismatch',
                stage: 'provider-select-mode',
                vendor: 'gemini',
                retryHint: 'model-fallback',
                message: `gemini Deep Think requested but active Deep Think chip was not verified; fail closed before prompt submit. ${warnings.join(' | ')}`,
            });
        }
        warnings.push('deep-think activated');
    }

    const turnsBefore = await countResponses(page);
    await dismissBlockingOverlays(page, warnings);
    await clearGeminiComposerAttachments(page, warnings);
    await page.locator(inputSel).first().click({ timeout: 5_000 });
    await page.evaluate((/** @type {{selector:string,text:string}} */ {selector, text}) => {
        const el = document.querySelector(selector);
        if (!el) throw new Error(`selector not found: ${selector}`);
        const target = el.shadowRoot?.querySelector('[contenteditable="true"], textarea') || el;
        target.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
        document.execCommand?.('insertText', false, text);
        if (!String(target.textContent || (/** @type {any} */ (target)).value || '').includes(text.slice(0, 20))) {
            target.textContent = text;
            target.dispatchEvent(new InputEvent('input', { data: text, bubbles: true }));
        }
    }, { selector: inputSel, text: rendered.composerText });
    const uploadPath = input.filePath || contextPack?.attachments?.[0]?.path;
    if (uploadPath) {
        const uploaded = await attachGeminiLocalFileLive(page, fileInfoFromPath(uploadPath));
        if (!uploaded.ok) throw new WebAiError({
            errorCode: 'provider.attachment-evidence-missing',
            stage: 'attachment-verify',
            vendor: 'gemini',
            retryHint: 're-upload',
            message: uploaded.error,
            mutationAllowed: true,
        });
        usedFallbacks.push(...uploaded.usedFallbacks);
        warnings.push(...(/** @type {any[]} */ (uploaded.warnings)));
    }

    const sendSel = await findFirstSelector(page, SEND_SELECTORS, 5_000);
    if (!sendSel) throw new WebAiError({
        errorCode: 'provider.commit-not-verified',
        stage: 'commit-verify',
        vendor: 'gemini',
        retryHint: 're-snapshot',
        message: 'gemini send button not visible',
        selectorsTried: SEND_SELECTORS,
        mutationAllowed: true,
    });
    await page.locator(sendSel).first().click({ timeout: 5_000 });
    if (uploadPath) {
        const sentAttachment = await verifyGeminiSentTurnAttachment(page, fileInfoFromPath(uploadPath));
        if (!sentAttachment.ok) throw new WebAiError({
            errorCode: 'provider.attachment-evidence-missing',
            stage: 'attachment-verify',
            vendor: 'gemini',
            retryHint: 're-upload',
            message: sentAttachment.error,
            mutationAllowed: true,
        });
    }

    const baseline = saveBaseline({
        vendor: 'gemini',
        url: page.url(),
        envelope,
        assistantCount: turnsBefore,
        textHash: String((await page.innerText('body').catch(() => '')).length),
    });
    const targetId = await deps.getTargetId?.().catch(() => null) || null;
    const session = createSession(envelope, {
        targetId,
        originalUrl: input.url || page.url(),
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt(input, 'gemini'),
        envelopeSummary: { ...summarizeEnvelope(input, contextPack), assistantCount: turnsBefore },
    });
    if (targetId) bindSessionToTab(session.sessionId, targetId);
    if (targetId) await recordActiveLease({
        owner: 'web-ai',
        vendor: 'gemini',
        sessionType: 'send-poll',
        sessionId: session.sessionId,
        targetId,
        url: page.url(),
        port: deps.getPort?.() || 9222,
    });
    return {
        ok: true,
        vendor: 'gemini',
        status: 'sent',
        url: page.url(),
        sessionId: session.sessionId,
        baseline,
        usedFallbacks,
        contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
        warnings: [
            ...warnings,
            ...(contextPack?.attachments?.[0] ? [`context package attached: ${contextPack.attachments[0].displayPath}`] : []),
        ],
    };
}

/**
 * @param {any} filePath
 */
function fileInfoFromPath(filePath) {
    const stat = statSync(filePath);
    if (!stat.isFile()) throw new Error(`not a regular file: ${filePath}`);
    return { path: filePath, basename: basename(filePath), sizeBytes: stat.size };
}

/**
 * @param {any} page
 * @param {any} file
 */
async function attachGeminiLocalFileLive(page, file) {
    /** @type {any[]} */
    const usedFallbacks = [];
    const warnings = [];
    const preflight = preflightAttachment(file);
    if (!preflight.ok) {
        return { ok: false, error: preflight.rejectedReason || 'preflight rejected', usedFallbacks };
    }
    warnings.push(...preflight.softWarnings);
    const uploadButton = await findFirstSelector(page, ['button[aria-label="Open upload file menu"]', 'button[aria-label*="upload file menu" i]'], 5_000);
    if (!uploadButton) return { ok: false, error: 'gemini upload file menu button not visible', usedFallbacks };
    try {
        await page.keyboard.press('Escape').catch(() => undefined);
        await page.locator(uploadButton).first().click({ timeout: 5_000 });
        const uploadItem = page.locator('[role="menuitem"][aria-label^="Upload files"], button[aria-label^="Upload files"]').first();
        await uploadItem.waitFor({ state: 'visible', timeout: 5_000 });
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
        await uploadItem.click({ timeout: 5_000, force: true });
        const chooser = await chooserPromise;
        await chooser.setFiles(file.path);
    } catch (e) {
        usedFallbacks.push(`gemini-filechooser-failed:${(/** @type {any} */ (e)).message}`);
        return { ok: false, error: `gemini file chooser upload failed: ${(/** @type {any} */ (e)).message}`, usedFallbacks };
    }
    const accepted = await waitForGeminiAttachmentAccepted(page, file);
    if (!accepted.ok) return { ok: false, error: accepted.error, usedFallbacks };
    return { ok: true, usedFallbacks, warnings };
}

/**
 * @param {any} page
 * @param {any} expectedFile
 */
async function waitForGeminiAttachmentAccepted(page, expectedFile) {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        if (await hasGeminiAttachmentEvidence(page, expectedFile)) return { ok: true };
        const busy = await page.locator('[role="progressbar"], [aria-label*="uploading" i], [aria-label*="processing" i]').count().catch(() => 0);
        await page.waitForTimeout(busy === 0 ? 500 : 1_000).catch(() => undefined);
    }
    return { ok: false, error: 'gemini attachment never showed visible chip' };
}

/**
 * @param {any} page
 * @param {any} warnings
 */
async function clearGeminiComposerAttachments(page, warnings) {
    const removeButtons = await page.locator('button[aria-label^="Remove file"]').all().catch(() => []);
    for (const button of removeButtons) {
        try {
            await button.click({ timeout: 2_000 });
        } catch (e) {
            warnings.push(`gemini attachment remove failed: ${(/** @type {any} */ (e)).message}`);
        }
    }
}

/**
 * @param {any} page
 * @param {any} expectedFile
 */
async function verifyGeminiSentTurnAttachment(page, expectedFile) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        if (await hasGeminiAttachmentEvidence(page, expectedFile)) return { ok: true };
        await page.waitForTimeout(500).catch(() => undefined);
    }
    return { ok: false, error: 'Gemini sent turn has no attachment evidence' };
}

/**
 * @param {any} page
 * @param {any} expectedFile
 */
async function hasGeminiAttachmentEvidence(page, expectedFile) {
    const expected = [expectedFile.basename, stripExtension(expectedFile.basename), expectedFile.basename.replace(/\(\d+\)(?=\.)/, '')].filter(Boolean);
    const bodyText = await page.innerText('body').catch(() => '');
    if (expected.some(name => bodyText.includes(name))) return true;
    const chipCount = await page.locator([
        'uploader-file-preview',
        '.file-preview-chip',
        '.attachment-preview-wrapper',
        '.file-preview-container',
        'button[aria-label^="Remove file"]',
    ].join(',')).count().catch(() => 0);
    return chipCount > 0;
}

/**
 * @param {any} name
 */
function stripExtension(name) {
    const idx = name.lastIndexOf('.');
    return idx < 0 ? name : name.slice(0, idx);
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function geminiPollWebAi(deps, input = {}) {
    const page = await deps.getPage();
    if (!isGeminiUrl(page.url())) throw new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'connect',
        vendor: 'gemini',
        retryHint: 'tab-switch',
        message: `active tab is not gemini.google.com (${page.url()})`,
        evidence: { url: page.url() },
    });
    const session = input.session
        ? getSession(input.session)
        : findActiveSession({
            vendor: 'gemini',
            targetId: await deps.getTargetId?.().catch(() => null) || null,
            conversationUrl: page.url(),
        });
    const baseline = (session && sessionToBaseline(session))
        || getBaseline('gemini', page.url())
        || getLatestBaseline('gemini');
    if (!baseline) throw new WebAiError({
        errorCode: 'provider.poll-timeout',
        stage: 'poll',
        vendor: 'gemini',
        retryHint: 'poll-or-resume',
        message: 'baseline required. Run web-ai send --vendor gemini first.',
    });
    const timeout = Math.max(1, Number(input.timeout || input.thinkingTime || 1200)) * 1000;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const responses = await readResponses(page);
        const next = responses.slice(baseline.assistantCount).at(-1);
        if (next && await hasCompletionSignal(page)) {
            if (isPendingDeepThinkText(next)) {
                await page.waitForTimeout(5_000).catch(() => undefined);
                continue;
            }
            let answerText = next;
            /** @type {any[]} */
            const usedFallbacks = [];
            const warnings = [];
            if (input.allowCopyMarkdownFallback === true) {
                const copied = await captureCopiedResponseText(page, GEMINI_COPY_SELECTORS);
                const copiedText = preferCopiedText(next, copied);
                if (copiedText) {
                    answerText = normalizeGeminiResponseText(copiedText);
                    usedFallbacks.push('copy-markdown');
                } else {
                    warnings.push(`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`);
                }
            }
            if (session) {
                await finalizeProviderTab(deps, { vendor: 'gemini', session: /** @type {any} */ (session), page, answerText, warnings });
            }
            return withAnswerArtifact({
                ok: true,
                vendor: 'gemini',
                status: 'complete',
                url: page.url(),
                ...(session ? { sessionId: session.sessionId } : {}),
                answerText,
                baseline,
                usedFallbacks,
                warnings,
            });
        }
        await page.waitForTimeout(2_000).catch(() => undefined);
    }
    if (session) updateSession(session.sessionId, { status: 'timeout' });
    return { ok: false, vendor: 'gemini', status: 'timeout', url: page.url(), ...(session ? { sessionId: session.sessionId } : {}), baseline, warnings: [], usedFallbacks: [], error: 'timed out waiting for gemini response' };
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function geminiQueryWebAi(deps, input = {}) {
    const sent = await geminiSendWebAi(deps, input);
    const result = await geminiPollWebAi(deps, {
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
 * @param {any} deps
 */
export async function geminiStopWebAi(deps) {
    const page = await deps.getPage();
    await page.keyboard.press('Escape').catch(() => undefined);
    return { ok: true, vendor: 'gemini', status: 'blocked', url: page.url(), warnings: ['sent Escape'] };
}

/**
 * @param {any} url
 */
function isGeminiUrl(url) {
    try { return GEMINI_HOSTS.has(new URL(url).hostname.replace(/^www\./, '')); }
    catch { return false; }
}

/**
 * @param {any} page
 * @param {any} usedFallbacks
 * @param {any} warnings
 */
async function ensureDeepThinkMode(page, usedFallbacks, warnings) {
    if (await isDeepThinkToolActive(page)) return true;
    const clickedTools = await clickToolsButton(page);
    const toolsSel = clickedTools ? null : await findFirstSelector(page, TOOLS_SELECTORS, 5_000);
    if (!clickedTools && !toolsSel) {
        warnings.push('tools button not found');
        return false;
    }
    if (toolsSel) await page.locator(toolsSel).first().click({ timeout: 5_000 }).catch((/** @type {any} */ e) => warnings.push(`tools click failed: ${e.message}`));
    await page.waitForTimeout(300).catch(() => undefined);
    if (await clickDeepThinkMenuItem(page)) {
        await page.waitForTimeout(700).catch(() => undefined);
        if (await isDeepThinkToolActive(page)) {
            await dismissBlockingOverlays(page, warnings);
            return true;
        }
    }
    const deepSel = await findFirstSelector(page, DEEP_THINK_SELECTORS, 2_000);
    if (!deepSel) {
        warnings.push('Deep think tool menu item not found');
        await page.keyboard.press('Escape').catch(() => undefined);
        return false;
    }
    try {
        await page.locator(deepSel).first().click({ timeout: 5_000 });
        await page.waitForTimeout(700).catch(() => undefined);
        if (await isDeepThinkToolActive(page)) {
            await dismissBlockingOverlays(page, warnings);
            return true;
        }
        await dismissBlockingOverlays(page, warnings);
        await page.waitForTimeout(300).catch(() => undefined);
        return isDeepThinkToolActive(page);
    } catch (e) {
        usedFallbacks.push('deep-think-click-failed');
        warnings.push(`Deep think tool click failed: ${(/** @type {any} */ (e)).message}`);
        return false;
    }
}

/**
 * @param {any} page
 */
async function clickToolsButton(page) {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
        const buttons = await page.locator('button').all().catch(() => []);
        for (const button of buttons) {
            const visible = await button.isVisible().catch(() => false);
            if (!visible) continue;
            const text = await button.innerText().catch(() => '');
            const aria = await button.getAttribute('aria-label').catch(() => '');
            if (text.trim() !== 'Tools' && !/Tools/i.test(aria || '')) continue;
            await button.click({ timeout: 3_000 });
            return true;
        }
        await page.waitForTimeout(250).catch(() => undefined);
    }
    return false;
}

/**
 * @param {any} page
 */
async function clickDeepThinkMenuItem(page) {
    const items = await page.locator('[role="menuitemcheckbox"], [role="menuitem"], button').all().catch(() => []);
    for (const item of items) {
        const visible = await item.isVisible().catch(() => false);
        if (!visible) continue;
        const text = (await item.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
        if (text !== 'Deep think') continue;
        await item.click({ timeout: 3_000 });
        return true;
    }
    return false;
}

/**
 * @param {any} page
 * @param {any} warnings
 */
async function openFreshGeminiChat(page, warnings) {
    const beforeUrl = page.url();
    const newChatSel = await findFirstSelector(page, NEW_CHAT_SELECTORS, 5_000);
    if (!newChatSel) {
        if ((await countResponses(page)) === 0) return;
        throw new WebAiError({
            errorCode: 'provider.composer-not-visible',
            stage: 'composer-prereq',
            vendor: 'gemini',
            retryHint: 're-snapshot',
            message: 'gemini new chat control not visible',
            selectorsTried: NEW_CHAT_SELECTORS,
        });
    }
    await page.locator(newChatSel).first().click({ timeout: 5_000 });
    await page.waitForTimeout(1_000).catch(() => undefined);
    await findFirstSelector(page, INPUT_SELECTORS, 10_000);
    if (page.url() === beforeUrl && (await countResponses(page)) > 0) {
        warnings.push('new chat URL did not change; continuing only because empty composer is visible');
    }
}

/**
 * @param {any} page
 */
async function isDeepThinkToolActive(page) {
    for (const sel of DEEP_THINK_ACTIVE_SELECTORS) {
        if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
    }
    return false;
}

/**
 * @param {any} page
 * @param {any} warnings
 */
async function dismissBlockingOverlays(page, warnings) {
    const backdrop = page.locator('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing').first();
    if (!await backdrop.isVisible().catch(() => false)) return;
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(250).catch(() => undefined);
    if (await backdrop.isVisible().catch(() => false)) {
        await backdrop.click({ timeout: 2_000, force: true }).catch((/** @type {any} */ e) => warnings.push(`overlay backdrop dismiss failed: ${e.message}`));
    }
    if (await backdrop.isVisible().catch(() => false)) warnings.push('overlay backdrop remained visible before composer focus');
}

/**
 * @param {any} page
 * @param {any} selectors
 * @param {any} timeoutMs
 */
async function findFirstSelector(page, selectors, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if (await loc.isVisible().catch(() => false)) return sel;
        }
        await page.waitForTimeout(250).catch(() => undefined);
    }
    return null;
}

/**
 * @param {any} page
 */
async function countResponses(page) {
    return (await readResponses(page)).length;
}

/**
 * @param {any} page
 */
async function readResponses(page) {
    for (const sel of RESPONSE_SELECTORS) {
        const locs = await page.locator(sel).all().catch(() => []);
        const out = [];
        for (const loc of locs) {
            const candidates = [];
            for (const textSel of RESPONSE_TEXT_SELECTORS) {
                const textLocs = await loc.locator(textSel).all().catch(() => []);
                for (const textLoc of textLocs) candidates.push(await textLoc.innerText().catch(() => ''));
            }
            candidates.push(await loc.innerText().catch(() => ''));
            const text = candidates.map(normalizeGeminiResponseText).find(candidate => candidate.trim());
            if (text) out.push(text);
        }
        if (out.length) return out;
    }
    return [];
}

/**
 * @param {any} text
 */
function normalizeGeminiResponseText(text) {
    return String(text || '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !/^(show thinking|gemini said)$/i.test(line))
        .join('\n')
        .trim();
}

/**
 * @param {any} text
 */
function isPendingDeepThinkText(text) {
    return /(?:responses with deep think can take some time|generating your response|check back later|i'?m on it)/i.test(String(text || ''));
}

/**
 * @param {any} page
 */
async function hasCompletionSignal(page) {
    for (const sel of COMPLETION_SELECTORS) {
        if ((await page.locator(sel).count().catch(() => 0)) > 0) return true;
    }
    return (await page.locator('[role="progressbar"]').count().catch(() => 0)) === 0;
}

/**
 * @param {any} contextPack
 */
function summarizeContextPack(contextPack) {
    return {
        files: contextPack.files.map((/** @type {any} */ file) => ({
            relativePath: file.relativePath,
            sizeBytes: file.sizeBytes,
            estimatedTokens: file.estimatedTokens,
        })),
        excluded: contextPack.excluded,
        budget: contextPack.budget,
    };
}
