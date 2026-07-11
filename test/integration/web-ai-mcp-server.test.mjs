import { describe, expect, it } from 'vitest';
import { handleMcpMessage } from '../../web-ai/mcp-server.mjs';

function fakePage({ duplicateButtons = false, clicked = [], url = 'https://chatgpt.com/' } = {}) {
    return {
        url: () => url,
        accessibility: {
            snapshot: async () => ({
                role: 'document',
                name: '',
                children: [
                    { role: 'button', name: 'Send' },
                    ...(duplicateButtons ? [{ role: 'button', name: 'Send' }] : []),
                ],
            }),
        },
        locator: () => ({ elementHandle: async () => null }),
        evaluate: async () => 'hash-source',
        getByRole: (role, options) => ({
            first: () => ({
                click: async () => clicked.push({ role, name: options.name, index: 0, via: 'first' }),
            }),
            nth: index => ({
                click: async () => clicked.push({ role, name: options.name, index, via: 'nth' }),
            }),
        }),
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
        expect(listed.result.tools.map(tool => tool.name)).toContain('browser_snapshot');
        expect(listed.result.tools.map(tool => tool.name)).toContain('browser_click_ref');

        const submitPrompt = listed.result.tools.find(tool => tool.name === 'web_ai_submit_prompt');
        expect(submitPrompt.inputSchema.properties.vendor.enum).toContain('grok');
        expect(submitPrompt.inputSchema.properties.policy.additionalProperties).toBe(false);
        expect(submitPrompt.inputSchema.properties.filePath.type).toBe('string');
        expect(submitPrompt.inputSchema.properties.reasoningEffort.type).toBe('string');
        expect(submitPrompt.inputSchema.properties.maxUploadFileSize.type).toBe('number');
        expect(submitPrompt.inputSchema.properties.attachmentUploadTimeoutMs.type).toBe('number');
        expect(submitPrompt.description).toContain('generated image output');
        expect(submitPrompt.description).toContain('CLI-only/deferred');
        const waitResponse = listed.result.tools.find(tool => tool.name === 'web_ai_wait_response');
        expect(waitResponse.description).toContain('recoverable timeout');
        expect(waitResponse.description).toContain('sessionId');
    });

    it('rejects unknown web_ai input fields before command execution', async () => {
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 21,
            method: 'tools/call',
            params: {
                name: 'web_ai_submit_prompt',
                arguments: {
                    prompt: 'hello',
                    polciy: { version: 1 },
                },
            },
        }, {});

        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('unknown property polciy');
    });

    it('rejects unsafeAllow before schema validation hides the policy error', async () => {
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 22,
            method: 'tools/call',
            params: {
                name: 'web_ai_submit_prompt',
                arguments: {
                    prompt: 'hello',
                    unsafeAllow: true,
                },
            },
        }, {});

        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('unsafeAllow is server-side policy');
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

    it('clicks duplicate role/name refs by snapshot occurrence instead of first match', async () => {
        const state = {};
        const clicked = [];
        const deps = { getPage: async () => fakePage({ duplicateButtons: true, clicked }) };
        const snapshotResponse = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: {
                name: 'web_ai_snapshot',
                arguments: { provider: 'chatgpt', compact: true },
            },
        }, deps, state);

        const snapshot = snapshotResponse.result.structuredContent;
        expect(snapshot.refs['@e1'].occurrenceIndex).toBe(0);
        expect(snapshot.refs['@e2'].occurrenceIndex).toBe(1);

        const click = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: {
                name: 'web_ai_click_ref',
                arguments: { snapshotId: snapshot.snapshotId, ref: '@e2' },
            },
        }, deps, state);

        expect(click.result.structuredContent.ok).toBe(true);
        expect(clicked).toEqual([{ role: 'button', name: 'Send', index: 1, via: 'nth' }]);
    });

    it('keeps generic browser snapshot refs isolated from web-ai refs', async () => {
        const state = {};
        const clicked = [];
        const deps = { getPage: async () => fakePage({ clicked }) };
        const browserSnapshot = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: {
                name: 'browser_snapshot',
                arguments: { compact: true },
            },
        }, deps, state);

        const snapshot = browserSnapshot.result.structuredContent;
        expect(snapshot.provider).toBe(null);
        expect(snapshot.refs['@e1'].name).toBe('Send');

        const wrongScopeClick = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 8,
            method: 'tools/call',
            params: {
                name: 'web_ai_click_ref',
                arguments: { snapshotId: snapshot.snapshotId, ref: '@e1' },
            },
        }, deps, state);
        expect(wrongScopeClick.result.isError).toBe(true);
        expect(wrongScopeClick.result.content[0].text).toContain('stale snapshotId');

        const browserClick = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 9,
            method: 'tools/call',
            params: {
                name: 'browser_click_ref',
                arguments: { snapshotId: snapshot.snapshotId, ref: '@e1' },
            },
        }, deps, state);

        expect(browserClick.result.structuredContent).toEqual({
            ok: true,
            snapshotId: snapshot.snapshotId,
            ref: '@e1',
        });
        expect(clicked).toEqual([{ role: 'button', name: 'Send', index: 0, via: 'nth' }]);
    });

    it('rejects browser refs when the active page moved after snapshot', async () => {
        const state = {};
        const clicked = [];
        let pageUrl = 'https://example.test/a';
        const deps = { getPage: async () => fakePage({ clicked, url: pageUrl }) };
        const browserSnapshot = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 10,
            method: 'tools/call',
            params: {
                name: 'browser_snapshot',
                arguments: { compact: true },
            },
        }, deps, state);

        const snapshot = browserSnapshot.result.structuredContent;
        pageUrl = 'https://example.test/b';
        const browserClick = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 11,
            method: 'tools/call',
            params: {
                name: 'browser_click_ref',
                arguments: { snapshotId: snapshot.snapshotId, ref: '@e1' },
            },
        }, deps, state);

        expect(browserClick.result.isError).toBe(true);
        expect(browserClick.result.content[0].text).toContain('snapshot URL mismatch');
        expect(clicked).toEqual([]);
    });
});

// 04: web_ai_work_send MCP contract
describe('web_ai_work_send MCP', () => {
    it('lists web_ai_work_send in tools/list with correct schema', async () => {
        const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 100, method: 'tools/list' }, {});
        const workSend = listed.result.tools.find(t => t.name === 'web_ai_work_send');
        expect(workSend).toBeTruthy();
        expect(workSend.inputSchema.properties.prompt.type).toBe('string');
        expect(workSend.inputSchema.properties.power.minimum).toBe(1);
        expect(workSend.inputSchema.properties.power.maximum).toBe(6);
        expect(workSend.inputSchema.properties.speed.enum).toEqual(['standard', 'fast']);
        expect(workSend.inputSchema.required).toContain('prompt');
        expect(workSend.inputSchema.required).toContain('power');
        expect(workSend.inputSchema.additionalProperties).toBe(false);
    });

    it('rejects unknown fields via additionalProperties:false', async () => {
        const resp = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 101,
            method: 'tools/call',
            params: {
                name: 'web_ai_work_send',
                arguments: { prompt: 'hello', power: 3, model: 'sol' },
            },
        }, {});
        expect(resp.result.isError).toBe(true);
        expect(resp.result.content[0].text).toContain('unknown property model');
    });

    it('rejects power out of range', async () => {
        const resp = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 102,
            method: 'tools/call',
            params: {
                name: 'web_ai_work_send',
                arguments: { prompt: 'hello', power: 8 },
            },
        }, {});
        expect(resp.result.isError).toBe(true);
        expect(resp.result.content[0].text).toMatch(/1\.\.6|maximum/i);
    });

    it('does not include model/effort/project/plugin/surface in schema', async () => {
        const listed = await handleMcpMessage({ jsonrpc: '2.0', id: 103, method: 'tools/list' }, {});
        const workSend = listed.result.tools.find(t => t.name === 'web_ai_work_send');
        const props = Object.keys(workSend.inputSchema.properties);
        expect(props).not.toContain('model');
        expect(props).not.toContain('effort');
        expect(props).not.toContain('project');
        expect(props).not.toContain('plugin');
        expect(props).not.toContain('surface');
        expect(props).not.toContain('filePath');
    });

   it('web_ai_submit_prompt rejects surface=work', async () => {
       const resp = await handleMcpMessage({
           jsonrpc: '2.0',
           id: 104,
           method: 'tools/call',
           params: {
               name: 'web_ai_submit_prompt',
               arguments: { prompt: 'hello', surface: 'work' },
           },
       }, {});
        expect(resp.result.isError).toBe(true);
        expect(resp.result.content[0].text).toContain('surface');
    });
});
