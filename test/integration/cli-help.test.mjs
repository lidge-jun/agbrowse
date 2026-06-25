import { describe, expect, it } from 'vitest';
import { execBrowser } from '../helpers/exec-browser.mjs';
import { execVisionClick } from '../helpers/exec-vision-click.mjs';
import { createTempBrowserEnv, getAvailablePort } from '../helpers/temp-env.mjs';

describe.sequential('CLI help', () => {
    it('shows browser help with new PLAN_2 commands', async () => {
        const result = await execBrowser([]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('reload');
        expect(result.stdout).toContain('resize <w> <h>');
        expect(result.stdout).toContain('get-dom');
        expect(result.stdout).toContain('console');
        expect(result.stdout).toContain('network');
        expect(result.stdout).toContain('fetch <url>');
        expect(result.stdout).toContain('--browser-session none|isolated|existing');
        expect(result.stdout).toContain('--no-browser');
        expect(result.stdout).toContain('Not generic search');
        expect(result.stdout).toContain('move-mouse');
        expect(result.stdout).toContain('mouse-down');
        expect(result.stdout).toContain('mouse-up');
        expect(result.stdout).toContain('wait-for-selector');
        expect(result.stdout).toContain('wait-for-text');
        expect(result.stdout).toContain('Start here:');
        expect(result.stdout).toContain('Agent decision loop:');
        expect(result.stdout).toContain('skills get core --full');
        expect(result.stdout).toContain('skills get web-ai');
        expect(result.stdout).toContain('skills path [skill]');
        expect(result.stdout).toContain('Common flags:');
        expect(result.stdout).toContain('Configuration model:');
        expect(result.stdout).toContain('install-skills --target <dir>');
        expect(result.stdout).toContain('--headless|--headed');
        expect(result.stdout).toContain('tab-cleanup');
        expect(result.stdout).toContain('active-tab');
        expect(result.stdout).toContain('new-tab <url>');
        expect(result.stdout).toContain('--no-activate');
        expect(result.stdout).toContain('tab-close <targetId>');
        expect(result.stdout).toContain('--force');
        expect(result.stdout).toContain('leaseClosedTabs');
        expect(result.stdout).toContain('--effort <alias>');
        expect(result.stdout).toContain('AGBROWSE_WEB_AI_AUTO_START=0');
        expect(result.stdout).toContain('Before agent-run Web AI automation:');
        expect(result.stdout).toContain('skills install --target <agent-skill-root>');
        expect(result.stdout).toContain('AGBROWSE_MAX_TABS');
        expect(result.stdout).toContain('--reuse-tab');
        expect(result.stdout).toContain('runway selectors');
        expect(result.stdout).toContain('runway poll');
        expect(result.stdout).toContain('never submits a generation');
        expect(result.stdout).toContain('Use when snapshot refs are unavailable');
        expect(result.stdout).toContain('Research planning:');
        expect(result.stdout).toContain('research plan --query <problem>');
        expect(result.stdout).toContain('research normalize-results --file <json>');
        expect(result.stdout).toContain('research enrich-fetch --plan <json> --results <json>');
        expect(result.stdout).toContain('research browse-plan --plan <json> --enrichment <json>');
    });

    it('shows Runway help without touching the browser', async () => {
        const result = await execBrowser(['runway', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('agbrowse runway <command>');
        expect(result.stdout).toContain('selectors');
        expect(result.stdout).toContain('preflight');
        expect(result.stdout).toContain('poll');
        expect(result.stdout).toContain('never click');
    });

    it('shows adaptive fetch help without touching the network', async () => {
        const result = await execBrowser(['fetch', '--help']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('agbrowse fetch <url>');
        expect(result.stdout).toContain('--no-browser');
        expect(result.stdout).toContain('--max-bytes N');
        expect(result.stdout).toContain('--timeout-ms N');
        expect(result.stdout).toContain('--selector CSS');
        expect(result.stdout).toContain('--allow-archive');
        expect(result.stdout).toContain('Not generic search');
    });

    it('shows browser help for unknown commands', async () => {
        const result = await execBrowser(['does-not-exist']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('Browser lifecycle:');
    });

    it('rejects tab-cleanup include-untracked without force before touching the browser', async () => {
        const result = await execBrowser(['tab-cleanup', '--include-untracked']);
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('tab-cleanup --include-untracked requires --force');
    });

    it('emits update notices on ordinary non-json CLI runs only', async () => {
        const temp = createTempBrowserEnv('agbrowse-update-notice-');
        try {
            const result = await execBrowser(['status'], {
                env: {
                    ...temp.env,
                    AGBROWSE_UPDATE_CHECK: '1',
                    AGBROWSE_UPDATE_CHECK_LATEST: '9.9.9',
                },
            });
            expect(result.code).toBe(0);
            expect(result.stdout).toContain('running:');
            expect(result.stderr).toContain('[agbrowse] new version is available:');
            expect(result.stderr).toContain('npm install -g agbrowse@latest to update');
        } finally {
            temp.cleanup();
        }
    });

    it('does not emit update notices for json CLI runs', async () => {
        const temp = createTempBrowserEnv('agbrowse-update-json-');
        const closedPort = await getAvailablePort();
        try {
            const result = await execBrowser(['tabs', '--json'], {
                env: {
                    ...temp.env,
                    CDP_PORT: closedPort,
                    AGBROWSE_UPDATE_CHECK: '1',
                    AGBROWSE_UPDATE_CHECK_LATEST: '9.9.9',
                },
            });
            expect(result.code).toBe(0);
            expect(JSON.parse(result.stdout)).toEqual([]);
            expect(result.stderr).not.toContain('new version is available');
        } finally {
            temp.cleanup();
        }
    });

    it('shows vision-click help when no target is given', async () => {
        const result = await execVisionClick([]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('agbrowse-vision-click');
        expect(result.stdout).toContain('--browser-script <path>');
        expect(result.stdout).toContain('--prepare-stable');
        expect(result.stdout).toContain('--verify-before-click');
        expect(result.stdout).toContain('--region <name>');
        expect(result.stdout).toContain('--clip <x y w h>');
        expect(result.stdout).toContain('Codex CLI');
    });
});
