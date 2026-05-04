import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execBrowser, stopBrowserIfRunning } from '../helpers/exec-browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { createTempBrowserEnv, getAvailablePort } from '../helpers/temp-env.mjs';
import { extractRef, extractRefs } from '../helpers/snapshot-utils.mjs';

describe.sequential('browser DOM commands', () => {
    const temp = createTempBrowserEnv('agbrowse-dom-');
    const env = temp.env;
    let port;
    let server;
    let snapshot;

    beforeAll(async () => {
        port = await getAvailablePort();
        server = await startFixtureServer();
        await execBrowser(['start', '--headless', '--port', port], { env });
        await execBrowser(['navigate', server.url], { env });
        const snap = await execBrowser(['snapshot', '--interactive'], { env });
        snapshot = snap.stdout;
    });

    afterAll(async () => {
        await stopBrowserIfRunning(env);
        await server.close();
        temp.cleanup();
    });

    it('supports right-click, type, select, reload, resize, get-dom, and low-level mouse commands', async () => {
        const buttonRef = extractRef(snapshot, 'button', 'Probe Button');
        const buttonRefs = extractRefs(snapshot, 'button', 'Probe Button');
        const inputRef = extractRef(snapshot, 'textbox', 'Name');
        const selectRef = extractRef(snapshot, 'combobox', 'Pick One');
        const scrollRef = extractRef(snapshot, 'button', 'Scroll Anchor');

        expect(buttonRef).toBeTruthy();
        expect(buttonRefs).toHaveLength(2);
        expect(inputRef).toBeTruthy();
        expect(selectRef).toBeTruthy();
        expect(scrollRef).toBeTruthy();

        const click = await execBrowser(['click', buttonRef, '--right'], { env });
        expect(click.code).toBe(0);
        expect(click.stdout).toContain(`clicked ${buttonRef}`);

        const secondClick = await execBrowser(['click', buttonRefs[1]], { env });
        expect(secondClick.code).toBe(0);

        const deniedEvaluate = await execBrowser(['evaluate', 'document.body.dataset.lastProbe'], { env });
        expect(deniedEvaluate.code).not.toBe(0);
        expect(deniedEvaluate.stderr).toContain('evaluate denied by policy');

        const probeState = await execBrowser(['evaluate', 'document.body.dataset.lastProbe', '--unsafe-allow', 'evaluate'], { env });
        expect(probeState.code).toBe(0);
        expect(probeState.stdout).toContain('"second"');

        const type = await execBrowser(['type', inputRef, 'Alice', '--submit'], { env });
        expect(type.code).toBe(0);
        expect(type.stdout).toContain(`typed into ${inputRef}`);

        const select = await execBrowser(['select', selectRef, 'b'], { env });
        expect(select.code).toBe(0);
        expect(select.stdout).toContain(`selected "b"`);

        const scrollBefore = await execBrowser(['evaluate', 'document.querySelector("[data-scroll-panel]").scrollTop', '--unsafe-allow', 'evaluate'], { env });
        const scroll = await execBrowser(['scroll', 'down', '--amount', '80', '--ref', scrollRef, '--json'], { env });
        expect(scroll.code).toBe(0);
        const scrollPayload = JSON.parse(scroll.stdout);
        expect(scrollPayload).toMatchObject({ ok: true, direction: 'down', pixels: 80, ref: scrollRef });

        const scrollAfter = await execBrowser(['evaluate', 'document.querySelector("[data-scroll-panel]").scrollTop', '--unsafe-allow', 'evaluate'], { env });
        expect(Number(scrollAfter.stdout)).toBeGreaterThan(Number(scrollBefore.stdout));

        const reload = await execBrowser(['reload'], { env });
        expect(reload.code).toBe(0);
        expect(reload.stdout).toContain('reloaded');

        const resize = await execBrowser(['resize', '1200', '800'], { env });
        expect(resize.stdout).toContain('resized to');

        const getDom = await execBrowser(['get-dom', '--selector', 'main', '--max-chars', '200'], { env });
        expect(getDom.stdout).toContain('<main>');
        expect(getDom.stderr).toContain('[truncated:');

        const clippedScreenshot = await execBrowser(['screenshot', '--json', '--clip', '0', '0', '240', '160'], { env });
        expect(clippedScreenshot.code).toBe(0);
        const clippedPayload = JSON.parse(clippedScreenshot.stdout);
        expect(existsSync(clippedPayload.path)).toBe(true);
        expect(clippedPayload.clip).toEqual({ x: 0, y: 0, width: 240, height: 160 });

        const move = await execBrowser(['move-mouse', '20', '20'], { env });
        expect(move.stdout).toContain('mouse moved to');

        const down = await execBrowser(['mouse-down'], { env });
        expect(down.stdout).toContain('mouse down');

        const up = await execBrowser(['mouse-up'], { env });
        expect(up.stdout).toContain('mouse up');

        const waitForText = await execBrowser(['wait-for-text', 'Delayed Ready', '--timeout', '2000'], { env });
        expect(waitForText.code).toBe(0);
        expect(waitForText.stdout).toContain('Delayed Ready');

        const waitForSelector = await execBrowser(['wait-for-selector', '#delayed-status', '--timeout', '2000'], { env });
        expect(waitForSelector.code).toBe(0);
        expect(waitForSelector.stdout).toContain('#delayed-status');
    });
});
