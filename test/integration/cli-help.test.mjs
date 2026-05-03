import { describe, expect, it } from 'vitest';
import { execBrowser } from '../helpers/exec-browser.mjs';
import { execVisionClick } from '../helpers/exec-vision-click.mjs';

describe.sequential('CLI help', () => {
    it('shows browser help with new PLAN_2 commands', async () => {
        const result = await execBrowser([]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('reload');
        expect(result.stdout).toContain('resize <w> <h>');
        expect(result.stdout).toContain('get-dom');
        expect(result.stdout).toContain('console');
        expect(result.stdout).toContain('network');
        expect(result.stdout).toContain('move-mouse');
        expect(result.stdout).toContain('mouse-down');
        expect(result.stdout).toContain('mouse-up');
        expect(result.stdout).toContain('wait-for-selector');
        expect(result.stdout).toContain('wait-for-text');
        expect(result.stdout).toContain('Start here:');
        expect(result.stdout).toContain('Agent decision loop:');
        expect(result.stdout).toContain('skills get core --full');
        expect(result.stdout).toContain('skills path [skill]');
        expect(result.stdout).toContain('Common flags:');
        expect(result.stdout).toContain('Configuration model:');
        expect(result.stdout).toContain('install-skills --target <dir>');
        expect(result.stdout).toContain('tab-cleanup');
        expect(result.stdout).toContain('AGBROWSE_MAX_TABS');
        expect(result.stdout).toContain('--reuse-tab');
    });

    it('shows browser help for unknown commands', async () => {
        const result = await execBrowser(['does-not-exist']);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain('Usage:');
        expect(result.stdout).toContain('Browser lifecycle:');
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
