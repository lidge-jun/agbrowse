import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execBrowser, stopBrowserIfRunning } from '../helpers/exec-browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { createTempBrowserEnv, getAvailablePort } from '../helpers/temp-env.mjs';
import { extractRef } from '../helpers/snapshot-utils.mjs';

describe.sequential('browser smoke e2e', () => {
    const temp = createTempBrowserEnv('agbrowse-smoke-');
    const env = temp.env;
    let port;
    let server;

    beforeAll(async () => {
        port = await getAvailablePort();
        server = await startFixtureServer();
        await execBrowser(['start', '--headless', '--port', port], { env });
    });

    afterAll(async () => {
        await stopBrowserIfRunning(env);
        await server.close();
        temp.cleanup();
    });

    it('runs a full browser workflow against the local fixture site', async () => {
        const navigate = await execBrowser(['navigate', server.url], { env });
        expect(navigate.code).toBe(0);

        const snapshot = await execBrowser(['snapshot', '--interactive'], { env });
        expect(snapshot.stdout).toContain('Probe Button');
        const buttonRef = extractRef(snapshot.stdout, 'button', 'Probe Button');
        expect(buttonRef).toBeTruthy();

        const click = await execBrowser(['click', buttonRef, '--right'], { env });
        expect(click.code).toBe(0);

        const screenshot = await execBrowser(['screenshot', '--json'], { env });
        const payload = JSON.parse(screenshot.stdout);
        expect(existsSync(payload.path)).toBe(true);
        expect(payload.viewport.width).toBeGreaterThan(0);

        const consoleLogs = await execBrowser(['console', '--clear', '--expression', 'console.log("smoke-console")', '--limit', '10'], { env });
        expect(consoleLogs.stdout).toContain('smoke-console');

        const network = await execBrowser(['network', '--clear', '--reload', '--duration', '700', '--filter', 'ping'], { env });
        expect(network.stdout).toContain('requests captured');
    });
});
