// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { pollWebAi } from './chatgpt.mjs';
import { geminiPollWebAi } from './gemini-live.mjs';
import { grokPollWebAi } from './grok-live.mjs';
import { WebAiError } from './errors.mjs';
import { getSession, listSessions, pruneSessionsOlderThan } from './session.mjs';

const SESSIONS_SUBCOMMANDS = new Set(['list', 'show', 'resume', 'reattach', 'prune']);

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
            commands: ['list', 'show', 'resume', 'reattach', 'prune'],
            usage: 'agbrowse web-ai sessions <list|show|resume|reattach|prune> [options]',
        };
    }
    if (!SESSIONS_SUBCOMMANDS.has(sub)) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'internal',
            retryHint: 'report',
            message: `unknown sessions subcommand: ${sub} (expected list|show|resume|reattach|prune)`,
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
        if (!session) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: `no session record for ${id}`, evidence: { sessionId: id } });
        return { ok: true, status: 'show', session };
    }
    if (sub === 'resume') {
        const id = rest[0] || values.session;
        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions resume <id> requires a sessionId (positional or --session)' });
        const session = getSession(id);
        if (!session) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: `no session record for ${id}`, evidence: { sessionId: id } });
        const pollInput = {
            ...input,
            vendor: session.vendor,
            session: id,
            allowCopyMarkdownFallback: input.allowCopyMarkdownFallback === true,
        };
        const pollFn = session.vendor === 'gemini' ? geminiPollWebAi : session.vendor === 'grok' ? grokPollWebAi : pollWebAi;
        const result = await pollFn(deps, pollInput);
        return { ...result, status: result.status || 'resumed' };
    }
    if (sub === 'reattach') {
        const id = rest[0] || values.session;
        if (!id) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: 'sessions reattach <id> requires a sessionId' });
        const session = getSession(id);
        if (!session) throw new WebAiError({ errorCode: 'internal.unhandled', stage: 'internal', retryHint: 'report', message: `no session record for ${id}`, evidence: { sessionId: id } });
        const page = await deps.getPage();
        const currentUrl = page?.url?.() || null;
        const targetUrl = session.conversationUrl || session.originalUrl;
        if (!targetUrl) {
            return { ok: false, status: 'reattach-failed', sessionId: id, error: 'session has no conversationUrl/originalUrl', warnings: [] };
        }
        if (currentUrl !== targetUrl) {
            if (input.navigate === true) {
                await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                return { ok: true, status: 'reattached', sessionId: id, url: targetUrl, warnings: [`navigated from ${currentUrl} to ${targetUrl}`] };
            }
            return {
                ok: false,
                status: 'reattach-mismatch',
                sessionId: id,
                url: currentUrl,
                conversationUrl: targetUrl,
                warnings: [`current tab ${currentUrl} does not match session conversationUrl ${targetUrl}; pass --navigate to switch tabs`],
            };
        }
        return { ok: true, status: 'reattached', sessionId: id, url: targetUrl, warnings: ['already on conversationUrl'] };
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
        console.log(JSON.stringify(result.session, null, 2));
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
    if (result.answerText) {
        console.log(result.answerText);
        return;
    }
    console.log(JSON.stringify(result, null, 2));
}
