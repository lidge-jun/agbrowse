import { parseArgs } from 'node:util';
import { renderWebAi, statusWebAi, sendWebAi, pollWebAi, queryWebAi, stopWebAi } from './chatgpt.mjs';
import { geminiStatusWebAi, geminiSendWebAi, geminiPollWebAi, geminiQueryWebAi, geminiStopWebAi } from './gemini-live.mjs';
import { grokStatusWebAi, grokSendWebAi, grokPollWebAi, grokQueryWebAi, grokStopWebAi } from './grok-live.mjs';
import { buildContextPackageResult, prepareContextForBrowser, renderContextDryRunReport } from './context-pack/index.mjs';
import { WebAiError, wrapError } from './errors.mjs';
import { getSession, listSessions, pruneSessionsOlderThan } from './session.mjs';

const COMMANDS = new Set([
    'render', 'status', 'send', 'poll', 'query', 'stop',
    'sessions',
    'context-dry-run', 'context-render',
]);
const SESSIONS_SUBCOMMANDS = new Set(['list', 'show', 'resume', 'reattach', 'prune']);
export const WEB_AI_USAGE = `
Usage:
  agbrowse web-ai <command> --vendor <chatgpt|gemini|grok> [options]

Commands:
  render              Render the prompt envelope without opening a browser
  status              Check active provider tab state
  send                Send a prompt; returns a sessionId for later resume
  poll                Poll a session (or the latest baseline) for completion
  query               send + poll in one call
  stop                Send Escape to the active provider tab
  sessions <sub>      Manage persisted sessions: list | show | resume | reattach | prune
  context-dry-run     Build a context package without sending
  context-render      Render full prompt/context package text

Provider:
  --vendor <name>     chatgpt | gemini | grok (default: chatgpt)
  --url <url>         Navigate or verify the provider URL before mutation
  --model <alias>     Provider model alias; aliases below
                        ChatGPT: instant, thinking, pro
                        Gemini  models: fast, thinking, pro
                        Gemini  tool:   deepthink
                        Grok:   auto, fast, expert, thinking, heavy
  --timeout <sec>     Polling timeout. Defaults: ChatGPT 1200, Gemini 1200, Grok 600.

Prompt envelope (every prompt also gets a [INSTRUCTIONS] block telling the
model to use web search and cite sources inline):
  --prompt <text>     Main user prompt/question (required)
  --system <text>     System / role instruction
  --project <text>    Project name
  --goal <text>       Task goal
  --context <text>    Inline context
  --question <text>   Alias for prompt detail
  --output <text>     Output preference
  --constraints <txt> Constraints to include in the prompt

Attachments and context:
  --inline-only                     Required for send/query without files
  --file <path>                     Upload a single file
  --context-from-files <glob|path>  Add files to a context package; repeatable
  --context-exclude <glob>          Exclude from the package; repeatable
  --context-file <path>             Use a prebuilt context package file
  --context-transport <upload|inline>
  --max-input <chars>               Inline prompt budget
  --max-file-size <bytes>           Per-file context budget
  --files-report                    Include file report metadata
  --allow-copy-markdown-fallback    Capture provider Copy button output after DOM response
  --allow-grok-context-pack         Override Grok hard-gate (Grok prefers inline + single --file)

Sessions (durable across shells, stored at $BROWSER_AGENT_HOME/web-ai-sessions.json):
  --session <id>      Resume a session by id on poll / query / stop.
                      Resolution priority: --session > active target id >
                      vendor latest > legacy baseline.
  --deadline <iso>    Override the session deadline (default now + --timeout
                      or the vendor polling default).
  --navigate          When sessions reattach finds a tab mismatch, allow
                      the runtime to switch tabs to the saved conversationUrl.

Sessions subcommands:
  agbrowse web-ai sessions list   [--vendor <v>] [--status <s>] [--limit N] [--json]
  agbrowse web-ai sessions show   <sessionId> [--json]
  agbrowse web-ai sessions resume <sessionId> [--allow-copy-markdown-fallback] [--timeout <s>]
  agbrowse web-ai sessions reattach <sessionId> [--navigate]
  agbrowse web-ai sessions prune  [--older-than 30d] [--status <s>]
                      Duration accepts s | m | h | d | w (default unit d).

Output:
  --json              Print JSON (or set AGBROWSE_JSON_ERRORS=1 to force JSON
                      failure envelopes regardless of --json).
  --full              Print full context dry-run/render output
  --dry-run <mode>    summary | full | json for context-dry-run

Failure envelope (when --json or AGBROWSE_JSON_ERRORS=1):
  { ok:false, status:"error", error:{ name, errorCode, stage, message,
    retryHint, vendor?, mutationAllowed, selectorsTried, evidence } }
  Codes: cdp.target-mismatch | provider.composer-not-visible |
         provider.attachment-preflight | provider.attachment-evidence-missing |
         provider.commit-not-verified | provider.poll-timeout |
         provider.runtime-disabled | capability.unsupported |
         context.over-budget | context.symlink-rejected |
         grok.context-pack-not-allowed | internal.unhandled

Examples:
  agbrowse web-ai render  --vendor chatgpt --prompt "hello" --json
  agbrowse web-ai query   --vendor grok    --inline-only --prompt "Reply OK"
  agbrowse web-ai query   --vendor gemini  --model deepthink --inline-only --prompt "Reply OK"
  agbrowse web-ai query   --vendor chatgpt --context-from-files "src/**/*.ts" \\
                                          --context-transport upload --prompt "Review this"

  # Long-running Pro: send returns sessionId; resume from any shell later.
  SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \\
          --prompt "..." --json | jq -r .sessionId)
  agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800
`;

export async function runWebAiCli(argv = [], deps) {
    try {
        return await runWebAiCliInner(argv, deps);
    } catch (err) {
        const wrapped = wrapError(err);
        emitCliError(wrapped, argv);
        wrapped.alreadyReported = true;
        throw wrapped;
    }
}

function emitCliError(err, argv = []) {
    const forceJson = process.env.AGBROWSE_JSON_ERRORS === '1' || argv.includes('--json');
    if (forceJson) {
        const payload = { ok: false, status: 'error', error: err.toJSON() };
        console.error(JSON.stringify(payload, null, 2));
        return;
    }
    console.error(`[web-ai error] ${err.errorCode}: ${err.message}`);
    if (err.retryHint) console.error(`[hint] retryHint: ${err.retryHint}`);
}

async function runWebAiCliInner(argv = [], deps) {
    const command = argv[0];
    if (!command || command === '--help' || command === 'help' || argv.includes('--help')) {
        console.log(WEB_AI_USAGE.trim());
        return { ok: true, status: 'help' };
    }
    if (!COMMANDS.has(command)) {
        throw new Error(WEB_AI_USAGE.trim());
    }

    const { values } = parseArgs({
        args: argv.slice(1),
        options: {
            vendor: { type: 'string', default: 'chatgpt' },
            url: { type: 'string' },
            prompt: { type: 'string' },
            system: { type: 'string' },
            project: { type: 'string' },
            goal: { type: 'string' },
            context: { type: 'string' },
            question: { type: 'string' },
            output: { type: 'string' },
            constraints: { type: 'string' },
            timeout: { type: 'string' },
            deadline: { type: 'string' },
            session: { type: 'string' },
            navigate: { type: 'boolean', default: false },
            'inline-only': { type: 'boolean', default: false },
            'allow-copy-markdown-fallback': { type: 'boolean', default: false },
            'allow-grok-context-pack': { type: 'boolean', default: false },
            file: { type: 'string' },
            model: { type: 'string' },
            'thinking-time': { type: 'string' },
            'context-from-files': { type: 'string', multiple: true },
            'context-exclude': { type: 'string', multiple: true },
            'context-file': { type: 'string' },
            'max-input': { type: 'string' },
            'max-file-size': { type: 'string' },
            'files-report': { type: 'boolean', default: false },
            'context-transport': { type: 'string' },
            'dry-run': { type: 'string' },
            'older-than': { type: 'string' },
            status: { type: 'string' },
            limit: { type: 'string' },
            probe: { type: 'string' },
            full: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });

    rejectFutureScope(values);
    const hasContextPackage = Boolean(values['context-file'] || (Array.isArray(values['context-from-files']) && values['context-from-files'].length > 0));
    if (['send', 'query'].includes(command) && !values['inline-only'] && !values.file && !hasContextPackage) {
        throw new WebAiError({
            errorCode: 'provider.attachment-preflight',
            stage: 'attachment-preflight',
            retryHint: 'inline-only-or-file',
            message: 'web-ai send/query require --inline-only or --file=<path>',
        });
    }

    const input = {
        vendor: values.vendor,
        url: values.url,
        prompt: values.prompt,
        system: values.system,
        project: values.project,
        goal: values.goal,
        context: values.context,
        question: values.question,
        output: values.output,
        constraints: values.constraints,
        timeout: values.timeout,
        deadline: values.deadline,
        session: values.session,
        navigate: values.navigate === true,
        attachmentPolicy: values.file ? 'upload' : 'inline-only',
        filePath: values.file,
        thinkingTime: values['thinking-time'],
        model: values.model,
        contextFromFiles: values['context-from-files'] || [],
        contextExclude: values['context-exclude'] || [],
        contextFile: values['context-file'],
        maxInput: values['max-input'],
        maxFileSize: values['max-file-size'],
        filesReport: values['files-report'],
        contextTransport: values['context-transport'],
        inlineOnly: values['inline-only'],
        allowCopyMarkdownFallback: values['allow-copy-markdown-fallback'] === true,
        allowGrokContextPack: values['allow-grok-context-pack'] === true,
        probe: values.probe,
    };

    const result = command === 'sessions'
        ? await runSessionsCommand(argv.slice(1), values, deps, input)
        : isContextCommand(command)
            ? await runContextCommand(command, input, values)
            : await runCommand(command, deps, input);
    if (isContextCommand(command) && values.json) console.log(renderContextDryRunReport(result, {
        mode: 'json',
        full: values.full || command === 'context-render',
        json: true,
        includeComposerText: values.full || command === 'context-render',
    }));
    else if (values.json) console.log(JSON.stringify(result, null, 2));
    else if (isContextCommand(command)) console.log(renderContextDryRunReport(result, {
        mode: command === 'context-render' || values.full ? 'full' : (values['dry-run'] || 'summary'),
        full: values.full || command === 'context-render',
        json: false,
    }));
    else if (command === 'sessions') printSessionsHuman(result);
    else printHuman(command, result);
    return result;
}

const SESSION_DURATION_RE = /^(\d+)\s*([smhdw]?)$/i;
const DURATION_MS = { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

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
    const factor = DURATION_MS[unit];
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

async function runSessionsCommand(args, values, deps, input) {
    const [sub, ...rest] = args; // args[0] is the subcommand
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
        const vendorExplicit = args.includes('--vendor') || args.some(a => a.startsWith('--vendor='));
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
            olderThanMs,
            ...(values.status ? { status: values.status } : {}),
        });
        return { ok: true, status: 'pruned', ...result, olderThanMs };
    }
}

function printSessionsHuman(result) {
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

async function runContextCommand(command, input, values) {
    const result = values['context-transport'] === 'inline' || values['inline-only']
        ? await buildContextPackageResult(input)
        : await prepareContextForBrowser(input);
    if (command === 'context-render') {
        return { ...result, status: 'rendered' };
    }
    const mode = values['dry-run'] || (values.full ? 'full' : values.json ? 'json' : 'summary');
    return {
        ...result,
        status: 'dry-run',
        dryRunMode: mode,
        filesReport: Boolean(values['files-report']),
    };
}

function isContextCommand(command) {
    return command === 'context-dry-run' || command === 'context-render';
}

async function runCommand(command, deps, input) {
    if (input.vendor === 'gemini') {
        switch (command) {
            case 'render': return renderWebAi(input);
            case 'status': return geminiStatusWebAi(deps, input);
            case 'send': return geminiSendWebAi(deps, input);
            case 'poll': return geminiPollWebAi(deps, input);
            case 'query': return geminiQueryWebAi(deps, input);
            case 'stop': return geminiStopWebAi(deps, input);
            default: throw new Error(`unknown web-ai command: ${command}`);
        }
    }
    if (input.vendor === 'grok') {
        switch (command) {
            case 'render': return renderWebAi(input);
            case 'status': return grokStatusWebAi(deps, input);
            case 'send': return grokSendWebAi(deps, input);
            case 'poll': return grokPollWebAi(deps, input);
            case 'query': return grokQueryWebAi(deps, input);
            case 'stop': return grokStopWebAi(deps, input);
            default: throw new Error(`unknown web-ai command: ${command}`);
        }
    }
    switch (command) {
        case 'render': return renderWebAi(input);
        case 'status': return statusWebAi(deps, input);
        case 'send': return sendWebAi(deps, input);
        case 'poll': return pollWebAi(deps, input);
        case 'query': return queryWebAi(deps, input);
        case 'stop': return stopWebAi(deps, input);
        default: throw new Error(`unknown web-ai command: ${command}`);
    }
}

function rejectFutureScope(values) {
    if (values.vendor && !['chatgpt', 'gemini', 'grok'].includes(values.vendor)) {
        throw new WebAiError({
            errorCode: 'provider.runtime-disabled',
            stage: 'provider-runtime-gate',
            retryHint: 'enable-or-skip',
            message: `unsupported vendor: ${values.vendor}`,
            evidence: { vendor: values.vendor },
        });
    }
    if (values.model && !isSupportedWebAiModel(values.vendor || 'chatgpt', values.model)) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `unsupported ${webAiVendorLabel(values.vendor || 'chatgpt')} model selection: ${values.model}`,
            evidence: { model: values.model },
        });
    }
}

function isSupportedWebAiModel(vendor, model) {
    const key = String(model || '').trim().toLowerCase();
    const byVendor = {
        chatgpt: new Set(['instant', 'fast', 'gpt-5-3', 'gpt-5.3', 'thinking', 'think', 'gpt-5-5-thinking', 'gpt-5.5-thinking', 'pro', 'gpt-5-5-pro', 'gpt-5.5-pro']),
        gemini: new Set(['fast', 'flash', 'gemini-fast', 'thinking', 'think', 'gemini-thinking', 'pro', 'gemini-pro', '3.1-pro', 'deepthink', 'deep-think', 'deep_think', 'deep think', 'gemini-deepthink', 'gemini-deep-think']),
        grok: new Set(['auto', 'automatic', 'fast', 'quick', 'expert', 'thinking', 'think', 'grok-4.3', 'grok43', 'grok-43', 'beta', 'heavy']),
    };
    return Boolean(byVendor[String(vendor || 'chatgpt')]?.has(key));
}

function webAiVendorLabel(vendor) {
    const key = String(vendor || 'chatgpt');
    if (key === 'chatgpt') return 'ChatGPT';
    if (key === 'gemini') return 'Gemini';
    if (key === 'grok') return 'Grok';
    return key;
}

function printHuman(command, result) {
    if (command === 'render') {
        console.log(result.rendered.composerText);
        if (result.warnings?.length) console.error(`[warnings] ${result.warnings.join(', ')}`);
        return;
    }
    if (result.answerText) {
        console.log(result.answerText);
        return;
    }
    console.log(`${result.status}: ${result.url || result.vendor}`);
}
