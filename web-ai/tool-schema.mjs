// @ts-check
import { BROWSER_TOOLS, isKnownBrowserTool } from './browser-tool-schema.mjs';

/**
 * @typedef {{ description: string, inputSchema: Record<string, unknown> }} ToolDefinition
 * @typedef {{ name: string, description?: string, inputSchema?: unknown, parameters?: unknown }} ToolSchema
 */

const providerEnum = ['chatgpt', 'gemini', 'grok'];

/**
 * @param {Record<string, unknown>} properties
 * @param {string[]} [required]
 */
const objectSchema = (properties, required = []) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
});

/** @type {Record<string, ToolDefinition>} */
export const WEB_AI_TOOLS = {
    web_ai_snapshot: {
        description: 'Return compact accessibility snapshot with @eN refs.',
        inputSchema: objectSchema({
            provider: { type: 'string', enum: providerEnum, default: 'chatgpt' },
            compact: { type: 'boolean', default: true },
            interactive: { type: 'boolean', default: true },
            maxDepth: { type: 'number', minimum: 1, maximum: 12, default: 6 },
            rootSelector: { type: 'string' },
        }),
    },
    web_ai_click_ref: {
        description: 'Click an element ref from the latest snapshot.',
        inputSchema: objectSchema({
            snapshotId: { type: 'string' },
            ref: { type: 'string', pattern: '^@e[0-9]+$' },
        }, ['snapshotId', 'ref']),
    },
    web_ai_submit_prompt: {
        description: 'Submit prompt to ChatGPT/Gemini/Grok web UI.',
        inputSchema: objectSchema({
            provider: { type: 'string', enum: providerEnum, default: 'chatgpt' },
            model: { type: 'string' },
            effort: { type: 'string' },
            prompt: { type: 'string', minLength: 1 },
            system: { type: 'string' },
            context: { type: 'string' },
            inlineOnly: { type: 'boolean', default: true },
            timeout: { type: 'number' },
        }, ['prompt']),
    },
    web_ai_wait_response: {
        description: 'Wait for provider response completion.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: { type: 'string', enum: providerEnum },
            timeout: { type: 'number' },
        }, ['sessionId']),
    },
    web_ai_copy_markdown: {
        description: 'Copy last response as markdown.',
        inputSchema: objectSchema({
            provider: { type: 'string', enum: providerEnum, default: 'chatgpt' },
        }),
    },
    web_ai_doctor: {
        description: 'Run provider diagnostics and return repair packet.',
        inputSchema: objectSchema({
            provider: { type: 'string', enum: providerEnum, default: 'chatgpt' },
            snapshot: { type: 'boolean', default: true },
            full: { type: 'boolean', default: false },
        }),
    },
    web_ai_session_resume: {
        description: 'Resume a stored session by ID.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: { type: 'string', enum: providerEnum },
            timeout: { type: 'number' },
        }, ['sessionId']),
    },
};

/** @type {Record<string, ToolDefinition>} */
const browserToolsChecked = BROWSER_TOOLS;

/** @type {Record<string, ToolDefinition>} */
export const MCP_TOOLS = {
    ...WEB_AI_TOOLS,
    ...browserToolsChecked,
};

/**
 * @param {string} toolName
 */
export function toolSchemaForMcp(toolName) {
    const tool = MCP_TOOLS[toolName];
    if (!tool) return null;
    return {
        name: toolName,
        description: tool.description,
        inputSchema: tool.inputSchema,
    };
}

/**
 * @param {string} toolName
 */
export function toolSchemaForAiSdk(toolName) {
    const tool = MCP_TOOLS[toolName];
    if (!tool) return null;
    return {
        name: toolName,
        description: tool.description,
        parameters: tool.inputSchema,
    };
}

/**
 * @param {string} [format]
 * @returns {Array<ToolSchema|null>}
 */
export function allToolSchemas(format = 'mcp') {
    /** @type {(name: string) => ToolSchema|null} */
    const mapper = format === 'ai-sdk' ? toolSchemaForAiSdk : toolSchemaForMcp;
    return Object.keys(MCP_TOOLS).map((name) => mapper(name));
}

/**
 * @param {string} toolName
 * @returns {boolean}
 */
export function isKnownMcpTool(toolName) {
    return Boolean(MCP_TOOLS[toolName]);
}

/**
 * @param {string} toolName
 * @returns {boolean}
 */
export function isKnownWebAiTool(toolName) {
    return Boolean(WEB_AI_TOOLS[toolName]);
}

export { BROWSER_TOOLS, isKnownBrowserTool };
