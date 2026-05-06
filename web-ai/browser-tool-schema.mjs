// @ts-check

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

const policySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        version: { type: 'number', enum: [1] },
        allowedOrigins: { type: 'array', items: { type: 'string' } },
        deniedOrigins: { type: 'array', items: { type: 'string' } },
        allowDownloads: { type: 'boolean' },
        allowUploads: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['explicit-only'] }] },
        allowClipboardRead: { type: 'boolean' },
        allowClipboardWrite: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['explicit-only'] }] },
        allowEvaluate: { type: 'boolean' },
        allowFileAccess: { type: 'boolean' },
        allowCrossOriginNavigation: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['confirm'] }] },
        destructiveFormPolicy: { type: 'string', enum: ['deny'] },
        promptInjectionBoundary: { type: 'string', enum: ['strict'] },
    },
};

/** @type {Record<string, { description: string, inputSchema: ReturnType<typeof objectSchema> }>} */
export const BROWSER_TOOLS = {
    browser_snapshot: {
        description: 'Return compact accessibility snapshot for the active browser tab.',
        inputSchema: objectSchema({
            compact: { type: 'boolean', default: true },
            interactive: { type: 'boolean', default: true },
            maxDepth: { type: 'number', minimum: 1, maximum: 12, default: 6 },
            rootSelector: { type: 'string' },
        }),
    },
    browser_click_ref: {
        description: 'Click an element ref from the latest generic browser snapshot.',
        inputSchema: objectSchema({
            snapshotId: { type: 'string' },
            ref: { type: 'string', pattern: '^@e[0-9]+$' },
            button: { type: 'string', enum: ['left', 'right', 'middle'], default: 'left' },
            doubleClick: { type: 'boolean', default: false },
            timeout: { type: 'number', minimum: 1, maximum: 60000, default: 5000 },
            policy: policySchema,
        }, ['snapshotId', 'ref']),
    },
};

export const FROZEN_BROWSER_TOOL_NAMES = Object.freeze(Object.keys(BROWSER_TOOLS));

export const NOT_IMPLEMENTED_BROWSER_TOOLS = Object.freeze({
    browser_type_ref: 'planned: type into a snapshot ref',
    browser_navigate: 'planned: navigate the active tab to a URL',
    browser_back: 'planned: navigate back in history',
    browser_forward: 'planned: navigate forward in history',
    browser_reload: 'planned: reload the active tab',
    browser_wait_for: 'planned: wait for a snapshot ref or condition',
    browser_screenshot: 'planned: capture a screenshot of the active tab',
    browser_extract_text: 'planned: extract visible text from a snapshot ref',
});

/**
 * @typedef {Error & { code?: string }} BrowserToolError
 */

/**
 * @param {string} toolName
 * @returns {boolean}
 */
export function isKnownBrowserTool(toolName) {
    return Boolean(BROWSER_TOOLS[toolName]);
}

/**
 * @param {string} toolName
 * @returns {boolean}
 */
export function isNotImplementedBrowserTool(toolName) {
    return Object.prototype.hasOwnProperty.call(NOT_IMPLEMENTED_BROWSER_TOOLS, toolName);
}

/**
 * @param {string} name
 * @param {string} message
 * @returns {BrowserToolError}
 */
function fail(name, message) {
    const err = /** @type {BrowserToolError} */ (new Error(`browser MCP input invalid for ${name}: ${message}`));
    err.code = 'BROWSER_TOOL_INPUT_INVALID';
    return err;
}

/**
 * @param {string} name
 * @param {Record<string, any>} schema
 * @param {unknown} value
 * @param {string} [pathPrefix]
 * @returns {void}
 */
function validateSchema(name, schema, value, pathPrefix = '') {
    if (schema.type === 'object') {
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            throw fail(name, `${pathPrefix || 'input'} must be object`);
        }
        const required = schema.required || [];
        for (const key of required) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) {
                throw fail(name, `${pathPrefix}${key} is required`);
            }
        }
        const props = schema.properties || {};
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(value)) {
                if (!Object.prototype.hasOwnProperty.call(props, key)) {
                    throw fail(name, `unknown property ${pathPrefix}${key}`);
                }
            }
        }
        for (const [key, sub] of Object.entries(props)) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                validateSchema(name, /** @type {Record<string, any>} */ (sub), /** @type {Record<string, any>} */ (value)[key], `${pathPrefix}${key}.`);
            }
        }
        return;
    }
    if (schema.anyOf) {
        let lastErr = null;
        for (const sub of schema.anyOf) {
            try {
                validateSchema(name, sub, value, pathPrefix);
                return;
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr || fail(name, `${pathPrefix.replace(/\.$/, '') || 'input'} did not match anyOf`);
    }
    if (schema.type === 'string') {
        if (typeof value !== 'string') throw fail(name, `${pathPrefix.replace(/\.$/, '')} must be string`);
        if (schema.minLength != null && value.length < schema.minLength) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} shorter than minLength`);
        }
        if (schema.enum && !schema.enum.includes(value)) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} not in enum`);
        }
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} does not match pattern ${schema.pattern}`);
        }
        return;
    }
    if (schema.type === 'number') {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} must be number`);
        }
        if (schema.minimum != null && value < schema.minimum) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} below minimum`);
        }
        if (schema.maximum != null && value > schema.maximum) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} above maximum`);
        }
        if (schema.enum && !schema.enum.includes(value)) {
            throw fail(name, `${pathPrefix.replace(/\.$/, '')} not in enum`);
        }
        return;
    }
    if (schema.type === 'boolean') {
        if (typeof value !== 'boolean') throw fail(name, `${pathPrefix.replace(/\.$/, '')} must be boolean`);
        return;
    }
    if (schema.type === 'array') {
        if (!Array.isArray(value)) throw fail(name, `${pathPrefix.replace(/\.$/, '')} must be array`);
        if (schema.items) {
            value.forEach((item, idx) => {
                validateSchema(name, schema.items, item, `${pathPrefix}${idx}.`);
            });
        }
        return;
    }
}

/**
 * Strict validator for the frozen browser MCP tool inputs. Throws an error
 * with code `BROWSER_TOOL_INPUT_INVALID` when input does not match the schema.
 * Returns true on success. Throws `BROWSER_TOOL_NOT_IMPLEMENTED` for tools
 * that are tracked as planned-but-unimplemented in
 * `NOT_IMPLEMENTED_BROWSER_TOOLS`.
 *
 * @param {string} toolName
 * @param {unknown} input
 * @returns {boolean}
 */
export function validateBrowserToolInput(toolName, input) {
    if (isNotImplementedBrowserTool(toolName)) {
        const err = /** @type {BrowserToolError} */ (new Error(`browser MCP tool not implemented: ${toolName}`));
        err.code = 'BROWSER_TOOL_NOT_IMPLEMENTED';
        throw err;
    }
    if (!isKnownBrowserTool(toolName)) {
        const err = /** @type {BrowserToolError} */ (new Error(`unknown browser MCP tool: ${toolName}`));
        err.code = 'BROWSER_TOOL_UNKNOWN';
        throw err;
    }
    const tool = BROWSER_TOOLS[toolName];
    validateSchema(toolName, tool.inputSchema, input ?? {});
    return true;
}
