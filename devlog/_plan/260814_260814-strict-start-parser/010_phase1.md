# 010 — Strict parseArgs for start command

## MODIFY: skills/browser/browser.mjs (lines 2473-2493)

Change the start case to use strict: true and wrap in try/catch for friendly errors.

Before (line 2474-2484):
    case 'start': {
        const { values } = parseArgs({
            args: process.argv.slice(3),
            options: { ... },
            strict: false,
        });

After:
    case 'start': {
        let values;
        try {
            ({ values } = parseArgs({
                args: process.argv.slice(3),
                options: { ... },
                strict: true,
                allowPositionals: false,
            }));
        } catch (e) {
            const msg = e.message || String(e);
            if (/profile/i.test(msg)) {
                console.error(
                    'agbrowse start --profile is not supported.\n' +
                    'agbrowse uses its dedicated persistent profile at\n' +
                    '  BROWSER_AGENT_HOME/browser-profile\n' +
                    '  (default: ~/.browser-agent/browser-profile)\n' +
                    'Use BROWSER_AGENT_HOME and CDP_PORT for separate profiles.'
                );
            } else {
                console.error('agbrowse start: ' + msg);
            }
            process.exit(1);
        }

## MODIFY: test/integration/cli-lifecycle.test.mjs

Add after existing stop test:

    it('rejects --profile flag with a clear error', async () => {
        const r = await execBrowser(['start', '--profile', 'default'], { env });
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('--profile is not supported');
    });

    it('rejects unknown flags (typo protection)', async () => {
        const r = await execBrowser(['start', '--headde'], { env });
        expect(r.code).not.toBe(0);
    });

## Verification (C)

1. npx vitest run test/integration/cli-lifecycle.test.mjs  (exit 0)
2. node skills/browser/browser.mjs start --profile default (should exit 1, stderr contains 'not supported')
3. node skills/browser/browser.mjs start --headde (should exit 1)

