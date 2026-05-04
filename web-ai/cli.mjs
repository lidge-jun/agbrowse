import { parseArgs } from 'node:util';
import { renderWebAi, statusWebAi, sendWebAi, pollWebAi, queryWebAi, stopWebAi } from './chatgpt.mjs';
import { geminiStatusWebAi, geminiSendWebAi, geminiPollWebAi, geminiQueryWebAi, geminiStopWebAi } from './gemini-live.mjs';
import { grokStatusWebAi, grokSendWebAi, grokPollWebAi, grokQueryWebAi, grokStopWebAi } from './grok-live.mjs';
import { buildContextPackageResult, prepareContextForBrowser, renderContextDryRunReport } from './context-pack/index.mjs';
import { WebAiError, wrapError } from './errors.mjs';
import { runDoctor } from './doctor.mjs';
import { maybeRecordChurn } from './churn-log.mjs';
import { watchSession } from './watcher.mjs';
import { buildWebAiSnapshot } from './ax-snapshot.mjs';
import { runSessionsCommand, printSessionsHuman, parseDurationToMs } from './cli-sessions.mjs';
import { createTab, waitForPageByTargetId } from '../skills/browser/tab-manager.mjs';
import { cleanupIdleTabs } from '../skills/browser/tab-lifecycle.mjs';
import { withSessionPage } from './tab-recovery.mjs';
import { withSessionCommandLock } from './session-store.mjs';
import { cleanupPoolTabs, getPooledTab } from './tab-pool.mjs';
import { runMcpServer } from './mcp-server.mjs';
export { parseDurationToMs };

const VENDOR_DEFAULT_URLS = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com',
    grok: 'https://grok.com',
};

const COMMANDS = new Set([
    'render', 'status', 'send', 'poll', 'query', 'stop',
    'watch', 'snapshot',
    'sessions', 'doctor',
    'context-dry-run', 'context-render',
    'mcp-server',
]);
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
  watch               Watch a persisted session until terminal status
  snapshot            Print a compact accessibility snapshot for the active provider tab
  sessions <sub>      Manage persisted sessions: list | show | resume | reattach | prune
  context-dry-run     Build a context package without sending
  context-render      Render full prompt/context package text
  mcp-server          Run stdio MCP bridge exposing web-ai tools

Provider:
  --vendor <name>     chatgpt | gemini | grok (default: chatgpt)
  --url <url>         Navigate or verify the provider URL before mutation
  --model <alias>     Provider model alias; aliases below
                        ChatGPT: instant, thinking, pro
                        Gemini  models: fast, thinking, pro
                        Gemini  tool:   deepthink
                        Grok:   auto, fast, expert, thinking, heavy
  --effort <alias>    ChatGPT reasoning effort. Requires --model because
                      Pro and Thinking expose different effort menus.
                        Pro: standard, extended
                        Thinking: light, standard, extended, heavy
  --reasoning-effort <alias>
                      Alias for --effort
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
  --new-tab           Create a new tab for this send/query (default in Phase 9.1)
  --reuse-tab         Reuse the existing active tab (legacy single-tab behavior)

Tab lease policy:
  Completed provider tabs are runtime leases, not history storage.
  The pool keeps at most one warm owned tab per owner/vendor/sessionType/origin/profile
  key for 5 minutes; expired or overflow pooled tabs are closed with CDP.
  Use "agbrowse tab-cleanup --json" to inspect leaseClosedTabs.

Sessions subcommands:
  agbrowse web-ai sessions list   [--vendor <v>] [--status <s>] [--limit N] [--json]
  agbrowse web-ai sessions show   <sessionId> [--json]
  agbrowse web-ai sessions resume <sessionId> [--allow-copy-markdown-fallback] [--timeout <s>]
  agbrowse web-ai sessions reattach <sessionId> [--navigate]
  agbrowse web-ai sessions prune  [--older-than 30d] [--status <s>]
                      Duration accepts s | m | h | d | w (default unit d).

Watcher:
  agbrowse web-ai watch --session <id> [--interval 15s] [--poll-timeout 30] [--navigate] [--json]
                      Long-running stdout notifier for one persisted session.
                      One watcher per session is enforced by a lock file.

Snapshot:
  agbrowse web-ai snapshot --vendor <v> [--interactive] [--compact] [--json]
                      Compact Playwright-MCP-style accessibility snapshot.

MCP:
  agbrowse web-ai mcp-server
                      Starts a stdio JSON-RPC MCP server with tools/list and
                      tools/call. Tool schemas are exported from
                      web-ai/tool-schema.mjs for AI SDK consumers.

Doctor snapshot:
  agbrowse web-ai doctor --vendor <v> --snapshot interactive [--json]
                      Adds content-safe snapshot stats and semantic target candidates.

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
         watcher.session-missing | watcher.already-running |
         snapshot.unavailable | snapshot.ref-stale |
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

  # Watch from a supervisor or terminal until complete.
  agbrowse web-ai watch --session "$SID" --interval 15s --poll-timeout 30 --navigate
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
    if (!command || command === '--help' || command === 'help') {
        console.log(WEB_AI_USAGE.trim());
        return { ok: true, status: 'help' };
    }
    if (argv.includes('--help')) {
        console.log(WEB_AI_USAGE.trim());
        return { ok: true, status: 'help' };
    }
    if (!COMMANDS.has(command)) {
        throw new Error(WEB_AI_USAGE.trim());
    }
    if (command === 'mcp-server') {
        await runMcpServer(deps);
        return { ok: true, status: 'mcp-server-stopped' };
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
            effort: { type: 'string' },
            'reasoning-effort': { type: 'string' },
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
            interval: { type: 'string' },
            'poll-timeout': { type: 'string' },
            'max-iterations': { type: 'string' },
            once: { type: 'boolean', default: false },
            interactive: { type: 'boolean', default: true },
            compact: { type: 'boolean', default: true },
            snapshot: { type: 'string' },
            'max-depth': { type: 'string' },
            'root-selector': { type: 'string' },
            full: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            'cache-metrics': { type: 'boolean', default: false },
            'new-tab': { type: 'boolean', default: false },
            'reuse-tab': { type: 'boolean', default: false },
        },
        strict: false,
    });

    rejectFutureScope(values);
    const vendorExplicit = argv.slice(1).includes('--vendor') || argv.slice(1).some(a => a.startsWith('--vendor='));
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
        vendor: (command === 'watch' && !vendorExplicit) ? null : values.vendor,
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
        reasoningEffort: values.effort || values['reasoning-effort'],
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
        interval: values.interval,
        pollTimeoutSec: values['poll-timeout'],
        maxIterations: values['max-iterations'],
        once: values.once === true,
        json: values.json === true,
        interactive: values.interactive !== false,
        compact: values.compact !== false,
        snapshotOption: values.snapshot,
        maxDepth: values['max-depth'],
        rootSelector: values['root-selector'],
        newTab: values['new-tab'] === true || (['send', 'query'].includes(command) && values['reuse-tab'] !== true && process.env.AGBROWSE_REUSE_TAB !== '1'),
        reuseTab: values['reuse-tab'] === true || process.env.AGBROWSE_REUSE_TAB === '1',
    };

    const result = command === 'watch'
        ? await watchSession(deps, input)
        : command === 'snapshot'
            ? await runSnapshotCommand(deps, input, values)
            : command === 'doctor'
                ? await runDoctorWithChurn(deps, { vendor: input.vendor, full: values.full, snapshot: values.snapshot, cacheMetrics: values['cache-metrics'] })
                : command === 'sessions'
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
    else if (command === 'watch') printWatchHuman(result);
    else if (command === 'snapshot') printSnapshotHuman(result);
    else if (command === 'doctor') printDoctorHuman(result);
    else if (command === 'sessions') printSessionsHuman(result);
    else printHuman(command, result);
    return result;
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

async function ensureProviderTab(deps, input) {
    if (!input.newTab || input.reuseTab) return deps;
    const vendorUrl = input.url || VENDOR_DEFAULT_URLS[input.vendor || 'chatgpt'];
    const port = deps.getPort?.() || 9222;

    await cleanupPoolTabs(port);
    await cleanupIdleTabs(port, { maxTabs: Number.POSITIVE_INFINITY });

    // Phase 9.2: try tab pool first
    const pooled = await getPooledTab(port, input.vendor || 'chatgpt', {
        owner: 'web-ai',
        sessionType: 'send-poll',
        url: vendorUrl,
        port,
    });
    if (pooled) {
        const page = await waitForPageByTargetId(port, pooled.targetId);
        if (page.url() !== vendorUrl) {
            await page.goto(vendorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
        return {
            ...deps,
            getPage: async () => {
                if (page.isClosed?.()) throw new Error(`bound tab closed: ${pooled.targetId}`);
                return page;
            },
            getTargetId: async () => pooled.targetId,
            getCdpSession: async () => page.context().newCDPSession(page),
        };
    }

    // Phase 9.1 fix: create tab WITHOUT activate (avoids focus race)
    const tab = await createTab(port, vendorUrl, { activate: false });
    const page = await waitForPageByTargetId(port, tab.targetId);
    return {
        ...deps,
        getPage: async () => {
            if (page.isClosed?.()) throw new Error(`bound tab closed: ${tab.targetId}`);
            return page;
        },
        getTargetId: async () => tab.targetId,
        getCdpSession: async () => page.context().newCDPSession(page),
    };
}

async function runBoundCommand(command, deps, input, pollFn, stopFn) {
    if (['poll', 'stop'].includes(command) && input.session) {
        return withSessionCommandLock(input.session, async () => {
            return withSessionPage(deps, input.session, async ({ page, targetId, session }) => {
                const sessionDeps = {
                    ...deps,
                    getPage: async () => page,
                    getTargetId: async () => targetId,
                    getCdpSession: async () => page.context().newCDPSession(page),
                };
                if (command === 'poll') return pollFn(sessionDeps, { ...input, vendor: session.vendor, session: session.sessionId });
                if (command === 'stop') return stopFn(sessionDeps, { ...input, vendor: session.vendor, session: session.sessionId });
            });
        });
    }
    if (command === 'poll') return pollFn(deps, input);
    if (command === 'stop') return stopFn(deps, input);
    throw new Error(`runBoundCommand: unsupported command ${command}`);
}

async function runCommand(command, deps, input) {
    // Phase 9.1: create new tab per session for send/query
    if (['send', 'query'].includes(command)) {
        deps = await ensureProviderTab(deps, input);
    }

    if (input.vendor === 'gemini') {
        switch (command) {
            case 'render': return renderWebAi(input);
            case 'status': return geminiStatusWebAi(deps, input);
            case 'send': return geminiSendWebAi(deps, input);
            case 'poll': return runBoundCommand(command, deps, input, geminiPollWebAi, geminiStopWebAi);
            case 'query': return geminiQueryWebAi(deps, input);
            case 'stop': return runBoundCommand(command, deps, input, geminiPollWebAi, geminiStopWebAi);
            default: throw new Error(`unknown web-ai command: ${command}`);
        }
    }
    if (input.vendor === 'grok') {
        switch (command) {
            case 'render': return renderWebAi(input);
            case 'status': return grokStatusWebAi(deps, input);
            case 'send': return grokSendWebAi(deps, input);
            case 'poll': return runBoundCommand(command, deps, input, grokPollWebAi, grokStopWebAi);
            case 'query': return grokQueryWebAi(deps, input);
            case 'stop': return runBoundCommand(command, deps, input, grokPollWebAi, grokStopWebAi);
            default: throw new Error(`unknown web-ai command: ${command}`);
        }
    }
    switch (command) {
        case 'render': return renderWebAi(input);
        case 'status': return statusWebAi(deps, input);
        case 'send': return sendWebAi(deps, input);
        case 'poll': return runBoundCommand(command, deps, input, pollWebAi, stopWebAi);
        case 'query': return queryWebAi(deps, input);
        case 'stop': return runBoundCommand(command, deps, input, pollWebAi, stopWebAi);
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
    const effort = values.effort || values['reasoning-effort'];
    if (effort && !values.model) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `${webAiVendorLabel(values.vendor || 'chatgpt')} reasoning effort requires --model because effort menus differ by model`,
            evidence: { effort },
        });
    }
    if (effort && !isSupportedWebAiEffort(values.vendor || 'chatgpt', values.model, effort)) {
        throw new WebAiError({
            errorCode: 'provider.model-mismatch',
            stage: 'provider-select-mode',
            vendor: values.vendor || 'chatgpt',
            retryHint: 'model-fallback',
            message: `unsupported ${webAiVendorLabel(values.vendor || 'chatgpt')} reasoning effort: ${effort}`,
            evidence: { effort },
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

function isSupportedWebAiEffort(vendor, model, effort) {
    if (String(vendor || 'chatgpt') !== 'chatgpt') return false;
    const effortKey = String(effort || '').trim().toLowerCase();
    const normalizedEffort = ({
        light: 'light',
        low: 'light',
        standard: 'standard',
        normal: 'standard',
        regular: 'standard',
        default: 'standard',
        extended: 'extended',
        high: 'extended',
        heavy: 'heavy',
    })[effortKey];
    if (!normalizedEffort) return false;
    const modelKey = String(model || '').trim().toLowerCase();
    const normalizedModel = ({
        thinking: 'thinking',
        think: 'thinking',
        'gpt-5-5-thinking': 'thinking',
        'gpt-5.5-thinking': 'thinking',
        pro: 'pro',
        'gpt-5-5-pro': 'pro',
        'gpt-5.5-pro': 'pro',
    })[modelKey];
    if (normalizedModel === 'thinking') return ['light', 'standard', 'extended', 'heavy'].includes(normalizedEffort);
    if (normalizedModel === 'pro') return ['standard', 'extended'].includes(normalizedEffort);
    return false;
}

function webAiVendorLabel(vendor) {
    const key = String(vendor || 'chatgpt');
    if (key === 'chatgpt') return 'ChatGPT';
    if (key === 'gemini') return 'Gemini';
    if (key === 'grok') return 'Grok';
    return key;
}

async function runDoctorWithChurn(deps, options) {
    const report = await runDoctor(deps, options);
    const churnRecords = maybeRecordChurn(report);
    if (churnRecords.length) {
        report.warnings = [...(report.warnings || []), `churn-log-recorded:${churnRecords.length}`];
    }
    return report;
}

function printDoctorHuman(report) {
    const worst = report.features.reduce((w, f) => {
        const rank = { fail: 3, warn: 2, ok: 1, unknown: 0 };
        return (rank[f.state] || 0) > (rank[w] || 0) ? f.state : w;
    }, 'ok');
    console.log(`doctor ${report.vendor}  worst=${worst}  ${report.url}`);
    console.log(`captured: ${report.capturedAt}`);
    for (const f of report.features) {
        const matches = f.selectorMatches.length;
        const tried = f.selectorsTried.length;
        console.log(`  ${f.state.padEnd(4)}  ${f.feature.padEnd(22)}  ${matches}/${tried} selectors  ${f.domHash}`);
    }
    if (report.lastSession) {
        console.log(`  session: ${report.lastSession.sessionId} (${report.lastSession.status})`);
    }
    if (report.warnings?.length) {
        console.log(`  warnings: ${report.warnings.join(', ')}`);
    }
    if (report.cacheMetrics) {
        console.log('');
        console.log('Cache Metrics (last 7 days):');
        console.log(`  Hit rate: ${(report.cacheMetrics.cacheHitRate * 100).toFixed(1)}%`);
        console.log(`  Self-heal rate: ${(report.cacheMetrics.selfHealRate * 100).toFixed(1)}%`);
        console.log(`  False heals: ${report.cacheMetrics.falseHeals}`);
        console.log(`  Avg duration: ${report.cacheMetrics.avgDurationMs.toFixed(0)}ms`);
    }
}

async function runSnapshotCommand(deps, input, values) {
    const page = await deps.getPage();
    return buildWebAiSnapshot(page, {
        provider: input.vendor,
        compact: values.compact !== false,
        interactiveOnly: values.interactive !== false,
        maxDepth: values['max-depth'] ? Number(values['max-depth']) : 6,
        rootSelector: values['root-selector'] || null,
    });
}

function printWatchHuman(result) {
    if (!result || result.eventsPrinted) return;
    console.log(`watch ${result.sessionId}: ${result.status}`);
}

function printSnapshotHuman(result) {
    console.log(result.text);
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
