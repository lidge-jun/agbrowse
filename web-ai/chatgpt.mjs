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
    resolveDeadlineAt,
    saveBaseline,
    sessionToBaseline,
    summarizeEnvelope,
    updateSession,
} from './session.mjs';
import { WebAiError } from './errors.mjs';
import { finalizeProviderTab } from './tab-finalizer.mjs';
import { recordActiveLease } from './tab-lease-store.mjs';
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';
import {
    attachLocalFileLive,
    fileInfoFromPath,
    verifySentTurnAttachmentLive,
} from './chatgpt-attachments.mjs';
import { selectChatGptModel, chatGptModelCapabilityProbe } from './chatgpt-model.mjs';
import { prepareContextForBrowser } from './context-pack/index.mjs';
import { captureCopiedResponseText, CHATGPT_COPY_SELECTORS, preferCopiedText } from './copy-markdown.mjs';
import { withAnswerArtifact } from './answer-artifact.mjs';
import { resolveTargetForIntent } from './target-resolver.mjs';
import { createTraceContext, getSessionTrace, recordTraceStep, summarizeTraceSteps } from './action-trace.mjs';
import { appendTraceToSession } from './trace-persistence.mjs';

const CHATGPT_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);
const ASSISTANT_SELECTORS = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    'article[data-testid^="conversation-turn"]',
];
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
    /^\s*$/,
];

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

const CHATGPT_UPLOAD_SELECTORS = [
    'button[aria-label*="Upload" i]',
    'button[aria-label*="Attach" i]',
    'button[data-testid*="plus" i]',
];
const CHATGPT_STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[aria-label*="Stop" i]',
];

export const chatGptCapabilities = [
    defineCapability('chatgpt-active-tab-verification', async (deps) => probeHostMatches(await deps.getPage(), CHATGPT_HOSTS)),
    defineCapability('chatgpt-composer-visible', async (deps) => probeFirstVisibleSelector(await deps.getPage(), CHATGPT_COMPOSER_SELECTORS)),
    defineCapability('chatgpt-model-alias-selectable', async (deps, input) => chatGptModelCapabilityProbe(await deps.getPage(), input.model, { effort: input.reasoningEffort })),
    defineCapability('chatgpt-upload-surface-visible', async (deps, input) => {
        if (!input.filePath && input.inlineOnly !== false) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), CHATGPT_UPLOAD_SELECTORS, { failNext: 'inline-only' });
    }),
    defineCapability('chatgpt-copy-button-present', async (deps, input) => {
        if (!input.allowCopyMarkdownFallback) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        return probeFirstVisibleSelector(await deps.getPage(), CHATGPT_COPY_SELECTORS.copyButtonSelectors, { timeoutMs: 500, failNext: 'send', failState: 'warn' });
    }),
    defineCapability('chatgpt-response-streaming', async (deps) => {
        const page = await deps.getPage();
        for (const sel of CHATGPT_STOP_SELECTORS) {
            if (await page.locator(sel).first().isVisible().catch(() => false)) {
                return { state: 'warn', evidence: { streaming: true, selector: sel }, next: 'poll' };
            }
        }
        return { state: 'ok', evidence: { streaming: false }, next: 'send' };
    }),
];

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

export async function sendWebAi(deps, input = {}) {
    const envelope = normalizeEnvelope(input);
    if (input.url) {
        const page = await deps.getPage();
        await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    const page = await requireChatGptPage(deps);
    const contextPack = await prepareContextForBrowser(input);
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(envelope, contextPack.composerText)
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelope(envelope);
    const selectedModel = await selectChatGptModel(page, input.model, { effort: input.reasoningEffort });
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
    if (targetId) bindSessionToTab(session.sessionId, targetId);
    if (targetId) await recordActiveLease({
        owner: 'web-ai',
        vendor: envelope.vendor,
        sessionType: 'send-poll',
        sessionId: session.sessionId,
        targetId,
        url: page.url(),
        port: deps.getPort?.() || 9222,
    });

    const editorOptions = {
        insertText: async (text) => {
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
    await readinessAdapter.waitForReady();
    const traceCtx = createTraceContext(session.sessionId);
    let tracePersisted = false;
    try {
        const composerResolution = await resolveChatGptComposerTarget(page, traceCtx);
        const adapter = createChatGptEditorAdapter(page, {
            ...editorOptions,
            composerTarget: composerResolution.target,
        });
        const commitBaseline = await adapter.getCommitBaseline();
        await adapter.insertPrompt(rendered.composerText);
        let attachmentWarnings = [];
        let usedFallbacks = [];
        const contextAttachmentPath = contextPack?.attachments?.[0]?.path;
        if (contextAttachmentPath && input.filePath) {
            throw new WebAiError({
                errorCode: 'provider.attachment-preflight',
                stage: 'attachment-preflight',
                vendor: 'chatgpt',
                retryHint: 'inline-only-or-file',
                message: 'context package upload and --file upload cannot be combined yet',
            });
        }
        const uploadPath = input.filePath || contextAttachmentPath;
        if (uploadPath) {
            const uploadResolution = await resolveOptionalChatGptUploadTarget(page, traceCtx);
            const upload = await attachLocalFileLive(page, fileInfoFromPath(uploadPath), {
                uploadTarget: uploadResolution?.target || null,
            });
            if (!upload.ok) throw new WebAiError({
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
        const sendResolution = await resolveOptionalChatGptSendTarget(page, traceCtx);
        await adapter.submitPrompt({
            sendTarget: sendResolution?.target || null,
        });
        await adapter.verifyPromptCommitted(rendered.composerText, commitBaseline);
        if (uploadPath) {
            const sentAttachment = await verifySentTurnAttachmentLive(page, fileInfoFromPath(uploadPath));
            if (!sentAttachment.ok) throw new WebAiError({
                errorCode: 'provider.attachment-evidence-missing',
                stage: 'attachment-verify',
                vendor: 'chatgpt',
                retryHint: 're-upload',
                message: sentAttachment.error,
                mutationAllowed: true,
            });
        }
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
            usedFallbacks: [...usedFallbacks, ...(selectedModel?.usedFallbacks || [])],
            ...(traceSummary ? { traceSummary } : {}),
            contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
            warnings: [
                ...rendered.warnings,
                ...(contextPack?.warnings || []),
                ...(contextAttachmentPath ? [`context package attached: ${contextPack.attachments[0].displayPath}`] : []),
                ...attachmentWarnings,
                ...(selectedModel ? [`model selected: ${selectedModel.selected}${selectedModel.alreadySelected ? ' (already selected)' : ''}`] : []),
                ...(selectedModel?.effort ? [`reasoning effort selected: ${selectedModel.effort}`] : []),
            ],
        };
    } finally {
        if (!tracePersisted) persistResolverTrace(session.sessionId, traceCtx);
    }
}

export async function pollWebAi(deps, input = {}) {
    const vendor = input.vendor || 'chatgpt';
    const timeout = Math.max(1, Number(input.timeout || 1200));
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
        || getLatestBaseline(vendor, { sameHostUrl: url })
        || getLatestBaseline(vendor);
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
    let stableText = '';
    let stableSince = 0;
    while (Date.now() <= deadline) {
        const answers = await readAssistantMessages(page);
        const newAnswers = answers.slice(baseline.assistantCount).filter(isFinalAnswer);
        const latest = newAnswers.at(-1) || '';
        const streaming = await isStreaming(page);
        if (latest && !streaming) {
            if (latest === stableText) {
                if (Date.now() - stableSince >= 1500) {
                    const usedFallbacks = [];
                    const warnings = [];
                    let answerText = latest;
                    let traceSummary = null;
                    if (input.allowCopyMarkdownFallback === true) {
                        const copyResolution = await resolveOptionalChatGptCopyTarget(page, copyTraceCtx);
                        const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
                            copyTarget: copyResolution?.target || null,
                        });
                        traceSummary = persistResolverTraceForSession(session, copyTraceCtx);
                        const copiedText = preferCopiedText(latest, copied);
                        if (copiedText) {
                            answerText = cleanAssistantText(copiedText);
                            usedFallbacks.push('copy-markdown');
                        } else {
                            warnings.push(`copy-markdown-fallback-unavailable:${copied.status || 'unknown'}`);
                        }
                    }
                    if (session) {
                        await finalizeProviderTab(deps, { vendor, session, page, answerText, warnings });
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
                stableSince = Date.now();
            }
        } else {
            stableText = '';
            stableSince = 0;
        }
        await page.waitForTimeout(500);
    }

    if (input.allowCopyMarkdownFallback === true && stableText) {
        const copyResolution = await resolveOptionalChatGptCopyTarget(page, copyTraceCtx);
        const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS, {
            copyTarget: copyResolution?.target || null,
        });
        const traceSummary = persistResolverTraceForSession(session, copyTraceCtx);
        const copiedText = preferCopiedText(stableText, copied);
        if (copiedText) {
            const answerText = cleanAssistantText(copiedText);
            if (session) {
                await finalizeProviderTab(deps, { vendor, session, page, answerText });
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
            });
        }
        if (session) updateSession(session.sessionId, { status: 'timeout' });
        return {
            ok: false,
            vendor,
            status: 'timeout',
            url: page.url(),
            ...(session ? { sessionId: session.sessionId } : {}),
            baseline,
            ...(traceSummary ? { traceSummary } : {}),
            warnings: [`copy-markdown-fallback-unavailable:${copied.status || 'unknown'}`],
            usedFallbacks: [],
            error: 'timed out waiting for answer',
        };
    }
    if (session) updateSession(session.sessionId, { status: 'timeout' });
    return { ok: false, vendor, status: 'timeout', url: page.url(), ...(session ? { sessionId: session.sessionId } : {}), baseline, warnings: [], usedFallbacks: [], error: 'timed out waiting for answer' };
}

async function isStreaming(page) {
    for (const selector of ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]']) {
        const first = page.locator(selector).first();
        if (typeof first.isVisible === 'function' && await first.isVisible().catch(() => false)) return true;
    }
    return false;
}

export async function queryWebAi(deps, input = {}) {
    const sent = await sendWebAi(deps, input);
    const result = await pollWebAi(deps, {
        vendor: sent.vendor,
        timeout: input.timeout,
        session: sent.sessionId,
        allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
    });
    return {
        ...result,
        sessionId: result.sessionId || sent.sessionId,
        ...(result.traceSummary || sent.traceSummary ? { traceSummary: result.traceSummary || sent.traceSummary } : {}),
        usedFallbacks: [...(sent.usedFallbacks || []), ...(result.usedFallbacks || [])],
        warnings: [...(sent.warnings || []), ...(result.warnings || [])],
    };
}

export async function stopWebAi(deps, input = {}) {
    const page = await requireChatGptPage(deps);
    await page.keyboard.press('Escape');
    return { ok: true, vendor: input.vendor || 'chatgpt', status: 'blocked', url: page.url(), warnings: ['sent Escape to stop generation'] };
}

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

async function resolveChatGptComposerTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'composer.fill',
    });
    recordResolverTrace(traceCtx, result, 'composer.fill');
    if (result.ok && result.target?.selector) return result;
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

async function resolveOptionalChatGptSendTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'send.click',
    });
    recordResolverTrace(traceCtx, result, 'send.click');
    if (result.ok && result.target?.selector) return result;
    return result;
}

async function resolveOptionalChatGptUploadTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'upload.attach',
    });
    recordResolverTrace(traceCtx, result, 'upload.attach');
    if (result.ok && result.target?.selector) return result;
    return result;
}

async function resolveOptionalChatGptCopyTarget(page, traceCtx = null) {
    const result = await resolveTargetForIntent(page, {
        provider: 'chatgpt',
        intentId: 'copy.lastResponse',
    });
    recordResolverTrace(traceCtx, result, 'copy.lastResponse');
    if (result.ok && result.target?.selector) return result;
    return result;
}

function summarizeResolverAttempts(attempts = []) {
    return attempts.map(attempt => ({
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

function recordResolverTrace(traceCtx, result, fallbackIntentId) {
    if (!traceCtx || !result) return;
    recordTraceStep(traceCtx, {
        action: 'target-resolve',
        provider: result.intent?.provider || 'chatgpt',
        intentId: result.intent?.intentId || fallbackIntentId,
        operation: result.intent?.operation || null,
        status: result.ok ? 'ok' : 'unresolved',
        target: scrubResolverTarget(result.target),
        confidence: result.confidence ?? null,
        resolutionSource: result.resolutionSource || null,
        errorCode: result.errorCode || null,
        attempts: summarizeResolverAttempts(result.attempts),
    });
}

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

function persistResolverTrace(sessionId, traceCtx) {
    const steps = getSessionTrace(traceCtx);
    if (!steps.length) return null;
    appendTraceToSession(sessionId, steps);
    const session = getSession(sessionId);
    return summarizeTraceSteps(sessionId, session?.trace?.length ? session.trace : steps);
}

function persistResolverTraceForSession(session, traceCtx) {
    if (!session?.sessionId || !traceCtx) return null;
    return persistResolverTrace(session.sessionId, traceCtx);
}

async function countAssistantMessages(page) {
    return (await readAssistantMessages(page)).length;
}

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

async function readAssistantMessages(page) {
    const evaluated = await page.evaluate((selectors) => {
        for (const selector of selectors) {
            const texts = Array.from(document.querySelectorAll(selector))
                .map(el => String(el.innerText || el.textContent || '').trim())
                .filter(Boolean);
            if (texts.length) return texts;
        }
        return [];
    }, ASSISTANT_SELECTORS).catch(() => []);
    if (Array.isArray(evaluated) && evaluated.length) return evaluated.map(cleanAssistantText).filter(Boolean);

    const messages = [];
    for (const selector of ASSISTANT_SELECTORS) {
        const locators = await page.locator(selector).all().catch(() => []);
        for (const locator of locators) {
            const text = cleanAssistantText(await locator.innerText().catch(() => ''));
            if (text) messages.push(text);
        }
        if (messages.length > 0) break;
    }
    return messages;
}

function isFinalAnswer(text) {
    return !PLACEHOLDER_PATTERNS.some(pattern => pattern.test(text));
}

function cleanAssistantText(text) {
    return String(text || '')
        .replace(/^Thought for\s+\d+s\s*/i, '')
        .trim();
}

function summarizeContextPack(contextPack) {
    return {
        files: contextPack.files.map(file => ({
            relativePath: file.relativePath,
            sizeBytes: file.sizeBytes,
            estimatedTokens: file.estimatedTokens,
        })),
        excluded: contextPack.excluded,
        budget: contextPack.budget,
    };
}
