import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execBrowser, stopBrowserIfRunning } from '../helpers/exec-browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { createTempBrowserEnv, getAvailablePort } from '../helpers/temp-env.mjs';

describe.sequential('browser console and network semantics', () => {
    const temp = createTempBrowserEnv('agbrowse-observe-');
    const env = temp.env;
    let port;
    let server;

    beforeAll(async () => {
        port = await getAvailablePort();
        server = await startFixtureServer();
        await execBrowser(['start', '--headless', '--port', port], { env });
        await execBrowser(['navigate', server.url], { env });
    });

    afterAll(async () => {
        await stopBrowserIfRunning(env);
        await server.close();
        temp.cleanup();
    });

    it('reads buffered console logs from expressions and reloads', async () => {
        const probe = await execBrowser(['console', '--clear', '--expression', 'console.log("probe-log")', '--limit', '10'], { env });
        expect(probe.code).toBe(0);
        expect(probe.stdout).toContain('probe-log');

        const reloadLogs = await execBrowser(['console', '--clear', '--reload', '--duration', '600', '--limit', '20'], { env });
        expect(reloadLogs.code).toBe(0);
        expect(reloadLogs.stdout).toContain('loaded');
    });

    it('captures immediate and delayed network requests with the right semantics', async () => {
        const fast = await execBrowser(['network', '--clear', '--reload', '--duration', '0', '--filter', 'late-ping'], { env });
        expect(fast.code).toBe(0);
        expect(fast.stdout).toContain('0 requests captured');

        const delayed = await execBrowser(['network', '--clear', '--reload', '--duration', '700', '--filter', 'late-ping'], { env });
        expect(delayed.code).toBe(0);
        expect(delayed.stdout).toContain('late-ping');

        const liveOnly = await execBrowser(['network', '--clear', '--reload', '--duration', '700', '--filter', 'ping', '--live-only'], { env });
        expect(liveOnly.code).toBe(0);
        expect(liveOnly.stdout).not.toContain('[performance]');
        expect(liveOnly.stdout).toContain('[live]');
    });
});
