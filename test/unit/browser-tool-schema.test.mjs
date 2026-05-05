import { describe, expect, it } from 'vitest';
import { BROWSER_TOOLS, isKnownBrowserTool } from '../../web-ai/browser-tool-schema.mjs';

describe('browser MCP tool schema', () => {
    it('keeps generic browser tools compact and strict', () => {
        expect(Object.keys(BROWSER_TOOLS)).toEqual(['browser_snapshot', 'browser_click_ref']);
        for (const tool of Object.values(BROWSER_TOOLS)) {
            expect(tool.description).toBeTruthy();
            expect(tool.inputSchema.type).toBe('object');
            expect(tool.inputSchema.additionalProperties).toBe(false);
        }
        expect(BROWSER_TOOLS.browser_click_ref.inputSchema.required).toEqual(['snapshotId', 'ref']);
        expect(BROWSER_TOOLS.browser_click_ref.inputSchema.properties.policy.additionalProperties).toBe(false);
        expect(Object.keys(BROWSER_TOOLS.browser_click_ref.inputSchema.properties.policy.properties))
            .toContain('deniedOrigins');
        expect(isKnownBrowserTool('browser_snapshot')).toBe(true);
        expect(isKnownBrowserTool('web_ai_snapshot')).toBe(false);
    });
});
