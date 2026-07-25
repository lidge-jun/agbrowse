// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { renderQuestionEnvelope, renderQuestionEnvelopeWithContext, normalizeEnvelope } from './question.mjs';
import { defineCapability, probeFirstVisibleSelector, probeHostMatches, runCapabilities, worstCapabilityState } from './capability.mjs';
import { INPUT_SELECTORS as CHATGPT_COMPOSER_SELECTORS } from './chatgpt-composer.mjs';
import {
    bindSessionToTab,
    createSession,
    findActiveSession,
    getBaseline,
    getLatestBaseline,
    getSession,
    markSessionTimeout,
    resolveDeadlineAt,
    resolveTimeoutBudgetSec,
    saveBaseline,
    sessionToBaseline,
    summarizeEnvelope,
    updateSession,
} from './session.mjs';
import { WebAiError } from './errors.mjs';
import { detectInterstitial, INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER } from './interstitial.mjs';
import { finalizeProviderTab } from './tab-finalizer.mjs';
import { saveAssistantDownloadableFiles } from './chatgpt-files.mjs';
import { observeAssistantResponse, recoverAssistantResponse } from './chatgpt-response-observer.mjs';
import { diagnosticsEnabled, captureFailureDiagnostics } from './failure-diagnostics.mjs';
import { recordActiveLease } from './tab-lease-store.mjs';
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';
import {
    attachLocalFileLive,
    attachLocalFilesLive,
    fileInfoFromPath,
    preflightAttachment,
    sendButtonTimeoutMs,
    UPLOAD_BUTTON_SELECTORS as CHATGPT_UPLOAD_SELECTORS,
    verifySentTurnAttachmentLive,
} from './chatgpt-attachments.mjs';
import { selectChatGptModel, chatGptModelCapabilityProbe } from './chatgpt-model.mjs';
import { prepareContextForBrowser } from './context-pack/index.mjs';
import { captureCopiedResponseText, CHATGPT_COPY_SELECTORS, preferCopiedText } from './copy-markdown.mjs';
import { withAnswerArtifact } from './answer-artifact.mjs';
import { resolveTargetForIntent } from './target-resolver.mjs';
import { createTraceContext, getSessionTrace, recordTraceStep, summarizeTraceSteps } from './action-trace.mjs';
import { appendTraceToSession } from './trace-persistence.mjs';
import { isPageDeathError } from './tab-recovery.mjs';
import { waitForConversationReady, isProviderUrl, shouldNavigateToRequestedProviderUrl, waitForPageUrl } from './navigation-ready.mjs';
import { collectImages, isImageOnlyGeneratedImageChromeText } from './chatgpt-images.mjs';
import { resolveArtifactsDir } from './session-artifacts.mjs';
import { sendDeepResearch } from './chatgpt-deep-research.mjs';
import { selectChatGptComposerTools } from './chatgpt-tools.mjs';
import { buildTargetMismatchResult } from './session-target-guard.mjs';
import {
    CHATGPT_ASSISTANT_SELECTORS,
    CHATGPT_STOP_SELECTORS,
    anyStopButtonVisible,
    isActiveState,
    readAssistantSnapshotSources,
    readChatGptStreamingState,
    readTopLevelAssistantSnapshots,
    readTopLevelAssistantTextsFromLocators,
    resolveTopLevelAssistantTurns,
} from './chatgpt-response-dom.mjs';

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const ASSISTANT_SELECTORS = CHATGPT_ASSISTANT_SELECTORS;
const FINISHED_ACTIONS_SELECTOR = [
    'button[data-testid="copy-turn-action-button"]',
    'button[data-testid="good-response-turn-action-button"]',
    'button[data-testid="bad-response-turn-action-button"]',
    'button[aria-label="Share"]',
].join(', ');

const PLACEHOLDER_PATTERNS = [
    /^answer now$/i,
    /^pro thinking/i,
    /^finalizing answer$/i,
    /^instant$/i,
    /^thinking$/i,
    /^pro$/i,
    /^configure\.{0,3}$/i,
    /^reading documents?$/i,
    /^analyzing files?$/i,
    /^stopped thinking$/i,
    /^reasoning$/i,
    /^deep thinking$/i,
    /^searching\.{0,3}$/i,
    /^browsing\.{0,3}$/i,
    /^\s*$/,
    /^chatgpt said:\s*answer now\s*$/i,
];

/**
 * @param {any} input
 */
export async function renderWebAi(input = {}) {
    const envelope = normalizeEnvelope(input);
    const contextPack = await prepareContextForBrowser(input);
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(envelope, contextPack.composerText)
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelope(envelope);
    return {
        ok: true,
        vendor: envelope.vendor,
        status: 'rendered',
        rendered,
        contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
        warnings: [...rendered.warnings, ...(contextPack?.warnings || [])],
    };
}

export const chatGptCapabilities = [
    defineCapability('chatgpt-active-tab-verification', async (/** @type {any} */ deps) => probeHostMatches(await deps.getPage(), CHATGPT_HOSTS)),
    defineCapability('chatgpt-composer-visible', async (/** @type {any} */ deps) => probeFirstVisibleSelector(await deps.getPage(), CHATGPT_COMPOSER_SELECTORS)),
    defineCapability('chatgpt-model-alias-selectable', async (/** @type {any} */ deps, /** @type {any} */ input) => chatGptModelCapabilityProbe(await deps.getPage(), input.model, { effort: input.reasoningEffort })),
    defineCapability('chatgpt-upload-surface-visible', async (/** @type {any} */ deps, /** @type {any} */ input) => {
        if (!input.filePath && input.inlineOnly !== false) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), CHATGPT_UPLOAD_SELECTORS, { failNext: 'inline-only' });
    }),
    defineCapability('chatgpt-copy-button-present', async (/** @type {any} */ deps, /** @type {any} */ input) => {
        if (!input.allowCopyMarkdownFallback) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), CHATGPT_COPY_SELECTORS.copyButtonSelectors, { timeoutMs: 500, failNext: 'send', failState: 'warn' });
    }),
    defineCapability('chatgpt-response-streaming', async (/** @type {any} */ deps) => {
        const page = await deps.getPage();
        for (const sel of CHATGPT_STOP_SELECTORS) {
            if (await page.locator(sel).first().isVisible().catch(() => false)) {
                return { state: 'warn', evidence: { streaming: true, selector: sel }, next: 'poll' };
            }
        }
        return { state: 'ok', evidence: { streaming: false }, next: 'send' };
    }),
];

/**
 * @param {any} deps
 * @param {any} input
 */
export async function statusWebAi(deps, input = {}) {
    // Run capability probes first so chatgpt-active-tab-verification can report
    // a fail row instead of throwing before any rows are collected. The strict
    // host-required path stays available for send/poll via requireChatGptPage().
    const page = await deps.getPage();
    const capabilities = await runCapabilities(deps, chatGptCapabilities, input);
    const worst = worstCapabilityState(capabilities);
    return {
        ok: worst !== 'fail',
        vendor: input.vendor || 'chatgpt',
        status: worst === 'fail' ? 'blocked' : 'ready',
        url: page.url(),
        capabilities,
        capabilityState: worst,
        warnings: [],
    };
}

/**
 * @param {string[]} uploadPaths
 * @param {any} input
 */
function preflightChatGptUploadFiles(uploadPaths, input) {
    return uploadPaths.map((uploadPath) => {
        let file;
        try {
            file = fileInfoFromPath(uploadPath);
        } catch (cause) {
            throw new WebAiError({
                errorCode: 'provider.attachment-preflight',
                stage: 'attachment-preflight',
                vendor: 'chatgpt',
                retryHint: 're-upload',
                message: `attachment preflight failed for ${uploadPath}: ${String((/** @type {any} */ (cause))?.message || cause)}`,
                mutationAllowed: false,
                cause,
            });
        }
        const preflight = preflightAttachment(file, {
            maxUploadBytes: input.maxUploadFileSize,
        });
        if (preflight.ok !== true) {
            throw new WebAiError({
                errorCode: 'provider.attachment-preflight',
                stage: 'attachment-preflight',
                vendor: 'chatgpt',
                retryHint: 're-upload',
                message: `${file.basename}: ${preflight.rejectedReason || 'preflight rejected'}`,
                mutationAllowed: false,
            });
        }
        return file;
    });
}

const CHATGPT_REPOMIX_COMPOSER_ROOT_SELECTORS = [
    'form:has(textarea)',
    'form:has([contenteditable="true"])',
    'main form',
];

const CHATGPT_REPOMIX_ATTACHMENT_COUNT_SELECTORS = [
    'button[aria-label*="Remove file" i]',
    'button[aria-label*="Remove attachment" i]',
    '.group\\/file-tile',
    '[data-testid*="attachment" i]',
].map(selector => CHATGPT_REPOMIX_COMPOSER_ROOT_SELECTORS
    .map(root => `${root} ${selector}`)
    .join(', '));

const CHATGPT_REPOMIX_UPLOAD_PROGRESS_SELECTORS = [
    '[role="progressbar"]',
    '[aria-label*="uploading" i]',
    '[aria-label*="processing" i]',
    '[data-testid*="upload-progress" i]',
].map(selector => CHATGPT_REPOMIX_COMPOSER_ROOT_SELECTORS
    .map(root => `${root} ${selector}`)
    .join(', '));

/**
 * Repomix may add several artifacts alongside existing user/code attachments.
 * Count visible chips instead of matching basenames so duplicate names remain
 * allowed without letting one accepted file stand in for several requested
 * files. This strict gate is intentionally not used by the legacy raw path.
 * @param {any} page
 * @param {number} expectedCount
 * @param {{timeoutMs?:number}} [options]
 */
export async function waitForChatGptRepomixAttachmentCount(page, expectedCount, options = {}) {
    const deadline = Date.now() + Math.max(0, Number(options.timeoutMs ?? 8_000));
    let observedCount = 0;
    let progressCount = 0;
    do {
        const [attachmentCounts, progressCounts] = await Promise.all([
            Promise.all(CHATGPT_REPOMIX_ATTACHMENT_COUNT_SELECTORS.map(selector => page.locator(selector).count().catch(() => 0))),
            Promise.all(CHATGPT_REPOMIX_UPLOAD_PROGRESS_SELECTORS.map(selector => page.locator(selector).count().catch(() => 0))),
        ]);
        // Each surface may represent only part of a mixed attachment batch.
        // Prefer any complete surface, then retain the largest partial count
        // for diagnostics without summing cross-selector duplicates.
        const exactCount = attachmentCounts.find(count => count === expectedCount);
        observedCount = exactCount ?? Math.max(0, ...attachmentCounts);
        progressCount = progressCounts.reduce((total, count) => total + count, 0);
        if (progressCount === 0 && observedCount === expectedCount) {
            return { ok: true, expectedCount, observedCount };
        }
        if (Date.now() >= deadline) break;
        await page.waitForTimeout(250).catch(() => undefined);
    } while (Date.now() <= deadline);
    return {
        ok: false,
        expectedCount,
        observedCount,
        error: `ChatGPT accepted ${observedCount}/${expectedCount} expected attachments before submit`,
    };
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function sendWebAi(deps, input = {}) {
    const envelope = normalizeEnvelope(input);
    const repomixMode = String(input.contextTransform || '').trim().toLowerCase() === 'repomix'
        || input.preparedContextPack?.contextTransform === 'repomix';
    let contextPack = repomixMode
        ? input.preparedContextPack || await prepareContextForBrowser(input)
        : null;
    let contextAttachments = Array.isArray(contextPack?.attachments) ? contextPack.attachments : [];
    // input.filePaths preserves the caller's upload order. In code mode that
    // order is the dev-agent context zip followed by caller-provided files.
    const requestedPaths = Array.isArray(input.filePaths) && input.filePaths.length
        ? input.filePaths
        : (input.filePath ? [input.filePath] : []);
    /** @type {string[]} */
    let uploadPaths = [];
    /** @type {any[]} */
    let uploadFiles = [];
    const strictRepomixUpload = repomixMode && contextAttachments.length > 0;
    if (repomixMode) {
        uploadPaths = [
            ...requestedPaths,
            ...contextAttachments.map((/** @type {any} */ attachment) => attachment.path),
        ];
        // Repomix/config/artifact failures must precede provider-page mutation.
        uploadFiles = preflightChatGptUploadFiles(uploadPaths, input);
    }

    if (input.url) {
        const page = await deps.getPage();
        const currentUrl = await waitForPageUrl(page, { state: 'load' });
        if (shouldNavigateToRequestedProviderUrl(currentUrl, input.url)) {
            await page.goto(input.url, { waitUntil: 'load', timeout: 30_000 });
        }
        const redirectedUrl = page.url();
        await waitForConversationReady(page, redirectedUrl);
        if (redirectedUrl !== input.url && isProviderUrl(redirectedUrl)) {
            input.url = redirectedUrl;
        }
    }
    const page = await requireChatGptPage(deps);
    if (!repomixMode) {
        // Preserve the raw workflow's existing navigation and mutation order.
        contextPack = await prepareContextForBrowser(input);
        contextAttachments = Array.isArray(contextPack?.attachments) ? contextPack.attachments : [];
    }
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(envelope, contextPack.composerText)
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelope(envelope);
    const selectedModel = await selectChatGptModel(page, input.model, {
        effort: input.reasoningEffort,
        family: input.family,
    });

    await waitForStableAssistantCount(page);
    const assistantCount = await countAssistantMessages(page);
    const baseline = saveBaseline({
        vendor: envelope.vendor,
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
        deadlineAt: resolveDeadlineAt(input, 'chatgpt'),
        envelopeSummary: { ...summarizeEnvelope(input, contextPack), assistantCount },
    });
    if (selectedModel?.modelSelection) {
        updateSession(session.sessionId, { modelSelection: selectedModel.modelSelection });
    }
    if (targetId) await recordActiveLease({
        owner: 'web-ai',
        vendor: envelope.vendor,
        sessionType: 'send-poll',
        sessionId: session.sessionId,
        targetId,
        url: page.url(),
        port: deps.getPort?.() || 9222,
    });
    if (targetId) bindSessionToTab(session.sessionId, targetId);

    const editorOptions = {
        insertText: async (/** @type {any} */ text) => {
            const cdp = await deps.getCdpSession?.();
            if (!cdp) throw new Error('CDP session unavailable for Input.insertText');
            try {
                await cdp.send('Input.insertText', { text });
            } finally {
                await cdp.detach?.().catch(() => undefined);
            }
        },
    };
    const readinessAdapter = createChatGptEditorAdapter(page, editorOptions);
    await waitForChatGptComposerReady(page, readinessAdapter);
    const selectedTools = await selectChatGptComposerTools(page, input);
    const traceCtx = createTraceContext(session.sessionId);
    let tracePersisted = false;
    try {
        const composerResolution = await resolveChatGptComposerTarget(page, traceCtx);
        const adapter = createChatGptEditorAdapter(page, {
            ...editorOptions,
            composerTarget: /** @type {any} */ (composerResolution.target),
        });
        const commitBaseline = await adapter.getCommitBaseline();
        await adapter.insertPrompt(rendered.composerText);
        /** @type {any[]} */
        let attachmentWarnings = [];
        /** @type {any[]} */
        let usedFallbacks = [];
        if (!repomixMode) {
            const contextAttachmentPath = contextAttachments[0]?.path;
            if (contextAttachmentPath && requestedPaths.length) {
                throw new WebAiError({
                    errorCode: 'provider.attachment-preflight',
                    stage: 'attachment-preflight',
                    vendor: 'chatgpt',
                    retryHint: 'inline-only-or-file',
                    message: 'context package upload and --file upload cannot be combined yet',
                });
            }
            uploadPaths = requestedPaths.length
                ? requestedPaths
                : (contextAttachmentPath ? [contextAttachmentPath] : []);
        }
        if (!repomixMode) uploadFiles = uploadPaths.map(fileInfoFromPath);
        if (uploadPaths.length) {
            const uploadResolution = await resolveOptionalChatGptUploadTarget(page, traceCtx);
            const upload = await attachLocalFilesLive(page, uploadFiles, {
                uploadTarget: /** @type {any} */ (uploadResolution?.target || null),
                maxUploadBytes: input.maxUploadFileSize,
                attachmentUploadTimeoutMs: input.attachmentUploadTimeoutMs,
            });
            if (repomixMode ? upload.ok !== true : !upload.ok) throw new WebAiError({
                errorCode: 'provider.attachment-evidence-missing',
                stage: 'attachment-verify',
                vendor: 'chatgpt',
                retryHint: 're-upload',
                message: upload.error,
                mutationAllowed: true,
            });
            attachmentWarnings = upload.warnings || [];
            usedFallbacks = upload.usedFallbacks || [];
        }
        if (strictRepomixUpload) {
            const attachmentCount = await waitForChatGptRepomixAttachmentCount(page, uploadFiles.length);
            if (attachmentCount.ok !== true) throw new WebAiError({
                errorCode: 'provider.attachment-evidence-missing',
                stage: 'attachment-verify',
                vendor: 'chatgpt',
                retryHint: 're-upload',
                message: attachmentCount.error,
                mutationAllowed: true,
                evidence: {
                    expectedCount: attachmentCount.expectedCount,
                    observedCount: attachmentCount.observedCount,
                },
            });
        }
        const sendResolution = await resolveOptionalChatGptSendTarget(page, traceCtx);
        const totalUploadBytes = uploadFiles.reduce((total, file) => total + (Number(file.sizeBytes) || 0), 0);
        const submitTimeoutMs = sendButtonTimeoutMs(uploadPaths, totalUploadBytes);
        const submitResult = await adapter.submitPrompt({
            sendTarget: /** @type {any} */ (sendResolution?.target || null),
            sendButtonTimeoutMs: submitTimeoutMs,
            requireEnabledSendButton: uploadPaths.length > 0,
        });
        if (submitResult.failure === 'send-button-disabled') {
            throw new WebAiError({
                errorCode: 'provider.send-click',
                stage: 'send-click',
                vendor: 'chatgpt',
                retryHint: 'retry-send',
                message: 'send button never became enabled while attachments were pending',
            });
        }
        await adapter.verifyPromptCommitted(rendered.composerText, commitBaseline, {
            timeoutMs: submitTimeoutMs,
        });
        await verifySentAttachments(page, uploadFiles, { usedFallbacks, attachmentWarnings });
        const finalUrl = page.url();
        if (session && finalUrl !== session.conversationUrl) {
            updateSession(session.sessionId, { conversationUrl: finalUrl });
        }
        const traceSummary = persistResolverTrace(session.sessionId, traceCtx);
        tracePersisted = true;
        return {
            ok: true,
            vendor: envelope.vendor,
            status: 'sent',
            url: finalUrl,
            sessionId: session.sessionId,
            baseline,
            usedFallbacks: [...usedFallbacks, ...(selectedModel?.usedFallbacks || []), ...(selectedTools?.usedFallbacks || [])],
            ...(traceSummary ? { traceSummary } : {}),
            contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
            warnings: [
                ...rendered.warnings,
                ...(contextPack?.warnings || []),
                ...(repomixMode
                    ? contextAttachments.map((/** @type {any} */ attachment) => `context package attached: ${attachment.displayPath || attachment.path}`)
                    : (contextAttachments[0]?.path ? [`context package attached: ${contextPack.attachments[0].displayPath}`] : [])),
                ...attachmentWarnings,
                ...(selectedModel?.warnings || []),
                ...(selectedTools?.warnings || []),
                ...(selectedModel?.selected ? [`model selected: ${selectedModel.selected}${selectedModel.alreadySelected ? ' (already selected)' : ''}`] : []),
                ...(selectedModel?.effort ? [`reasoning effort selected: ${selectedModel.effort}`] : []),
                ...(selectedTools?.selectedTools?.length ? [`composer tools selected: ${selectedTools.selectedTools.join(', ')}`] : []),
                ...(selectedTools?.selectedPlugins?.length ? [`composer plugins selected: ${selectedTools.selectedPlugins.join(', ')}`] : []),
                ...(selectedTools?.reasons?.length ? [`composer tool reasons: ${selectedTools.reasons.join(', ')}`] : []),
            ],
        };
    } finally {
        if (!tracePersisted) persistResolverTrace(session.sessionId, traceCtx);
    }
}

/**
 * Preserve the composer readiness error unless a bounded ChatGPT-scoped probe
 * identifies a provider interstitial.
 * @param {any} page
 * @param {{ waitForReady: () => Promise<void> }} readinessAdapter
 * @param {{ detect?: typeof detectInterstitial }} [options]
 */
export async function waitForChatGptComposerReady(page, readinessAdapter, { detect = detectInterstitial } = {}) {
    try {
        await readinessAdapter.waitForReady();
    } catch (cause) {
        const verdict = await detect(page, { shellSelectors: INTERSTITIAL_SHELL_SELECTORS_BY_PROVIDER.chatgpt });
        if (verdict.kind !== 'none') {
            throw new WebAiError({
                errorCode: 'provider.interstitial',
                stage: 'provider-interstitial',
                vendor: 'chatgpt',
                retryHint: verdict.retryHint,
                message: `ChatGPT interstitial blocked composer readiness: ${verdict.kind}`,
                evidence: verdict,
                cause,
            });
        }
        throw cause;
    }
}

/**
 * @param {Page} page
 * @param {Array<{basename: string}>} uploadFiles
 * @param {{usedFallbacks: string[], attachmentWarnings: string[]}} evidence
 * @param {(page: Page, file: any) => Promise<any>} [verifyAttachment]
 */
export async function verifySentAttachments(page, uploadFiles, evidence, verifyAttachment = verifySentTurnAttachmentLive) {
    for (const file of uploadFiles) {
        const sentAttachment = await verifyAttachment(page, file);
        if (sentAttachment.ok) continue;
        const underlyingError = sentAttachment.error || 'unknown verification failure';
        if (process.env.AGBROWSE_SENT_ATTACHMENT_POLICY === 'warn') {
            evidence.usedFallbacks.push('sent-attachment-evidence-unavailable');
            evidence.attachmentWarnings.push(`sent attachment evidence unavailable after submit (${file.basename}): ${underlyingError}`);
            continue;
        }
        throw new WebAiError({
            errorCode: 'provider.sent-attachment-missing',
            stage: 'attachment-verify',
            vendor: 'chatgpt',
            retryHint: 're-upload',
            mutationAllowed: true,
            message: `sent attachment missing after submit (${file.basename}): ${underlyingError}`,
        });
    }
}

/**
 * Check whether the latest assistant conversation turn follows the latest user turn.
 * Evaluation failures are treated as ordered so transient DOM issues do not block polling.
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function doesAssistantFollowUser(page) {
    // Returns true (ordered) or false (stale). Non-boolean results from mock/fake
    // pages (e.g. null) are treated as true to avoid blocking in test environments.
    const result = await page.evaluate(() => {
        const turns = Array.from(document.querySelectorAll(
            'article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"], section[data-testid^="conversation-turn"]',
        ));
        const roleOf = (/** @type {Element} */ turn) => turn.getAttribute('data-message-author-role')
            || turn.querySelector('[data-message-author-role]')?.getAttribute('data-message-author-role');
        const lastAssistantTurn = turns.findLast((turn) => roleOf(turn) === 'assistant');
        const lastUserTurn = turns.findLast((turn) => roleOf(turn) === 'user');
        // No user turn found → can't verify ordering; assume OK (avoids blocking
        // in test fixtures and edge cases like system-initiated conversations).
        // No assistant turn → not ready yet, but the outer poll handles that via `latest`.
        if (!lastUserTurn) return true;
        if (!lastAssistantTurn) return false;
        return Boolean(lastUserTurn.compareDocumentPosition(lastAssistantTurn) & Node.DOCUMENT_POSITION_FOLLOWING);
    }).catch(() => null);
    return result !== false;
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function pollWebAi(deps, input = {}) {
    const vendor = input.vendor || 'chatgpt';
    const timeout = Math.max(1, Number(input.timeout) > 0
        ? Number(input.timeout)
        : (() => {
            const session = input.session ? getSession(input.session) : null;
            return resolveTimeoutBudgetSec(input, session, vendor);
        })(),
    );
    const page = await requireChatGptPage(deps);
    const url = page.url();
    const session = input.session
        ? getSession(input.session)
        : findActiveSession({
            vendor,
            targetId: await deps.getTargetId?.().catch(() => null) || null,
            conversationUrl: url,
        });
    const baseline = (session && sessionToBaseline(session))
        || getBaseline(vendor, url)
        || getLatestBaseline(vendor, { sameHostUrl: url });
    if (!baseline) throw new WebAiError({
        errorCode: 'provider.poll-timeout',
        stage: 'poll',
        vendor: 'chatgpt',
        retryHint: 'poll-or-resume',
        message: 'baseline required. Run web-ai send or query first.',
    });
    const copyTraceCtx = session && input.allowCopyMarkdownFallback === true
        ? createTraceContext(session.sessionId)
        : null;

    const deadline = Date.now() + timeout * 1000;
    const startedAt = Date.now();
    let stableText = '';
    let stableSnapshot = null;
    let stableSince = 0;
    let lastHeartbeat = 0;
    // 33 short-circuit: a MutationObserver wakes the loop as soon as the response
    // settles (bounded so it self-disconnects). The poller stays AUTHORITATIVE —
    // it still reads + verifies every tick; this only reduces wait latency, so the
    // worst case (observer never fires / errors) is identical 500ms polling.
    const observerBudgetMs = Math.min(Math.max(0, deadline - Date.now()), 120_000);
    let observerWake = observerBudgetMs > 1_000
        ? observeAssistantResponse(page, { baselineAssistantCount: baseline.assistantCount, timeoutMs: observerBudgetMs })
        : null;
    while (Date.now() <= deadline) {
        try {
        if (session?.targetId) {
            const currentTargetId = await deps.getTargetId?.().catch(() => null);
            if (currentTargetId && currentTargetId !== session.targetId) {
                return buildTargetMismatchResult({
                    vendor,
                    session,
                    actualTargetId: currentTargetId,
                    port: deps.getPort?.() || 9222,
                    url: page.url(),
                    baseline,
                });
            }
        } else {
            const currentUrl = page.url();
            const baselineConvoId = extractConversationId(baseline.url);
            const currentConvoId = extractConversationId(currentUrl);
            if (baselineConvoId !== currentConvoId || (!baselineConvoId && !currentConvoId && baseline.url !== currentUrl)) {
                return {
                    ok: false, vendor, status: 'conversation-mismatch',
                    url: currentUrl, answerText: '', baseline, usedFallbacks: [],
                    warnings: [`conversation changed: ${baselineConvoId || 'none'} → ${currentConvoId || 'none'}`],
                    error: 'conversation changed during poll',
                };
            }
        }
        const split = await readAssistantSnapshotsSplit(page);
        // Only a FAILED acquisition falls back. A successful empty read means the
        // page genuinely has nothing yet, and must keep polling rather than have a
        // legacy reader invent candidates.
        const wrapped = split.ok
            ? split.wrapped
            : (await readAssistantSnapshots(page)).map((sample, index) => ({
                ...sample, source: 'wrapped', domOrder: index,
            }));
        const wrapperless = split.wrapperless;
        // Wrapped turns are positional: slice against the pre-send count.
        // Wrapperless blocks are already correlated by DOM-following the latest
        // user node, so slicing them against a stale count would drop the answer.
        // Merge by DOM order so `.at(-1)` means "last in the document".
        const newSnapshots = [...wrapped.slice(baseline.assistantCount), ...wrapperless]
            .sort((a, b) => (a.domOrder ?? 0) - (b.domOrder ?? 0))
            .filter(sample => isFinalAnswer(sample.text));
        const latestSnapshot = newSnapshots.at(-1) || null;
        const latest = latestSnapshot?.text || '';
        const activity = await readActivityState(page);
        // `streaming` now means STRONG evidence only. Weak activity — a mounted
        // sidecar still reading "Thinking", or a growing "Thought for 2s: …"
        // trace — no longer freezes the stability window; it only demands a
        // longer quiet period before we accept completion.
        const streaming = activity.strength === 'strong';
        const weakActive = activity.strength === 'weak';
        const now = Date.now();
        if ((streaming || latest) && now - lastHeartbeat >= 30_000) {
            const elapsed = Math.round((now - startedAt) / 1000);
            const phase = streaming ? 'streaming' : weakActive ? 'settling' : 'stabilizing';
            process.stderr.write(`[poll] ${elapsed}s — ${phase}...\n`);
            lastHeartbeat = now;
        }
        // The image shortcut returns on the FIRST detected image with no terminal
        // evidence, so it requires true quiet: weak activity is still activity.
        if (activity.strength === 'none' && latestSnapshot && session && input.outputImage !== undefined
            && isImageOnlyGeneratedImageChromeText(latest)) {
            const imageResult = await collectGeneratedImageAnswer(deps, input, session, baseline);
            if (imageResult) {
                if (!input.skipFinalize) {
                    await finalizeProviderTab(deps, {
                        vendor, session: /** @type {any} */ (session), page,
                        answerText: imageResult.answerText,
                        warnings: imageResult.warnings,
                        archiveFlag: input.archiveFlag,
                    });
                }
                return withAnswerArtifact({
                    ok: true, vendor, status: 'complete', url: page.url(), sessionId: session.sessionId,
                    answerText: imageResult.answerText, baseline, usedFallbacks: ['generated-image'],
                    warnings: imageResult.warnings, responseStableMs: 0,
                });
            }
        }
        const completion = !streaming && latestSnapshot
            ? await isResponseFinished(page, latestSnapshot, baseline.assistantCount)
            : { finished: false, messageId: null, turnId: null, turnIndex: -1 };
        const finished = completion.finished === true;
        // G5: Turn ordering — ensure latest assistant turn follows latest user turn
        // before accepting as stable. Prevents stale historical text from being returned.
        // A wrapperless candidate was ADMITTED only because it DOM-follows the latest
        // user node, so it already carries the exact evidence this gate checks — and
        // the gate structurally cannot see it, since it only knows turn wrappers.
        if (latest && !streaming && latestSnapshot?.source !== 'wrapperless') {
            const ordered = await doesAssistantFollowUser(page).catch(() => true);
            if (!ordered) continue; // not ready yet — user's turn is still the latest
        }
        if (latest && !streaming) {
            if (latest === stableText) {
                const elapsedStable = Date.now() - stableSince;
                // A weak signal demands a longer quiet window before we treat it as
                // stale, so a genuinely slow reasoning phase is never cut short.
                const minStableMs = weakActive ? 5_000 : 1_000;
                if (finished && elapsedStable >= minStableMs) {
                    const usedFallbacks = [];
                    const warnings = [];
                    let answerText = latest;
                    let traceSummary = null;
                    if (input.allowCopyMarkdownFallback === true) {
                        const copyResolution = await resolveOptionalChatGptCopyTarget(page, copyTraceCtx);
                        const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
                            copyTarget: /** @type {any} */ (copyResolution?.target || null),
                        });
                        traceSummary = persistResolverTraceForSession(session, copyTraceCtx);
                        const copiedText = preferCopiedText(latest, copied);
                        if (copiedText) {
                            answerText = cleanAssistantText(copiedText);
                            usedFallbacks.push('copy-markdown');
                        } else {
                            warnings.push(`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`);
                        }
                    }
                    if (session && input.outputImage !== undefined) {
                        const cdp = await deps.getCdpSession?.();
                        if (!cdp) {
                            throw new WebAiError({
                                errorCode: 'provider.image-output',
                                stage: 'image-output',
                                vendor: 'chatgpt',
                                retryHint: 'start-headed',
                                message: 'CDP session unavailable for explicit generated-image output',
                            });
                        }
                        try {
                            const imgResult = await collectImages(cdp, {
                                baselineAssistantCount: baseline?.assistantCount || 0,
                                outputPath: input.outputImage || null,
                                sessionId: input.outputImage ? null : session.sessionId,
                                waitTimeoutMs: 60_000,
                            });
                            warnings.push(...(imgResult.warnings || []));
                            if (imgResult.errors?.length) {
                                throw new WebAiError({
                                    errorCode: 'provider.image-output',
                                    stage: 'image-output',
                                    vendor: 'chatgpt',
                                    retryHint: 'check-generated-image-or-disable-output-image',
                                    message: imgResult.errors.join('; '),
                                    mutationAllowed: true,
                                });
                            }
                            if (imgResult.savedPaths.length) {
                                if (isImageOnlyGeneratedImageChromeText(answerText)) {
                                    answerText = imgResult.images.length === 1
                                        ? 'Generated image.'
                                        : `Generated ${imgResult.images.length} images.`;
                                }
                                answerText += imgResult.markdownSuffix;
                            }
                        } finally {
                            await cdp.detach?.().catch(() => undefined);
                        }
                    }
                    if (session && !input.skipFinalize) {
                        // Capture generic assistant-turn downloadable files (CSV/PDF/ZIP/...)
                        // before archive. Separate from code-mode ZIP (code-artifact.mjs,
                        // not on this path) and generated images (handled above). Never
                        // throws past its boundary; only adds warnings.
                        try {
                            const fileCdp = await deps.getCdpSession?.();
                            if (fileCdp) {
                                try {
                                    const fileResult = await saveAssistantDownloadableFiles(fileCdp, deps, {
                                        sessionId: session.sessionId,
                                        baselineAssistantCount: baseline?.assistantCount || 0,
                                    });
                                    if (fileResult.warnings?.length) warnings.push(...fileResult.warnings);
                                } finally {
                                    await fileCdp.detach?.().catch(() => undefined);
                                }
                            }
                        } catch (err) {
                            warnings.push(`file-artifact-capture-failed:${/** @type {any} */ (err)?.message || 'unknown'}`);
                        }
                        await finalizeProviderTab(deps, { vendor, session: /** @type {any} */ (session), page, answerText, warnings, archiveFlag: input.archiveFlag });
                    }
                    return withAnswerArtifact({
                        ok: true,
                        vendor,
                        status: 'complete',
                        url: page.url(),
                        ...(session ? { sessionId: session.sessionId } : {}),
                        answerText,
                        baseline,
                        usedFallbacks,
                        warnings,
                        ...(traceSummary ? { traceSummary } : {}),
                        responseStableMs: Date.now() - stableSince,
                    });
                }
            } else {
                stableText = latest;
                stableSnapshot = latestSnapshot;
                stableSince = Date.now();
            }
        } else {
            stableText = '';
            stableSnapshot = null;
            stableSince = 0;
        }
        if (observerWake) {
            // Wake early when the observer signals settle; else cap at 500ms.
            // Once it resolves, stop racing it (plain polling thereafter).
            await Promise.race([
                page.waitForTimeout(500),
                observerWake.then(() => { observerWake = null; }, () => { observerWake = null; }),
            ]);
        } else {
            await page.waitForTimeout(500);
        }
        } catch (pollErr) {
            if (isPageDeathError(pollErr)) {
                if (session) updateSession(session.sessionId, { status: 'crashed' });
                return {
                    ok: false, vendor, status: 'tab-crashed',
                    url: baseline.url || '', ...(session ? { sessionId: session.sessionId } : {}),
                    answerText: '', baseline, usedFallbacks: [],
                    warnings: ['tab-crashed-during-poll'],
                    error: String((/** @type {any} */ (pollErr))?.message || pollErr),
                    recoverable: true,
                };
            }
            throw pollErr;
        }
    }

    // 33 3rd-tier recovery: the poller hit the deadline. Re-read the latest
    // assistant turn once — recovers a final answer the loop missed (e.g. a late
    // DOM settle). Session polls only (recovery persists to the session).
    if (session) {
        const recovered = await recoverAssistantResponse(page, {
            baselineAssistantCount: baseline.assistantCount,
            isFinalAnswer,
            readStreaming: () => isStreaming(page),
            readFinished: async sample => {
                const completion = await isResponseFinished(page, sample, baseline.assistantCount);
                return completion.finished === true;
            },
        });
        if (recovered?.text) {
            if (recovered.streaming === true) {
                return buildDeferredPollingResult({
                    vendor, page, session, baseline,
                    answerText: recovered.text,
                    usedFallbacks: ['recovery'],
                    warning: 'recovery-deferred-streaming',
                    streamingState: 'streaming',
                });
            }
            const canComplete = recovered.finished === true;
            if (!canComplete) {
                return buildDeferredPollingResult({
                    vendor, page, session, baseline,
                    answerText: recovered.text,
                    usedFallbacks: ['recovery'],
                    warning: 'recovery-deferred-unverified',
                    streamingState: 'unknown',
                });
            }
            const answerText = recovered.text;
            if (!input.skipFinalize) {
                await finalizeProviderTab(deps, { vendor, session: /** @type {any} */ (session), page, answerText, archiveFlag: input.archiveFlag });
            }
            return withAnswerArtifact({
                ok: true,
                vendor,
                status: 'complete',
                url: page.url(),
                sessionId: session.sessionId,
                answerText,
                baseline,
                usedFallbacks: ['recovery'],
                warnings: ['response-recovered-after-timeout'],
                responseStableMs: Math.max(1, Number(recovered.responseStableMs || 0)),
            });
        }
    }

    // 34 diagnostics: on the timeout path (recovery already failed), capture a
    // DOM snapshot + screenshot when gated. Fire-and-forget; never throws.
    if (session && diagnosticsEnabled(input)) {
        await captureFailureDiagnostics(deps, { sessionId: session.sessionId, context: 'response-timeout', page });
    }

    if (input.allowCopyMarkdownFallback === true && stableText) {
        const streaming = await isStreaming(page);
        const responseStableMs = stableSince ? Date.now() - stableSince : 0;
        if (streaming) {
            if (session) {
                return buildDeferredPollingResult({
                    vendor, page, session, baseline,
                    answerText: stableText,
                    usedFallbacks: ['copy-markdown'],
                    warning: 'copy-markdown-deferred-streaming',
                    streamingState: 'streaming',
                });
            }
            stableText = '';
            stableSnapshot = null;
        }
        if (responseStableMs <= 0) {
            stableText = '';
            stableSnapshot = null;
        }
        const completion = stableSnapshot
            ? await isResponseFinished(page, stableSnapshot, baseline.assistantCount)
            : { finished: false };
        if (completion.finished !== true) {
            if (session) {
                return buildDeferredPollingResult({
                    vendor, page, session, baseline,
                    answerText: stableText,
                    usedFallbacks: ['copy-markdown'],
                    warning: 'copy-markdown-deferred-unverified',
                    streamingState: 'unknown',
                });
            }
            stableText = '';
            stableSnapshot = null;
        }
    }

    if (input.allowCopyMarkdownFallback === true && stableText) {
        const copyResolution = await resolveOptionalChatGptCopyTarget(page, copyTraceCtx);
        const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
            copyTarget: /** @type {any} */ (copyResolution?.target || null),
        });
        const traceSummary = persistResolverTraceForSession(session, copyTraceCtx);
        const copiedText = preferCopiedText(stableText, copied);
        if (copiedText) {
            const answerText = cleanAssistantText(copiedText);
            if (session && !input.skipFinalize) {
                await finalizeProviderTab(deps, { vendor, session: /** @type {any} */ (session), page, answerText, archiveFlag: input.archiveFlag });
            }
            return withAnswerArtifact({
                ok: true,
                vendor,
                status: 'complete',
                url: page.url(),
                ...(session ? { sessionId: session.sessionId } : {}),
                answerText,
                baseline,
                usedFallbacks: ['copy-markdown'],
                warnings: [],
                ...(traceSummary ? { traceSummary } : {}),
                responseStableMs: Date.now() - stableSince,
            });
        }
        const timedOutSession = session ? markSessionTimeout(session.sessionId, {
            lastError: { errorCode: 'provider.poll-timeout', message: 'timed out waiting for answer' },
        }) : null;
        return {
            ok: false,
            vendor,
            status: 'timeout',
            url: page.url(),
            ...(session ? { sessionId: session.sessionId } : {}),
            ...(timedOutSession?.deadlineAt ? { deadlineAt: timedOutSession.deadlineAt } : {}),
            ...(timedOutSession?.conversationUrl ? { conversationUrl: timedOutSession.conversationUrl } : {}),
            baseline,
            ...(traceSummary ? { traceSummary } : {}),
            warnings: [`copy-markdown-fallback-unavailable:${(/** @type {any} */ (copied)).status || 'unknown'}`],
            usedFallbacks: [],
            recoverable: true,
            retryHint: 'poll-or-resume',
            error: 'timed out waiting for answer',
        };
    }
    const timedOutSession = session ? markSessionTimeout(session.sessionId, {
        lastError: { errorCode: 'provider.poll-timeout', message: 'timed out waiting for answer' },
    }) : null;
    return {
        ok: false,
        vendor,
        status: 'timeout',
        url: page.url(),
        ...(session ? { sessionId: session.sessionId } : {}),
        ...(timedOutSession?.deadlineAt ? { deadlineAt: timedOutSession.deadlineAt } : {}),
        ...(timedOutSession?.conversationUrl ? { conversationUrl: timedOutSession.conversationUrl } : {}),
        baseline,
        warnings: [],
        usedFallbacks: [],
        recoverable: true,
        retryHint: 'poll-or-resume',
        error: 'timed out waiting for answer',
    };
}

/**
 * @param {any} page
 * @returns {Promise<import('./chatgpt-response-dom.mjs').ChatGptActivityState>}
 */
async function readActivityState(page) {
    // The composer-scoped stop probe runs FIRST: it is the strongest, cheapest
    // signal, and a page double whose `evaluate` cannot honor the options object
    // would otherwise report `none` while a stop button is plainly visible.
    try {
        if (await anyStopButtonVisible(page)) return { strength: 'strong', evidence: 'stop-button' };
    } catch { /* fall through to the DOM probe */ }
    try {
        const state = await page.evaluate(
            readChatGptStreamingState,
            {
                assistantSelectors: CHATGPT_ASSISTANT_SELECTORS,
                stopSelectors: CHATGPT_STOP_SELECTORS,
                resolverSource: resolveTopLevelAssistantTurns.toString(),
            },
        );
        if (state && typeof state === 'object' && typeof state.strength === 'string') return state;
        // A legacy boolean from a stubbed page still means "strong or nothing".
        if (typeof state === 'boolean') {
            return state ? { strength: 'strong', evidence: 'stop-button' } : { strength: 'none', evidence: '' };
        }
    } catch { /* page may be navigating or lack a complete DOM context */ }
    return { strength: 'none', evidence: '' };
}

/**
 * @param {any} page
 */
async function isStreaming(page) {
    return isActiveState(await readActivityState(page));
}

/**
 * @param {any} page
 * @param {import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot | import('./chatgpt-response-dom.mjs').ChatGptCorrelatedSnapshot} sample
 * @param {number} minTurnIndex
 * @returns {Promise<{ finished: boolean, messageId: string|null, turnId: string|null, turnIndex: number }>}
 */
async function isResponseFinished(page, sample, minTurnIndex) {
    try {
        const result = await page.evaluate(
            ({ finishedSelector, sample, minTurnIndex, resolverSource, selectors }) => {
            const resolver = (0, eval)(`(${resolverSource})`);
            const turns = resolver(selectors);
            for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex--) {
                const turn = turns[turnIndex];
                const messageNode = turn.matches?.('[data-message-id]') ? turn : turn.querySelector?.('[data-message-id]');
                const turnNode = turn.matches?.('[data-testid^="conversation-turn"]')
                    ? turn
                    : turn.querySelector?.('[data-testid^="conversation-turn"]');
                const messageId = messageNode?.getAttribute?.('data-message-id') || null;
                const turnId = turnNode?.getAttribute?.('data-testid') || null;
                const hasIdentity = Boolean(sample.messageId || sample.turnId);
                const identityMatches = (!sample.messageId || sample.messageId === messageId)
                    && (!sample.turnId || sample.turnId === turnId);
                if (hasIdentity ? !identityMatches : turnIndex < minTurnIndex) continue;
                return { finished: Boolean(turn.querySelector(finishedSelector)), messageId, turnId, turnIndex };
            }
            return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
        }, {
            finishedSelector: FINISHED_ACTIONS_SELECTOR,
            sample,
            minTurnIndex,
            resolverSource: resolveTopLevelAssistantTurns.toString(),
            selectors: CHATGPT_ASSISTANT_SELECTORS,
        });
        if (result === true) {
            return {
                finished: true,
                messageId: sample.messageId || null,
                turnId: sample.turnId || null,
                turnIndex: sample.turnIndex,
            };
        }
        if (result && typeof result === 'object' && result.turnIndex >= 0) return result;
        // A wrapperless candidate has no turn to carry terminal actions, so
        // completion rests on text stability. The DOM-following filter applied at
        // acquisition is what makes that safe: an old answer or a user echo never
        // becomes a candidate. `in` narrowing keeps the recovery caller — which
        // passes a base snapshot — on the ordinary path.
        if ('source' in sample && sample.source === 'wrapperless') {
            return { finished: true, messageId: null, turnId: null, turnIndex: minTurnIndex };
        }
        return result && typeof result === 'object'
            ? result
            : { finished: false, messageId: null, turnId: null, turnIndex: -1 };
    } catch {
        return { finished: false, messageId: null, turnId: null, turnIndex: -1 };
    }
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function queryWebAi(deps, input = {}) {
    const sent = await sendWebAi(deps, input);
    const result = await pollWebAi(deps, {
        vendor: sent.vendor,
        timeout: input.timeout,
        session: sent.sessionId,
        allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
        outputImage: input.outputImage,
        archiveFlag: input.archiveFlag,
        skipFinalize: input.skipFinalize,
    });
    const resultAny = /** @type {any} */ (result);
    const sentAny = /** @type {any} */ (sent);
    return {
        ...resultAny,
        sessionId: result.sessionId || sent.sessionId,
        ...(resultAny.traceSummary || sentAny.traceSummary ? { traceSummary: resultAny.traceSummary || sentAny.traceSummary } : {}),
        usedFallbacks: [...(sentAny.usedFallbacks || []), ...(resultAny.usedFallbacks || [])],
        warnings: [...(sentAny.warnings || []), ...(resultAny.warnings || [])],
    };
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function deepResearchWebAi(deps, input = {}) {
    const envelope = normalizeEnvelope(input);
    const page = await requireChatGptPage(deps);
    const assistantCount = await countAssistantMessages(page);
    const targetId = await deps.getTargetId?.().catch(() => null) || null;
    const session = createSession(envelope, {
        targetId,
        originalUrl: input.url || page.url(),
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt(input, 'chatgpt'),
        envelopeSummary: { ...summarizeEnvelope(input), assistantCount },
    });
    if (targetId) await recordActiveLease({
        owner: 'web-ai',
        vendor: envelope.vendor,
        sessionType: 'deep-research',
        sessionId: session.sessionId,
        targetId,
        url: page.url(),
        port: deps.getPort?.() || 9222,
    });
    if (targetId) bindSessionToTab(session.sessionId, targetId);
    const timeoutMs = Math.max(1, Number(input.timeout || 1200)) * 1000;
    const selectedTools = await selectChatGptComposerTools(page, { ...input, research: 'deep' });
    const result = await sendDeepResearch(page, deps, {
        prompt: (/** @type {any} */ (envelope)).composerText || input.prompt,
        session,
        timeoutMs,
        skipModeActivation: selectedTools?.selectedTools?.includes('deep-research') === true,
    });
    if (result.ok) {
        const refreshed = getSession(session.sessionId) || session;
        await finalizeProviderTab(deps, {
            vendor: 'chatgpt',
            session: /** @type {any} */ (refreshed),
            page,
            answerText: result.reportText || '',
            artifactText: result.reportText || '',
            warnings: result.warnings || [],
            archiveFlag: input.archiveFlag,
            sessionType: 'deep-research',
        });
    }
    return {
        ...result,
        vendor: envelope.vendor,
        url: page.url(),
        usedFallbacks: [...(selectedTools?.usedFallbacks || [])],
        warnings: [
            ...(result.warnings || []),
            ...(selectedTools?.warnings || []),
            ...(selectedTools?.selectedTools?.length ? [`composer tools selected: ${selectedTools.selectedTools.join(', ')}`] : []),
            ...(selectedTools?.selectedPlugins?.length ? [`composer plugins selected: ${selectedTools.selectedPlugins.join(', ')}`] : []),
        ],
    };
}

/**
 * @param {any} deps
 * @param {any} input
 */
export async function stopWebAi(deps, input = {}) {
    const page = await requireChatGptPage(deps);
    await page.keyboard.press('Escape');
    return { ok: true, vendor: input.vendor || 'chatgpt', status: 'blocked', url: page.url(), warnings: ['sent Escape to stop generation'] };
}

/**
 * @param {any} deps
 */
async function requireChatGptPage(deps) {
    const page = await deps.getPage();
    const url = page.url();
    let host = '';
    try {
        host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
        throw new WebAiError({
            errorCode: 'cdp.target-mismatch',
            stage: 'connect',
            vendor: 'chatgpt',
            retryHint: 'tab-switch',
            message: `active tab has invalid URL: ${url}`,
            evidence: { url },
        });
    }
    if (!CHATGPT_HOSTS.has(host)) {
        throw new WebAiError({
            errorCode: 'cdp.target-mismatch',
            stage: 'connect',
            vendor: 'chatgpt',
            retryHint: 'tab-switch',
            message: `active tab is not ChatGPT: ${url}. Use tabs then tab-switch before web-ai.`,
            evidence: { url, host },
        });
    }
    return page;
}

/**
 * @param {any} page
 * @param {any} traceCtx
 */
async function resolveChatGptComposerTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'composer.fill',
    });
    recordResolverTrace(traceCtx, result, 'composer.fill');
    if (result.ok && (/** @type {any} */ (result.target))?.selector) return result;
    throw new WebAiError({
        errorCode: 'provider.composer-not-visible',
        stage: 'composer-prereq',
        vendor: 'chatgpt',
        retryHint: 're-snapshot',
        message: 'ChatGPT composer target resolver did not find a verified composer',
        selectorsTried: result.intent?.cssFallbacks || [...CHATGPT_COMPOSER_SELECTORS],
        evidence: {
            intentId: result.intent?.intentId || 'composer.fill',
            errorCode: result.errorCode || null,
            attempts: summarizeResolverAttempts(result.attempts),
        },
    });
}

/**
 * @param {any} page
 * @param {any} traceCtx
 */
async function resolveOptionalChatGptSendTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'send.click',
    });
    recordResolverTrace(traceCtx, result, 'send.click');
    if (result.ok && (/** @type {any} */ (result.target))?.selector) return result;
    return result;
}

/**
 * @param {any} page
 * @param {any} traceCtx
 */
async function resolveOptionalChatGptUploadTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'upload.attach',
    });
    recordResolverTrace(traceCtx, result, 'upload.attach');
    if (result.ok && (/** @type {any} */ (result.target))?.selector) return result;
    return result;
}

/**
 * @param {any} page
 * @param {any} traceCtx
 */
async function resolveOptionalChatGptCopyTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'copy.lastResponse',
    });
    recordResolverTrace(traceCtx, result, 'copy.lastResponse');
    if (result.ok && (/** @type {any} */ (result.target))?.selector) return result;
    return result;
}

/**
 * @param {any} attempts
 */
function summarizeResolverAttempts(attempts = []) {
    return attempts.map((/** @type {any} */ attempt) => ({
        source: attempt.source || null,
        selector: attempt.selector || null,
        ref: attempt.ref || null,
        validation: attempt.validation ? {
            ok: attempt.validation.ok === true,
            reason: attempt.validation.reason || null,
            confidence: attempt.validation.confidence ?? null,
            count: attempt.validation.count ?? null,
        } : null,
    }));
}

/**
 * @param {any} traceCtx
 * @param {any} result
 * @param {any} fallbackIntentId
 */
function recordResolverTrace(traceCtx, result, fallbackIntentId) {
    if (!traceCtx || !result) return;
    recordTraceStep(traceCtx, {
        action: 'target-resolve',
        provider: result.intent?.provider || 'chatgpt',
        intentId: result.intent?.intentId || fallbackIntentId,
        operation: result.intent?.operation || null,
        status: result.ok ? 'ok' : 'unresolved',
        target: /** @type {any} */ (scrubResolverTarget(result.target)),
        confidence: result.confidence ?? null,
        resolutionSource: result.resolutionSource || null,
        errorCode: result.errorCode || null,
        attempts: summarizeResolverAttempts(result.attempts),
    });
}

/**
 * @param {any} target
 */
function scrubResolverTarget(target) {
    if (!target) return null;
    return {
        resolution: target.resolution || null,
        source: target.source || null,
        ref: target.ref || null,
        selector: target.selector || null,
        role: target.role || null,
    };
}

/**
 * @param {any} sessionId
 * @param {any} traceCtx
 */
function persistResolverTrace(sessionId, traceCtx) {
    const steps = getSessionTrace(traceCtx);
    if (!steps.length) return null;
    appendTraceToSession(sessionId, steps);
    const session = getSession(sessionId);
    return summarizeTraceSteps(sessionId, /** @type {any} */ (session?.trace?.length ? session.trace : steps));
}

/**
 * @param {any} session
 * @param {any} traceCtx
 */
function persistResolverTraceForSession(session, traceCtx) {
    if (!session?.sessionId || !traceCtx) return null;
    return persistResolverTrace(session.sessionId, traceCtx);
}

/**
 * @param {any} page
 */
async function countAssistantMessages(page) {
    // WRAPPED only: `baseline.assistantCount` is a positional count, and
    // wrapperless blocks are correlated by DOM position instead, so counting them
    // here would make the baseline incomparable across sends.
    //
    // A successful empty read returns 0 — falling back to the legacy locator
    // reader there would count a user turn as an assistant message and shift the
    // baseline by one, silently dropping the next real answer.
    const split = await readAssistantSnapshotsSplit(page);
    if (split.ok) return split.wrapped.length;
    return (await readAssistantMessages(page)).length;
}

/**
 * @param {any} page
 * @param {any} timeoutMs
 */
async function waitForStableAssistantCount(page, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    let previous = -1;
    let stableReads = 0;
    while (Date.now() < deadline) {
        const count = await countAssistantMessages(page).catch(() => 0);
        if (count === previous) stableReads += 1;
        else stableReads = 0;
        previous = count;
        if (stableReads >= 2) return;
        await page.waitForTimeout(500).catch(() => undefined);
    }
}

/**
 * @param {any} page
 */
async function readAssistantMessages(page) {
    const snapshots = await readAssistantSnapshots(page);
    if (snapshots.length) return snapshots.map(sample => cleanAssistantText(sample.text)).filter(Boolean);
    const fallback = await readTopLevelAssistantTextsFromLocators(page, ASSISTANT_SELECTORS);
    return fallback.map(cleanAssistantText).filter(Boolean);
}

/**
 * @param {any} page
 * @returns {Promise<import('./chatgpt-response-dom.mjs').ChatGptAssistantSnapshot[]>}
 */
async function readAssistantSnapshots(page) {
    try {
        let snapshots = await page.evaluate(readTopLevelAssistantSnapshots, ASSISTANT_SELECTORS).catch(() => []);
        if (!Array.isArray(snapshots) || snapshots.length === 0) snapshots = await page.evaluate(
            readTopLevelAssistantSnapshots,
            { selectors: ASSISTANT_SELECTORS, resolverSource: resolveTopLevelAssistantTurns.toString() },
        );
        if (!Array.isArray(snapshots)) return [];
        return snapshots.map((sample, turnIndex) => typeof sample === 'string'
            ? { text: sample, messageId: null, turnId: null, turnIndex }
            : sample);
    } catch {
        return [];
    }
}

/**
 * Read both snapshot sources in ONE page evaluation so they share a document-order
 * coordinate space. Fails closed to empty lists — a probe failure must never look
 * like "no answer yet AND no history", and a PARTIAL result would enter polling
 * with a single coordinate source, which is what the shared pass exists to prevent.
 *
 * @param {any} page
 * @returns {Promise<{ ok: boolean, wrapped: import('./chatgpt-response-dom.mjs').ChatGptCorrelatedSnapshot[], wrapperless: import('./chatgpt-response-dom.mjs').ChatGptCorrelatedSnapshot[] }>}
 */
async function readAssistantSnapshotsSplit(page) {
    // `ok:false` means the acquisition FAILED — distinct from a successful read
    // that found nothing. Only the failure case may fall back to a legacy reader.
    const failed = { ok: false, wrapped: [], wrapperless: [] };
    try {
        const result = await page.evaluate(readAssistantSnapshotSources, {
            assistantSelectors: ASSISTANT_SELECTORS,
            resolverSource: resolveTopLevelAssistantTurns.toString(),
        });
        if (!result || typeof result !== 'object'
            || !Array.isArray(result.wrapped)
            || !Array.isArray(result.wrapperless)) return failed;
        return { ok: result.ok === true, wrapped: result.wrapped, wrapperless: result.wrapperless };
    } catch {
        return failed;
    }
}

/**
 * Image-only assistant turns may never mount text action controls. Collection
 * itself supplies the positive generated-image evidence for this path.
 * @param {any} deps
 * @param {any} input
 * @param {any} session
 * @param {any} baseline
 * @returns {Promise<{ answerText: string, warnings: string[] } | null>}
 */
async function collectGeneratedImageAnswer(deps, input, session, baseline) {
    const cdp = await deps.getCdpSession?.();
    if (!cdp) throw new WebAiError({
        errorCode: 'provider.image-output',
        stage: 'image-output',
        vendor: 'chatgpt',
        retryHint: 'start-headed',
        message: 'CDP session unavailable for explicit generated-image output',
    });
    try {
        const result = await collectImages(cdp, {
            baselineAssistantCount: baseline?.assistantCount || 0,
            outputPath: input.outputImage || null,
            sessionId: input.outputImage ? null : session.sessionId,
            waitTimeoutMs: 60_000,
        });
        if (result.errors?.length) throw new WebAiError({
            errorCode: 'provider.image-output',
            stage: 'image-output',
            vendor: 'chatgpt',
            retryHint: 'check-generated-image-or-disable-output-image',
            message: result.errors.join('; '),
            mutationAllowed: true,
        });
        if (!result.savedPaths.length) return null;
        const label = result.images.length === 1
            ? 'Generated image.'
            : `Generated ${result.images.length} images.`;
        return { answerText: label + result.markdownSuffix, warnings: result.warnings || [] };
    } finally {
        await cdp.detach?.().catch(() => undefined);
    }
}

/**
 * @param {{ vendor: string, page: any, session: any, baseline: any, answerText: string, usedFallbacks: string[], warning: string, streamingState: string }} input
 */
function buildDeferredPollingResult({ vendor, page, session, baseline, answerText, usedFallbacks, warning, streamingState }) {
    const current = getSession(session.sessionId) || session;
    updateSession(session.sessionId, {
        status: 'polling',
        answer: null,
        completedAt: null,
        lastStreamingState: streamingState,
        warnings: appendUniqueWarningLocal(current.warnings || [], warning),
    });
    return {
        ok: true,
        vendor,
        status: 'polling',
        url: page.url(),
        sessionId: session.sessionId,
        answerText,
        baseline,
        usedFallbacks,
        warnings: [warning],
        recoverable: true,
        retryHint: 'watch-or-poll',
    };
}

/**
 * @param {any[]} warnings
 * @param {string} warning
 */
function appendUniqueWarningLocal(warnings, warning) {
    return warnings.includes(warning) ? warnings : [...warnings, warning];
}

/**
 * @param {string|null|undefined} url
 */
function extractConversationId(url) {
    if (!url) return null;
    const match = url.match(/\/c\/([a-f0-9-]+)/);
    return match ? match[1] : null;
}

/** @param {any} text */
function isFinalAnswer(text) {
    return !PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * @param {any} text
 */
function cleanAssistantText(text) {
    return String(text || '')
        .replace(/^Thought for\s+[\dm\s]+s(?:econds?)?\s*/i, '')
        .trim();
}

/**
 * @param {any} contextPack
 */
function summarizeContextPack(contextPack) {
    const summary = {
        files: (contextPack.files || []).map((/** @type {any} */ file) => ({
            relativePath: file.relativePath,
            sizeBytes: file.sizeBytes,
            estimatedTokens: file.estimatedTokens,
        })),
        excluded: contextPack.excluded,
        budget: contextPack.budget,
    };
    if (contextPack.contextTransform !== 'repomix') return summary;
    return {
        ...summary,
        transport: contextPack.transport,
        contextTransform: 'repomix',
        attachments: (contextPack.attachments || []).map((/** @type {any} */ attachment) => ({
            displayPath: attachment.displayPath,
            sizeBytes: attachment.sizeBytes,
        })),
        ...(contextPack.repomix ? { repomix: contextPack.repomix } : {}),
    };
}
