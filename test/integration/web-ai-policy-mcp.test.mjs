import { describe, expect, it, vi } from 'vitest';
import { handleMcpMessage } from '../../web-ai/mcp-server.mjs';
import { registerActiveCommand } from '../../web-ai/active-command-store.mjs';
import { createTempBrowserEnv } from '../helpers/temp-env.mjs';

async function withTempHome(fn) {
    const temp = createTempBrowserEnv('agbrowse-mcp-active-command-');
    const previousHome = process.env.BROWSER_AGENT_HOME;
    process.env.BROWSER_AGENT_HOME = temp.homeDir;
    try {
        return await fn(temp);
    } finally {
        if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
        else process.env.BROWSER_AGENT_HOME = previousHome;
        temp.cleanup();
    }
}

describe('web-ai policy MCP', () => {
    it('denies copy markdown clipboard read before touching page', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'web_ai_copy_markdown', arguments: { provider: 'chatgpt' } },
        }, deps, {});
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('clipboard read denied');
        expect(deps.getPage).not.toHaveBeenCalled();
    });

    it('allows copy markdown policy path when explicitly unsafe-allowed', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('browser reached after policy pass'); }) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: { provider: 'chatgpt', unsafeAllow: ['clipboard-read'] },
            },
        }, deps, {});
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('browser reached after policy pass');
        expect(deps.getPage).toHaveBeenCalled();
    });

    it('enforces denied provider default origin before touching page', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: {
                    provider: 'chatgpt',
                    unsafeAllow: ['clipboard-read'],
                    policy: { version: 1, deniedOrigins: ['https://chatgpt.com'] },
                },
            },
        }, deps, {});
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('origin denied');
        expect(deps.getPage).not.toHaveBeenCalled();
    });

    it('enforces denied snapshot origin for copy and submit before touching page', async () => {
        const state = {
            latestSnapshot: {
                snapshotId: 'snap-1',
                url: 'https://evil.test/page',
                refs: {},
            },
        };
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        const policy = { version: 1, deniedOrigins: ['https://evil.test'] };
        const copyResponse = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: { provider: 'chatgpt', unsafeAllow: ['clipboard-read'], policy },
            },
        }, deps, state);
        const submitResponse = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'web_ai_submit_prompt',
                arguments: { provider: 'chatgpt', prompt: 'hello', inlineOnly: true, policy },
            },
        }, deps, state);
        expect(copyResponse.result.isError).toBe(true);
        expect(copyResponse.result.content[0].text).toContain('origin denied');
        expect(submitResponse.result.isError).toBe(true);
        expect(submitResponse.result.content[0].text).toContain('origin denied');
        expect(deps.getPage).not.toHaveBeenCalled();
    });

    it('uses snapshot origin over caller-supplied url for snapshot actions', async () => {
        const state = {
            latestSnapshot: {
                snapshotId: 'snap-1',
                url: 'https://evil.test/page',
                refs: {},
            },
        };
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: {
                    provider: 'chatgpt',
                    url: 'https://chatgpt.com/',
                    unsafeAllow: ['clipboard-read'],
                    policy: { version: 1, deniedOrigins: ['https://evil.test'] },
                },
            },
        }, deps, state);
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('origin denied');
        expect(deps.getPage).not.toHaveBeenCalled();
    });

    it('enforces denied browser snapshot origin before touching page', async () => {
        const state = {
            latestSnapshots: {
                browser: {
                    snapshotId: 'browser-snap-1',
                    url: 'https://evil.test/page',
                    refs: {
                        '@e1': { ref: '@e1', role: 'button', name: 'Send', occurrenceIndex: 0 },
                    },
                },
            },
        };
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'browser_click_ref',
                arguments: {
                    snapshotId: 'browser-snap-1',
                    ref: '@e1',
                    policy: { version: 1, deniedOrigins: ['https://evil.test'] },
                },
            },
        }, deps, state);
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('origin denied');
        expect(deps.getPage).not.toHaveBeenCalled();
    });

    it('rejects invalid inline MCP policy before defaulting', async () => {
        const deps = { getPage: vi.fn(() => { throw new Error('browser should not be touched'); }) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: { provider: 'chatgpt', policy: null },
            },
        }, deps, {});
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('MCP policy must be an inline policy object');
        expect(deps.getPage).not.toHaveBeenCalled();
    });

    it('checks actual current page origin for copy when no snapshot exists', async () => {
        const page = { url: () => 'https://evil.test/current' };
        const deps = { getPage: vi.fn(() => page) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: {
                    provider: 'chatgpt',
                    url: 'https://chatgpt.com/',
                    unsafeAllow: ['clipboard-read'],
                    policy: { version: 1, deniedOrigins: ['https://evil.test'] },
                },
            },
        }, deps, {});
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('origin denied');
        expect(deps.getPage).toHaveBeenCalledOnce();
    });

    it('checks actual current page origin for copy even when snapshot origin is allowed', async () => {
        const state = {
            latestSnapshot: {
                snapshotId: 'snap-1',
                url: 'https://chatgpt.com/c/allowed',
                refs: {},
            },
        };
        const page = { url: () => 'https://evil.test/current' };
        const deps = { getPage: vi.fn(() => page) };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: {
                    provider: 'chatgpt',
                    unsafeAllow: ['clipboard-read'],
                    policy: { version: 1, deniedOrigins: ['https://evil.test'] },
                },
            },
        }, deps, state);
        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('origin denied');
        expect(deps.getPage).toHaveBeenCalledOnce();
    });

    it('blocks MCP mutation when the current target is owned by another active command', async () => withTempHome(async () => {
        await registerActiveCommand({
            commandId: 'cmd-owner',
            targetId: 'target-owned',
            browserProfileKey: '9222',
        });
        const page = {
            url: () => 'https://chatgpt.com/c/owned',
            locator: vi.fn(() => {
                throw new Error('copy capture should not run after ownership conflict');
            }),
        };
        const deps = {
            getPage: vi.fn(async () => page),
            getTargetId: vi.fn(async () => 'target-owned'),
            getPort: () => 9222,
        };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'web_ai_copy_markdown',
                arguments: {
                    provider: 'chatgpt',
                    unsafeAllow: ['clipboard-read'],
                },
            },
        }, deps, {});

        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('target already owned by active command');
        expect(page.locator).not.toHaveBeenCalled();
    }));

    it('blocks generic browser click when the current target is owned by another active command', async () => withTempHome(async () => {
        await registerActiveCommand({
            commandId: 'cmd-owner',
            targetId: 'target-owned',
            browserProfileKey: '9222',
        });
        const state = {
            latestSnapshots: {
                browser: {
                    snapshotId: 'browser-snap-owned',
                    url: 'https://example.test/owned',
                    refs: {
                        '@e1': { ref: '@e1', role: 'button', name: 'Send', occurrenceIndex: 0 },
                    },
                },
            },
        };
        const page = {
            url: () => 'https://example.test/owned',
            getByRole: vi.fn(() => {
                throw new Error('ref should not resolve after ownership conflict');
            }),
        };
        const deps = {
            getPage: vi.fn(async () => page),
            getTargetId: vi.fn(async () => 'target-owned'),
            getPort: () => 9222,
        };
        const response = await handleMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'browser_click_ref',
                arguments: {
                    snapshotId: 'browser-snap-owned',
                    ref: '@e1',
                },
            },
        }, deps, state);

        expect(response.result.isError).toBe(true);
        expect(response.result.content[0].text).toContain('target already owned by active command');
        expect(page.getByRole).not.toHaveBeenCalled();
    }));
});
