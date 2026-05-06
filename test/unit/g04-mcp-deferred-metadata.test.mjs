// @ts-check
import { describe, it, expect } from 'vitest';
import {
    BROWSER_TOOLS,
    DEFERRED_BROWSER_TOOLS,
    NOT_IMPLEMENTED_BROWSER_TOOLS,
    getDeferredBrowserToolMetadata,
    isKnownBrowserTool,
} from '../../web-ai/browser-tool-schema.mjs';
import { handleMcpMessage } from '../../web-ai/mcp-server.mjs';

describe('G04 — MCP deferred-tool metadata + probe-safe envelope', () => {
    it('every deferred entry carries reason+cliEquivalent+competitorRef+since', () => {
        const required = ['reason', 'cliEquivalent', 'competitorRef', 'since'];
        const names = Object.keys(DEFERRED_BROWSER_TOOLS);
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
            const meta = /** @type {any} */ (DEFERRED_BROWSER_TOOLS)[name];
            for (const key of required) {
                expect(typeof meta[key], `${name}.${key}`).toBe('string');
                expect(meta[key].length, `${name}.${key} non-empty`).toBeGreaterThan(0);
            }
        }
    });

    it('legacy NOT_IMPLEMENTED_BROWSER_TOOLS shape preserved (back-compat)', () => {
        expect(Object.keys(NOT_IMPLEMENTED_BROWSER_TOOLS).sort()).toEqual(
            Object.keys(DEFERRED_BROWSER_TOOLS).sort(),
        );
    });

    it('no deferred name overlaps the live BROWSER_TOOLS scope', () => {
        for (const name of Object.keys(DEFERRED_BROWSER_TOOLS)) {
            expect(isKnownBrowserTool(name), `${name} must not be live`).toBe(false);
        }
    });

    it('getDeferredBrowserToolMetadata returns null for unknown name', () => {
        expect(getDeferredBrowserToolMetadata('browser_does_not_exist')).toBe(null);
    });

    it('tools/call on a deferred tool returns capability.unsupported envelope (no JSON-RPC error)', async () => {
        const response = await handleMcpMessage(
            {
                jsonrpc: '2.0',
                id: 42,
                method: 'tools/call',
                params: { name: 'browser_navigate', arguments: { url: 'https://example.com' } },
            },
            /** @type {any} */ ({ getPage: async () => ({ url: () => 'about:blank' }) }),
            {},
        );
        expect(response).toBeTruthy();
        expect(response.error).toBeUndefined();
        const structured = response.result?.structuredContent;
        expect(structured).toBeTruthy();
        expect(structured.ok).toBe(false);
        expect(structured.code).toBe('capability.unsupported');
        expect(structured.tool).toBe('browser_navigate');
        expect(typeof structured.cliEquivalent).toBe('string');
        expect(typeof structured.competitorRef).toBe('string');
        expect(structured.scope).toBe('browser');
        expect(structured.mcpScope).toBe('frozen');
    });
});
