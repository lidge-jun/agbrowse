import { parseArgs } from 'node:util';
import { renderWebAi, statusWebAi, sendWebAi, pollWebAi, queryWebAi, stopWebAi } from './chatgpt.mjs';
import { geminiStatusWebAi, geminiSendWebAi, geminiPollWebAi, geminiQueryWebAi, geminiStopWebAi } from './gemini-live.mjs';
import { grokStatusWebAi, grokSendWebAi, grokPollWebAi, grokQueryWebAi, grokStopWebAi } from './grok-live.mjs';
import { buildContextPackageResult, prepareContextForBrowser, renderContextDryRunReport } from './context-pack/index.mjs';
import { wrapError } from './errors.mjs';

const COMMANDS = new Set(['render', 'status', 'send', 'poll', 'query', 'stop', 'context-dry-run', 'context-render']);
export const WEB_AI_USAGE = `
Usage:
  agbrowse web-ai <command> --vendor <chatgpt|gemini|grok> [options]

Commands:
  render              Render the prompt envelope without opening a browser
  status              Check active provider tab state
  send                Send a prompt and save a polling session
  poll                Poll the saved session for completion
  query               Send and poll in one command
  stop                Stop a saved session
  context-dry-run     Build a context package without sending
  context-render      Render full prompt/context package text

Provider options:
  --vendor <name>     chatgpt, gemini, or grok (default: chatgpt)
  --url <url>         Navigate or verify the provider URL before mutation
  --model <alias>     Provider model alias; Gemini also accepts deepthink tool alias
                       ChatGPT: instant, thinking, pro
                       Gemini models: fast, thinking, pro
                       Gemini tool: deepthink
                       Grok: auto, fast, expert, thinking, beta
  --timeout <sec>     Wait timeout for send/query/poll

Prompt envelope:
  --prompt <text>     Main user prompt/question
  --system <text>     System or role instruction
  --project <text>    Project name
  --goal <text>       Task goal
  --context <text>    Inline context
  --question <text>   Alias/detail question text
  --output <text>     Output preference
  --constraints <txt> Constraints to include in the prompt

Attachments and context:
  --inline-only                     Required for send/query without files
  --file <path>                     Upload a single file
  --context-from-files <glob|path>  Add files to a context package; repeatable
  --context-exclude <glob>          Exclude files from context package; repeatable
  --context-file <path>             Use a prebuilt context package file
  --context-transport <mode>        upload or inline
  --max-input <chars>               Inline prompt budget
  --max-file-size <bytes>           Per-file context budget
  --files-report                    Include file report metadata
  --allow-copy-markdown-fallback    Capture provider Copy button output after DOM response
  --allow-grok-context-pack         Override Grok context-pack hard-gate (Grok prefers inline)

Output:
  --json             Print JSON
  --full             Print full context dry-run/render output
  --dry-run <mode>   summary, full, or json for context-dry-run

Examples:
  agbrowse web-ai render --vendor chatgpt --prompt "hello" --json
  agbrowse web-ai query --vendor grok --inline-only --prompt "Reply OK"
  agbrowse web-ai query --vendor gemini --model deepthink --inline-only --prompt "Reply OK"
  agbrowse web-ai query --vendor chatgpt --context-from-files "src/**/*.ts" --context-transport upload --prompt "Review this"
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
            full: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
        },
        strict: false,
    });

    rejectFutureScope(values);
    const hasContextPackage = Boolean(values['context-file'] || (Array.isArray(values['context-from-files']) && values['context-from-files'].length > 0));
    if (['send', 'query'].includes(command) && !values['inline-only'] && !values.file && !hasContextPackage) {
        throw new Error('web-ai send/query require --inline-only or --file=<path>');
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
    };

    const result = isContextCommand(command)
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
    if (values.vendor && !['chatgpt', 'gemini', 'grok'].includes(values.vendor)) throw new Error(`unsupported vendor: ${values.vendor}`);
    if (values.model && !isSupportedWebAiModel(values.vendor || 'chatgpt', values.model)) throw new Error(`unsupported ${webAiVendorLabel(values.vendor || 'chatgpt')} model selection: ${values.model}`);
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
