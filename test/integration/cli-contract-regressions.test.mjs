import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execBrowser, stopBrowserIfRunning } from '../helpers/exec-browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { createTempBrowserEnv, getAvailablePort } from '../helpers/temp-env.mjs';

/**
 * Regressions found by running the CLI by hand (devlog/_plan/260726_agbrowse_qa).
 *
 * These assert BEHAVIOUR through the real CLI process — exit codes and parsed
 * stdout — because the defects they cover were all invisible to source-shape
 * assertions and to a suite that never invoked the commands with flags.
 *
 * None of these need Chrome: they exercise argument handling and exit-code
 * wiring, which is exactly where the bugs were.
 */
describe('CLI contract regressions (hands-on QA)', () => {
    describe('Q1 — status honours the --json contract', () => {
        it('emits parseable JSON with the documented keys', async () => {
            const temp = createTempBrowserEnv('agbrowse-q1-');
            try {
                // No browser is started, so this is the not-running shape.
                const result = await execBrowser(['status', '--json', '--port', '9399'], { env: temp.env });
                const parsed = JSON.parse(result.stdout);
                expect(parsed).toMatchObject({ running: false, tabs: 0 });
                expect(parsed).toHaveProperty('cdpUrl');
            } finally {
                temp.cleanup();
            }
        });

        it('keeps the human format when --json is absent', async () => {
            const temp = createTempBrowserEnv('agbrowse-q1b-');
            try {
                const result = await execBrowser(['status', '--port', '9399'], { env: temp.env });
                expect(result.stdout).toContain('running: false');
                expect(() => JSON.parse(result.stdout)).toThrow();
            } finally {
                temp.cleanup();
            }
        });
    });

    describe('Q3 — a reported failure exits non-zero', () => {
        it('exits 1 when claim-audit reports a policy violation, 0 when it passes', async () => {
            const temp = createTempBrowserEnv('agbrowse-q3-');
            try {
                const audit = await execBrowser(['web-ai', 'claim-audit', '--json'], { env: temp.env });
                const report = JSON.parse(audit.stdout);
                // Whatever the repo's current state, the exit code must agree
                // with the verdict. A FAIL that exits 0 is unusable in CI, which
                // is how --help tells you to verify claims.
                expect(audit.code).toBe(report.ok ? 0 : 1);
            } finally {
                temp.cleanup();
            }
        });

        it('does not break a succeeding web-ai command', async () => {
            const temp = createTempBrowserEnv('agbrowse-q3b-');
            try {
                const render = await execBrowser(
                    ['web-ai', 'render', '--vendor', 'chatgpt', '--prompt', 'hi', '--json'],
                    { env: temp.env },
                );
                expect(render.code).toBe(0);
                expect(JSON.parse(render.stdout).ok).toBe(true);
            } finally {
                temp.cleanup();
            }
        });
    });
});

describe.sequential('Q2 — evaluate never absorbs a CLI flag into the source', () => {
    const temp = createTempBrowserEnv('agbrowse-q2-');
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

    it('evaluates the expression alone when --port follows it', async () => {
        // Previously the source became `1+1 --port <n>`, where the port number
        // parsed as the operand of a postfix `--`, so this died with
        // "Invalid left-hand side expression in postfix operation".
        const result = await execBrowser(['evaluate', '1+1', '--port', port], { env });
        expect(result.stdout.trim()).toBe('2');
    });

    it('does not let a flag silently change the RESULT', async () => {
        // The dangerous case, and the whole reason this is High severity:
        // `globalThis.json = 41; 1 + --json` is VALID JS. It returned 41 with no
        // error at all — a wrong answer, reported as success.
        //
        // `--port` is deliberately omitted so the port comes from persisted
        // state. With the port on the command line its digits also land in the
        // source and produce a syntax error, which would mask the silent case
        // and make this test pass against the bug.
        const result = await execBrowser(
            ['evaluate', 'globalThis.json = 41; 1 +', '--json'],
            { env },
        );
        expect(result.stdout.trim()).not.toBe('41');
        expect(`${result.stdout}${result.stderr}`).toContain('SyntaxError');
    });

    it('evaluates correctly with no flags at all', async () => {
        const result = await execBrowser(['evaluate', '2+3', '--port', port], { env });
        expect(result.stdout.trim()).toBe('5');
    });

    it('passes flag-shaped JS through after a bare --', async () => {
        // The mirror image of the bug: a real JS token that looks like a flag.
        // `--b` must arrive as its OWN argv element, because that is the shape
        // the flag filter eats. Quoted into one string it survives either way
        // and the test would pass against a broken implementation.
        const result = await execBrowser(
            ['evaluate', '--port', port, '--', 'let b=5;', '--b'],
            { env },
        );
        expect(result.stdout.trim()).toBe('4');
    });
});
