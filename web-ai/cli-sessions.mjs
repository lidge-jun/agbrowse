// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { pollWebAi } from './chatgpt.mjs';
import { geminiPollWebAi } from './gemini-live.mjs';
import { grokPollWebAi } from './grok-live.mjs';
import { isWorkSession, pollWorkSession } from './chatgpt-work-picker.mjs';
import { resumeDeepResearch } from './chatgpt-deep-research.mjs';
import { WebAiError } from './errors.mjs';
import { getSession, listSessions, pruneSessionsOlderThan, updateSession, resolvePollTimeoutSec, resolveTimeoutBudgetSec } from './session.mjs';
import { resolveSessionPage, withSessionPage, openConversationInNewTab } from './tab-recovery.mjs';
import { withSessionCommandLock } from './session-store.mjs';
import { buildSessionDoctorReport } from './session-doctor.mjs';

const SESSIONS_SUBCOMMANDS = new Set(['list', 'show', 'resume', 'reattach', 'doctor', 'prune']);

const SESSION_DURATION_RE = /^(\d+)\s*([smhdw]?)$/i;
const DURATION_MS = { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/**
 * @param {any} value
 */
export function parseDurationToMs(value) {
    if (value === undefined || value === null || value === '') return null;
    const match = SESSION_DURATION_RE.exec(String(value).trim());
    if (!match) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'internal',
            retryHint: 'report',
            message: `invalid duration: ${value} (expected e.g. 30d, 12h, 90m, 600s)`,
            evidence: { value },
        });
    }
    const [, num, unitRaw] = match;
    const unit = (unitRaw || 'd').toLowerCase();
    const factor = (/** @type {any} */ (DURATION_MS))[unit];
    if (!factor) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'internal',
            retryHint: 'report',
            message: `unsupported duration unit: ${unit}`,
            evidence: { value, unit },
        });
    }
    return Number(num) * factor;
}

/**
 * @param {any} args
 * @param {any} values
 * @param {any} deps
 * @param {any} input
 */
export async function runSessionsCommand(args, values, deps, input) {
    const [sub, ...rest] = args;
    if (!sub) {
        return {
            ok: true,
            status: 'help',
            commands: ['list', 'show', 'resume', 'reattach', 'doctor', 'prune'],
            usage: 'agbrowse web-ai sessions <list|show|resume|reattach|doctor|prune> [options]',
        };
    }
    if (!SESSIONS_SUBCOMMANDS.has(sub)) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'internal',
            retryHint: 'report',
            message: `unknown sessions subcommand: ${sub} (expected list|show|resume|reattach|doctor|prune)`,
        });
    }
    if (sub === 'list') {
        const filter = {};
        const vendorExplicit = args.includes('--vendor') || args.some((/** @type {any} */ a) => a.startsWith('--vendor='));
        if (vendorExplicit && values.vendor) filter.vendor = values.vendor;
        if (values.status) filter.status = values.status;
        if (values.limit) filter.limit = Number(values.limit);
        const rows = listSessions(filter);
        return { ok: true, status: 'list', sessions: rows };
    }
    if (sub === 'show') {
        const id = rest[0];
        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions show <id> requires a sessionId argument' });
        const session = getSession(id);
        if (!session) throw new WebAiError({ errorCode: 'input.session-not-found', stage: 'input-preflight', retryHint: 'list-sessions', message: `no session record for ${id} — run \`agbrowse web-ai sessions list\``, evidence: { sessionId: id } });
        return { ok: true, status: 'show', session };
    }
    if (sub === 'resume') {
        const id = rest[0] || values.session;
        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions resume <id> requires a sessionId (positional or --session)' });
        const session = getSession(id);
        if (!session) throw new WebAiError({ errorCode: 'input.session-not-found', stage: 'input-preflight', retryHint: 'list-sessions', message: `no session record for ${id} — run \`agbrowse web-ai sessions list\``, evidence: { sessionId: id } });
        // 35.2: a Deep Research session resumes via the DR capture path (no new
        // prompt), not the generic poller.
        if (session.researchMode === 'deep' && session.vendor === 'chatgpt') {
            const drResult = await withSessionCommandLock(id, () => withSessionPage(deps, id, async ({ page, targetId, session: refreshed }) => {
                const sessionDeps = {
                    ...deps,
                    getPage: async () => page,
                    getTargetId: async () => targetId,
                    getCdpSession: async () => /** @type {any} */ (page).context?.().newCDPSession?.(page),
                };
                // Clamped to the stored deadline. This value is used as a HARD
                // `timeoutMs`, so the budget resolver's whole-second floor let a
                // sub-second remainder run past the session's own deadline.
                const budgetMs = resolvePollTimeoutSec(input, refreshed, refreshed.vendor || 'chatgpt') * 1000;
                return resumeDeepResearch(page, sessionDeps, { session: refreshed, timeoutMs: budgetMs });
            }));
            return { ...drResult, status: drResult.status || 'resumed' };
        }
        const pollInput = {
            ...input,
            vendor: session.vendor,
            session: id,
            allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
        };
        const pollFn = isWorkSession(session) ? pollWorkSession
            : session.vendor === 'gemini' ? geminiPollWebAi
            : session.vendor === 'grok' ? grokPollWebAi
            : pollWebAi;
        const result = await withSessionCommandLock(id, () => withSessionPage(deps, id, async ({ page, targetId, session: refreshed }) => {
            const sessionDeps = {
                ...deps,
                getPage: async () => page,
                getTargetId: async () => targetId,
                getCdpSession: async () => /** @type {any} */ (page).context?.().newCDPSession?.(page),
            };
            return pollFn(sessionDeps, {
                ...pollInput,
                vendor: refreshed.vendor,
                session: refreshed.sessionId,
                // Clamped to the stored deadline, fractional. Resolving a plain
                // budget floored the remainder to a whole second and handed it
                // down as if the user had typed it. Omitting it instead is only
                // safe for ChatGPT: Gemini and Grok read no stored deadline and
                // fall back to their own 1200s/600s defaults.
                timeout: resolvePollTimeoutSec(input, refreshed, refreshed.vendor || 'chatgpt'),
            });
        }));
        return { ...result, status: result.status || 'resumed' };
    }
    if (sub === 'reattach') {
        const id = rest[0] || values.session;
        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions reattach <id> requires a sessionId' });
        const session = getSession(id);
        if (!session) throw new WebAiError({ errorCode: 'input.session-not-found', stage: 'input-preflight', retryHint: 'list-sessions', message: `no session record for ${id} — run \`agbrowse web-ai sessions list\``, evidence: { sessionId: id } });
        const targetUrl = session.conversationUrl || session.originalUrl;
        if (!targetUrl) {
            return { ok: false, status: 'reattach-failed', sessionId: id, error: 'session has no conversationUrl/originalUrl', warnings: [] };
        }
        const resolved = await resolveSessionPage(deps, id, { allowNavigate: input.navigate === true });
        // Liveness unverified is not a mismatch: the stored tab may be perfectly
        // usable and merely unreadable right now. Opening a replacement here
        // would rebind the session to a new tab and strand the live one.
        if (/** @type {any} */ (resolved).strategy === 'unverified') {
            return {
                ok: false,
                status: 'reattach-unverified',
                sessionId: id,
                error: 'tab liveness could not be verified; retry once the browser responds',
                warnings: resolved.warnings || [],
                recoverable: true,
                retryHint: 'retry-reattach',
            };
        }
        if (resolved.mismatch) {
            // 35.1 new-tab recovery: when navigation is authorized, open the saved
            // ChatGPT conversation in a fresh tab (32.3-guarded) instead of failing.
            if (input.navigate === true && session.vendor === 'chatgpt') {
                const reopened = await openConversationInNewTab(deps, { conversationUrl: session.conversationUrl });
                if (reopened.opened) {
                    updateSession(id, { targetId: reopened.targetId });
                    return {
                        ok: true,
                        status: 'reattached',
                        sessionId: id,
                        targetId: reopened.targetId,
                        url: /** @type {any} */ (reopened.page).url?.() || reopened.conversationUrl,
                        recovered: true,
                        strategy: 'new-tab',
                        warnings: ['recovered-via-new-tab'],
                    };
                }
                return {
                    ok: false,
                    status: 'reattach-mismatch',
                    sessionId: id,
                    targetId: resolved.targetId,
                    url: resolved.url,
                    conversationUrl: resolved.conversationUrl,
                    warnings: [...(resolved.warnings || []), `new-tab-recovery-failed:${reopened.reason}`],
                };
            }
            return {
                ok: false,
                status: 'reattach-mismatch',
                sessionId: id,
                targetId: resolved.targetId,
                url: resolved.url,
                conversationUrl: resolved.conversationUrl,
                warnings: resolved.warnings,
            };
        }
        return {
            ok: true,
            status: 'reattached',
            sessionId: id,
            targetId: resolved.targetId,
            url: /** @type {any} */ (resolved.page).url?.() || resolved.conversationUrl || targetUrl,
            recovered: resolved.recovered === true,
            strategy: resolved.strategy || 'existing-tab',
            warnings: resolved.warnings || [],
        };
    }
    if (sub === 'doctor') {
        const id = rest[0] || values.session;
        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions doctor <id> requires a sessionId' });
        return buildSessionDoctorReport(deps, id, { navigate: input.navigate === true });
    }
    if (sub === 'prune') {
        const olderThanMs = values['older-than']
            ? parseDurationToMs(values['older-than'])
            : 30 * 86_400_000;
        const result = pruneSessionsOlderThan({
            olderThanMs: /** @type {any} */ (olderThanMs),
            ...(values.status ? { status: values.status } : {}),
        });
        return { ok: true, status: 'pruned', ...result, olderThanMs };
    }
}

/**
 * @param {any} result
 */
export function printSessionsHuman(result) {
    if (!result) return;
    if (result.status === 'help') {
        console.log(result.usage);
        console.log(`subcommands: ${result.commands.join(', ')}`);
        return;
    }
    if (result.status === 'list') {
        const rows = result.sessions || [];
        if (rows.length === 0) { console.log('(no sessions)'); return; }
        for (const s of rows) {
            console.log(`${s.sessionId}  ${s.vendor.padEnd(8)}  ${s.status.padEnd(10)}  ${s.createdAt}  ${s.conversationUrl || s.originalUrl || ''}`);
        }
        return;
    }
    if (result.status === 'show') {
        const session = result.session;
        console.log(`${session.sessionId}  ${session.vendor || 'unknown'}  ${session.status || 'unknown'}`);
        if (session.conversationUrl || session.originalUrl) console.log(`URL: ${session.conversationUrl || session.originalUrl}`);
        const evidenceLines = formatBrowserEvidenceLines(session);
        if (evidenceLines.length) {
            console.log('Browser evidence:');
            for (const line of evidenceLines) console.log(`- ${line}`);
        }
        if (session.artifacts?.length) {
            console.log('Artifacts:');
            for (const artifact of session.artifacts) {
                const details = [
                    artifact.mimeType,
                    Number.isFinite(artifact.sizeBytes) ? `${artifact.sizeBytes} bytes` : null,
                ].filter(Boolean).join(', ');
                console.log(`- ${artifact.kind}: ${artifact.path}${details ? ` (${details})` : ''}`);
            }
        } else {
            console.log('Artifacts: none');
        }
        return;
    }
    if (result.status === 'pruned') {
        console.log(`pruned ${result.removed} (remaining ${result.remaining})`);
        return;
    }
    if (result.status === 'reattached') {
        console.log(`reattached to ${result.sessionId} at ${result.url}`);
        return;
    }
    if (result.status === 'reattach-mismatch') {
        console.log(`reattach mismatch: tab=${result.url} session=${result.conversationUrl}`);
        console.log('pass --navigate to switch tabs');
        return;
    }
    if (result.status === 'session-doctor') {
        console.log(`session ${result.sessionId}: ${result.summary}`);
        for (const line of result.recommendations || []) console.log(`- ${line}`);
        return;
    }
    if (result.answerText) {
        console.log(result.answerText);
        return;
    }
    console.log(JSON.stringify(result, null, 2));
}

/**
 * @param {any} session
 * @returns {string[]}
 */
function formatBrowserEvidenceLines(session) {
    /** @type {string[]} */
    const lines = [];
    const evidence = session?.modelSelection;
    if (evidence && typeof evidence === 'object') {
        const requested = evidence.requestedModel ?? '(none)';
        const resolved = evidence.resolvedLabel ?? '(unavailable)';
        const surface = evidence.surface ?? '(unknown)';
        const family = evidence.familyLabel ?? '(unavailable)';
        const tier = evidence.tierLabel ?? evidence.resolvedLabel ?? '(unavailable)';
        const taskId = evidence.taskId ?? '(unavailable)';
        const taskUrl = evidence.taskUrl ?? '(unavailable)';
        const responseContract = evidence.responseContract ?? '(unavailable)';
        const strategy = evidence.strategy ?? '(default)';
        const verified = evidence.verified ? 'yes' : 'no';
        lines.push(`model requested=${requested}; resolved=${resolved}; surface=${surface}; family=${family}; tier=${tier}; taskId=${taskId}; taskUrl=${taskUrl}; responseContract=${responseContract}; status=${evidence.status || 'unknown'}; strategy=${strategy}; verified=${verified}`);
    }
    for (const warning of session?.warnings || []) {
        if (!warning || typeof warning !== 'object' || !warning.code) continue;
        lines.push(`warning ${warning.code}: ${warning.message || ''}`.trim());
    }
    return lines;
}
