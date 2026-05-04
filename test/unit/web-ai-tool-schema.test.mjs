import { describe, expect, it } from 'vitest';
import {
    BROWSER_TOOLS,
    MCP_TOOLS,
    WEB_AI_TOOLS,
    allToolSchemas,
    isKnownBrowserTool,
    isKnownMcpTool,
    isKnownWebAiTool,
    toolSchemaForAiSdk,
    toolSchemaForMcp,
} from '../../web-ai/tool-schema.mjs';

describe('web-ai MCP tool schema', () => {
    it('exposes all Phase 10 tools as MCP schemas', () => {
        expect(Object.keys(WEB_AI_TOOLS)).toEqual([
            'web_ai_snapshot',
            'web_ai_click_ref',
            'web_ai_submit_prompt',
            'web_ai_wait_response',
            'web_ai_copy_markdown',
            'web_ai_doctor',
            'web_ai_session_resume',
        ]);
        const schemas = allToolSchemas('mcp');
        expect(schemas).toHaveLength(Object.keys(MCP_TOOLS).length);
        for (const schema of schemas) {
            expect(schema.description).toBeTruthy();
            expect(schema.inputSchema.type).toBe('object');
            expect(schema.inputSchema.additionalProperties).toBe(false);
        }
    });

    it('exposes Phase 18 browser tools from the shared schema source', () => {
        expect(Object.keys(BROWSER_TOOLS)).toEqual([
            'browser_snapshot',
            'browser_click_ref',
        ]);
        expect(allToolSchemas('mcp').map(tool => tool.name)).toEqual(Object.keys(MCP_TOOLS));
        expect(toolSchemaForMcp('browser_snapshot')).toHaveProperty('inputSchema');
        expect(toolSchemaForAiSdk('browser_click_ref')).toHaveProperty('parameters');
        expect(isKnownBrowserTool('browser_snapshot')).toBe(true);
        expect(isKnownMcpTool('browser_click_ref')).toBe(true);
    });

    it('renders AI SDK parameters without mutating the MCP schema', () => {
        expect(toolSchemaForMcp('web_ai_snapshot')).toHaveProperty('inputSchema');
        expect(toolSchemaForAiSdk('web_ai_snapshot')).toHaveProperty('parameters');
        expect(isKnownWebAiTool('web_ai_snapshot')).toBe(true);
        expect(isKnownWebAiTool('invalid_tool')).toBe(false);
        expect(isKnownMcpTool('invalid_tool')).toBe(false);
    });
});
