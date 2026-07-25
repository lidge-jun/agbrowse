// @ts-check
import { updateSession } from './session.mjs';
import { trySaveTranscript, appendArtifactRecord } from './session-artifacts.mjs';
import { createChatGptEditorAdapter } from './vendor-editor-contract.mjs';
import { anyStopButtonVisible } from './chatgpt-response-dom.mjs';

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
 * Check if ChatGPT is currently streaming.
 * @param {any} page
 * @returns {Promise<boolean>}
 */
async function isStreaming(page) {
    return anyStopButtonVisible(page);
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
        await new Promise(r => setTimeout(r, 500));

        const count = await countAssistants(page);
        if (count <= baselineAssistantCount) continue;

        const latest = (await readLatestAssistant(page)).trim();
        const streaming = await isStreaming(page);

        if (latest && !streaming) {
            if (latest === stableText) {
                if (Date.now() - stableSince >= 1500) {
                    return { ok: true, answerText: latest, warnings: [] };
                }
            } else {
                stableText = latest;
                stableSince = Date.now();
            }
        } else if (streaming) {
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
    /** @type {TurnResult[]} */
    const turns = [];
    const allWarnings = [];
    let finalAnswer = session.answer || null;

    const existingTurns = session.turns || [];
    let turnIndex = existingTurns.length;

    for (const prompt of followUps) {
        const sentAt = new Date().toISOString();
        const baselineAssistantCount = await countAssistants(page);

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
            if (result.answerText) finalAnswer = result.answerText;
            updateSession(session.sessionId, {
                turns: allTurns,
                answer: result.answerText || finalAnswer,
                followUpCount: allTurns.length,
            });

            if (!result.ok) {
                updateSession(session.sessionId, { status: 'partial' });
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
            updateSession(session.sessionId, {
                turns: allTurns,
                status: 'partial',
                followUpCount: allTurns.length,
            });

            allWarnings.push(`turn-${turnIndex - 1}-error`);
            break;
        }
    }
    const allTurns = [...existingTurns, ...turns];
    const transcriptMarkdown = renderMultiTurnTranscript(allTurns);
    const ok = turns.length === followUps.length && turns.every(t => t.status === 'complete');
    if (!ok && transcriptMarkdown) {
        const saved = trySaveTranscript(session.sessionId, transcriptMarkdown);
        if (saved.ok) appendArtifactRecord(session.sessionId, saved.descriptor);
        else allWarnings.push(`artifact-save-failed:${saved.stage}:${saved.error}`);
    }
    updateSession(session.sessionId, {
        status: ok ? 'complete' : 'partial',
        conversationUrl: page.url(),
        answer: finalAnswer,
        followUpCount: allTurns.length,
        turns: allTurns,
        ...(ok ? { completedAt: new Date().toISOString() } : {}),
    });

    return {
        ok,
        sessionId: session.sessionId,
        conversationUrl: page.url(),
        turns,
        finalAnswer,
        warnings: allWarnings,
        finalStatus: ok ? 'complete' : 'partial',
        transcriptMarkdown,
    };
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
