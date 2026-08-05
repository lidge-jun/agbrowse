// @ts-check
import { DEADLINE_PASSED, updateSessionAsync } from './session.mjs';
import { trySaveTranscript, appendArtifactRecordAsync } from './session-artifacts.mjs';
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';
import { probeStopButton } from './chatgpt-response-dom.mjs';
import { monotonicNowMs, withPollDeadline } from './poll-deadline.mjs';

/**
 * @typedef {Object} TurnResult
 * @property {number} index
 * @property {string} prompt
 * @property {string|null} answer
 * @property {'complete'|'failed'} status
 * @property {string[]} warnings
 * @property {string} sentAt
 * @property {string|null} completedAt
 */

/**
 * @typedef {Object} MultiTurnResult
 * @property {boolean} ok
 * @property {string} sessionId
 * @property {string} conversationUrl
 * @property {TurnResult[]} turns
 * @property {string|null} finalAnswer
 * @property {string[]} warnings
 * @property {'complete'|'partial'} finalStatus
 * @property {string} transcriptMarkdown
 */

/**
 * Count assistant messages on the page.
 * @param {any} page
 * @returns {Promise<number>}
 */
async function countAssistants(page) {
    return page.locator('[data-message-author-role="assistant"]').count();
}

/**
 * Read the latest assistant message text.
 * @param {any} page
 * @returns {Promise<string>}
 */
async function readLatestAssistant(page) {
    const els = await page.locator('[data-message-author-role="assistant"]').all();
    if (!els.length) return '';
    return els[els.length - 1].innerText().catch(() => '');
}

/**
 * Is ChatGPT streaming right now?
 *
 * Returns the verdict, not a boolean: `unknown` must not be read as "finished",
 * which is what the completion check below does with `!streaming`.
 *
 * @param {any} page
 * @returns {Promise<'visible'|'absent'|'unknown'>}
 */
async function isStreaming(page) {
    return probeStopButton(page);
}

/**
 * Submit a single turn into an existing conversation without finalization.
 * @param {any} page
 * @param {any} deps
 * @param {{ prompt: string }} opts
 * @returns {Promise<void>}
 */
async function submitTurn(page, deps, { prompt }) {
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
}

/**
 * Poll for a single turn's completion without calling finalizeProviderTab.
 * @param {any} page
 * @param {{ baselineAssistantCount: number, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, answerText: string, warnings: string[] }>}
 */
async function pollTurn(page, { baselineAssistantCount, timeoutMs = 120_000 }) {
    const deadline = Date.now() + timeoutMs;
    let stableText = '';
    let stableSince = 0;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, Math.max(1, Math.min(500, deadline - Date.now()))));

        const count = await countAssistants(page);
        if (count <= baselineAssistantCount) continue;

        const latest = (await readLatestAssistant(page)).trim();
        const stop = await isStreaming(page);
        const streaming = stop === 'visible';

        // `unknown` blocks completion without counting as generation: the loop
        // keeps its deadline, so an unreadable probe delays the answer rather
        // than turning a half-written one into the final result.
        if (latest && stop === 'absent') {
            if (latest === stableText) {
                if (Date.now() - stableSince >= 1500) {
                    return { ok: true, answerText: latest, warnings: [] };
                }
            } else {
                stableText = latest;
                stableSince = Date.now();
            }
        } else if (streaming || stop === 'unknown') {
            stableText = '';
            stableSince = 0;
        }
    }

    return { ok: false, answerText: stableText || '', warnings: ['turn-timeout'] };
}

/**
 * Execute a multi-turn follow-up sequence in an existing ChatGPT conversation.
 * Session command lock must be held by the caller for the entire sequence.
 * @param {any} page
 * @param {any} deps
 * @param {{ followUps: string[], session: any, timeoutPerTurn?: number }} opts
 * @returns {Promise<MultiTurnResult>}
 */
export async function sendMultiTurn(page, deps, { followUps, session, timeoutPerTurn = 120_000 }) {
    // One outer budget covers the accumulated per-turn polling budgets. The
    // race bounds browser probes that a single turn's clock checks cannot.
    const timeoutMs = Math.max(1, Number(timeoutPerTurn) * Math.max(1, followUps.length));
    const startedAt = Date.now();
    const monotonicStartMs = monotonicNowMs();
    const ctx = {
        turns: /** @type {TurnResult[]} */ ([]),
        finalAnswer: session.answer || null,
        warnings: /** @type {string[]} */ ([]),
    };
    return withPollDeadline(
        (hardDeadline, token) => runMultiTurn(page, deps, { followUps, session, timeoutPerTurn }, ctx, token),
        {
            startedAt,
            monotonicStartMs,
            timeoutMs,
            onExpired: () => buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']),
        },
    );
}

/**
 * @param {any} page
 * @param {any} deps
 * @param {{ followUps: string[], session: any, timeoutPerTurn: number }} opts
 * @param {{ turns: TurnResult[], finalAnswer: string|null, warnings: string[] }} ctx
 * @param {{ expired?: boolean, hardDeadline?: number }|null} runToken
 * @returns {Promise<MultiTurnResult>}
 */
async function runMultiTurn(page, deps, { followUps, session, timeoutPerTurn }, ctx, runToken) {
    const stillActive = () => isMultiTurnRunActive(runToken);
    /** @type {TurnResult[]} */
    const turns = ctx.turns;
    const allWarnings = ctx.warnings;

    const existingTurns = session.turns || [];
    let turnIndex = existingTurns.length;

    for (const prompt of followUps) {
        if (!stillActive()) {
            return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
        }
        const sentAt = new Date().toISOString();
        const baselineAssistantCount = await countAssistants(page);
        if (!stillActive()) {
            return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
        }

        try {
            await submitTurn(page, deps, { prompt });
            const result = await pollTurn(page, {
                baselineAssistantCount,
                timeoutMs: timeoutPerTurn,
            });

            /** @type {TurnResult} */
            const turn = {
                index: turnIndex,
                prompt,
                answer: result.answerText || null,
                status: result.ok ? 'complete' : 'failed',
                warnings: result.warnings,
                sentAt,
                completedAt: new Date().toISOString(),
            };
            turns.push(turn);
            turnIndex++;

            const allTurns = [...existingTurns, ...turns];
            if (result.answerText) ctx.finalAnswer = result.answerText;
            const progressWrite = await updateSessionAsync(session.sessionId, {
                turns: allTurns,
                answer: result.answerText || ctx.finalAnswer,
                followUpCount: allTurns.length,
            }, stillActive);
            if (progressWrite === DEADLINE_PASSED) {
                return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
            }

            if (!result.ok) {
                const partialWrite = await updateSessionAsync(session.sessionId, { status: 'partial' }, stillActive);
                if (partialWrite === DEADLINE_PASSED) {
                    return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
                }
                allWarnings.push(`turn-${turnIndex - 1}-failed`);
                break;
            }
        } catch (err) {
            turns.push({
                index: turnIndex,
                prompt,
                answer: null,
                status: 'failed',
                warnings: [(/** @type {any} */ (err))?.message || 'unknown-error'],
                sentAt,
                completedAt: new Date().toISOString(),
            });
            turnIndex++;

            const allTurns = [...existingTurns, ...turns];
            const partialWrite = await updateSessionAsync(session.sessionId, {
                turns: allTurns,
                status: 'partial',
                followUpCount: allTurns.length,
            }, stillActive);
            if (partialWrite === DEADLINE_PASSED) {
                return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
            }

            allWarnings.push(`turn-${turnIndex - 1}-error`);
            break;
        }
    }
    const allTurns = [...existingTurns, ...turns];
    const transcriptMarkdown = renderMultiTurnTranscript(allTurns);
    const ok = turns.length === followUps.length && turns.every(t => t.status === 'complete');
    if (!ok && transcriptMarkdown && stillActive()) {
        const saved = trySaveTranscript(session.sessionId, transcriptMarkdown);
        if (saved.ok) {
            const appended = await appendArtifactRecordAsync(session.sessionId, saved.descriptor, stillActive);
            if (appended === DEADLINE_PASSED) {
                return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
            }
        }
        else allWarnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);
    }
    const finalWrite = await updateSessionAsync(session.sessionId, {
        status: ok ? 'complete' : 'partial',
        conversationUrl: page.url(),
        answer: ctx.finalAnswer,
        followUpCount: allTurns.length,
        turns: allTurns,
        ...(ok ? { completedAt: new Date().toISOString() } : {}),
    }, stillActive);
    if (finalWrite === DEADLINE_PASSED) {
        return buildMultiTurnResult(page, session, followUps, ctx, ['multi-turn-deadline-expired']);
    }

    return {
        ok,
        sessionId: session.sessionId,
        conversationUrl: page.url(),
        turns,
        finalAnswer: ctx.finalAnswer,
        warnings: allWarnings,
        finalStatus: ok ? 'complete' : 'partial',
        transcriptMarkdown,
    };
}

/**
 * Build a write-free result for an outer deadline loss.
 * @param {any} page
 * @param {any} session
 * @param {string[]} followUps
 * @param {{ turns: TurnResult[], finalAnswer: string|null, warnings: string[] }} ctx
 * @param {string[]} extraWarnings
 * @returns {MultiTurnResult}
 */
function buildMultiTurnResult(page, session, followUps, ctx, extraWarnings = []) {
    const allTurns = [...(session.turns || []), ...ctx.turns];
    const ok = ctx.turns.length === followUps.length && ctx.turns.every(turn => turn.status === 'complete');
    return {
        ok,
        sessionId: session.sessionId,
        conversationUrl: (typeof page?.url === 'function' ? page.url() : null) || session.conversationUrl,
        turns: ctx.turns,
        finalAnswer: ctx.finalAnswer,
        warnings: [...ctx.warnings, ...extraWarnings],
        finalStatus: ok ? 'complete' : 'partial',
        transcriptMarkdown: renderMultiTurnTranscript(allTurns),
    };
}

/**
 * @param {{ expired?: boolean, hardDeadline?: number }|null} token
 */
export function isMultiTurnRunActive(token) {
    if (!token) return true;
    return !(token.expired || Date.now() >= token.hardDeadline);
}

/**
 * @param {TurnResult[]} turns
 * @returns {string}
 */
export function renderMultiTurnTranscript(turns) {
    return turns
        .map(t => `## Turn ${t.index}\n\n**User:** ${t.prompt}\n\n**Assistant:** ${t.answer || '(no response)'}`)
        .join('\n\n---\n\n');
}
