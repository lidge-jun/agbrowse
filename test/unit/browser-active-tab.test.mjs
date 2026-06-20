import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const browserSrc = readFileSync(join(root, 'skills/browser/browser.mjs'), 'utf8');

describe('active tab persistence contract', () => {
    it('start supports headed override and foreground activation for visible local work', () => {
        expect(browserSrc).toMatch(/headed:\s*\{\s*type:\s*'boolean'/);
        expect(browserSrc).toMatch(/function resolveHeadlessMode/);
        expect(browserSrc).toMatch(/opts\.headed === true\) return false/);
        expect(browserSrc).toMatch(/function focusChromeApp/);
        expect(browserSrc).toMatch(/async function foregroundCdpWindow/);
        expect(browserSrc).toMatch(/Browser\.setWindowBounds/);
        expect(browserSrc).toMatch(/Target\.activateTarget/);
        expect(browserSrc).toMatch(/spawnSync\('open', \['-a', appName\]/);
        expect(browserSrc).toMatch(/headless:\s*previousState\?\.headless \?\? headless/);
        expect(browserSrc).toMatch(/headless,\s*\n\s*lockToken/);
    });

    it('preserves the headed restart remediation when an existing agbrowse CDP is headless', () => {
        const start = browserSrc.indexOf('async function launchChrome');
        const end = browserSrc.indexOf('if (chromeProc && !chromeProc.killed)', start);
        const block = browserSrc.slice(start, end);
        expect(block).toMatch(/let resp;/);
        expect(block).toMatch(/Port \$\{port\} is in use but not responding as CDP/);
        expect(block).toMatch(/already backed by a headless agbrowse Chrome/);
        expect(block.indexOf('Port ${port} is in use but not responding as CDP'))
            .toBeLessThan(block.indexOf('already backed by a headless agbrowse Chrome'));
    });

    it('persists tab-switch target id across CLI invocations', () => {
        expect(browserSrc).toMatch(/Target\.activateTarget/);
        expect(browserSrc).toMatch(/activeTargetId:\s*wanted\.id/);
        expect(browserSrc).toMatch(/index-or-targetId/);
        expect(browserSrc).toMatch(/updatePersistedState\(/);
    });

    it('exposes active-tab as the read-only persisted active target surface', () => {
        expect(browserSrc).toContain("case 'active-tab'");
        expect(browserSrc).toContain('async function getActiveTabInfo');
        expect(browserSrc).toContain('persistedTargetId');
        expect(browserSrc).toContain('currentTargetId');
        expect(browserSrc).toContain('persisted-active-target');
    });

    it('aligns new-tab and tab-close with the cli-jaw browser mirror surface', () => {
        expect(browserSrc).toContain("case 'new-tab'");
        expect(browserSrc).toContain("'no-activate': { type: 'boolean'");
        expect(browserSrc).toContain('activate: !noActivate');
        expect(browserSrc).toContain("status: 'created'");
        expect(browserSrc).toContain("case 'tab-close'");
        expect(browserSrc).toContain("status: 'closed'");
    });

    it('protects active-command tabs from accidental tab-switch and exposes select-tab alias', () => {
        expect(browserSrc).toContain("import { listActiveCommands } from '../../web-ai/active-command-store.mjs'");
        expect(browserSrc).toContain('active-command.target-owned');
        expect(browserSrc).toContain('active-command.store-unavailable');
        expect(browserSrc).toContain("case 'select-tab'");
        expect(browserSrc).toContain('Usage: browser.mjs select-tab <index-or-targetId> [--json] [--force]');
        expect(browserSrc).toContain('const activeCommand = activeCommandSummary');
    });

    it('documents low-risk Phase 15 browser primitives in help', () => {
        expect(browserSrc).toContain('scroll <dir> [--amount N] [--json]');
        expect(browserSrc).toContain('wait <ms> [--json]');
        expect(browserSrc).toContain('wait-for-selector <css> [--timeout ms] [--json]');
        expect(browserSrc).toContain('select <ref> <value> [--json]');
        expect(browserSrc).toContain('check <ref> [--json]');
        expect(browserSrc).toContain('uncheck <ref> [--json]');
        expect(browserSrc).toContain("case 'check'");
        expect(browserSrc).toContain("case 'uncheck'");
    });

    it('keeps evaluate primitive policy-aware while defaulting to allowed', () => {
        expect(browserSrc).toContain("import { enforcePolicy } from '../../web-ai/policy/enforce.mjs'");
        expect(browserSrc).toMatch(/async function evaluate\(port, expression, opts = \{\}\)/);
        expect(browserSrc).toMatch(/evaluate: true/);
        expect(browserSrc).toMatch(/unsafeAllow: opts\.unsafeAllow/);
        expect(browserSrc).toContain("case 'evaluate'");
    });

    it('getActivePage resolves the persisted target before array-order fallback', () => {
        const start = browserSrc.indexOf('async function getActivePage');
        const end = browserSrc.indexOf('async function listTabs', start);
        const block = browserSrc.slice(start, end);
        expect(block).toMatch(/activeTargetId/);
        expect(block).toMatch(/getPageTargetId\(page\)/);
        expect(block).toMatch(/pageTargetId === activeTargetId/);
        expect(block).toMatch(/present in CDP but not attached as a Playwright page/);
        expect(block.indexOf('activeTargetId')).toBeLessThan(block.indexOf('pages[pages.length - 1]'));
    });
});
