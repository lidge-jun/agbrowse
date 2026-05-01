import { renderQuestionEnvelope, renderQuestionEnvelopeWithContext, normalizeEnvelope } from './question.mjs';
import { defineCapability, probeFirstVisibleSelector, probeHostMatches, runCapabilities, worstCapabilityState } from './capability.mjs';
import { INPUT_SELECTORS as CHATGPT_COMPOSER_SELECTORS } from './chatgpt-composer.mjs';
import {
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
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';
import {
    attachLocalFileLive,
    fileInfoFromPath,
    verifySentTurnAttachmentLive,
} from './chatgpt-attachments.mjs';
import { selectChatGptModel } from './chatgpt-model.mjs';
import { prepareContextForBrowser } from './context-pack/index.mjs';
import { captureCopiedResponseText, CHATGPT_COPY_SELECTORS, preferCopiedText } from './copy-markdown.mjs';

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

export const chatGptCapabilities = [
    defineCapability('chatgpt-active-tab-verification', async (deps) => probeHostMatches(await deps.getPage(), CHATGPT_HOSTS)),
    defineCapability('chatgpt-composer-visible', async (deps) => probeFirstVisibleSelector(await deps.getPage(), CHATGPT_COMPOSER_SELECTORS)),
];

export async function statusWebAi(deps, input = {}) {
    const page = await requireChatGptPage(deps);
    const capabilities = await runCapabilities(deps, chatGptCapabilities, input);
    const worst = worstCapabilityState(capabilities);
    return {
        ok: worst !== 'fail',
        vendor: input.vendor || 'chatgpt',
        status: 'ready',
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
    const selectedModel = await selectChatGptModel(page, input.model);
    await waitForStableAssistantCount(page);
    const assistantCount = await countAssistantMessages(page);
    const baseline = saveBaseline({
        vendor: envelope.vendor,
        url: page.url(),
        envelope,
        assistantCount,
        textHash: String((await page.innerText('body').catch(() => '')).length),
    });
    const session = createSession(envelope, {
        targetId: await deps.getTargetId?.().catch(() => null) || null,
        originalUrl: input.url || page.url(),
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt(input, 'chatgpt'),
        envelopeSummary: { ...summarizeEnvelope(input, contextPack), assistantCount },
    });

    const adapter = createChatGptEditorAdapter(page, {
        insertText: async (text) => {
            const cdp = await deps.getCdpSession?.();
            if (!cdp) throw new Error('CDP session unavailable for Input.insertText');
            try {
                await cdp.send('Input.insertText', { text });
            } finally {
                await cdp.detach?.().catch(() => undefined);
            }
        },
    });
    await adapter.waitForReady();
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
        const upload = await attachLocalFileLive(page, fileInfoFromPath(uploadPath));
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
    await adapter.submitPrompt();
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
    return {
        ok: true,
        vendor: envelope.vendor,
        status: 'sent',
        url: finalUrl,
        sessionId: session.sessionId,
        baseline,
        usedFallbacks: [...usedFallbacks, ...(selectedModel?.usedFallbacks || [])],
        contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
        warnings: [
            ...rendered.warnings,
            ...(contextPack?.warnings || []),
            ...(contextAttachmentPath ? [`context package attached: ${contextPack.attachments[0].displayPath}`] : []),
            ...attachmentWarnings,
            ...(selectedModel ? [`model selected: ${selectedModel.selected}${selectedModel.alreadySelected ? ' (already selected)' : ''}`] : []),
        ],
    };
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
                    if (input.allowCopyMarkdownFallback === true) {
                        const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS);
                        const copiedText = preferCopiedText(latest, copied);
                        if (copiedText) {
                            answerText = cleanAssistantText(copiedText);
                            usedFallbacks.push('copy-markdown');
                        } else {
                            warnings.push(`copy-markdown-fallback-unavailable:${copied.status || 'unknown'}`);
                        }
                    }
                    if (session) updateSession(session.sessionId, { status: 'complete', conversationUrl: page.url(), answer: answerText });
                    return {
                        ok: true,
                        vendor,
                        status: 'complete',
                        url: page.url(),
                        ...(session ? { sessionId: session.sessionId } : {}),
                        answerText,
                        baseline,
                        usedFallbacks,
                        warnings,
                    };
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
        const copied = await captureCopiedResponseText(page, CHATGPT_COPY_SELECTORS);
        const copiedText = preferCopiedText(stableText, copied);
        if (copiedText) {
            const answerText = cleanAssistantText(copiedText);
            if (session) updateSession(session.sessionId, { status: 'complete', conversationUrl: page.url(), answer: answerText });
            return {
                ok: true,
                vendor,
                status: 'complete',
                url: page.url(),
                ...(session ? { sessionId: session.sessionId } : {}),
                answerText,
                baseline,
                usedFallbacks: ['copy-markdown'],
                warnings: [],
            };
        }
        if (session) updateSession(session.sessionId, { status: 'timeout' });
        return {
            ok: false,
            vendor,
            status: 'timeout',
            url: page.url(),
            ...(session ? { sessionId: session.sessionId } : {}),
            baseline,
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
