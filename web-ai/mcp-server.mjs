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
import { allToolSchemas, isKnownWebAiTool } from './tool-schema.mjs';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const JSON_RPC = '2.0';
const PROVIDERS = new Set(['chatgpt', 'gemini', 'grok']);

function providerFromArgs(args = {}) {
    const provider = args.provider || args.vendor || 'chatgpt';
    if (!PROVIDERS.has(provider)) throw new Error(`unsupported provider: ${provider}`);
    return provider;
}

function jsonResult(payload) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
    };
}

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

function jsonResponse(id, result) {
    return { jsonrpc: JSON_RPC, id, result };
}

async function pollByProvider(provider, deps, input) {
    if (provider === 'gemini') return geminiPollWebAi(deps, input);
    if (provider === 'grok') return grokPollWebAi(deps, input);
    return pollWebAi(deps, input);
}

async function sendByProvider(provider, deps, input) {
    if (provider === 'gemini') return geminiSendWebAi(deps, input);
    if (provider === 'grok') return grokSendWebAi(deps, input);
    return sendWebAi(deps, input);
}

function copySelectorsForProvider(provider) {
    if (provider === 'gemini') return GEMINI_COPY_SELECTORS;
    if (provider === 'grok') return GROK_COPY_SELECTORS;
    return CHATGPT_COPY_SELECTORS;
}

async function callWebAiTool(name, args, deps, state) {
    if (!isKnownWebAiTool(name)) throw new Error(`unknown tool: ${name}`);
    if (name === 'web_ai_snapshot') {
        const page = await deps.getPage();
        const snapshot = await buildWebAiSnapshot(page, {
            provider: providerFromArgs(args),
            compact: args.compact !== false,
            interactiveOnly: args.interactive !== false,
            maxDepth: args.maxDepth ? Number(args.maxDepth) : 6,
            rootSelector: args.rootSelector || null,
        });
        state.latestSnapshot = snapshot;
        return snapshot;
    }
    if (name === 'web_ai_click_ref') {
        const snapshot = state.latestSnapshot;
        if (!snapshot || snapshot.snapshotId !== args.snapshotId) throw new Error('stale snapshotId');
        const ref = snapshot.refs?.[args.ref];
        if (!ref) throw new Error(`unknown ref for latest snapshot: ${args.ref}`);
        const page = await deps.getPage();
        if (!ref.name) throw new Error(`ref is not actionable without an accessible name: ${args.ref}`);
        await page.getByRole(ref.role, { name: ref.name }).first().click({ timeout: 5_000 });
        return { ok: true, snapshotId: snapshot.snapshotId, ref: args.ref };
    }
    if (name === 'web_ai_submit_prompt') {
        const provider = providerFromArgs(args);
        return sendByProvider(provider, deps, {
            ...args,
            vendor: provider,
            inlineOnly: args.inlineOnly !== false,
            attachmentPolicy: 'inline-only',
            reasoningEffort: args.effort || args.reasoningEffort,
        });
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
        const page = await deps.getPage();
        const copied = await captureCopiedResponseText(page, copySelectorsForProvider(provider));
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
            const result = await callWebAiTool(params.name, params.arguments || {}, deps, state);
            return jsonResponse(message.id, jsonResult(result));
        }
        return jsonError(message.id, -32601, `Method not found: ${message.method}`);
    } catch (error) {
        return jsonResponse(message.id, {
            content: [{ type: 'text', text: error?.message || String(error) }],
            isError: true,
        });
    }
}

export async function runMcpServer(deps, {
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
            output.write(`${JSON.stringify(jsonError(null, -32700, error.message))}\n`);
            continue;
        }
        const response = await handleMcpMessage(message, deps, state);
        if (response) output.write(`${JSON.stringify(response)}\n`);
    }
}
