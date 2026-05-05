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

/**
 * @param {string} toolName
 * @returns {boolean}
 */
export function isKnownBrowserTool(toolName) {
    return Boolean(BROWSER_TOOLS[toolName]);
}
