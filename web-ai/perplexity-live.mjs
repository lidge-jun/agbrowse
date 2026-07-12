// @ts-check
/** @typedef {any} Deps */
/** @typedef {Record<string, any>} Input */
/** @typedef {import('playwright-core').Page} Page */
/** @typedef {import('playwright-core').Locator} Locator */

import { normalizeEnvelope, renderQuestionEnvelope, renderQuestionEnvelopeWithContext } from './question.mjs';
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
import { hasContextPackaging, prepareContextForBrowser } from './context-pack/index.mjs';
import { WebAiError, optionConflictError, providerError } from './errors.mjs';
import { finalizeProviderTab } from './tab-finalizer.mjs';
import { recordActiveLease } from './tab-lease-store.mjs';
import {
    defineCapability,
    probeFirstVisibleSelector,
    probeHostMatches,
    runCapabilities,
    worstCapabilityState,
} from './capability.mjs';
import { fileInfoFromPath } from './chatgpt-attachments.mjs';
import { createAnswerArtifact, withAnswerArtifact } from './answer-artifact.mjs';
import {
    inspectPerplexityModels,
    normalizePerplexityEffort,
    selectPerplexityModel,
    validatePerplexitySelectionRequest,
} from './perplexity-model.mjs';
import {
    normalizePerplexityCitations,
    perplexityCitationFingerprint,
    readPerplexityCitationCandidates,
} from './perplexity-citations.mjs';
import {
    isProviderOriginUrl,
    isSafePerplexityConversationUrl,
    perplexityConversationId,
} from './provider-url-identity.mjs';
import { isPageDeathError } from './tab-recovery.mjs';

export const PERPLEXITY_DEFAULT_URL = 'https://www.perplexity.ai/';
export const PERPLEXITY_CITATION_GRACE_MS = 2000;
const RESPONSE_STABLE_MS = 1500;
const CITATION_STABLE_MS = 500;
const PERPLEXITY_HOSTS = new Set(['perplexity.ai', 'www.perplexity.ai']);
const COMPOSER_SELECTOR = '#ask-input';
const COMMITTED_RESPONSE_ROOT_XPATH = [
    'xpath=ancestor::*[',
    './/button[(normalize-space(.)="Copy" or @aria-label="Copy")]',
    ' and .//button[',
    'contains(translate(normalize-space(.), "SOURCES", "sources"), "sources")',
    ' or contains(translate(@aria-label, "SOURCES", "sources"), "sources")',
    ']',
    ' and (.//button[normalize-space(.)="Share" or @aria-label="Share"]',
    ' or .//button[normalize-space(.)="Rewrite Session" or @aria-label="Rewrite Session"])',
    ' and (.//p or .//*[@data-answer-text])',
    '][1]',
].join('');
const USER_TURN_SELECTORS = [
    '[data-testid="user-message"]',
    '[data-testid="query"]',
    '[data-query="true"]',
];
const STOP_SELECTOR = 'button[aria-label="Stop response (Esc)"]';
const COPY_SELECTOR = 'button[aria-label="Copy"], button:has-text("Copy")';
const SUBMIT_SELECTOR = 'button[aria-label="Submit"]';
const ADD_FILES_BUTTON_NAME = 'Add files or tools';
const UPLOAD_MENU_ITEM_NAME = 'Upload files or images';
const SOURCE_COUNT_RE = /^\s*\d+\s*(?:sources?|소스|개\s*출처|출처)\s*$/i;
const SOURCE_TOGGLE_RE = /^\s*(?:Sources|소스)(?:\s+\d+)?\s*$/i;

export const perplexityCapabilities = [
    defineCapability('perplexity-active-tab-verification', async (/** @type {Deps} */ deps) => probeHostMatches(await deps.getPage(), PERPLEXITY_HOSTS)),
    defineCapability('perplexity-composer-visible', async (/** @type {Deps} */ deps) => probeFirstVisibleSelector(await deps.getPage(), [COMPOSER_SELECTOR])),
    defineCapability('perplexity-model-alias-selectable', async (/** @type {Deps} */ deps, /** @type {Input} */ input) => {
        try {
            const request = validatePerplexitySelectionRequest(input.model, input.reasoningEffort ?? input.effort);
            return { state: 'ok', evidence: { requestedModel: request.requestedModel, requestedThinking: request.requestedThinking }, next: 'send' };
        } catch (error) {
            return { state: 'fail', evidence: { errorCode: /** @type {any} */ (error)?.errorCode || 'provider.model-mismatch' }, next: 'model-fallback' };
        }
    }),
    defineCapability('perplexity-upload-surface-visible', async (/** @type {Deps} */ deps, /** @type {Input} */ input) => {
        if (!input.filePath && !input.filePaths?.length && input.inlineOnly !== false) return { state: 'unknown', evidence: { required: false }, next: 'send' };
        const page = await deps.getPage();
        return probeNamedButton(page, ADD_FILES_BUTTON_NAME);
    }),
    defineCapability('perplexity-copy-button-present', async (/** @type {Deps} */ deps) => probeFirstVisibleSelector(await deps.getPage(), [COPY_SELECTOR], { timeoutMs: 500, failNext: 'poll', failState: 'warn' })),
    defineCapability('perplexity-response-streaming', async (/** @type {Deps} */ deps) => {
        const state = await probePerplexityStreamingState(await deps.getPage());
        return state === 'streaming'
            ? { state: 'warn', evidence: { streaming: true, selector: STOP_SELECTOR }, next: 'poll' }
            : state === 'idle'
                ? { state: 'ok', evidence: { streaming: false }, next: 'send' }
                : { state: 'unknown', evidence: { streaming: null }, next: 'poll' };
    }),
];

/**
 * Reject unsupported Perplexity V1 options before Page acquisition.
 * @param {Input} [input]
 */
export function validatePerplexityUnsupportedFeatures(input = {}) {
    if (input.reasoningEffort != null && input.effort != null) {
        const canonicalReasoningEffort = normalizePerplexityEffort(input.reasoningEffort);
        const canonicalEffort = normalizePerplexityEffort(input.effort);
        if (canonicalReasoningEffort !== canonicalEffort) {
            throw optionConflictError('perplexity', 'reasoning-effort', input.reasoningEffort, input.effort, {
                canonicalReasoningEffort,
                canonicalEffort,
            });
        }
    }
    const rejected = [
        ['tools', Array.isArray(input.tools) ? input.tools.length > 0 : Boolean(input.tools)],
        ['plugins', Array.isArray(input.plugins) ? input.plugins.length > 0 : Boolean(input.plugins)],
        ['webSearch', input.webSearch === true],
        ['autoTools', input.autoTools === true],
        ['outputImage', Boolean(input.outputImage)],
        ['followUps', Array.isArray(input.followUps) ? input.followUps.length > 0 : Boolean(input.followUps)],
        ['research', String(input.research || '').toLowerCase() === 'deep'],
        ['space', Boolean(input.space || input.spaceId)],
        ['focus', Boolean(input.focus || input.focusMode)],
        ['filePaths', Array.isArray(input.filePaths) && input.filePaths.length > 1],
    ];
    const unsupported = rejected.find(([, enabled]) => enabled);
    if (unsupported) {
        throw providerError('perplexity', {
            errorCode: 'capability.unsupported',
            stage: 'provider-input-validation',
            retryHint: 'remove-unsupported-option',
            message: `Perplexity V1 does not support ${unsupported[0]}`,
            mutationAllowed: false,
            evidence: { feature: unsupported[0] },
        });
    }
}

/** @param {Deps} deps @param {Input} [input] */
export async function perplexityStatusWebAi(deps, input = {}) {
    validatePerplexityUnsupportedFeatures(input);
    validatePerplexitySelectionRequest(input.model, input.reasoningEffort ?? input.effort);
    const page = await deps.getPage();
    verifyPerplexityHost(page);
    const capabilities = await runCapabilities(deps, perplexityCapabilities, input);
    const worst = worstCapabilityState(capabilities);
    const modelOptions = await inspectPerplexityModels(page);
    return {
        ok: worst !== 'fail',
        vendor: 'perplexity',
        status: worst === 'fail' ? 'blocked' : 'ready',
        url: page.url(),
        modelOptions,
        capabilities,
        warnings: [],
    };
}

/** @param {Deps} deps @param {Input} [input] */
export async function perplexitySendWebAi(deps, input = {}) {
    const effort = input.reasoningEffort ?? input.effort;
    const selectionRequest = validatePerplexitySelectionRequest(input.model, effort);
    validatePerplexityUnsupportedFeatures(input);
    const envelope = normalizeEnvelope({ ...input, vendor: 'perplexity' });

    const contextPack = hasContextPackaging(input)
        ? await prepareContextForBrowser({ ...input, vendor: 'perplexity' })
        : null;
    if (contextPack?.attachments?.[0] && input.filePath) {
        throw providerError('perplexity', {
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            retryHint: 'inline-only-or-file',
            message: 'context package upload and --file cannot be combined',
            mutationAllowed: false,
        });
    }
    const rendered = contextPack
        ? contextPack.transport === 'inline'
            ? renderQuestionEnvelopeWithContext(envelope, contextPack.composerText)
            : renderQuestionEnvelope(envelope)
        : renderQuestionEnvelope(envelope);
    const warnings = [...rendered.warnings, ...(contextPack?.warnings || [])];
    /** @type {string[]} */
    const usedFallbacks = [];

    const targetId = await deps.getTargetId?.().catch(() => null) || null;
    if (!targetId) {
        throw new WebAiError({
            errorCode: 'cdp.target-mismatch',
            stage: 'target-resolution',
            vendor: 'perplexity',
            retryHint: 'tab-switch',
            message: 'Perplexity send requires a managed target ID',
            mutationAllowed: false,
        });
    }

    const page = await deps.getPage();
    verifyPerplexityHost(page);
    if (!input.session) await openFreshPerplexityThread(page);
    verifyPerplexityHost(page);
    await dismissPerplexityBlockingOverlay(page);
    const composer = await resolvePerplexityComposer(page);
    const modelSelection = await selectPerplexityModel(page, selectionRequest);
    await insertPerplexityPrompt(composer, rendered.composerText);
    const upload = await attachAndVerifyPerplexityFile(page, input, contextPack);
    const captured = await capturePerplexityBaseline(page);
    await submitPerplexityPrompt(page);
    await verifyPerplexityCommit(page, { baseline: captured, attachment: upload });

    const baseline = {
        ...saveBaseline({
            vendor: 'perplexity',
            url: captured.url,
            envelope,
            assistantCount: captured.responseCount,
            textHash: captured.textHash,
        }),
        userCount: captured.userCount,
    };
    const session = createSession(envelope, {
        vendor: 'perplexity',
        targetId,
        originalUrl: captured.url,
        conversationUrl: page.url(),
        deadlineAt: resolveDeadlineAt({ ...input, reasoningEffort: selectionRequest.requestedThinking }, 'perplexity'),
        envelopeSummary: {
            ...summarizeEnvelope(input, contextPack),
            assistantCount: captured.responseCount,
            userCount: captured.userCount,
            model: modelSelection?.resolvedModel ?? input.model ?? null,
            reasoningEffort: modelSelection?.thinking ?? effort ?? null,
        },
    });
    updateSession(session.sessionId, { modelSelection });
    await recordActiveLease({
        owner: 'web-ai', vendor: 'perplexity', sessionType: 'send-poll',
        sessionId: session.sessionId, targetId, url: page.url(), port: deps.getPort?.() || 9222,
    });
    bindSessionToTab(session.sessionId, targetId);
    return {
        ok: true,
        vendor: 'perplexity',
        status: 'sent',
        url: page.url(),
        sessionId: session.sessionId,
        baseline,
        modelSelection,
        contextPack: contextPack ? summarizeContextPack(contextPack) : undefined,
        warnings,
        usedFallbacks,
    };
}

/** @param {Deps} deps @param {Input} [input] */
export async function perplexityPollWebAi(deps, input = {}) {
    const page = await deps.getPage();
    verifyPerplexityHost(page);
    const targetId = await deps.getTargetId?.().catch(() => null) || null;
    const session = input.session
        ? getSession(input.session)
        : findActiveSession({ vendor: 'perplexity', targetId, conversationUrl: page.url() });
    const baseline = (session && { ...sessionToBaseline(session), userCount: Number(session.envelopeSummary?.userCount) || 0 })
        || getBaseline('perplexity', page.url())
        || getLatestBaseline('perplexity', { sameHostUrl: page.url() });
    if (!baseline) {
        throw providerError('perplexity', {
            errorCode: 'provider.poll-timeout', stage: 'poll', retryHint: 'poll-or-resume',
            message: 'baseline required. Run web-ai send --vendor perplexity first.',
        });
    }

    const timeoutMs = Math.max(1, resolveTimeoutBudgetSec({ ...input, timeout: input.timeout || input.thinkingTime }, session, 'perplexity')) * 1000;
    const deadline = Date.now() + timeoutMs;
    let stableText = '';
    let stableSince = 0;
    let stableCitationFingerprint = '';
    let citationStableSince = 0;

    while (Date.now() < deadline) {
        try {
            const currentUrl = page.url();
            if (session && isSafePerplexityConversationUrl(currentUrl) && currentUrl !== session.conversationUrl) {
                updateSession(session.sessionId, { conversationUrl: currentUrl });
                session.conversationUrl = currentUrl;
            }
            const committed = await resolveCommittedPerplexityResponse(page, baseline);
            const urlProgress = currentUrl !== baseline.url && isSafePerplexityConversationUrl(currentUrl);
            const turnProgress = committed.isNewTurn === true && committed.responseCount > Number(baseline.assistantCount || 0);
            const progressObserved = urlProgress || turnProgress;
            const streamingState = await probePerplexityStreamingState(page, committed.locator);
            const citation = await extractPerplexityCitations(page, committed, { baseUrl: currentUrl });
            const citationFingerprint = perplexityCitationFingerprint(citation.citations);
            const now = Date.now();

            if (committed.text && committed.text === stableText) {
                if (!stableSince) stableSince = now;
            } else {
                stableText = committed.text;
                stableSince = committed.text ? now : 0;
                stableCitationFingerprint = '';
                citationStableSince = 0;
            }
            if (citationFingerprint === stableCitationFingerprint) {
                if (!citationStableSince) citationStableSince = now;
            } else {
                stableCitationFingerprint = citationFingerprint;
                citationStableSince = now;
            }

            const responseStableMs = stableSince ? now - stableSince : 0;
            const citationStableMs = citationStableSince ? now - citationStableSince : 0;
            const complete = evaluatePerplexityCompletion({
                progressObserved,
                isNewTurn: committed.isNewTurn,
                promptCommitObserved: committed.promptCommitObserved,
                text: committed.text,
                stableText,
                responseStableMs,
                citationState: citation.state,
                citationFingerprint,
                stableCitationFingerprint,
                citationStableMs,
                streamingState,
            });

            if (complete) {
                const resultWarnings = citation.state === 'unavailable' ? ['citations-unavailable'] : [];
                const answerArtifact = createAnswerArtifact({
                    provider: 'perplexity',
                    sessionId: session?.sessionId || null,
                    conversationUrl: currentUrl,
                    capturedBy: 'dom-fallback',
                    markdown: committed.text,
                    text: committed.text,
                    responseStableMs,
                    warnings: resultWarnings,
                    citations: citation.citations,
                });
                if (session) {
                    await finalizeProviderTab(deps, {
                        vendor: 'perplexity', session: /** @type {any} */ (session), page,
                        answerText: committed.text, answerArtifact, warnings: resultWarnings,
                    });
                }
                return withAnswerArtifact({
                    ok: true,
                    vendor: 'perplexity',
                    status: 'complete',
                    url: currentUrl,
                    conversationUrl: currentUrl,
                    ...(session ? { sessionId: session.sessionId } : {}),
                    answerText: committed.text,
                    citations: citation.citations,
                    citationState: citation.state,
                    responseStableMs,
                    baseline,
                    usedFallbacks: [],
                    warnings: resultWarnings,
                    answerArtifact,
                });
            }
            await page.waitForTimeout?.(500).catch(() => undefined);
        } catch (pollError) {
            if (isPageDeathError(pollError)) {
                if (session) updateSession(session.sessionId, { status: 'crashed' });
                return {
                    ok: false, vendor: 'perplexity', status: 'tab-crashed', recoverable: true,
                    url: baseline.url || '', ...(session ? { sessionId: session.sessionId } : {}),
                    answerText: '', citations: [], baseline, usedFallbacks: [],
                    warnings: ['tab-crashed-during-poll'],
                    error: String(/** @type {any} */ (pollError)?.message || pollError),
                };
            }
            if (/** @type {any} */ (pollError)?.errorCode === 'provider.response-resolution') {
                await page.waitForTimeout?.(500).catch(() => undefined);
                continue;
            }
            throw pollError;
        }
    }

    const timedOut = session ? markSessionTimeout(session.sessionId, {
        lastError: { errorCode: 'provider.poll-timeout', message: 'timed out waiting for Perplexity response' },
    }) : null;
    return {
        ok: false, vendor: 'perplexity', status: 'timeout', recoverable: true,
        url: page.url(), ...(session ? { sessionId: session.sessionId } : {}),
        ...(timedOut?.deadlineAt ? { deadlineAt: timedOut.deadlineAt } : {}),
        ...(timedOut?.conversationUrl ? { conversationUrl: timedOut.conversationUrl } : {}),
        baseline, citations: [], warnings: [], usedFallbacks: [],
        retryHint: 'poll-or-resume', error: 'timed out waiting for Perplexity response',
    };
}

/** @param {Deps} deps @param {Input} [input] */
export async function perplexityQueryWebAi(deps, input = {}) {
    const sent = await perplexitySendWebAi(deps, input);
    const polled = await perplexityPollWebAi(deps, {
        timeout: input.timeout || input.thinkingTime,
        session: sent.sessionId,
    });
    return {
        ...polled,
        sessionId: polled.sessionId || sent.sessionId,
        usedFallbacks: [...(sent.usedFallbacks || []), ...(polled.usedFallbacks || [])],
        warnings: [...(sent.warnings || []), ...(polled.warnings || [])],
    };
}

/** @param {Deps} deps */
export async function perplexityStopWebAi(deps) {
    const page = await deps.getPage();
    verifyPerplexityHost(page);
    const stop = page.locator(STOP_SELECTOR);
    const visible = await visibleIndices(stop);
    if (visible.length !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.mode-unavailable', stage: 'stop', retryHint: 'poll',
            message: 'unique Perplexity stop control not available', mutationAllowed: false,
            evidence: { visibleCount: visible.length },
        });
    }
    await stop.nth(visible[0]).click({ timeout: 5_000 });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        if (await probePerplexityStreamingState(page) !== 'streaming') {
            return { ok: true, vendor: 'perplexity', status: 'stopped', url: page.url(), warnings: [] };
        }
        await page.waitForTimeout?.(100).catch(() => undefined);
    }
    throw providerError('perplexity', {
        errorCode: 'provider.mode-unavailable', stage: 'stop', retryHint: 'poll',
        message: 'Perplexity stop postcondition was not observed', mutationAllowed: true,
    });
}

/**
 * Completion truth table used by the poll loop and deterministic tests.
 * @param {Record<string, any>} input
 */
export function evaluatePerplexityCompletion(input) {
    const citationSettled = input.citationState === 'present'
        ? input.citationFingerprint === input.stableCitationFingerprint && input.citationStableMs >= CITATION_STABLE_MS
        : (input.citationState === 'none-confirmed' || input.citationState === 'unavailable')
            ? input.responseStableMs >= PERPLEXITY_CITATION_GRACE_MS
            : false;
    return Boolean(
        input.progressObserved
        && input.isNewTurn === true
        && input.promptCommitObserved === true
        && String(input.text || '').trim()
        && input.text === input.stableText
        && input.responseStableMs >= RESPONSE_STABLE_MS
        && citationSettled
        && input.streamingState === 'idle'
    );
}

/** @param {Page} page */
export function verifyPerplexityHost(page) {
    const url = page.url();
    if (!isProviderOriginUrl('perplexity', url)) {
        throw new WebAiError({
            errorCode: 'cdp.target-mismatch', stage: 'connect', vendor: 'perplexity', retryHint: 'tab-switch',
            message: `active tab is not Perplexity (${url})`, mutationAllowed: false, evidence: { url },
        });
    }
    return true;
}

/**
 * Navigate to a clean exact provider root when the current page has a committed turn.
 * @param {Page} page
 */
export async function openFreshPerplexityThread(page) {
    verifyPerplexityHost(page);
    const beforeUrl = page.url();
    const beforeId = perplexityConversationId(beforeUrl);
    const beforeResponses = await countCommittedResponses(page);
    const isCleanRoot = isExactPerplexityRoot(beforeUrl) && beforeResponses === 0;
    if (!isCleanRoot) {
        await page.goto(PERPLEXITY_DEFAULT_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    verifyPerplexityHost(page);
    const afterUrl = page.url();
    if (!isExactPerplexityRoot(afterUrl)) {
        throw providerError('perplexity', {
            errorCode: 'cdp.target-mismatch', stage: 'fresh-thread', retryHint: 'tab-switch',
            message: 'Perplexity fresh thread did not reach exact provider root', mutationAllowed: false,
            evidence: { beforeUrl, afterUrl },
        });
    }
    const composer = await resolvePerplexityComposer(page);
    const afterResponses = await countCommittedResponses(page);
    if (afterResponses !== 0 || (beforeId && perplexityConversationId(afterUrl) === beforeId)) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution', stage: 'fresh-thread', retryHint: 'retry-new-thread',
            message: 'Perplexity fresh thread postcondition failed', mutationAllowed: false,
            evidence: { afterResponses, beforeId, afterUrl },
        });
    }
    return { url: afterUrl, composer };
}

/** @param {Page} page */
export async function resolvePerplexityComposer(page) {
    const composers = page.locator(COMPOSER_SELECTOR);
    const visible = await visibleIndices(composers);
    if (visible.length !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.composer-not-visible', stage: 'composer-prereq', retryHint: 're-snapshot',
            message: 'Perplexity requires one visible #ask-input composer', mutationAllowed: false,
            selectorsTried: [COMPOSER_SELECTOR], evidence: { visibleCount: visible.length },
        });
    }
    const composer = composers.nth(visible[0]);
    const role = await composer.getAttribute('role');
    const editable = await composer.getAttribute('contenteditable');
    if (role !== 'textbox' || editable !== 'true') {
        throw providerError('perplexity', {
            errorCode: 'provider.composer-not-visible', stage: 'composer-prereq', retryHint: 're-snapshot',
            message: 'Perplexity composer semantics do not match observed contract', mutationAllowed: false,
            evidence: { role, contenteditable: editable },
        });
    }
    return composer;
}

/** @param {Page} page @param {any} baseline */
export async function resolveCommittedPerplexityResponse(page, baseline) {
    const roots = await resolveResponseRoots(page);
    const responseCount = await roots.count();
    const assistantBaseline = Number(baseline.assistantCount || 0);
    const newCount = responseCount - assistantBaseline;
    if (newCount !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution', stage: 'poll', retryHint: 'poll',
            message: 'Perplexity committed response root is not unique', mutationAllowed: false,
            evidence: { responseCount, assistantBaseline, newCount },
        });
    }
    const locator = roots.nth(responseCount - 1);
    if (!await locator.isVisible().catch(() => false)) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution', stage: 'poll', retryHint: 'poll',
            message: 'Perplexity committed response root is not visible', mutationAllowed: false,
        });
    }
    const answerNodes = locator.locator('[data-answer-text], p');
    const answerIndices = await visibleIndices(answerNodes);
    const rawText = answerIndices.length > 0
        ? (await Promise.all(answerIndices.map(index => answerNodes.nth(index).innerText().catch(() => '')))).join('\n\n')
        : await locator.innerText().catch(() => '');
    const text = cleanPerplexityAnswer(rawText);
    const userCount = await countUserTurns(page);
    const promptCommitObserved = userCount > Number(baseline.userCount || 0) || responseCount > assistantBaseline;
    const turnId = await locator.getAttribute('data-turn-id').catch(() => null)
        || await locator.getAttribute('data-testid').catch(() => null)
        || `${responseCount}:${text.length}`;
    return { locator, turnId, responseCount, promptCommitObserved, isNewTurn: newCount === 1, text };
}

/**
 * Observed streaming state: exact Stop response (Esc); completion evidence:
 * Copy action scoped to the committed response root. Contradictions are unknown.
 * @param {Page} page
 * @param {Locator|null} [committedRoot]
 * @returns {Promise<'streaming'|'idle'|'unknown'>}
 */
export async function probePerplexityStreamingState(page, committedRoot = null) {
    const stops = page.locator(STOP_SELECTOR);
    const visibleStops = await visibleIndices(stops);
    if (visibleStops.length === 1) return 'streaming';
    if (visibleStops.length > 1) return 'unknown';
    if (!committedRoot) return 'unknown';
    const copies = committedRoot.locator(COPY_SELECTOR);
    const visibleCopies = await visibleIndices(copies);
    return visibleCopies.length === 1 ? 'idle' : 'unknown';
}

/**
 * Citation extraction opens the associated Sources accordion only when needed
 * and deliberately leaves it open after reading the source links.
 * @param {Page} page
 * @param {{locator:Locator,text:string,responseCount:number}} committed
 * @param {{baseUrl:string, paneAdapter?:{openAndResolve:(page:Page,root:Locator)=>Promise<{pane:Locator}>}}} options
 */
export async function extractPerplexityCitations(page, committed, options) {
    const sourceButtons = committed.locator.locator('button').filter({ hasText: SOURCE_COUNT_RE });
    const visible = await visibleIndices(sourceButtons);
    if (visible.length === 0) return { state: 'unavailable', citations: [], evidence: { reason: 'sources-control-missing' } };
    if (visible.length !== 1) return { state: 'unknown', citations: [], evidence: { reason: 'sources-control-ambiguous', count: visible.length } };
    const label = String(await sourceButtons.nth(visible[0]).innerText().catch(() => '')).trim();
    const count = Number(label.match(/\d+/)?.[0]);
    if (count === 0) return { state: 'none-confirmed', citations: [], evidence: { sourceCount: 0 } };
    try {
        const { pane } = options.paneAdapter
            ? await options.paneAdapter.openAndResolve(page, committed.locator)
            : { pane: await openPerplexitySourcesPane(page, committed.locator) };
        const citations = await readPerplexityCitationCandidates(pane, options.baseUrl);
        if (citations.length === 0) return { state: 'unavailable', citations: [], evidence: { reason: 'citations-normalized-empty' } };
        return { state: 'present', citations: normalizePerplexityCitations(citations, options.baseUrl), evidence: { sourceCount: citations.length } };
    } catch (error) {
        return { state: 'unknown', citations: [], evidence: { reason: 'sources-pane-error', message: String(/** @type {any} */ (error)?.message || error) } };
    }
}

/**
 * Resolve the visible Perplexity sources accordion. It is safe to open a
 * collapsed pane, but the extraction contract intentionally leaves it open.
 * @param {Page} page
 * @param {Locator} committedRoot
 */
export async function openPerplexitySourcesPane(page, committedRoot) {
    let toggles = page.locator('button[aria-expanded]').filter({ hasText: SOURCE_TOGGLE_RE });
    let visible = await visibleIndices(toggles);

    if (visible.length === 0) {
        const footerSources = committedRoot.locator('button').filter({ hasText: SOURCE_COUNT_RE });
        const footerVisible = await visibleIndices(footerSources);
        if (footerVisible.length === 1) {
            await footerSources.nth(footerVisible[0]).click({ timeout: 5_000 });
            toggles = page.locator('button[aria-expanded]').filter({ hasText: SOURCE_TOGGLE_RE });
            visible = await waitForVisibleSourceToggles(toggles, 5_000);
        }
    }

    if (visible.length !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution',
            stage: 'sources-open',
            retryHint: 're-snapshot',
            message: 'Perplexity sources toggle is not unique',
            mutationAllowed: false,
            evidence: { visibleCount: visible.length },
        });
    }

    const toggle = toggles.nth(visible[0]);
    const expandedBefore = await toggle.getAttribute('aria-expanded');
    if (expandedBefore !== 'true') {
        await toggle.click({ timeout: 5_000 });
    }

    const pane = toggle.locator('xpath=..');
    const links = pane.locator('a[href], [data-source-url]');
    const linkCount = await waitForSourceLinks(links, 5_000);
    if (linkCount < 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution',
            stage: 'sources-open',
            retryHint: 'poll',
            message: 'Perplexity sources pane opened without source links',
            mutationAllowed: true,
            evidence: { expandedBefore, linkCount },
        });
    }
    return pane;
}

/** @param {Locator} toggles @param {number} timeoutMs */
async function waitForVisibleSourceToggles(toggles, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const visible = await visibleIndices(toggles);
        if (visible.length !== 0) return visible;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return visibleIndices(toggles);
}

/** @param {Locator} links @param {number} timeoutMs */
async function waitForSourceLinks(links, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const visible = await visibleIndices(links);
        if (visible.length > 0) return visible.length;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    return (await visibleIndices(links)).length;
}

/** @param {Page} _page */
export async function dismissPerplexityBlockingOverlay(_page) {
    // No overlay was observed in the authenticated snapshot. V1 intentionally
    // performs zero dismissal actions rather than inventing Escape/close logic.
    return { observed: false, dismissed: false };
}

/** @param {Locator} composer @param {string} text */
async function insertPerplexityPrompt(composer, text) {
    await composer.click({ timeout: 5_000 });
    if (typeof /** @type {any} */ (composer).fill === 'function') {
        await /** @type {any} */ (composer).fill(text);
    } else {
        await composer.evaluate((node, value) => {
            node.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(node);
            selection?.removeAllRanges();
            selection?.addRange(range);
            document.execCommand('insertText', false, String(value));
            node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(value) }));
        }, text);
    }
    const value = String(await composer.innerText().catch(() => '')).trim();
    if (!value) {
        throw providerError('perplexity', {
            errorCode: 'provider.composer-not-visible', stage: 'composer-insert', retryHint: 'retry',
            message: 'Perplexity composer remained empty after insertion', mutationAllowed: true,
        });
    }
}

/** @param {Page} page @param {Input} input @param {any} contextPack */
async function attachAndVerifyPerplexityFile(page, input, contextPack) {
    const uploadPath = input.filePath || input.filePaths?.[0] || contextPack?.attachments?.[0]?.path;
    if (!uploadPath) return null;
    const info = fileInfoFromPath(uploadPath);
    const add = await uniqueNamedRole(page, 'button', ADD_FILES_BUTTON_NAME, 'attachment-trigger');
    await add.click({ timeout: 5_000 });
    const uploadItem = await uniqueNamedRole(page, 'menuitem', UPLOAD_MENU_ITEM_NAME, 'attachment-menuitem');
    await uploadItem.click({ timeout: 5_000 });
    const inputs = page.locator('input[type="file"][multiple]');
    if (await inputs.count() !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.attachment-preflight', stage: 'attachment-upload', retryHint: 're-snapshot',
            message: 'Perplexity file input is not unique', mutationAllowed: false,
            evidence: { count: await inputs.count() },
        });
    }
    await inputs.nth(0).setInputFiles(uploadPath);
    const preview = typeof page.getByText === 'function'
        ? page.getByText(info.basename, { exact: true })
        : page.locator(`text=${JSON.stringify(info.basename)}`);
    const visible = await visibleIndices(preview);
    if (visible.length !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.attachment-evidence-missing', stage: 'attachment-verify', retryHint: 're-upload',
            message: 'Perplexity attachment preview not observed', mutationAllowed: true,
            evidence: { fileName: info.basename, visibleCount: visible.length },
        });
    }
    return { path: uploadPath, fileName: info.basename };
}

/** @param {Page} page */
async function capturePerplexityBaseline(page) {
    return {
        url: page.url(),
        responseCount: await countCommittedResponses(page),
        userCount: await countUserTurns(page),
        textHash: String((await page.locator('body').innerText().catch(() => '')).length),
    };
}

/** @param {Page} page */
async function submitPerplexityPrompt(page) {
    const submit = page.locator(SUBMIT_SELECTOR);
    const visible = await visibleIndices(submit);
    if (visible.length !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.composer-not-visible', stage: 'submit', retryHint: 're-snapshot',
            message: 'Perplexity Submit button is not unique', mutationAllowed: false,
            evidence: { visibleCount: visible.length },
        });
    }
    await submit.nth(visible[0]).click({ timeout: 5_000 });
}

/** @param {Page} page @param {{baseline:any,attachment:any}} input */
async function verifyPerplexityCommit(page, { baseline, attachment }) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const urlProgress = page.url() !== baseline.url && isSafePerplexityConversationUrl(page.url());
        const userProgress = await countUserTurns(page) > baseline.userCount;
        if (urlProgress || userProgress) {
            if (attachment) {
                const evidence = typeof page.getByText === 'function'
                    ? page.getByText(attachment.fileName, { exact: true })
                    : page.locator(`text=${JSON.stringify(attachment.fileName)}`);
                if ((await visibleIndices(evidence)).length === 0) {
                    throw providerError('perplexity', {
                        errorCode: 'provider.attachment-evidence-missing', stage: 'attachment-verify', retryHint: 're-upload',
                        message: 'sent-turn attachment evidence missing', mutationAllowed: true,
                    });
                }
            }
            return true;
        }
        await page.waitForTimeout?.(100).catch(() => undefined);
    }
    throw providerError('perplexity', {
        errorCode: 'provider.response-resolution', stage: 'submit', retryHint: 'retry',
        message: 'Perplexity prompt commit was not observed', mutationAllowed: true,
    });
}

/**
 * Resolve the latest semantically committed Perplexity answer root for
 * non-session operations such as MCP copy. Older completed turns may remain
 * visible, so DOM order is the only accepted selection rule.
 * @param {Page} page
 * @returns {Promise<Locator>}
 */
export async function resolveLatestPerplexityResponseRoot(page) {
    const roots = await resolveResponseRoots(page);
    const count = await roots.count();
    if (count < 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution',
            stage: 'copy-root',
            retryHint: 're-snapshot',
            message: 'No committed Perplexity response root was found',
            mutationAllowed: false,
            evidence: { count },
        });
    }
    const latest = roots.nth(count - 1);
    if (!(await latest.isVisible().catch(() => false))) {
        throw providerError('perplexity', {
            errorCode: 'provider.response-resolution',
            stage: 'copy-root',
            retryHint: 're-snapshot',
            message: 'Latest Perplexity response root is not visible',
            mutationAllowed: false,
            evidence: { count },
        });
    }
    return latest;
}

/** @param {Page} page */
async function resolveResponseRoots(page) {
    // The live observation intentionally records no stable answer-root class or
    // role. Resolve from the exact completed footer instead: one Copy control,
    // one <n> sources control, and Share or Rewrite Session, then choose the
    // nearest ancestor containing that footer and answer text.
    const copyButtons = page.locator('button[aria-label="Copy"], button:not([aria-label]):has-text("Copy")');
    if (typeof /** @type {any} */ (copyButtons).locator !== 'function') {
        return page.locator('[data-agbrowse-perplexity-response="committed"]');
    }
    return copyButtons.locator(COMMITTED_RESPONSE_ROOT_XPATH);
}

/** @param {Page} page */
async function countCommittedResponses(page) {
    return (await resolveResponseRoots(page)).count();
}

/** @param {Page} page */
async function countUserTurns(page) {
    for (const selector of USER_TURN_SELECTORS) {
        const rows = page.locator(selector);
        const count = await rows.count().catch(() => 0);
        if (count) return count;
    }
    return 0;
}

/** @param {Page} page @param {'button'|'menuitem'} role @param {string} name @param {string} stage */
async function uniqueNamedRole(page, role, name, stage) {
    const candidates = typeof page.getByRole === 'function'
        ? page.getByRole(role, { name, exact: true })
        : page.locator(`[role="${role}"]`).filter({ hasText: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    const visible = await visibleIndices(candidates);
    if (visible.length !== 1) {
        throw providerError('perplexity', {
            errorCode: 'provider.attachment-preflight', stage, retryHint: 're-snapshot',
            message: `Perplexity ${name} control is not unique`, mutationAllowed: false,
            evidence: { role, name, visibleCount: visible.length },
        });
    }
    return candidates.nth(visible[0]);
}

/** @param {Page} page @param {string} name */
async function probeNamedButton(page, name) {
    const candidates = typeof page.getByRole === 'function'
        ? page.getByRole('button', { name, exact: true })
        : page.locator('button').filter({ hasText: new RegExp(`^${escapeRegex(name)}$`, 'i') });
    const visible = await visibleIndices(candidates);
    return visible.length === 1
        ? { state: 'ok', evidence: { name, visibleCount: 1 }, next: 'send' }
        : { state: 'fail', evidence: { name, visibleCount: visible.length }, next: 'inline-only' };
}

/** @param {Locator} locator */
async function visibleIndices(locator) {
    const result = [];
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
        if (await locator.nth(index).isVisible().catch(() => false)) result.push(index);
    }
    return result;
}

/** @param {string} url */
function isExactPerplexityRoot(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:'
            && PERPLEXITY_HOSTS.has(parsed.hostname)
            && (parsed.pathname === '/' || parsed.pathname === '')
            && !parsed.search && !parsed.hash && !parsed.username && !parsed.password && !parsed.port;
    } catch { return false; }
}

/** @param {string} text */
function cleanPerplexityAnswer(text) {
    return String(text || '')
        .replace(/\b(?:Share|Download|Copy|Rewrite Session|Helpful|Not helpful|More actions)\b/g, '')
        .replace(/\b\d+\s+sources\b/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** @param {any} contextPack */
function summarizeContextPack(contextPack) {
    return {
        transport: contextPack.transport,
        fileCount: contextPack.files?.length || 0,
        totalBytes: contextPack.totalBytes || 0,
        attachmentCount: contextPack.attachments?.length || 0,
    };
}

/** @param {string} value */
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
