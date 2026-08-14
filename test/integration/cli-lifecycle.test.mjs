import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execBrowser, stopBrowserIfRunning } from '../helpers/exec-browser.mjs';
import { createTempBrowserEnv, getAvailablePort, readBrowserState, writeBrowserState } from '../helpers/temp-env.mjs';

describe.sequential('browser lifecycle regressions', () => {
    const temp = createTempBrowserEnv('agbrowse-lifecycle-');
    const env = temp.env;
    let port;
    let isolated;

    beforeAll(async () => {
        port = await getAvailablePort();
        isolated = createTempBrowserEnv('agbrowse-cli-port-');
        await stopBrowserIfRunning(env);
    });

    afterAll(async () => {
        await stopBrowserIfRunning(env);
        isolated.cleanup();
        temp.cleanup();
    });

    it('persists non-default port state across CLI invocations and reuses existing instances', async () => {
        const start1 = await execBrowser(['start', '--headless', '--port', port], { env });
        expect(start1.code).toBe(0);
        expect(start1.stdout).toContain(`http://127.0.0.1:${port}`);

        const start2 = await execBrowser(['start', '--headless', '--port', port], { env });
        expect(start2.code).toBe(0);
        expect(start2.stdout).toContain(`http://127.0.0.1:${port}`);
        expect(start2.stdout).toContain('reusing existing instance');

        const status = await execBrowser(['status'], { env });
        expect(status.code).toBe(0);
        expect(status.stdout).toContain('running: true');
        expect(status.stdout).toContain(`cdpUrl: http://127.0.0.1:${port}`);

        const state = readBrowserState(temp.homeDir);
        expect(state.port).toBe(Number(port));
    });

    it('allows non-start commands to target a running browser via --port', async () => {
        const status = await execBrowser(['status', '--port', port], { env: isolated.env });
        expect(status.code).toBe(0);
        expect(status.stdout).toContain('running: true');
        expect(status.stdout).toContain(`cdpUrl: http://127.0.0.1:${port}`);
    });

    it('stop falls back cleanly when persisted PID is stale', async () => {
        const state = readBrowserState(temp.homeDir);
        writeBrowserState(temp.homeDir, { ...state, pid: 999999 });

        const stop = await execBrowser(['stop'], { env });
        expect(stop.code).toBe(0);
        expect(stop.stdout).toContain('Chrome stopped');

        const status = await execBrowser(['status'], { env });
        expect(status.stdout).toContain('running: false');
    });

    it('rejects --profile flag with a clear error (strict parseArgs)', async () => {
        const r = await execBrowser(['start', '--profile', 'default'], { env });
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('--profile');
        expect(r.stderr).toContain('not supported');
    });

    it('rejects unknown flags like --headde (typo protection)', async () => {
        const r = await execBrowser(['start', '--headde'], { env });
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('Unknown option');
    });

    it('rejects positional arguments on start', async () => {
        const r = await execBrowser(['start', 'default'], { env });
        expect(r.code).not.toBe(0);
    });
});
