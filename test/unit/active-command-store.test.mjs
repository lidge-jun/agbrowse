import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeCommandTargetIds, heartbeatActiveCommand, listActiveCommands, registerActiveCommand, releaseActiveCommand, withActiveCommand } from '../../web-ai/active-command-store.mjs';
import { createTempBrowserEnv } from '../helpers/temp-env.mjs';

async function withTempHome(fn) {
    const temp = createTempBrowserEnv('agbrowse-active-command-');
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

describe('active command store', () => {
    it('registers, heartbeats, and releases active commands', async () => withTempHome(async () => {
        const command = await registerActiveCommand({
            commandId: 'cmd-1',
            command: 'web-ai query',
            provider: 'chatgpt',
            sessionId: 'session-1',
            targetId: 'target-1',
            owner: 'cli',
            browserProfileKey: '9222',
        });

        expect(command.status).toBe('running');
        expect(await activeCommandTargetIds({ browserProfileKey: '9222' })).toEqual(new Set(['target-1']));

        const heartbeat = await heartbeatActiveCommand('cmd-1', { ttlMs: 30_000 });
        expect(heartbeat.commandId).toBe('cmd-1');

        const released = await releaseActiveCommand('cmd-1');
        expect(released.status).toBe('completed');
        expect(await activeCommandTargetIds({ browserProfileKey: '9222' })).toEqual(new Set());
    }));

    it('rejects two active commands for the same target', async () => withTempHome(async () => {
        await registerActiveCommand({
            commandId: 'cmd-owner',
            targetId: 'target-owned',
            browserProfileKey: '9222',
        });

        await expect(registerActiveCommand({
            commandId: 'cmd-racer',
            targetId: 'target-owned',
            browserProfileKey: '9222',
        })).rejects.toMatchObject({ code: 'active-command.target-owned' });
    }));

    it('does not treat expired commands as active ownership', async () => withTempHome(async () => {
        await registerActiveCommand({
            commandId: 'cmd-expired',
            targetId: 'target-expired',
            browserProfileKey: '9222',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        });

        expect(await listActiveCommands({ browserProfileKey: '9222', active: true })).toEqual([]);
        expect(await listActiveCommands({ browserProfileKey: '9222' })).toMatchObject([
            { commandId: 'cmd-expired', status: 'stale' },
        ]);
        await expect(registerActiveCommand({
            commandId: 'cmd-after-expiry',
            targetId: 'target-expired',
            browserProfileKey: '9222',
        })).resolves.toMatchObject({ commandId: 'cmd-after-expiry', status: 'running' });
    }));

    it('scopes active targets by browser profile key', async () => withTempHome(async () => {
        await registerActiveCommand({ commandId: 'cmd-a', targetId: 'target-a', browserProfileKey: '9222' });
        await registerActiveCommand({ commandId: 'cmd-b', targetId: 'target-b', browserProfileKey: '9333' });

        expect(await activeCommandTargetIds({ browserProfileKey: '9222' })).toEqual(new Set(['target-a']));
        expect(await activeCommandTargetIds({ browserProfileKey: '9333' })).toEqual(new Set(['target-b']));
    }));

    it('fails closed when the active command store is corrupt', async () => withTempHome(async (temp) => {
        writeFileSync(join(temp.homeDir, 'web-ai-active-commands.json'), '{not-json');

        await expect(activeCommandTargetIds({ browserProfileKey: '9222' }))
            .rejects.toMatchObject({ code: 'active-command.store-unavailable' });
        await expect(registerActiveCommand({
            commandId: 'cmd-after-corrupt',
            targetId: 'target-a',
            browserProfileKey: '9222',
        })).rejects.toMatchObject({ code: 'active-command.store-unavailable' });
    }));

    it('releases ownership after withActiveCommand success or failure', async () => withTempHome(async () => {
        await withActiveCommand({
            commandId: 'cmd-success',
            targetId: 'target-success',
            browserProfileKey: '9222',
            heartbeatIntervalMs: 0,
        }, async () => 'ok');

        await expect(withActiveCommand({
            commandId: 'cmd-fail',
            targetId: 'target-fail',
            browserProfileKey: '9222',
            heartbeatIntervalMs: 0,
        }, async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        expect(await activeCommandTargetIds({ browserProfileKey: '9222' })).toEqual(new Set());
        expect((await listActiveCommands({ browserProfileKey: '9222' })).map(row => row.status)).toEqual(['completed', 'completed']);
    }));

    it('reuses the current command context for nested same-target calls', async () => withTempHome(async () => {
        const seen = [];
        await withActiveCommand({
            commandId: 'cmd-outer',
            targetId: 'target-nested',
            browserProfileKey: '9222',
            heartbeatIntervalMs: 0,
        }, async outer => {
            seen.push(outer.commandId);
            await withActiveCommand({
                commandId: 'cmd-inner',
                targetId: 'target-nested',
                browserProfileKey: '9222',
                heartbeatIntervalMs: 0,
            }, async inner => {
                seen.push(inner.commandId);
            });
            expect(await activeCommandTargetIds({ browserProfileKey: '9222' })).toEqual(new Set(['target-nested']));
        });

        expect(seen).toEqual(['cmd-outer', 'cmd-outer']);
        const commands = await listActiveCommands({ browserProfileKey: '9222' });
        expect(commands.map(row => row.commandId)).toEqual(['cmd-outer']);
        expect(commands[0].status).toBe('completed');
    }));
});
