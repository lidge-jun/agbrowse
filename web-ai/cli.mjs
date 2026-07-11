// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { parseArgs } from 'node:util';
import { renderWebAi, statusWebAi, sendWebAi, pollWebAi, queryWebAi, stopWebAi, deepResearchWebAi } from './chatgpt.mjs';
import { codeWebAi, extractCodeArtifacts } from './code-mode.mjs';
import { geminiStatusWebAi, geminiSendWebAi, geminiPollWebAi, geminiQueryWebAi, geminiStopWebAi } from './gemini-live.mjs';
import { grokStatusWebAi, grokSendWebAi, grokPollWebAi, grokQueryWebAi, grokStopWebAi } from './grok-live.mjs';
import { isWorkSession, pollWorkSession, submitWorkPrompt } from './chatgpt-work-picker.mjs';
import { buildContextPackageResult, prepareContextForBrowser, renderContextDryRunReport } from './context-pack/index.mjs';
import { WebAiError, wrapError } from './errors.mjs';
import { runDoctor } from './doctor.mjs';
import { maybeRecordChurn } from './churn-log.mjs';
import { watchSession } from './watcher.mjs';
import { buildWebAiSnapshot } from './ax-snapshot.mjs';
import { runSessionsCommand, printSessionsHuman, parseDurationToMs } from './cli-sessions.mjs';
import { isChatGptEffortSupported, normalizeChatGptFamilyChoice } from './chatgpt-model.mjs';
import { createTab, listManagedTabs, waitForPageByTargetId } from '../skills/browser/tab-manager.mjs';
import { cleanupIdleTabs, isPinned, DEFAULT_MAX_TABS } from '../skills/browser/tab-lifecycle.mjs';
import { resolveSessionPage, withSessionPage } from './tab-recovery.mjs';
import { withSessionCommandLock } from './session-store.mjs';
import { listSessions, getSession, resolveTimeoutDefaultSec } from './session.mjs';
import { resolveImplicitSessionSelection } from './session-target-guard.mjs';
import { listLeases } from './tab-lease-store.mjs';
import { cleanupPoolTabs, getPooledTab } from './tab-pool.mjs';
import { finalizeProviderTab } from './tab-finalizer.mjs';
import { runMcpServer } from './mcp-server.mjs';
import { runWebAiEval } from './eval-runner.mjs';
import { createTraceId } from './trace/types.mjs';
import { writeCommandTrace } from './trace/writer.mjs';
import { enforcePolicy } from './policy/enforce.mjs';
import { loadPolicy } from './policy/schema.mjs';
import { applyProviderDefaults } from './policy/default-policy.mjs';
import { activeCommandTargetIds, withActiveCommand } from './active-command-store.mjs';
import { auditSources } from './source-audit.mjs';
import { isProviderPageDriveable, shouldNavigateToRequestedProviderUrl, waitForPageUrl } from './navigation-ready.mjs';
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
    'mcp-server', 'eval', 'claim-audit',
   'project-sources', 'code', 'code-extract',
    'work',
]);

const BROWSER_REQUIRED_COMMANDS = new Set(['status', 'send', 'poll', 'query', 'stop', 'watch', 'snapshot', 'doctor', 'project-sources', 'code', 'code-extract']);
const BROWSER_REQUIRED_SESSION_COMMANDS = new Set(['resume', 'reattach', 'doctor']);
export const WEB_AI_USAGE = `
Usage:
  agbrowse web-ai <command> --vendor <chatgpt|gemini|grok> [options]

Agent skill setup:
  agbrowse skills get web-ai
                      Print the bundled web-ai SKILL.md; load it before
                      agent-driven provider automation.
  agbrowse skills install --target <dir>
                      Install browser/web-ai skills into an explicit agent
                      skill root. Skills are never installed implicitly.

Commands:
  render              Render the prompt envelope without opening a browser
  status              Check active provider tab state
  send                Send a prompt; returns a sessionId for later resume
  poll                Poll a session for completion. Without --session:
                      0 active sessions use the current baseline/tab, 1 active
                      provider session auto-binds, 2+ fail closed with candidates.
  query               send + poll in one call
  stop                Interrupt generation. stop --session <id> targets that
                      session-bound tab even while a poll is running; without
                      --session: 0 active uses current tab, 1 active auto-binds,
                      2+ active provider sessions fail closed.
  watch               Watch a persisted session until terminal status
  snapshot            Print a compact accessibility snapshot for the active provider tab
  sessions <sub>      Manage persisted sessions: list | show | resume | reattach | doctor | prune
  context-dry-run     Build a context package without sending
  context-render      Render full prompt/context package text
  project-sources     ChatGPT Project Sources list/add; append-only, explicit project URL required
  code                ChatGPT-only. Send a strict code-mode contract prompt, then
                      retrieve the generated /mnt/data/result.zip headlessly
                      (no button click) and verify it. --prompt = build spec,
                      --output-zip = save path. Best with --model thinking.
                      Automatically uploads the saved GPT dev-agent context zip
                      first and requires PLAN.md or 00_plan.md inside new code
                      artifacts.
                      --multi-zip allows several named archives (e.g.
                      frontend.zip + backend.zip); saved into --output-dir.
  code-extract        ChatGPT-only. Re-retrieve existing code-mode zip artifacts
                      from a saved conversation without sending a new prompt.
                      Use --url <chatgpt conversation URL>, --conversation
                      <id|url>, --session <id>, or the currently open
                      ChatGPT conversation tab. Plain assistant text such as
                      /mnt/data/result.zip is enough when the original
                      conversation is still accessible.
  mcp-server          Run stdio MCP bridge exposing web-ai tools
  eval                Run offline provider DOM fixture evals; never opens Chrome
  claim-audit         Scan repo docs for forbidden hosted/cloud/stealth claims (G10).
                      No browser, no provider. Use --json for machine-readable output.

Provider:
  --vendor <name>     chatgpt | gemini | grok (default: chatgpt)
  --url <url>         Navigate or verify the provider URL before mutation
  --model <alias>     Provider model alias; aliases below
                        ChatGPT: instant, thinking, pro
                        Gemini  models: flash-lite, flash, pro
                        Gemini  tool:   deepthink
                        Grok:   auto, fast, expert, thinking, heavy
  --effort <alias>    ChatGPT reasoning effort. The reasoning-effort menu is
                      ONLY touched when this flag is provided; otherwise the
                      currently-checked effort in the browser is left as-is.
                      Requires a model because legacy Pro/Thinking menus and the
                      simplified Intelligence menu map efforts differently.
                        Pro: standard, extended
                        Thinking: light, standard, extended, heavy
  --reasoning-effort <alias>
                      Alias for --effort
  --timeout <sec>     Polling timeout. When omitted, the default scales by model tier:
                      instant 120s, thinking 600s, pro/deep-research 3600s (vendor
                      default 1200/1200/600 for unknown models). --timeout overrides.

Prompt envelope (every prompt also gets a [INSTRUCTIONS] block telling the
model to use web search and cite sources inline):
  --prompt <text>     Main user prompt/question (required)
  --system <text>     Trusted operating/role instructions — the channel for skill
                      guidance and "how to behave". Honored, not treated as data.
                      Put instructions HERE, not in --context.
  --project <text>    Project name
  --goal <text>       Task goal
  --context <text>    UNTRUSTED reference data only (scraped text, provider output).
                      Rendered as [UNTRUSTED_CONTEXT]; instructions placed here are
                      ignored by design. For a file the model should read, use --file.
  --question <text>   Alias for prompt detail
  --output <text>     Output preference
  --constraints <txt> Constraints to include in the prompt

Attachments and context:
  --inline-only                     Required for send/query without files
  --file <path>                     Upload a file; repeat for several files of
                                    mixed types (zip + image + doc) in one turn
  --tool <name>                     ChatGPT composer tool to select before send;
                                    repeatable. Known: image, deep-research,
                                    web-search, agent-mode, tasks.
  --plugin <name>                   ChatGPT "More" plugin/tool to select;
                                    repeatable. Known: github, gmail,
                                    google-drive, google-calendar, supabase,
                                    vercel, figma, canva, context7.
  --web-search                      Shortcut for --tool web-search.
  --auto-tools                      Heuristically select non-auth ChatGPT tools
                                    from the prompt (current/news → web search,
                                    image intent → image, deep research intent
                                    → deep research). Plugins/connectors require
                                    explicit --plugin because they may open auth.
  --output-image <path>             Save generated ChatGPT images. If several
                                    images are returned, siblings are written
                                    as out.png, out-2.png, out-3.png.
  --follow-up <text>                Repeatable ChatGPT batch follow-up prompt
                                    in the same command. For a later follow-up
                                    in an existing conversation, use query
                                    --session <id> --prompt <text>. Not
                                    compatible with --research deep.
  --research deep                   Experimental ChatGPT Deep Research mode.
                                    ChatGPT only; not compatible with follow-ups.
                                    Keeps Deep Research's default source state;
                                    Apps/Sites/connectors are not configured
                                    unless a future explicit flag requests them.
  --max-upload-file-size <bytes>    Per-file live upload cap for --file.
  --attachment-upload-timeout-ms <ms>
                                    Timeout for browser file handoff before the
                                    provider processes the upload. Env fallback:
                                    AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS.
  --max-context-file-size <bytes>   Preferred name for per-file context budget.
  --context-from-files <glob|path>  Add files to a context package; repeatable
  --context-exclude <glob>          Exclude from the package; repeatable
  --context-file <path>             Use a prebuilt context package file
  --context-transport <upload|inline>
  --max-input <chars>               Inline prompt budget
  --max-file-size <bytes>           Legacy alias for --max-context-file-size
  --files-report                    Include file report metadata
  --allow-copy-markdown-fallback    Explicitly permit provider Copy button capture after DOM response
  --allow-grok-context-pack         Override Grok hard-gate (Grok prefers inline + single --file)
  --require-source-audit            Fail closed when completed answers lack inline sources
  --source-audit-ratio <0..1>       Required sourced claim ratio (default 1)
  --source-audit-scope <text>       Checked scope for absence/no-result claims
  --source-audit-date <text>        Checked date for absence/no-result claims
  --trace-dir <dir>                 Write redacted JSONL trace evidence for non-render commands
  --policy <path>                   Enforce action policy before browser mutation
  --unsafe-allow <name>             Explicit unsafe allowance; repeatable

Sessions (durable across shells, stored at $BROWSER_AGENT_HOME/web-ai-sessions.json):
  --session <id>      Resume a session by id on poll / query / stop.
                      Resolution priority: --session > active target id >
                      vendor latest > legacy baseline.
                      query --session <id> sends a new prompt in the same
                      saved conversation tab; poll/sessions resume only wait
                      for an already-sent response.
                      For shared CDP ports, pass --session when multiple active
                      provider sessions exist; ambiguity errors include
                      candidates: [{ sessionId, targetId, vendor, conversationUrl }].
  --deadline <iso>    Override the session deadline (default now + --timeout
                      or the vendor polling default).
  --navigate          When sessions reattach finds a tab mismatch, allow
                      the runtime to switch tabs to the saved conversationUrl.
  --new-tab           Force a fresh provider tab for this send/query
                      (default reuses pooled or inactive provider tabs first)
  --parallel          Alias for --new-tab. Use when you want to run a Pro
                      query without contending with another in-flight one.
  --reuse-tab         Reuse the existing active tab (legacy single-tab behavior)

Browser:
  Provider commands auto-start headed Chrome when CDP is not running.
  Set AGBROWSE_WEB_AI_AUTO_START=0 to fail closed instead.
  Existing headless CDP sessions are rejected; restart with "agbrowse start --headed".

Tab lease policy:
  Completed provider tabs are runtime leases, not history storage.
  Pool defaults: maxPerKey=3, globalMax=8, TTL=30m. Per-key limit is the
  number of warm pooled tabs allowed per
  (owner,vendor,sessionType,origin,profile). Override via
  AGBROWSE_PROVIDER_POOL_MAX_PER_KEY / _GLOBAL_MAX / _TTL.
  Active session caps default to per-key=5 and global=14. Override via
  AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY / _GLOBAL_MAX.
  Expired or overflow pooled tabs are closed with CDP.
  Use --new-tab / --parallel to bypass pool reuse for a single call.
  Use "agbrowse tab-cleanup --json" to inspect leaseClosedTabs.

Sessions subcommands:
  agbrowse web-ai sessions list   [--vendor <v>] [--status <s>] [--limit N] [--json]
  agbrowse web-ai sessions show   <sessionId> [--json]
  agbrowse web-ai sessions resume <sessionId> [--allow-copy-markdown-fallback] [--timeout <s>]
  agbrowse web-ai sessions reattach <sessionId> [--navigate]
  agbrowse web-ai sessions doctor   <sessionId> [--navigate] [--json]
  agbrowse web-ai sessions prune  [--older-than 30d] [--status <s>]
                      Duration accepts s | m | h | d | w (default unit d).

Watcher:
  agbrowse web-ai watch --session <id> [--interval 15s] [--poll-timeout 30] [--navigate] [--json]
                      Long-running stdout notifier for one persisted session.
                      One watcher per session is enforced by a lock file.

Snapshot:
  agbrowse web-ai snapshot --vendor <v> [--interactive] [--compact] [--json]
                      Compact Playwright-MCP-style accessibility snapshot.

Project Sources:
  agbrowse web-ai project-sources list --chatgpt-url <project-url> [--json]
  agbrowse web-ai project-sources add  --chatgpt-url <project-url> --file <path>... [--dry-run summary] [--json]
                      ChatGPT Project Sources are append-only in agbrowse.
                      --dry-run validates URL and files without browser mutation.
                      Always pass the explicit ChatGPT project URL; active tab
                      inference is intentionally unsupported.

MCP:
  agbrowse web-ai mcp-server
                      Starts a stdio JSON-RPC MCP server with tools/list and
                      tools/call. Tool schemas are exported from
                      web-ai/tool-schema.mjs for AI SDK consumers.

Eval:
  agbrowse web-ai eval --vendor <v> --fixtures test/fixtures/provider-dom [--json]
                      Offline, non-mutating provider DOM fixture harness.
                      Does not use the persisted Chrome profile, provider tabs,
                      sessions, tab pool, clipboard, downloads, screenshots, or
                      live provider modules.
  --config <path>     Run an explicit eval fixture config JSON.
  --variant <name>    Restrict fixture variants; repeatable.
  --concurrency <n>   Bounded fixture concurrency, integer 1..4 (default 1).
  --update-golden     Update ChatGPT golden eval JSON from the current run.

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
         session.target-ambiguous |
         watcher.session-missing | watcher.already-running |
         snapshot.unavailable | snapshot.ref-stale |
         context.over-budget | context.symlink-rejected |
         code-mode.vendor-unsupported | code-mode.prompt-missing |
         code-mode.output-conflict | code-mode.conversation-id-missing |
         code-extract.conversation-id-missing |
         code-extract.navigation-failed |
         code-artifact:missing | code-artifact:download-failed |
         code-artifact:plan-missing |
         grok.context-pack-not-allowed | internal.unhandled

Capability boundary: web-ai query uses the existing local browser automation
skill for chatgpt, gemini, and grok. G09 does not add provider API clients,
API-key auth, hosted model routing, or MCP model tools. API model adapters
are explicitly deferred and unavailable in this release.

Examples:
  agbrowse web-ai render  --vendor chatgpt --prompt "hello" --json
  agbrowse web-ai query   --vendor grok    --inline-only --prompt "Reply OK"
  agbrowse web-ai query   --vendor gemini  --model deepthink --inline-only --prompt "Reply OK"
  agbrowse web-ai query   --vendor chatgpt --context-from-files "src/**/*.ts" \\
                                          --context-transport upload --prompt "Review this"
  agbrowse web-ai query   --vendor chatgpt --inline-only --output-image ./out.png \\
                                          --prompt "Create a diagram image"
  agbrowse web-ai query   --vendor chatgpt --inline-only --follow-up "Summarize risks" \\
                                          --prompt "Analyze this design"
  agbrowse web-ai query   --vendor chatgpt --session "$SID" --inline-only \\
                                          --output-image ./next.png \\
                                          --prompt "Create another image in this same conversation"
  agbrowse web-ai code    --vendor chatgpt --model thinking --effort standard \\
                                          --prompt "Build an MVP" --output-zip ./result.zip

  # Re-retrieve a zip from an existing ChatGPT code-mode conversation.
  agbrowse web-ai code-extract --vendor chatgpt \\
          --url "https://chatgpt.com/c/<conversation-id>" \\
          --output-zip ./result.zip

  # Re-retrieve every zip mentioned in an existing conversation.
  agbrowse web-ai code-extract --vendor chatgpt \\
          --url "https://chatgpt.com/c/<conversation-id>" \\
          --multi-zip --output-dir ./artifacts

  # Long-running Pro: send returns sessionId; resume from any shell later.
  SID=$(agbrowse web-ai send --vendor chatgpt --inline-only \\
          --prompt "..." --json | jq -r .sessionId)
  agbrowse web-ai poll --vendor chatgpt --session "$SID" --timeout 1800

  # Watch from a supervisor or terminal until complete.
  agbrowse web-ai watch --session "$SID" --interval 15s --poll-timeout 30 --navigate
`;

export const WEB_AI_CODE_USAGE = `
Usage:
  agbrowse web-ai code --vendor chatgpt --prompt <build-spec> [options]

What it does:
  ChatGPT-only code generation through the visible ChatGPT web UI. This is a
  subcommand, not a --code flag. It sends a strict code-mode contract prompt,
  automatically uploads the saved GPT dev-agent context zip first, waits for
  ChatGPT to create /mnt/data/*.zip in its sandbox, retrieves the archive
  headlessly through the provider download API, verifies the zip, and writes it
  locally.

Required:
  --prompt <text>       Build spec for ChatGPT.

Recommended model:
  --model thinking      Use ChatGPT thinking mode for code work.
  --effort <alias>      thinking: light|standard|extended|heavy
                        pro: standard|extended

Artifact options:
  --output-zip <path>   Save one generated zip to this path.
                        Default: ./code-artifact-<conversation>.zip.
  --multi-zip           Retrieve several named /mnt/data/*.zip artifacts.
  --output-dir <dir>    Save multi-zip artifacts into this directory.
                        Default: ./code-artifacts-<conversation>/.

Optional inputs:
  --file <path>         Repeatable upload; may mix zip, image, PDF, docs, text.
  --context-from-files <glob|path>
  --context-exclude <glob>
  --context-file <path>
  --context-transport <upload|inline>
  --context-refresh     Re-upload the dev-agent context zip on a continuation
                        turn. By default it is attached only on the FIRST turn
                        of a conversation; continuation turns (--url /
                        --conversation / --session) skip it.

Behavior:
  New code artifacts must include PLAN.md or 00_plan.md at the zip root.
  The visible turn_plan.update_turn_plan checklist is best-effort and may be
  transient; the plan file inside the zip is the durable checklist.
  The final ChatGPT answer should include both:
    DOWNLOAD: [result.zip](sandbox:/mnt/data/result.zip)
    MACHINE: /mnt/data/result.zip

Examples:
  agbrowse web-ai code --vendor chatgpt --model thinking --effort standard \\
          --prompt "Create a Flask hello-world MVP." \\
          --output-zip ./result.zip

  agbrowse web-ai code --vendor chatgpt --model thinking --effort heavy \\
          --multi-zip --output-dir ./artifacts \\
          --prompt "Create backend.zip and frontend.zip as separate deliverables."

After extraction:
  unzip -t ./result.zip
  unzip -l ./result.zip
`;

export const WEB_AI_CODE_EXTRACT_USAGE = `
Usage:
  agbrowse web-ai code-extract --vendor chatgpt [conversation selector] [options]

What it does:
  ChatGPT-only artifact re-extraction. It does not send a new prompt. It scans
  the saved ChatGPT conversation JSON for /mnt/data/*.zip paths, mints the
  provider download URL, fetches the cookie-bound payload inside the page,
  validates the zip, and writes it locally.

Conversation selector:
  --url <chatgpt conversation URL>
  --conversation <id|url>
  --session <sessionId>
  Or omit these when the target ChatGPT conversation tab is already open.

Artifact options:
  --output-zip <path>   Save one recovered zip to this path.
                        Default: ./code-artifact-<conversation>.zip.
  --multi-zip           Recover every mentioned /mnt/data/*.zip artifact.
  --output-dir <dir>    Save multi-zip artifacts into this directory.
                        Default: ./code-artifacts-<conversation>/.

Requirements:
  The original conversation must still be accessible in the logged-in ChatGPT
  browser profile. A copied /mnt/data/result.zip text line alone is not enough.

Examples:
  agbrowse web-ai code-extract --vendor chatgpt \\
          --url "https://chatgpt.com/c/<conversation-id>" \\
          --output-zip ./result.zip

  agbrowse web-ai code-extract --vendor chatgpt \\
          --url "https://chatgpt.com/c/<conversation-id>" \\
          --multi-zip --output-dir ./artifacts
`;

/**
 * @param {string|undefined} command
 */
function usageForCommand(command) {
    if (command === 'code') return WEB_AI_CODE_USAGE.trim();
    if (command === 'code-extract') return WEB_AI_CODE_EXTRACT_USAGE.trim();
    return WEB_AI_USAGE.trim();
}

/**
 * @param {any} argv
 * @param {any} deps
 */
export async function runWebAiCli(argv = [], deps) {
    try {
        return await runWebAiCliInner(argv, deps);
    } catch (err) {
        const wrapped = wrapError(err);
        const traceDir = readFlagValue(argv, '--trace-dir');
        const command = argv[0] || 'help';
        if (traceDir && command !== 'render') {
            wrapped.traceId = wrapped.traceId || createTraceId(`${command}:${wrapped.errorCode}:${Date.now()}`);
            await writeCommandTrace(traceDir, {
                traceId: wrapped.traceId,
                command: `web-ai ${command}`,
                provider: readFlagValue(argv, '--vendor') || 'chatgpt',
                status: 'error',
                errorEnvelope: wrapped.toJSON(),
            }).catch(() => null);
        }
        emitCliError(wrapped, argv);
        (/** @type {any} */ (wrapped)).alreadyReported = true;
        throw wrapped;
    }
}

/**
 * @param {any} err
 * @param {any} argv
 */
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

/**
 * @param {any} argv
 * @param {any} flag
 */
function readFlagValue(argv = [], flag) {
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === flag) return argv[i + 1];
        if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    }
    return undefined;
}

/**
 * @param {any} argv
 * @param {any} deps
 */
async function runWebAiCliInner(argv = [], deps) {
    const command = argv[0];
    if (!command || command === '--help' || command === 'help') {
        console.log(WEB_AI_USAGE.trim());
        return { ok: true, status: 'help' };
    }
    if (argv.includes('--help')) {
        console.log(usageForCommand(command));
        return { ok: true, status: 'help' };
    }
    if (!COMMANDS.has(command)) {
        throw new Error(WEB_AI_USAGE.trim());
    }
    if (command === 'mcp-server') {
        await runMcpServer(deps);
        return { ok: true, status: 'mcp-server-stopped' };
    }
    if (command === 'claim-audit') {
        const { auditClaims, formatClaimAuditReport } = await import('./claim-audit.mjs');
        const path = await import('node:path');
        const url = await import('node:url');
        const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
        const report = auditClaims({ repoRoot });
        const wantsJson = argv.includes('--json');
        if (wantsJson) console.log(JSON.stringify(report, null, 2));
        else console.log(formatClaimAuditReport(report));
        return { ok: report.ok, status: report.ok ? 'claim-audit-pass' : 'claim-audit-fail', report };
    }
   if (command === 'project-sources') {
       return runProjectSourcesCommand(argv.slice(1), deps);
   }
    if (command === 'work') {
        return runWorkCommand(argv.slice(1), deps);
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
            diagnostics: { type: 'boolean', default: false },
            'inline-only': { type: 'boolean', default: false },
            'allow-copy-markdown-fallback': { type: 'boolean', default: false },
            'allow-grok-context-pack': { type: 'boolean', default: false },
            'require-source-audit': { type: 'boolean', default: false },
            'source-audit-ratio': { type: 'string' },
            'source-audit-scope': { type: 'string' },
            'source-audit-date': { type: 'string' },
            file: { type: 'string', multiple: true },
            tool: { type: 'string', multiple: true },
            plugin: { type: 'string', multiple: true },
            'web-search': { type: 'boolean', default: false },
            'auto-tools': { type: 'boolean', default: false },
            'output-image': { type: 'string' },
            'output-zip': { type: 'string' },
            'output-dir': { type: 'string' },
            'multi-zip': { type: 'boolean', default: false },
            'context-refresh': { type: 'boolean', default: false },
            conversation: { type: 'string' },
            research: { type: 'string' },
            archive: { type: 'string' },
            'follow-up': { type: 'string', multiple: true },
            model: { type: 'string' },
            effort: { type: 'string' },
            'reasoning-effort': { type: 'string' },
            'thinking-time': { type: 'string' },
            'context-from-files': { type: 'string', multiple: true },
            'context-exclude': { type: 'string', multiple: true },
            'context-file': { type: 'string' },
            'max-input': { type: 'string' },
            'max-file-size': { type: 'string' },
            'max-context-file-size': { type: 'string' },
            'max-upload-file-size': { type: 'string' },
            'attachment-upload-timeout-ms': { type: 'string' },
            'files-report': { type: 'boolean', default: false },
            'context-transport': { type: 'string' },
            'trace-dir': { type: 'string' },
            policy: { type: 'string' },
            'unsafe-allow': { type: 'string', multiple: true },
            config: { type: 'string' },
            fixtures: { type: 'string' },
            variant: { type: 'string', multiple: true },
            concurrency: { type: 'string' },
            'update-golden': { type: 'boolean', default: false },
            'dry-run': { type: 'string' },
            'chatgpt-url': { type: 'string' },
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
            parallel: { type: 'boolean', default: false },
            'reuse-tab': { type: 'boolean', default: false },
            'control-summary': { type: 'boolean', default: false },
        },
        strict: false,
    });

    applyVendorDefaults(values, command);
    rejectFutureScope(values);
    const vendorExplicit = argv.slice(1).includes('--vendor') || argv.slice(1).some((/** @type {any} */ a) => a.startsWith('--vendor='));
    const hasContextPackage = Boolean(values['context-file'] || (Array.isArray(values['context-from-files']) && values['context-from-files'].length > 0));
    // --file may repeat → parseArgs yields an array; normalize to a path list.
    const filePaths = (Array.isArray(values.file) ? values.file : (values.file ? [values.file] : [])).filter((value) => typeof value === 'string');
    if (['send', 'query'].includes(command) && !values['inline-only'] && filePaths.length === 0 && !hasContextPackage) {
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
        // When --timeout is omitted on send/query, default scales by model tier
        // (instant 120s, thinking 600s, chatgpt-pro 5400s, grok-heavy 3600s,
        // deep-research 3600s). For poll/watch/resume, timeout stays undefined
        // so the budget resolver inherits stored session deadline remainder.
        timeout: values.timeout != null
            ? values.timeout
            : (command === 'send' || command === 'query')
                ? resolveTimeoutDefaultSec({ model: values.model, research: values.research }, values.vendor || 'chatgpt')
                : undefined,
        deadline: values.deadline,
        session: values.session,
        navigate: values.navigate === true,
        diagnostics: values.diagnostics === true,
        attachmentPolicy: filePaths.length ? 'upload' : 'inline-only',
        filePath: filePaths[0],
        filePaths,
        tools: values.tool || [],
        plugins: values.plugin || [],
        webSearch: values['web-search'] === true,
        autoTools: values['auto-tools'] === true,
        outputImage: values['output-image'],
        outputZip: values['output-zip'],
        outputDir: values['output-dir'],
        multiZip: values['multi-zip'] === true,
        contextRefresh: values['context-refresh'] === true,
        conversation: values.conversation,
        research: values.research,
        archiveFlag: values.archive,
        followUps: values['follow-up'] || [],
        thinkingTime: values['thinking-time'],
        model: values.model,
        reasoningEffort: values.effort || values['reasoning-effort'],
        contextFromFiles: values['context-from-files'] || [],
        contextExclude: values['context-exclude'] || [],
        contextFile: values['context-file'],
        maxInput: values['max-input'],
        maxFileSize: values['max-context-file-size'] || values['max-file-size'],
        maxUploadFileSize: values['max-upload-file-size'],
        attachmentUploadTimeoutMs: values['attachment-upload-timeout-ms'] || process.env.AGBROWSE_ATTACHMENT_UPLOAD_TIMEOUT_MS,
        filesReport: values['files-report'],
        contextTransport: values['context-transport'],
        inlineOnly: values['inline-only'],
        allowCopyMarkdownFallback: values['allow-copy-markdown-fallback'] === true,
        allowGrokContextPack: values['allow-grok-context-pack'] === true,
        requireSourceAudit: values['require-source-audit'] === true,
        sourceAuditRatio: values['source-audit-ratio'],
        sourceAuditScope: values['source-audit-scope'],
        sourceAuditDate: values['source-audit-date'],
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
        forceNewTab: values['new-tab'] === true || values.parallel === true,
        newTab: values['new-tab'] === true || values.parallel === true || (['send', 'query', 'code'].includes(command) && values['reuse-tab'] !== true && !values.session && process.env.AGBROWSE_REUSE_TAB !== '1'),
        reuseTab: values['reuse-tab'] === true || process.env.AGBROWSE_REUSE_TAB === '1',
        evalConfig: values.config,
        evalFixtures: values.fixtures,
        evalVariants: values.variant,
        evalConcurrency: values.concurrency,
        updateGolden: values['update-golden'] === true,
        traceDir: values['trace-dir'],
        policyPath: values.policy,
        unsafeAllow: values['unsafe-allow'] || [],
    };

    validateCodeModeCliInput(command, input);
    await enforceCliPolicy(command, input);
    await ensureHeadedBrowserForWebAi(deps, command, argv);

    if (values['control-summary'] && !values.json && BROWSER_REQUIRED_COMMANDS.has(command)) {
        const { emitControlSummary } = await import('./control-summary.mjs');
        const port = Number(deps?.getPort?.() || process.env.CDP_PORT || 9222);
        emitControlSummary({
            cdpPort: port,
            tabSource: input.newTab ? 'new-tab' : input.reuseTab ? 'active' : 'pooled',
            sessionReuse: !!input.session,
            recoveryUrl: typeof input.url === 'string' ? input.url : undefined,
            chromeVisible: true,
        }, { controlSummary: true, json: false });
    }

    let result = command === 'watch'
        ? await watchSession(deps, input)
        : command === 'snapshot'
            ? await runSnapshotCommand(deps, input, values)
            : command === 'eval'
                ? await runEvalCommand(input)
                : command === 'doctor'
                    ? await runDoctorWithChurn(deps, { vendor: input.vendor, full: values.full, snapshot: values.snapshot, cacheMetrics: values['cache-metrics'] })
                    : command === 'sessions'
                        ? await runSessionsCommand(argv.slice(1), values, deps, input)
                        : isContextCommand(command)
                            ? await runContextCommand(command, input, values)
                            : await runCommand(command, deps, input);
    result = applyRequiredSourceAudit(command, result, input);
    const traceId = input.traceDir && command !== 'render'
        ? createTraceId(`${command}:${Date.now()}`)
        : null;
    if (traceId) {
        result.traceId = traceId;
        await writeCommandTrace(/** @type {any} */ (input.traceDir), {
            traceId,
            command: `web-ai ${command}`,
            provider: input.vendor || result.vendor || 'chatgpt',
            modelAlias: /** @type {any} */ (input.model),
            sessionId: input.session || result.sessionId,
            url: result.url || input.url,
            status: result.status,
            evidence: {
                prompt: input.prompt,
                answerText: result.answerText,
                pageText: result.pageText,
                sourceContext: /** @type {any} */ (input).contextPackageText,
            },
            steps: [{ type: 'command', status: result.ok === false ? 'fail' : 'ok' }],
        });
    }
    if (isContextCommand(command) && values.json) console.log(renderContextDryRunReport(result, {
        mode: 'json',
        full: /** @type {any} */ (values.full || command === 'context-render'),
        json: true,
        includeComposerText: /** @type {any} */ (values.full || command === 'context-render'),
    }));
    else if (values.json) console.log(JSON.stringify(result, null, 2));
    else if (isContextCommand(command)) console.log(renderContextDryRunReport(result, {
        mode: /** @type {any} */ (command === 'context-render' || values.full ? 'full' : (values['dry-run'] || 'summary')),
        full: /** @type {any} */ (values.full || command === 'context-render'),
        json: false,
    }));
    else if (command === 'watch') printWatchHuman(result);
    else if (command === 'snapshot') printSnapshotHuman(result);
    else if (command === 'eval') printEvalHuman(result);
    else if (command === 'doctor') printDoctorHuman(result);
    else if (command === 'sessions') printSessionsHuman(result);
    else printHuman(command, result);
    return result;
}

/**
 * Fail fast on code-mode flag combinations that can be rejected without opening
 * or mutating provider tabs.
 *
 * @param {string} command
 * @param {Record<string, any>} input
 */
function validateCodeModeCliInput(command, input) {
    if (!['code', 'code-extract'].includes(command)) return;
    let vendor = input.vendor || 'chatgpt';
    if (command === 'code-extract' && input.session) {
        const session = getSession(input.session);
        vendor = session?.vendor || vendor;
    }
    if (vendor !== 'chatgpt') {
        throw new WebAiError({
            errorCode: 'code-mode.vendor-unsupported',
            stage: command === 'code' ? 'code-mode' : 'code-extract',
            vendor,
            retryHint: 'use-chatgpt',
            message: `web-ai ${command} is ChatGPT-only (container artifact contract)`,
            mutationAllowed: false,
        });
    }
    if (command === 'code' && !String(input.prompt || '').trim()) {
        throw new WebAiError({
            errorCode: 'code-mode.prompt-missing',
            stage: 'code-mode',
            vendor,
            retryHint: 'add-prompt',
            message: 'web-ai code requires --prompt <build-spec>',
            mutationAllowed: false,
        });
    }
    if (input.multiZip === true && input.outputZip) {
        throw new WebAiError({
            errorCode: 'code-mode.output-conflict',
            stage: command === 'code' ? 'code-mode' : 'code-extract',
            vendor,
            retryHint: 'use-output-dir',
            message: '--multi-zip cannot be combined with --output-zip; use --output-dir',
            mutationAllowed: false,
        });
    }
}

/**
 * @param {any} command
 * @param {any} result
 * @param {any} input
 */
export function applyRequiredSourceAudit(command, result = {}, input = {}) {
    if (input.requireSourceAudit !== true) return result;
    const answerText = result.answerText || result.answerArtifact?.text || result.answerArtifact?.markdown || '';
    const auditsCompletedAnswers = ['poll', 'query', 'watch'].includes(command);
    if (!answerText && (!auditsCompletedAnswers || result.ok === false)) return result;
    if (!answerText) {
        throw new WebAiError({
            errorCode: 'source-audit.answer-missing',
            stage: 'source-audit',
            vendor: result.vendor || input.vendor,
            retryHint: 'poll-or-disable-audit',
            message: `source audit requires completed answer text for web-ai ${command}`,
            mutationAllowed: false,
            evidence: { status: result.status || null },
        });
    }
    const requiredSourceRatio = parseSourceAuditRatio(input.sourceAuditRatio);
    const sourceAudit = auditSources(answerText, {
        requiredSourceRatio,
        checkedScope: input.sourceAuditScope || null,
        checkedDate: input.sourceAuditDate || null,
    });
    result.sourceAudit = sourceAudit;
    if (!sourceAudit.ok) {
        throw new WebAiError({
            errorCode: 'source-audit.failed',
            stage: 'source-audit',
            vendor: result.vendor || input.vendor,
            retryHint: 'add-inline-sources-or-disable-audit',
            message: `source audit failed: ${sourceAudit.gaps.map(gap => gap.code).join(', ')}`,
            mutationAllowed: false,
            evidence: {
                gaps: sourceAudit.gaps,
                claimCount: sourceAudit.claims.length,
                unsourcedClaimCount: sourceAudit.unsourcedClaims.length,
                checkedScope: sourceAudit.checkedScope,
                checkedDate: sourceAudit.checkedDate,
            },
        });
    }
    return result;
}

/**
 * @param {any} value
 */
export function parseSourceAuditRatio(value) {
    if (value === undefined || value === null || value === '') return 1;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new WebAiError({
            errorCode: 'source-audit.invalid-ratio',
            stage: 'source-audit',
            retryHint: 'fix-source-audit-ratio',
            message: '--source-audit-ratio must be a number between 0 and 1',
            mutationAllowed: false,
            evidence: { value },
        });
    }
    return parsed;
}

/**
 * @param {any} command
 * @param {any} input
 */
async function enforceCliPolicy(command, input) {
    const mutating = ['send', 'query', 'stop'].includes(command);
    const provider = input.vendor || input.provider || 'chatgpt';
    const policyUrl = input.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[input.vendor || 'chatgpt'];
    const action = {
        url: policyUrl,
        upload: Boolean(input.filePath || input.contextFile || input.contextFromFiles?.length),
        explicitUpload: Boolean(input.filePath || input.contextFile || input.contextFromFiles?.length),
        fileAccess: Boolean(input.filePath || input.contextFile || input.contextFromFiles?.length),
        clipboardWriteIntercept: input.allowCopyMarkdownFallback === true,
        explicitClipboardWriteIntercept: input.allowCopyMarkdownFallback === true,
        evaluate: false,
        unsafeAllow: input.unsafeAllow,
    };
    if (!mutating && !action.clipboardWriteIntercept && !input.unsafeAllow?.length) return null;
    const { policy, explicitKeys } = await loadPolicy(input.policyPath);
    const effective = applyProviderDefaults(provider, policy, { explicitKeys });
    enforcePolicy(effective, action);
    return { ok: true, policy: effective };
}

/**
 * @param {any} input
 */
async function runEvalCommand(input) {
    const result = await runWebAiEval({
        config: input.evalConfig,
        vendor: input.vendor || 'chatgpt',
        fixtures: input.evalFixtures || 'test/fixtures/provider-dom',
        variants: input.evalVariants,
        concurrency: input.evalConcurrency,
    });
    if (input.updateGolden) {
        if ((input.vendor || 'chatgpt') !== 'chatgpt' || input.evalConfig) {
            throw new WebAiError({
                errorCode: 'eval.golden-unsupported',
                stage: 'eval',
                mutationAllowed: false,
                message: '--update-golden currently supports only --vendor chatgpt without --config',
            });
        }
        const fs = await import('node:fs/promises');
        await fs.writeFile('test/golden/web-ai-eval-baseline.chatgpt.json', `${JSON.stringify(result, null, 2)}\n`);
    }
    return result;
}

/**
 * @param {any} command
 * @param {any} input
 * @param {any} values
 */
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

/**
 * @param {any} command
 */
function isContextCommand(command) {
    return command === 'context-dry-run' || command === 'context-render';
}

/**
 * @param {any} deps
 * @param {any} input
 */
async function ensureProviderTab(deps, input) {
    if (!input.newTab || input.reuseTab) return deps;
    const vendorUrl = input.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[input.vendor || 'chatgpt'];
    const port = deps.getPort?.() || 9222;

    await cleanupPoolTabs(port);
    await cleanupIdleTabs(port, { maxTabs: DEFAULT_MAX_TABS });

    if (input.forceNewTab !== true) {
        // Phase 9.2: try tab pool first
        const pooled = await getPooledTab(port, input.vendor || 'chatgpt', /** @type {any} */ ({
            owner: 'web-ai',
            sessionType: 'send-poll',
            url: vendorUrl,
            port: port,
        }));
        if (pooled && !shouldNavigateToRequestedProviderUrl(pooled.url, vendorUrl)) {
            const bound = await bindReusableProviderPage(deps, port, pooled, vendorUrl);
            if (bound) return bound;
        }

        const reusable = await findReusableProviderTab(port, input.vendor || 'chatgpt', vendorUrl);
        if (reusable) {
            const bound = await bindReusableProviderPage(deps, port, reusable, vendorUrl);
            if (bound) return bound;
        }
    }

    // Phase 9.1 fix: create tab WITHOUT activate (avoids focus race)
    const tab = await createTab(port, vendorUrl, { activate: false, reuseBlank: false });
    const page = await waitForPageByTargetId(port, tab.targetId);
    return {
        ...deps,
        getPage: async () => {
            if (page.isClosed?.()) throw new Error(`bound tab closed: ${tab.targetId}`);
            return page;
        },
        getTargetId: async () => tab.targetId,
        getCdpSession: async () => (/** @type {any} */ (page)).context().newCDPSession(page),
    };
}

/**
 * @param {any} deps
 * @param {any} page
 * @param {any} targetId
 * @param {any} vendorUrl
 */
function bindProviderPage(deps, page, targetId, vendorUrl) {
    return {
        ...deps,
        getPage: async () => {
            if (page.isClosed?.()) throw new Error(`bound tab closed: ${targetId}`);
            return page;
        },
        getTargetId: async () => targetId,
        getCdpSession: async () => (/** @type {any} */ (page)).context().newCDPSession(page),
        prepareProviderPage: async () => {
            const currentUrl = await waitForPageUrl(page);
            if (shouldNavigateToRequestedProviderUrl(currentUrl, vendorUrl)) {
                await page.goto(vendorUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                // SPA providers render the composer asynchronously after DOMContentLoaded
                await page.locator('#prompt-textarea, .ProseMirror, [contenteditable="true"]').first()
                    .waitFor({ state: 'visible', timeout: 15_000 })
                    .catch(() => undefined);
            }
        },
    };
}

/**
 * @param {any} deps
 * @param {number} port
 * @param {{ targetId?: string }} tab
 * @param {string} vendorUrl
 */
async function bindReusableProviderPage(deps, port, tab, vendorUrl) {
    if (!tab?.targetId) return null;
    const page = await waitForPageByTargetId(port, tab.targetId).catch(() => null);
    if (!page) return null;
    if (!await isProviderPageDriveable(page, vendorUrl)) return null;
    return bindProviderPage(deps, page, tab.targetId, vendorUrl);
}

/**
 * @param {any} port
 * @param {any} vendor
 * @param {any} targetUrl
 */
async function findReusableProviderTab(port, vendor, targetUrl) {
    const origin = providerOrigin(vendor, targetUrl);
    if (!origin) return null;
    const activeTargets = await activeCommandTargetIds({ browserProfileKey: String(port) });
    const activeSessionTargets = new Set(listSessions({ active: true }).map(session => session.targetId).filter(Boolean));
    const leases = await listLeases();
    const leaseByTargetId = new Map(leases.map(lease => [lease.targetId, lease]));
    const tabs = await listManagedTabs(port);
    return tabs
        .filter(tab => tab?.targetId && tab.type === 'page')
        .filter(tab => !activeTargets.has(tab.targetId))
        .filter(tab => !activeSessionTargets.has(tab.targetId))
        .filter(tab => !isPinned(tab.targetId))
        .filter(tab => isReusableByLease(tab.targetId, leaseByTargetId))
        .filter(tab => providerOriginFromUrl(tab.url) === origin)
        .filter(tab => !shouldNavigateToRequestedProviderUrl(tab.url, targetUrl))
        .sort((a, b) => (Number(b.lastActiveAt) || 0) - (Number(a.lastActiveAt) || 0))[0] || null;
}

/**
 * @param {any} targetId
 * @param {any} leaseByTargetId
 */
function isReusableByLease(targetId, leaseByTargetId) {
    const lease = leaseByTargetId.get(targetId);
    if (!lease) return true;
    return ['web-ai', 'cli-jaw'].includes(lease.owner) &&
        ['pooled', 'completed-session'].includes(lease.state);
}

/**
 * @param {any} vendor
 * @param {any} fallbackUrl
 */
function providerOrigin(vendor, fallbackUrl = '') {
    return providerOriginFromUrl(fallbackUrl || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[vendor] || '');
}

/**
 * @param {any} url
 */
function providerOriginFromUrl(url = '') {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

/**
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 * @param {any} pollFn
 * @param {any} stopFn
 */
async function runBoundCommand(command, deps, input, pollFn, stopFn) {
    input = resolveImplicitCommandSession(command, deps, input);
    if (command === 'stop' && input.session) {
        return runSessionStopInterrupt(deps, input, stopFn);
    }
    if (command === 'poll' && input.session) {
        return withSessionCommandLock(input.session, async () => {
            return withCommandSessionPage(command, deps, input, async ({ page, targetId, session }) => {
                const effectivePollFn = isWorkSession(session) ? pollWorkSession : pollFn;
                const sessionDeps = {
                    ...deps,
                    getPage: async () => page,
                    getTargetId: async () => targetId,
                    getCdpSession: async () => (/** @type {any} */ (page)).context().newCDPSession(page),
                };
                return withWebAiActiveCommand(command, sessionDeps, { ...input, vendor: session.vendor, session: session.sessionId }, async () => {
                    const result = await effectivePollFn(sessionDeps, { ...input, vendor: session.vendor, session: session.sessionId });
                    if (isRecoverableTabCrash(result)) {
                        throw new Error(result.error || 'target closed during session-bound web-ai command');
                    }
                    return appendAutoBindWarning(result, input, session);
                });
            });
        });
    }
    if (command === 'poll') return withWebAiActiveCommand(command, deps, input, () => pollFn(deps, input));
    if (command === 'stop') return withWebAiActiveCommand(command, deps, input, () => stopFn(deps, input));
    throw new Error(`runBoundCommand: unsupported command ${command}`);
}

/**
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 */
function resolveImplicitCommandSession(command, deps, input) {
    if (input.session || !['poll', 'stop'].includes(command)) return input;
    const port = Number(deps.getPort?.() || process.env.CDP_PORT || 9222);
    const selection = resolveImplicitSessionSelection({
        command,
        vendor: input.vendor || 'chatgpt',
        port,
    });
    if (selection.action !== 'auto-bind' || !selection.sessionId) return input;
    return {
        ...input,
        session: selection.sessionId,
        autoBoundSession: true,
        autoBoundCandidates: selection.candidates,
    };
}

/**
 * @template T
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 * @param {(ctx: { page: any, targetId: string, session: any }) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withCommandSessionPage(command, deps, input, fn) {
    if (input.autoBoundSession === true) {
        const resolved = await resolveSessionPage(deps, input.session, { allowNavigate: input.navigate === true });
        if (resolved.mismatch) throw sessionResolutionError(command, deps, input, resolved);
        return fn({ page: resolved.page, targetId: resolved.targetId, session: resolved.session });
    }
    return withSessionPage(deps, input.session, fn);
}

/**
 * @param {any} deps
 * @param {any} input
 * @param {any} stopFn
 */
async function runSessionStopInterrupt(deps, input, stopFn) {
    const resolved = await resolveSessionPage(deps, input.session, { allowNavigate: input.navigate === true });
    if (resolved.mismatch) throw sessionResolutionError('stop', deps, input, resolved);
    const sessionDeps = {
        ...deps,
        getPage: async () => resolved.page,
        getTargetId: async () => resolved.targetId,
        getCdpSession: async () => (/** @type {any} */ (resolved.page)).context().newCDPSession(resolved.page),
    };
    const result = await stopFn(sessionDeps, {
        ...input,
        vendor: resolved.session.vendor,
        session: resolved.session.sessionId,
    });
    return appendAutoBindWarning({
        ...result,
        sessionId: resolved.session.sessionId,
        targetId: resolved.targetId,
        interrupt: true,
    }, input, resolved.session);
}

/**
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 * @param {any} resolved
 */
function sessionResolutionError(command, deps, input, resolved) {
    const vendor = input.vendor || resolved.session?.vendor || 'chatgpt';
    const sessionId = input.session || resolved.session?.sessionId || null;
    const expectedTargetId = resolved.session?.targetId || resolved.targetId || null;
    const actualTargetId = resolved.url ? (resolved.targetId || null) : null;
    const port = Number(deps.getPort?.() || process.env.CDP_PORT || 9222);
    const recovery = sessionId
        ? `agbrowse web-ai ${command || 'poll'} --vendor ${vendor} --session ${sessionId} --navigate --json`
        : `agbrowse web-ai ${command || 'poll'} --vendor ${vendor} --navigate --json`;
    return new WebAiError({
        errorCode: 'cdp.target-mismatch',
        stage: 'target-resolution',
        vendor,
        retryHint: 'pass-session-or-navigate',
        message: resolved.warnings?.[0] || `session ${sessionId} is not attached to its saved provider tab`,
        mutationAllowed: false,
        evidence: {
            sessionId,
            expectedTargetId,
            actualTargetId,
            targetId: expectedTargetId,
            port,
            url: resolved.url || null,
            conversationUrl: resolved.conversationUrl || null,
            targetMismatch: {
                expectedTargetId,
                actualTargetId,
                port,
            },
            recovery,
            warnings: resolved.warnings || [],
        },
    });
}

/**
 * @param {any} result
 * @param {any} input
 * @param {any} session
 */
function appendAutoBindWarning(result, input, session) {
    if (input.autoBoundSession !== true) return result;
    return {
        ...result,
        warnings: [
            ...(result.warnings || []),
            `auto-bound ${input.vendor || session.vendor || 'web-ai'} session ${input.session} because it was the only active provider session`,
        ],
    };
}

/**
 * @param {any} result
 */
function isRecoverableTabCrash(result) {
    return result?.recoverable === true && result?.status === 'tab-crashed';
}

/**
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 */
async function runBoundSendOrQuery(command, deps, input) {
    if (!['send', 'query'].includes(command) || !input.session) return null;
    return withSessionCommandLock(input.session, async () => {
        return withSessionPage(deps, input.session, async ({ page, targetId, session }) => {
            const sessionDeps = {
                ...deps,
                getPage: async () => page,
                getTargetId: async () => targetId,
                getCdpSession: async () => (/** @type {any} */ (page)).context().newCDPSession(page),
            };
            const sessionInput = {
                ...input,
                vendor: session.vendor,
                session: session.sessionId,
                url: undefined,
                newTab: false,
                reuseTab: true,
            };
            return withWebAiActiveCommand(command, sessionDeps, sessionInput, async () => {
                if (session.vendor === 'gemini') {
                    if (command === 'send') return geminiSendWebAi(sessionDeps, sessionInput);
                    return geminiQueryWebAi(sessionDeps, sessionInput);
                }
                if (session.vendor === 'grok') {
                    if (command === 'send') return grokSendWebAi(sessionDeps, sessionInput);
                    return grokQueryWebAi(sessionDeps, sessionInput);
                }
                if (command === 'send') return sendWebAi(sessionDeps, sessionInput);
                return queryWebAi(sessionDeps, sessionInput);
            });
        });
    });
}

/**
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 * @param {any} fn
 */
async function withWebAiActiveCommand(command, deps, input, fn) {
    const targetId = await deps.getTargetId?.().catch(() => null);
    if (!targetId) return fn();
    return withActiveCommand({
        command: `web-ai ${command}`,
        provider: input.vendor || 'chatgpt',
        sessionId: input.session || null,
        targetId,
        owner: 'cli',
        port: deps.getPort?.() || 9222,
    }, async () => {
        await deps.prepareProviderPage?.();
        return fn();
    });
}

/**
 * @param {any} command
 * @param {any} deps
 * @param {any} input
 */
async function runCommand(command, deps, input) {
    const boundSendOrQuery = await runBoundSendOrQuery(command, deps, input);
    if (boundSendOrQuery) return boundSendOrQuery;
    input = resolveSessionVendorInput(command, input);

    // Phase 9.1: create new tab per session for send/query (code reuses query)
    if (['send', 'query', 'code'].includes(command)) {
        deps = await ensureProviderTab(deps, input);
    }

    if (input.vendor === 'gemini') {
        switch (command) {
            case 'render': return renderWebAi(input);
            case 'status': return geminiStatusWebAi(deps, input);
            case 'send': return withWebAiActiveCommand(command, deps, input, () => geminiSendWebAi(deps, input));
            case 'poll': return runBoundCommand(command, deps, input, geminiPollWebAi, geminiStopWebAi);
            case 'query': return withWebAiActiveCommand(command, deps, input, () => geminiQueryWebAi(deps, input));
            case 'stop': return runBoundCommand(command, deps, input, geminiPollWebAi, geminiStopWebAi);
            default: throw new Error(`unknown web-ai command: ${command}`);
        }
    }
    if (input.vendor === 'grok') {
        switch (command) {
            case 'render': return renderWebAi(input);
            case 'status': return grokStatusWebAi(deps, input);
            case 'send': return withWebAiActiveCommand(command, deps, input, () => grokSendWebAi(deps, input));
            case 'poll': return runBoundCommand(command, deps, input, grokPollWebAi, grokStopWebAi);
            case 'query': return withWebAiActiveCommand(command, deps, input, () => grokQueryWebAi(deps, input));
            case 'stop': return runBoundCommand(command, deps, input, grokPollWebAi, grokStopWebAi);
            default: throw new Error(`unknown web-ai command: ${command}`);
        }
    }
    switch (command) {
        case 'render': return renderWebAi(input);
        case 'status': return statusWebAi(deps, input);
        case 'send': return withWebAiActiveCommand(command, deps, input, () => sendWebAi(deps, input));
        case 'poll': return runBoundCommand(command, deps, input, pollWebAi, stopWebAi);
        case 'query': return withWebAiActiveCommand(command, deps, input, async () => {
            if (input.research === 'deep') {
                return deepResearchWebAi(deps, input);
            }
            const hasFollowUps = input.followUps?.length > 0;
            const result = await queryWebAi(deps, { ...input, skipFinalize: hasFollowUps });
            if (result.ok && hasFollowUps && result.sessionId) {
                const resultAny = /** @type {any} */ (result);
                const { sendMultiTurn } = await import('./chatgpt-multi-turn.mjs');
                const session = getSession(result.sessionId);
                if (session) {
                    const page = await deps.getPage();
                    const multiResult = await sendMultiTurn(page, deps, {
                        followUps: input.followUps,
                        session,
                        timeoutPerTurn: (input.timeout || 120) * 1000,
                    });
                    if (multiResult.ok) {
                        const refreshed = getSession(session.sessionId) || session;
                        await finalizeProviderTab(deps, {
                            vendor: 'chatgpt',
                            session: /** @type {any} */ (refreshed),
                            page,
                            answerText: multiResult.finalAnswer || resultAny.answerText,
                            artifactText: multiResult.transcriptMarkdown,
                            warnings: [...(result.warnings || []), ...multiResult.warnings],
                            archiveFlag: input.archiveFlag,
                            sessionType: 'multi-turn',
                        });
                    }
                    return {
                        ...result,
                        answerText: multiResult.finalAnswer || resultAny.answerText,
                        turns: multiResult.turns,
                        followUpCount: multiResult.turns.length,
                        finalStatus: multiResult.finalStatus,
                        warnings: [...(result.warnings || []), ...multiResult.warnings],
                    };
                }
            }
            return result;
        });
        case 'stop': return runBoundCommand(command, deps, input, pollWebAi, stopWebAi);
        case 'code': return withWebAiActiveCommand(command, deps, input, () => codeWebAi(deps, input, { queryWebAi, getSession }));
        case 'code-extract': return runCodeExtractCommand(deps, input);
        default: throw new Error(`unknown web-ai command: ${command}`);
    }
}

/**
 * @param {any} deps
 * @param {any} input
 */
async function runCodeExtractCommand(deps, input) {
    if (input.session) {
        return withSessionPage(deps, input.session, async ({ page, targetId, session }) => {
            const sessionDeps = {
                ...deps,
                getPage: async () => page,
                getTargetId: async () => targetId,
                getCdpSession: async () => (/** @type {any} */ (page)).context().newCDPSession(page),
            };
            return withWebAiActiveCommand('code-extract', sessionDeps, { ...input, vendor: session.vendor, session: session.sessionId }, () => {
                return extractCodeArtifacts(sessionDeps, { ...input, vendor: session.vendor, session: session.sessionId }, { getSession });
            });
        });
    }
    return withWebAiActiveCommand('code-extract', deps, input, () => extractCodeArtifacts(deps, input, { getSession }));
}

/**
 * @param {any} command
 * @param {any} input
 */
function resolveSessionVendorInput(command, input) {
    if (!['poll', 'stop'].includes(command) || !input.session) return input;
    const session = getSession(input.session);
    if (!session?.vendor || session.vendor === input.vendor) return input;
    return { ...input, vendor: session.vendor, sessionVendorResolved: true };
}

/**
 * @param {any} command
 * @param {any} argv
 */
export function commandNeedsHeadedBrowser(command, argv = []) {
    if (BROWSER_REQUIRED_COMMANDS.has(command)) return true;
    if (command !== 'sessions') return false;
    return BROWSER_REQUIRED_SESSION_COMMANDS.has(argv[1]);
}

/**
 * @param {any} deps
 * @param {any} command
 * @param {any} argv
 */
export async function ensureHeadedBrowserForWebAi(deps = {}, command, argv = []) {
    if (!commandNeedsHeadedBrowser(command, argv)) {
        return { ok: true, status: 'skipped' };
    }
    const port = Number(deps.getPort?.() || process.env.CDP_PORT || 9222);
    const status = deps.getBrowserStatus
        ? await deps.getBrowserStatus(port)
        : { running: true, tabs: null };
    const state = deps.readBrowserState?.() || null;
    if (!status?.running) {
        if (process.env.AGBROWSE_WEB_AI_AUTO_START === '0') {
            throw new WebAiError({
                errorCode: 'cdp.unreachable',
                stage: 'connect',
                retryHint: 'start-headed',
                message: `web-ai requires a headed browser on CDP port ${port}; run "agbrowse start --headed" first`,
                mutationAllowed: false,
            });
        }
        if (typeof deps.ensureStarted !== 'function') {
            throw new WebAiError({
                errorCode: 'cdp.unreachable',
                stage: 'connect',
                retryHint: 'start-headed',
                message: `web-ai requires a headed browser on CDP port ${port}, but this runtime cannot auto-start it`,
                mutationAllowed: false,
            });
        }
        await deps.ensureStarted({ port, headed: true });
        return { ok: true, status: 'started', port };
    }
    if (state?.headless === true) {
        throw new WebAiError({
            errorCode: 'cdp.headless',
            stage: 'connect',
            retryHint: 'restart-headed',
            message: `web-ai requires headed Chrome, but agbrowse Chrome on port ${port} is headless. Run "agbrowse stop" then "agbrowse start --headed".`,
            mutationAllowed: false,
            evidence: { port, headless: true },
        });
    }
    return { ok: true, status: 'ready', port };
}

/**
 * Keep provider defaults non-mutating: send/query must not touch model or
 * effort selectors unless the caller passes --model or --effort explicitly.
 *
 * @param {any} values
 * @param {string} command
 */
function applyVendorDefaults(values, command) {
    void values;
    void command;
}

/**
 * @param {any} values
 */
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
    const vendor = values.vendor || 'chatgpt';
    const followUps = Array.isArray(values['follow-up']) ? values['follow-up'] : [];
    if (followUps.length > 0 && vendor !== 'chatgpt') {
        throw new WebAiError({
            errorCode: 'capability.unsupported',
            stage: 'multi-turn',
            vendor,
            retryHint: 'use-chatgpt-or-inline-prompt',
            message: '--follow-up is currently supported only for ChatGPT batch follow-ups',
            mutationAllowed: false,
        });
    }
    if (values.research === 'deep' && vendor !== 'chatgpt') {
        throw new WebAiError({
            errorCode: 'capability.unsupported',
            stage: 'deep-research',
            vendor,
            retryHint: 'use-chatgpt-or-disable-research',
            message: '--research deep is currently supported only for ChatGPT',
            mutationAllowed: false,
        });
    }
    if (values.research === 'deep' && followUps.length > 0) {
        throw new WebAiError({
            errorCode: 'capability.unsupported',
            stage: 'deep-research',
            vendor,
            retryHint: 'choose-research-or-follow-ups',
            message: '--research deep cannot be combined with --follow-up batch prompts',
            mutationAllowed: false,
        });
    }
}

/**
 * @param {any} vendor
 * @param {any} model
 */
function isSupportedWebAiModel(vendor, model) {
    const key = String(model || '').trim().toLowerCase();
    if (String(vendor || 'chatgpt') === 'gemini' && /^(?:gemini\s+)?(?:\d+(?:\.\d+)?\s+)?(?:flash[-_\s]?lite|flash|pro)$/.test(key)) {
        return true;
    }
    const byVendor = {
        chatgpt: new Set(['instant', 'fast', 'gpt-5-3', 'gpt-5.3', 'thinking', 'think', 'gpt-5-5-thinking', 'gpt-5.5-thinking', 'pro', 'gpt-5-5-pro', 'gpt-5.5-pro']),
        gemini: new Set(['fast', 'flash-lite', 'flash_lite', 'flash lite', 'gemini-fast', 'gemini-flash-lite', 'gemini-flash_lite', 'gemini flash lite', 'flash', 'gemini-flash', 'thinking', 'think', 'gemini-thinking', 'pro', 'gemini-pro', 'deepthink', 'deep-think', 'deep_think', 'deep think', 'gemini-deepthink', 'gemini-deep-think']),
        grok: new Set(['auto', 'automatic', 'fast', 'quick', 'expert', 'thinking', 'think', 'grok-4.3', 'grok43', 'grok-43', 'beta', 'heavy']),
    };
    return Boolean((/** @type {any} */ (byVendor))[String(vendor || 'chatgpt')]?.has(key));
}

/**
 * @param {any} vendor
 * @param {any} model
 * @param {any} effort
 */
function isSupportedWebAiEffort(vendor, model, effort) {
    if (String(vendor || 'chatgpt') !== 'chatgpt') return false;
    return isChatGptEffortSupported(model, effort);
}

/**
 * @param {any} vendor
 */
function webAiVendorLabel(vendor) {
    const key = String(vendor || 'chatgpt');
    if (key === 'chatgpt') return 'ChatGPT';
    if (key === 'gemini') return 'Gemini';
    if (key === 'grok') return 'Grok';
    return key;
}

/**
 * @param {any} deps
 * @param {any} options
 */
async function runDoctorWithChurn(deps, options) {
    const report = await runDoctor(deps, options);
    const churnRecords = maybeRecordChurn(report);
    if (churnRecords.length) {
        report.warnings = [...(report.warnings || []), `churn-log-recorded:${churnRecords.length}`];
    }
    return report;
}

/**
 * @param {any} report
 */
function printDoctorHuman(report) {
    const worst = report.features.reduce((/** @type {any} */ w, /** @type {any} */ f) => {
        const rank = { fail: 3, warn: 2, ok: 1, unknown: 0 };
        return ((/** @type {any} */ (rank))[f.state] || 0) > ((/** @type {any} */ (rank))[w] || 0) ? f.state : w;
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

/**
 * @param {any} deps
 * @param {any} input
 * @param {any} values
 */
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

/**
 * @param {any} result
 */
function printWatchHuman(result) {
    if (!result || result.eventsPrinted) return;
    console.log(`watch ${result.sessionId}: ${result.status}`);
}

/**
 * @param {any} result
 */
function printSnapshotHuman(result) {
    console.log(result.text);
}

/**
 * @param {any} result
 */
function printEvalHuman(result) {
    console.log(`web-ai eval ${result.status}: ${result.summary.passCount}/${result.summary.total} fixtures passed`);
    for (const regression of result.regressions || []) {
        console.log(`regression ${regression.provider}/${regression.variant} ${regression.metric}: ${regression.value} < ${regression.threshold}`);
    }
}

/**
 * @param {any} command
 * @param {any} result
 */
function printHuman(command, result) {
    if (command === 'render') {
        console.log(result.rendered.composerText);
        if (result.warnings?.length) console.error(`[warnings] ${result.warnings.join(', ')}`);
        return;
    }
    if (command === 'code' || command === 'code-extract') {
        if (result.ok && Array.isArray(result.artifacts)) {
            for (const artifact of result.artifacts) {
                if (artifact.savedPath) {
                    console.log(artifact.savedPath);
                    console.error(`[code] ${artifact.zipPath} → ${artifact.files.length} files, ${artifact.sizeBytes} bytes`);
                } else {
                    console.error(`[code] ${artifact.zipPath} failed: ${artifact.reason}`);
                }
            }
        } else if (result.ok && result.artifact?.savedPath) {
            console.log(result.artifact.savedPath);
            console.error(`[code] ${result.artifact.files.length} files, ${result.artifact.sizeBytes} bytes`);
        } else {
            console.error(`[code] failed: ${result.errorCode || result.artifact?.reason || 'unknown'}`);
        }
        if (result.warnings?.length) console.error(`[warnings] ${result.warnings.join(', ')}`);
        return;
    }
    if (result.answerText) {
        console.log(result.answerText);
        return;
    }
    console.log(`${result.status}: ${result.url || result.vendor}`);
}

/**
* @param {string[]} args
* @param {any} deps
*/
async function runWorkCommand(args, deps) {
    const sub = args[0];
    if (sub !== 'send') {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'work',
            message: `Unknown work subcommand: ${sub}. Available: send`,
        });
    }
    const { values } = parseArgs({
        args: args.slice(1),
        options: {
            prompt: { type: 'string' },
            power: { type: 'string' },
            speed: { type: 'string' },
            timeout: { type: 'string' },
            json: { type: 'boolean', default: false },
        },
        strict: true,
    });
    if (!values.prompt) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'work',
            message: '--prompt is required for work send',
        });
    }
    if (values.power == null) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'work',
            message: '--power is required for work send (integer 1..6)',
        });
    }
    const { normalizeWorkPower, normalizeWorkSpeed } = await import('./chatgpt-work-picker.mjs');
    const powerMapping = normalizeWorkPower(Number(values.power));
    const speed = normalizeWorkSpeed(values.speed || null);
    const timeoutSec = values.timeout ? Number(values.timeout) : undefined;
    if (values.timeout && (!Number.isFinite(timeoutSec) || /** @type {number} */ (timeoutSec) <= 0)) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'work',
            message: '--timeout must be a positive number (seconds)',
        });
    }

    await ensureHeadedBrowserForWebAi(deps, 'work', ['work', ...args]);
    const page = await deps.getPage();

    const { configureWorkSurface, readWorkTaskState, submitWorkPrompt: submitWork } = await import('./chatgpt-work-picker.mjs');
    const { insertPromptIntoComposer } = await import('./chatgpt-composer.mjs');
    const { createSession } = await import('./session.mjs');

    // Configure surface + picker
    const config = await configureWorkSurface(page, { power: powerMapping.power, speed });

    // Write prompt into Work composer
    await insertPromptIntoComposer(page, values.prompt, { vendor: 'chatgpt' });

    // Submit via scoped send button + commit verification (04 §4, WP1 R03)
    // NO keyboard Enter fallback — ProseMirror + IME can leak characters.
    // Session is NOT created until commit evidence is observed.
    const commitResult = await submitWork(page, values.prompt);

    // Create session record only after verified commit
    const session = createSession(
        { vendor: 'chatgpt', prompt: values.prompt },
        {
            vendor: 'chatgpt',
            originalUrl: commitResult.taskUrl,
            conversationUrl: commitResult.taskUrl,
            deadlineAt: timeoutSec
                ? new Date(Date.now() + timeoutSec * 1000).toISOString()
                : null,
            envelopeSummary: {
                surface: 'work',
                power: powerMapping.power,
                speed,
                model: powerMapping.model,
                effort: powerMapping.effort,
                taskId: commitResult.taskId,
                taskUrl: commitResult.taskUrl,
            },
            responseContract: 'work',
        },
    );

    const result = {
        ok: true,
        status: 'work-sent',
        surface: 'work',
        sessionId: session.sessionId,
        taskId: commitResult.taskId,
        taskUrl: commitResult.taskUrl,
        power: powerMapping.power,
        speed,
        model: powerMapping.model,
        effort: powerMapping.effort,
        responseContract: 'work',
        evidence: config.evidence,
        warnings: commitResult.warnings || [],
    };

    if (values.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(`Work sent (power ${powerMapping.power}, ${powerMapping.compactLabel}${speed ? ', ' + speed : ''})`);
        console.log(`Session: ${session.sessionId}`);
    }
    return result;
}

/**
 * @param {string[]} args
 * @param {any} deps
 */
async function runProjectSourcesCommand(args, deps) {
    const sub = args[0];
    if (sub !== 'list' && sub !== 'add') {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'project-sources',
            message: 'usage: project-sources list|add --chatgpt-url <url> [--file <path>...] [--dry-run summary] [--json]',
        });
    }
    const { values } = parseArgs({
        args: args.slice(1),
        options: {
            'chatgpt-url': { type: 'string' },
            file: { type: 'string', multiple: true },
            'dry-run': { type: 'string' },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });
    const projectUrl = typeof values['chatgpt-url'] === 'string' ? values['chatgpt-url'] : '';
    if (!projectUrl) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'project-sources',
            message: '--chatgpt-url is required for project-sources',
        });
    }
    const { listProjectSources, addProjectSource } = await import('./chatgpt-project-sources.mjs');
    const filePaths = Array.isArray(values.file) ? values.file.filter((value) => typeof value === 'string') : [];
    const dryRun = values['dry-run'] !== undefined;
    if (sub === 'add' && !filePaths.length) {
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'project-sources',
            message: '--file is required for project-sources add',
        });
    }
    if (sub === 'add' && dryRun) {
        const result = await addProjectSource(null, {
            projectUrl,
            filePaths,
            dryRun: true,
        });
        if (values.json) console.log(JSON.stringify(result, null, 2));
        else {
            for (const u of result.uploads) console.log(`○ ${u.name}`);
            for (const e of result.errors || []) console.error(`[error] ${e}`);
            for (const w of result.warnings || []) console.error(`[warning] ${w}`);
        }
        return result;
    }
    await ensureHeadedBrowserForWebAi(deps, 'project-sources', ['project-sources', ...args]);
    const cdpSession = await deps.getCdpSession?.();
    if (!cdpSession) {
        throw new WebAiError({
            errorCode: 'cdp.unreachable',
            stage: 'project-sources',
            retryHint: 'start-headed',
            message: 'CDP session required for project-sources',
        });
    }
    try {
        if (sub === 'list') {
            const result = await listProjectSources(cdpSession, { projectUrl });
            if (values.json) console.log(JSON.stringify(result, null, 2));
            else {
                if (!result.sources.length) console.log('(no sources)');
                else result.sources.forEach((/** @type {any} */ s) => console.log(`${s.name} (${s.type})`));
            }
            return result;
        }
        const result = await addProjectSource(cdpSession, {
            projectUrl,
            filePaths,
            dryRun,
        });
        if (values.json) console.log(JSON.stringify(result, null, 2));
        else {
            for (const u of result.uploads) {
                console.log(`${u.uploaded ? '✓' : '○'} ${u.name}`);
            }
            if (result.errors.length) {
                for (const e of result.errors) console.error(`[error] ${e}`);
            }
        }
        return result;
    } finally {
        await cdpSession.detach?.().catch(() => undefined);
    }
}
