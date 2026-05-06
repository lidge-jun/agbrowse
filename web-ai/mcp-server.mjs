// @ts-check
/**
 * @typedef {any} Deps
 * @typedef {any} Input
 * @typedef {any} Page
 */
import { createInterface } from 'node:readline';
import { buildWebAiSnapshot } from './ax-snapshot.mjs';
import { sendWebAi, pollWebAi } from './chatgpt.mjs';
import { geminiSendWebAi, geminiPollWebAi } from './gemini-live.mjs';
import { grokSendWebAi, grokPollWebAi } from './grok-live.mjs';
import { runDoctor } from './doctor.mjs';
import { getSession } from './session.mjs';
import {
    captureCopiedResponseText,
    CHATGPT_COPY_SELECTORS,
    GEMINI_COPY_SELECTORS,
    GROK_COPY_SELECTORS,
} from './copy-markdown.mjs';
import { allToolSchemas, isKnownMcpTool } from './tool-schema.mjs';
import { enforcePolicy } from './policy/enforce.mjs';
import { withActiveCommand } from './active-command-store.mjs';
import { requireLatestSnapshot, setLatestSnapshot } from './mcp-state.mjs';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const JSON_RPC = '2.0';
const WEB_AI_SCOPE = 'web_ai';
const BROWSER_SCOPE = 'browser';
const PROVIDERS = new Set(['chatgpt', 'gemini', 'grok']);
const VENDOR_DEFAULT_URLS = {
    chatgpt: 'https://chatgpt.com',
    gemini: 'https://gemini.google.com',
    grok: 'https://grok.com',
};

/**
 * @param {any} args
 */
function providerFromArgs(args = {}) {
    const provider = args.provider || args.vendor || 'chatgpt';
    if (!PROVIDERS.has(provider)) throw new Error(`unsupported provider: ${provider}`);
    return provider;
}

/**
 * @param {any} payload
 */
function jsonResult(payload) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

/**
 * @param {any} id
 * @param {any} code
 * @param {any} message
 * @param {any} [data]
 */
function jsonError(id, code, message, data) {
    return {
        jsonrpc: JSON_RPC,
        id,
        error: {
            code,
            message,
            ...(data ? { data } : {}),
        },
    };
}

/**
 * @param {any} id
 * @param {any} result
 */
function jsonResponse(id, result) {
    return { jsonrpc: JSON_RPC, id, result };
}

/**
 * @param {any} provider
 * @param {any} deps
 * @param {any} input
 */
async function pollByProvider(provider, deps, input) {
    if (provider === 'gemini') return geminiPollWebAi(deps, input);
    if (provider === 'grok') return grokPollWebAi(deps, input);
    return pollWebAi(deps, input);
}

/**
 * @param {any} provider
 * @param {any} deps
 * @param {any} input
 */
async function sendByProvider(provider, deps, input) {
    if (provider === 'gemini') return geminiSendWebAi(deps, input);
    if (provider === 'grok') return grokSendWebAi(deps, input);
    return sendWebAi(deps, input);
}

/**
 * @param {any} provider
 */
function copySelectorsForProvider(provider) {
    if (provider === 'gemini') return GEMINI_COPY_SELECTORS;
    if (provider === 'grok') return GROK_COPY_SELECTORS;
    return CHATGPT_COPY_SELECTORS;
}

/**
 * @param {any} name
 * @param {any} args
 * @param {any} deps
 * @param {any} state
 */
async function callMcpTool(name, args, deps, state) {
    if (!isKnownMcpTool(name)) throw new Error(`unknown tool: ${name}`);
    const policy = normalizeMcpPolicy(args.policy === undefined ? {} : args.policy);
    if (name === 'browser_snapshot') {
        const page = await deps.getPage();
        const snapshot = await buildWebAiSnapshot(page, {
            provider: null,
            compact: args.compact !== false,
            interactiveOnly: args.interactive !== false,
            maxDepth: args.maxDepth ? Number(args.maxDepth) : 6,
            rootSelector: args.rootSelector || null,
        });
        setLatestSnapshot(state, BROWSER_SCOPE, snapshot);
        return snapshot;
    }
    if (name === 'browser_click_ref') {
        const snapshot = requireLatestSnapshot(state, BROWSER_SCOPE, args.snapshotId);
        enforcePolicy(policy, { url: snapshot.url || args.url || 'about:blank' });
        return clickSnapshotRef(name, 'browser', deps, args, snapshot, {
            enforceCurrentUrl: true,
            policy,
        });
    }
    if (name === 'web_ai_snapshot') {
        const page = await deps.getPage();
        const snapshot = await buildWebAiSnapshot(page, {
            provider: providerFromArgs(args),
            compact: args.compact !== false,
            interactiveOnly: args.interactive !== false,
            maxDepth: args.maxDepth ? Number(args.maxDepth) : 6,
            rootSelector: args.rootSelector || null,
        });
        setLatestSnapshot(state, WEB_AI_SCOPE, snapshot);
        return snapshot;
    }
    if (name === 'web_ai_click_ref') {
        const provider = providerFromArgs(args);
        const snapshot = requireLatestSnapshot(state, WEB_AI_SCOPE, args.snapshotId);
        enforcePolicy(policy, { url: snapshot.url || args.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[provider] });
        return clickSnapshotRef(name, provider, deps, args, snapshot, { policy });
    }
    if (name === 'web_ai_submit_prompt') {
        const provider = providerFromArgs(args);
        enforcePolicy(policy, {
            url: state.latestSnapshot?.url || args.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[provider],
            upload: Boolean(args.filePath),
            explicitUpload: Boolean(args.filePath),
            fileAccess: Boolean(args.filePath),
            unsafeAllow: args.unsafeAllow || [],
        });
        return withMcpActiveCommand(name, provider, deps, args, () => sendByProvider(provider, deps, {
            ...args,
            vendor: provider,
            inlineOnly: args.inlineOnly !== false,
            attachmentPolicy: 'inline-only',
            reasoningEffort: args.effort || args.reasoningEffort,
        }));
    }
    if (name === 'web_ai_wait_response' || name === 'web_ai_session_resume') {
        const session = getSession(args.sessionId);
        const provider = args.provider || session?.vendor || 'chatgpt';
        return pollByProvider(providerFromArgs({ provider }), deps, {
            ...args,
            vendor: provider,
            session: args.sessionId,
            timeout: args.timeout,
        });
    }
    if (name === 'web_ai_copy_markdown') {
        const provider = providerFromArgs(args);
        const fallbackUrl = state.latestSnapshot?.url || args.url || (/** @type {any} */ (VENDOR_DEFAULT_URLS))[provider];
        const action = { url: fallbackUrl, clipboardRead: true, unsafeAllow: args.unsafeAllow || [] };
        enforcePolicy(policy, action);
        const page = await deps.getPage();
        enforcePolicy(policy, { ...action, url: page.url?.() || fallbackUrl });
        const copied = await withMcpActiveCommand(name, provider, deps, args, () => captureCopiedResponseText(page, copySelectorsForProvider(provider)));
        return { ok: copied.ok, vendor: provider, text: copied.text || '', status: copied.status || 'copied' };
    }
    if (name === 'web_ai_doctor') {
        return runDoctor(deps, {
            vendor: providerFromArgs(args),
            snapshot: args.snapshot === false ? false : 'interactive',
            full: args.full === true,
        });
    }
    throw new Error(`unhandled tool: ${name}`);
}

/**
 * @param {any} name
 * @param {any} provider
 * @param {any} deps
 * @param {any} args
 * @param {any} fn
 */
async function withMcpActiveCommand(name, provider, deps, args, fn) {
    const targetId = await deps.getTargetId?.().catch(() => null);
    if (!targetId) return fn();
    return withActiveCommand({
        command: `mcp ${name}`,
        provider,
        sessionId: args.sessionId || null,
        targetId,
        owner: 'mcp',
        port: deps.getPort?.() || 9222,
    }, fn);
}

/**
 * @param {any} policy
 */
function normalizeMcpPolicy(policy) {
    if (policy && typeof policy === 'object' && !Array.isArray(policy)) return policy;
    throw new Error('MCP policy must be an inline policy object');
}

/**
 * @param {any} message
 * @param {any} deps
 * @param {any} state
 */
export async function handleMcpMessage(message, deps, state = {}) {
    if (!message || message.jsonrpc !== JSON_RPC) return jsonError(message?.id ?? null, -32600, 'Invalid Request');
    if (message.id === undefined || message.id === null) return null;
    try {
        if (message.method === 'initialize') {
            return jsonResponse(message.id, {
                protocolVersion: MCP_PROTOCOL_VERSION,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'agbrowse', version: '0.1.5-preview' },
            });
        }
        if (message.method === 'tools/list') {
            return jsonResponse(message.id, { tools: allToolSchemas('mcp') });
        }
        if (message.method === 'tools/call') {
            const params = message.params || {};
            const result = await callMcpTool(params.name, params.arguments || {}, deps, state);
            return jsonResponse(message.id, jsonResult(result));
        }
        return jsonError(message.id, -32601, `Method not found: ${message.method}`);
    } catch (error) {
        return jsonResponse(message.id, {
            content: [{ type: 'text', text: (/** @type {any} */ (error))?.message || String(error) }],
            isError: true,
        });
    }
}

/**
 * @param {any} name
 * @param {any} provider
 * @param {any} deps
 * @param {any} args
 * @param {any} snapshot
 * @param {any} options
 */
async function clickSnapshotRef(name, provider, deps, args, snapshot, options = {}) {
    const ref = snapshot.refs?.[args.ref];
    if (!ref) throw new Error(`unknown ref for latest snapshot: ${args.ref}`);
    const page = await deps.getPage();
    const currentUrl = page.url?.() || null;
    if (options.enforceCurrentUrl && snapshot.url && currentUrl && currentUrl !== snapshot.url) {
        throw new Error(`snapshot URL mismatch: ${snapshot.url} !== ${currentUrl}`);
    }
    if (options.policy) enforcePolicy(options.policy, { url: currentUrl || snapshot.url || args.url || 'about:blank' });
    if (!ref.name) throw new Error(`ref is not actionable without an accessible name: ${args.ref}`);
    const clickOptions = {
        timeout: Number.isFinite(Number(args.timeout)) ? Math.max(1, Number(args.timeout)) : 5_000,
        ...(args.button ? { button: args.button } : {}),
        ...(args.doubleClick === true ? { clickCount: 2 } : {}),
    };
    await withMcpActiveCommand(name, provider, deps, args, async () => {
        const locator = page.getByRole(ref.role, { name: ref.name });
        const target = Number.isInteger(ref.occurrenceIndex) && ref.occurrenceIndex >= 0
            ? locator.nth(ref.occurrenceIndex)
            : locator.first();
        await target.click(clickOptions);
    });
    return { ok: true, snapshotId: snapshot.snapshotId, ref: args.ref };
}

export async function runMcpServer(/** @type {any} */ deps, {
    input = process.stdin,
    output = process.stdout,
} = {}) {
    const state = {};
    const rl = createInterface({ input, crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.trim()) continue;
        let message;
        try {
            message = JSON.parse(line);
        } catch (error) {
            output.write(`${JSON.stringify(jsonError(null, -32700, (/** @type {any} */ (error)).message))}\n`);
            continue;
        }
        const response = await handleMcpMessage(message, deps, state);
        if (response) output.write(`${JSON.stringify(response)}\n`);
    }
}
