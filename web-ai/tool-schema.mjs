// @ts-check
import { BROWSER_TOOLS, isKnownBrowserTool, policySchema, validateSchema } from './browser-tool-schema.mjs';

/**
 * @typedef {{ description: string, inputSchema: Record<string, unknown> }} ToolDefinition
 * @typedef {{ name: string, description?: string, inputSchema?: unknown, parameters?: unknown }} ToolSchema
 */

const providerEnum = ['chatgpt', 'gemini', 'grok'];
const providerSchema = { type: 'string', enum: providerEnum };
const optionalUrlSchema = { type: 'string' };
const MCP_WEB_AI_DEFERRED_NOTE = ' Note: generated image output, Deep Research, multi-turn follow-ups, archive mutation, Project Sources, and context package fields are CLI-only/deferred in MCP for this release.';

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
            provider: { ...providerSchema, default: 'chatgpt' },
            vendor: providerSchema,
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
            provider: providerSchema,
            vendor: providerSchema,
            url: optionalUrlSchema,
            policy: policySchema,
        }, ['snapshotId', 'ref']),
    },
    web_ai_submit_prompt: {
        description: `Submit prompt to ChatGPT/Gemini/Grok web UI. When timeout is omitted, the selected model tier supplies the persisted session deadline.${MCP_WEB_AI_DEFERRED_NOTE}`,
        inputSchema: objectSchema({
            provider: { ...providerSchema, default: 'chatgpt' },
            vendor: providerSchema,
            surface: { type: 'string', enum: ['chat'] },
            family: { type: 'string', enum: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4', 'gpt-5.3', 'o3'] },
            model: { type: 'string' },
            effort: { type: 'string', enum: ['medium', 'high', 'xhigh', 'extra-high', 'extra_high', 'extra high', 'light', 'low', 'standard', 'normal', 'regular', 'default', 'extended', 'heavy'] },
            reasoningEffort: { type: 'string', enum: ['medium', 'high', 'xhigh', 'extra-high', 'extra_high', 'extra high', 'light', 'low', 'standard', 'normal', 'regular', 'default', 'extended', 'heavy'] },
            prompt: { type: 'string', minLength: 1 },
            system: { type: 'string' },
            context: { type: 'string' },
            filePath: { type: 'string' },
            url: optionalUrlSchema,
            inlineOnly: { type: 'boolean', default: true },
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit submit timeout in seconds; overrides the selected tier default.',
            },
            maxUploadFileSize: { type: 'number', minimum: 1 },
            attachmentUploadTimeoutMs: { type: 'number', minimum: 1 },
            policy: policySchema,
        }, ['prompt']),
    },
    web_ai_wait_response: {
        description: 'Wait for a stored provider session response. When timeout is omitted, inherit the remaining stored session deadline before tier/vendor fallback; preserve sessionId after a recoverable timeout.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: providerSchema,
            vendor: providerSchema,
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit wait timeout in seconds; overrides the remaining stored session deadline.',
            },
        }, ['sessionId']),
    },
    web_ai_copy_markdown: {
        description: 'Copy last response as markdown.',
        inputSchema: objectSchema({
            provider: { ...providerSchema, default: 'chatgpt' },
            vendor: providerSchema,
            url: optionalUrlSchema,
            policy: policySchema,
        }),
    },
    web_ai_doctor: {
        description: 'Run provider diagnostics and return repair packet.',
        inputSchema: objectSchema({
            provider: { ...providerSchema, default: 'chatgpt' },
            vendor: providerSchema,
            snapshot: { type: 'boolean', default: true },
            full: { type: 'boolean', default: false },
        }),
    },
    web_ai_session_resume: {
        description: 'Resume a stored provider session through session-bound recovery. When timeout is omitted, inherit the remaining stored session deadline before tier/vendor fallback.',
        inputSchema: objectSchema({
            sessionId: { type: 'string' },
            provider: providerSchema,
            vendor: providerSchema,
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit resume timeout in seconds; overrides the remaining stored session deadline.',
            },
        }, ['sessionId']),
    },
    web_ai_work_send: {
        description: 'Submit prompt to ChatGPT Work surface with Power control. Requires ChatGPT Pro subscription.',
        inputSchema: objectSchema({
            prompt: { type: 'string', minLength: 1 },
            power: { type: 'number', minimum: 1, maximum: 6 },
            speed: { type: 'string', enum: ['standard', 'fast'] },
            timeout: {
                type: 'number',
                minimum: 1,
                description: 'Explicit timeout in seconds for Work submission.',
            },
        }, ['prompt', 'power']),
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

/**
 * @param {string} toolName
 * @param {unknown} input
 * @returns {boolean}
 */
export function validateWebAiToolInput(toolName, input) {
    const tool = WEB_AI_TOOLS[toolName];
    if (!tool) throw new Error(`unknown web-ai tool: ${toolName}`);
    validateSchema(toolName, tool.inputSchema, input ?? {});
    return true;
}

export { BROWSER_TOOLS, isKnownBrowserTool };
