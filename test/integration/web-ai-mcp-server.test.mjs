import { describe, expect, it } from 'vitest';
import { handleMcpMessage } from '../../web-ai/mcp-server.mjs';

function fakePage() {
    return {
        url: () => 'https://chatgpt.com/',
        accessibility: {
            snapshot: async () => ({
                role: 'document',
                name: '',
                children: [
                    { role: 'button', name: 'Send' },
                ],
            }),
        },
        locator: () => ({ elementHandle: async () => null }),
        evaluate: async () => 'hash-source',
        getByRole: () => ({ first: () => ({ click: async () => undefined }) }),
    };
}

describe('web-ai MCP server', () => {
    it('responds to initialize and tools/list JSON-RPC requests', async () => {
        const init = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }, {});
        expect(init.result.protocolVersion).toBe('2025-06-18');
        expect(init.result.capabilities.tools.listChanged).toBe(false);

        const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, {});
        expect(listed.result.tools.map(tool => tool.name)).toContain('web_ai_snapshot');
        expect(listed.result.tools.map(tool => tool.name)).toContain('web_ai_submit_prompt');
    });

    it('runs web_ai_snapshot and rejects stale refs', async () => {
        const state = {};
        const deps = { getPage: async () => fakePage() };
        const snapshotResponse = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'web_ai_snapshot',
                arguments: { provider: 'chatgpt', compact: true },
            },
        }, deps, state);

        expect(snapshotResponse.result.structuredContent.snapshotId).toBeTruthy();
        expect(snapshotResponse.result.structuredContent.refs['@e1'].name).toBe('Send');

        const staleClick = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'web_ai_click_ref',
                arguments: { snapshotId: 'not-current', ref: '@e1' },
            },
        }, deps, state);

        expect(staleClick.result.isError).toBe(true);
        expect(staleClick.result.content[0].text).toContain('stale snapshotId');
    });
});
