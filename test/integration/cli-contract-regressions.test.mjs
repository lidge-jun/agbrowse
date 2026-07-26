import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execBrowser, stopBrowserIfRunning } from '../helpers/exec-browser.mjs';
import { startFixtureServer } from '../helpers/fixture-server.mjs';
import { createTempBrowserEnv, getAvailablePort } from '../helpers/temp-env.mjs';
import { extractRef } from '../helpers/snapshot-utils.mjs';

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

describe.sequential('Q8 — a flag VALUE never becomes a positional argument', () => {
    const temp = createTempBrowserEnv('agbrowse-q8-');
    const env = temp.env;
    let port;
    let server;

    beforeAll(async () => {
        port = await getAvailablePort();
        server = await startFixtureServer();
        await execBrowser(['start', '--headless', '--port', port], { env });
        await execBrowser(['navigate', server.url], { env });
        await execBrowser(['snapshot', '--interactive'], { env });
    });

    afterAll(async () => {
        await stopBrowserIfRunning(env);
        await server.close();
        temp.cleanup();
    });

    it('type does not append the --port value to the typed text', async () => {
        // `type e2 "hello" --port <n>` used to type "hello <n>" into the page,
        // with no error and exit 0 — a silent mutation of user-visible state.
        const snapshot = await execBrowser(['snapshot', '--interactive'], { env });
        const ref = extractRef(snapshot.stdout, 'textbox', 'Name');
        expect(ref).toBeTruthy();

        await execBrowser(['type', ref, 'hello', '--port', port], { env });
        const read = await execBrowser(
            ['evaluate', 'document.querySelector("input[aria-label=Name]").value', '--port', port],
            { env },
        );
        expect(read.stdout.trim()).toBe('"hello"');
    });

    it('wait-for-text does not append the --port value to the search text', async () => {
        // The contaminated form searched for "Probe Button <n>" and timed out.
        // A timeout would also fail this test, so assert on the success shape:
        // a clean exit proves the text was matched as written.
        const result = await execBrowser(
            ['wait-for-text', 'Probe Button', '--timeout', '3000', '--port', port, '--json'],
            { env },
        );
        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({ text: 'Probe Button' });
    });

    it('does not leak the value of a flag it has never heard of', async () => {
        // The first fix listed the value-taking flags, which fails OPEN: --file
        // and --browser were not on that list and still leaked. The parser now
        // assumes an unknown --flag consumes a value, so a flag added later is
        // safe by default. --file is a real agbrowse flag, so this is not a
        // hypothetical shape.
        const snapshot = await execBrowser(['snapshot', '--interactive'], { env });
        const ref = extractRef(snapshot.stdout, 'textbox', 'Name');

        await execBrowser(['type', ref, 'hello', '--file', '/etc/hosts', '--port', port], { env });
        const read = await execBrowser(
            ['evaluate', 'document.querySelector("input[aria-label=Name]").value', '--port', port],
            { env },
        );
        expect(read.stdout.trim()).toBe('"hello"');
    });

    it('treats --flag=value as self-contained and keeps the next token', async () => {
        // `--port=9333` carries its value inline, so skipping a following token
        // would swallow a real positional argument.
        const result = await execBrowser(['evaluate', `--port=${port}`, '7+1'], { env });
        expect(result.stdout.trim()).toBe('8');
    });
});

describe('Q7/Q12/Q14 — failures honour the --json contract', () => {
    it('emits a JSON envelope instead of plaintext when a command fails', async () => {
        // Failures used to print `❌ <message>` even under --json, so a caller
        // that parsed a successful run got JSON and a failed one got a
        // JSON.parse error — a silent break in the machine-readable contract.
        const temp = createTempBrowserEnv('agbrowse-q7-');
        try {
            const result = await execBrowser(
                ['research', 'normalize-results', '--file', '/tmp/agbrowse-qa-definitely-absent.json', '--json'],
                { env: temp.env },
            );
            expect(result.code).toBe(1);
            const parsed = JSON.parse(result.stdout);
            expect(parsed).toMatchObject({ ok: false, status: 'error' });
            expect(parsed.error).toHaveProperty('message');
        } finally {
            temp.cleanup();
        }
    });

    it('keeps the human format when --json is absent', async () => {
        const temp = createTempBrowserEnv('agbrowse-q7b-');
        try {
            const result = await execBrowser(
                ['research', 'normalize-results', '--file', '/tmp/agbrowse-qa-definitely-absent.json'],
                { env: temp.env },
            );
            expect(result.code).toBe(1);
            expect(`${result.stdout}${result.stderr}`).toContain('❌');
        } finally {
            temp.cleanup();
        }
    });

    it('covers argument errors that return instead of throwing', async () => {
        // `research` validates arguments by RETURNING {stderr, exitCode}, so it
        // never reaches the top-level handler. That path kept printing
        // plaintext usage under --json after the first pass at this fix.
        const temp = createTempBrowserEnv('agbrowse-q12-');
        try {
            const result = await execBrowser(['research', 'plan', '--json'], { env: temp.env });
            expect(result.code).toBe(1);
            const parsed = JSON.parse(result.stdout);
            expect(parsed.ok).toBe(false);
            expect(parsed.error.errorCode).toBe('input.invalid-arguments');
        } finally {
            temp.cleanup();
        }
    });
});

describe('Q13 — a missing argument is an input error, not a crash', () => {
    // web-ai writes its failure envelope to stderr (emitCliError), unlike the
    // top-level handler which uses stdout. Read both so the assertion is about
    // the envelope's content, not which stream carried it.
    const envelopeOf = (result) => JSON.parse(result.stdout || result.stderr);

    it('names the missing prompt instead of blaming the context budget', async () => {
        // This used to throw context.over-budget with retryHint reduce-files —
        // the code for a genuine budget overflow — so the two events were
        // indistinguishable and the user was told to reduce files.
        const temp = createTempBrowserEnv('agbrowse-q13-');
        try {
            const result = await execBrowser(['web-ai', 'render', '--vendor', 'chatgpt', '--json'], { env: temp.env });
            expect(result.code).toBe(1);
            const parsed = envelopeOf(result);
            expect(parsed.error.errorCode).toBe('input.prompt-missing');
            expect(parsed.error.retryHint).toBe('add-prompt');
        } finally {
            temp.cleanup();
        }
    });

    it('names a missing context source instead of crashing', async () => {
        const temp = createTempBrowserEnv('agbrowse-q13b-');
        try {
            const result = await execBrowser(
                ['web-ai', 'context-dry-run', '--vendor', 'chatgpt', '--prompt', 'hi', '--json'],
                { env: temp.env },
            );
            expect(result.code).toBe(1);
            expect(envelopeOf(result).error.errorCode).toBe('input.context-source-missing');
        } finally {
            temp.cleanup();
        }
    });

    it('does not report a typo as a bug to file', async () => {
        const temp = createTempBrowserEnv('agbrowse-q13c-');
        try {
            const result = await execBrowser(['web-ai', 'sessions', 'show', 'no-such-session-qa', '--json'], { env: temp.env });
            expect(result.code).toBe(1);
            const parsed = envelopeOf(result);
            expect(parsed.error.errorCode).toBe('input.session-not-found');
            expect(parsed.error.retryHint).not.toBe('report');
        } finally {
            temp.cleanup();
        }
    });

    it('accepts --context-file, which the first version of this guard rejected', async () => {
        // The guard was hand-written as a second copy of a predicate that
        // already existed 380 lines up, and the copy omitted --context-file —
        // so a valid invocation started failing, and the error told the user to
        // use flags other than the correct one they had passed.
        const temp = createTempBrowserEnv('agbrowse-q13d-');
        const listPath = join(tmpdir(), `agbrowse-qa-ctx-${Date.now()}.txt`);
        writeFileSync(listPath, 'web-ai/errors.mjs\n');
        try {
            const result = await execBrowser(
                ['web-ai', 'context-dry-run', '--prompt', 'hi', '--context-file', listPath, '--json'],
                { env: temp.env },
            );
            expect(result.code).toBe(0);
            expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, status: 'dry-run' });
        } finally {
            rmSync(listPath, { force: true });
            temp.cleanup();
        }
    });

    it('rejects --file as a context source instead of crashing on it', async () => {
        // `--file` uploads a file; it does not build a context package. The
        // guard once accepted it, `prepareContextForBrowser` then returned null
        // because builder.mjs:172 does not count --file, and the report
        // renderer crashed on `result.files.length` — surfacing
        // internal.unhandled with retryHint report for what is a flag mistake.
        //
        // Two predicates disagreeing about what a context source is was the
        // whole defect, so this pins them to the same answer.
        const temp = createTempBrowserEnv('agbrowse-q13e-');
        try {
            const result = await execBrowser(
                ['web-ai', 'context-dry-run', '--prompt', 'hi', '--file', 'web-ai/errors.mjs', '--json'],
                { env: temp.env },
            );
            expect(result.code).toBe(1);
            const parsed = JSON.parse(result.stdout || result.stderr);
            expect(parsed.error.errorCode).toBe('input.context-source-missing');
            expect(parsed.error.retryHint).not.toBe('report');
        } finally {
            temp.cleanup();
        }
    });

    it('recognises every context source the canonical predicate accepts', async () => {
        // The CLI used to restate builder.mjs's `hasContextPackaging` by hand,
        // and every hand-written version was wrong about something: the 'raw'
        // default read as a source, --context-file dropped, --file admitted.
        // It now calls the canonical predicate.
        //
        // These three inputs are what that predicate accepts. A future copy
        // that drops any of them lands on input.context-source-missing, which
        // is exactly how the --context-file regression showed up.
        const temp = createTempBrowserEnv('agbrowse-wp2b-');
        const listPath = join(tmpdir(), `agbrowse-wp2b-${Date.now()}.txt`);
        writeFileSync(listPath, 'web-ai/errors.mjs\n');
        try {
            for (const argv of [
                ['--context-from-files', 'web-ai/errors.mjs'],
                ['--context-file', listPath],
                ['--context-transform', 'REPOMIX'],
            ]) {
                const result = await execBrowser(
                    ['web-ai', 'context-dry-run', '--prompt', 'hi', ...argv, '--json'],
                    { env: temp.env },
                );
                const parsed = JSON.parse(result.stdout || result.stderr);
                expect(parsed.error?.errorCode, `${argv[0]} should be a context source`)
                    .not.toBe('input.context-source-missing');
            }
        } finally {
            rmSync(listPath, { force: true });
            temp.cleanup();
        }
    });
});

describe('Q11 — ok:false reaches the exit code', () => {
    it('exits non-zero when fetch RETURNS ok:false', async () => {
        // fetch used to print ok:false and exit 0, so a failed lookup passed
        // through `&&` chains as success and downstream steps ran on empty
        // content.
        //
        // Two paths must not be used here, because both exit 1 even against the
        // bug and would pass while guarding nothing: the SSRF guard throws, and
        // so does any local URL (it is caught by the same guard). This drives
        // the path that RETURNS a verdict, which is the one that used to exit 0.
        //
        // `.invalid` is reserved by RFC 2606 and can never resolve, so this
        // needs no network and cannot break when a domain gets registered.
        const temp = createTempBrowserEnv('agbrowse-q11-');
        try {
            const result = await execBrowser(
                ['fetch', 'https://agbrowse-qa-must-not-resolve.invalid', '--json', '--browser', 'never'],
                { env: temp.env },
            );
            const body = JSON.parse(result.stdout);
            expect(body.ok).toBe(false);
            expect(result.code).toBe(1);
        } finally {
            temp.cleanup();
        }
    });
});

describe.sequential('Q9 — tab-cleanup preview and execution share a schema', () => {
    const temp = createTempBrowserEnv('agbrowse-q9-');
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

    it('exposes ok, dryRun and counts on both paths', async () => {
        // The two shapes used to share no keys at all: the preview nested its
        // counters under `counts` and carried `ok`, the real run was flat with
        // no `ok`. Previewing and then executing needed two parsers, and
        // anything gating on `ok` read a successful cleanup as a failure.
        await execBrowser(['new-tab', server.url], { env });
        await execBrowser(['new-tab', 'about:blank'], { env });

        const preview = await execBrowser(
            ['tab-cleanup', '--dry-run', '--max-tabs', '1', '--include-untracked', '--force', '--json'],
            { env },
        );
        const previewBody = JSON.parse(preview.stdout);

        await execBrowser(['new-tab', 'about:blank'], { env });
        const real = await execBrowser(
            ['tab-cleanup', '--max-tabs', '1', '--include-untracked', '--force', '--json'],
            { env },
        );
        const realBody = JSON.parse(real.stdout);

        for (const body of [previewBody, realBody]) {
            expect(body).toHaveProperty('ok');
            expect(body).toHaveProperty('dryRun');
            expect(body.counts).toEqual(expect.objectContaining({ limitClosed: expect.any(Number) }));
        }
        expect(previewBody.dryRun).toBe(true);
        expect(realBody.dryRun).toBe(false);
    });
});
