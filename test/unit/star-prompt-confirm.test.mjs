import { describe, expect, test } from 'vitest';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { interactiveConfirm } from '../../scripts/interactive-confirm.mjs';
import { isAgentDriven } from '../../scripts/agent-driven.mjs';
import { shouldSkipStarPrompt, maybeRunStarPrompt } from '../../scripts/postinstall.mjs';

const postinstallPath = fileURLToPath(new URL('../../scripts/postinstall.mjs', import.meta.url));

/**
 * A fake TTY pair: the input side supports raw mode (so the selector takes the
 * keypress path), and the output side records everything painted.
 */
function makeTty() {
    const input = new PassThrough();
    input.isRaw = false;
    input.setRawMode = mode => {
        input.isRaw = mode;
        return input;
    };

    const frames = [];
    const output = new PassThrough();
    const write = output.write.bind(output);
    output.write = (chunk, ...rest) => {
        frames.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return write(chunk, ...rest);
    };

    return { input, output, frames };
}

async function ask(keys, defaultYes = true) {
    const { input, output, frames } = makeTty();
    const pending = interactiveConfirm({ question: 'Star it?', defaultYes, input, output });
    for (const key of keys) input.write(key);
    const answer = await pending;
    return { answer, frames, raw: input.isRaw };
}

const ARROW_LEFT = '\x1b[D';
const ARROW_RIGHT = '\x1b[C';
const ENTER = '\r';
const ESCAPE = '\x1b';

describe('interactiveConfirm', () => {
    test('bare enter takes whichever choice is highlighted', async () => {
        expect((await ask([ENTER], true)).answer).toBe(true);
        expect((await ask([ENTER], false)).answer).toBe(false);
    });

    test('arrow keys move the selection and enter confirms it', async () => {
        expect((await ask([ARROW_RIGHT, ENTER])).answer).toBe(false);
        expect((await ask([ARROW_RIGHT, ARROW_LEFT, ENTER])).answer).toBe(true);
    });

    test('y and n answer immediately without enter', async () => {
        expect((await ask(['n'])).answer).toBe(false);
        expect((await ask(['y'], false)).answer).toBe(true);
        expect((await ask(['N'])).answer).toBe(false);
    });

    test('escape declines rather than consenting', async () => {
        expect((await ask([ESCAPE], true)).answer).toBe(false);
    });

    test('both choices are shown and the terminal mode is restored', async () => {
        const { frames, raw } = await ask([ENTER]);
        const painted = frames.join('');

        expect(painted).toContain('Yes');
        expect(painted).toContain('No');
        expect(painted).toContain('y/n');
        expect(raw).toBe(false);
    });

    test('without raw mode it falls back to a typed answer honoring the same default', async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const accepted = interactiveConfirm({ question: 'Star it?', defaultYes: true, input, output });
        input.write('\n');
        expect(await accepted).toBe(true);
    });
});

describe('isAgentDriven', () => {
    test('a plain user shell is not agent-driven', () => {
        expect(isAgentDriven({ TERM: 'xterm-256color', SHELL: '/bin/zsh' })).toBe(false);
    });

    test('recognizes the agent harnesses that run installs on a user behalf', () => {
        expect(isAgentDriven({ CLAUDECODE: '1' })).toBe(true);
        expect(isAgentDriven({ CODEX_THREAD_ID: '019fa50b' })).toBe(true);
        expect(isAgentDriven({ GITHUB_ACTIONS: 'true' })).toBe(true);
    });

    test('an empty or whitespace value does not count as set', () => {
        expect(isAgentDriven({ CLAUDECODE: '' })).toBe(false);
        expect(isAgentDriven({ CODEX_THREAD_ID: '   ' })).toBe(false);
    });
});

describe('postinstall star prompt', () => {
    test('asks with the selector, names gh, and defers to the user when agent-driven', async () => {
        const source = await readFile(postinstallPath, 'utf8');

        expect(source).toContain('interactiveConfirm');
        expect(source).toContain('defaultYes: true');
        expect(source).toContain('Star it on GitHub (via gh)?');

        const guardIndex = source.indexOf('if (isAgentDriven()) {');
        // The call gained a `stateFile` argument when the prompt moved from
        // the npm hook to first CLI run; the ordering check is unchanged.
        const markIndex = source.indexOf('await markPrompted(');
        expect(guardIndex).toBeGreaterThan(-1);
        // The guard must precede the state write, otherwise an agent-driven
        // install would consume the one-time prompt the user never saw.
        expect(guardIndex).toBeLessThan(markIndex);
        expect(source).toContain('do not answer this yourself');
    });

    test('only prompts when gh can actually star', async () => {
        const source = await readFile(postinstallPath, 'utf8');

        expect(source).toContain('"auth", "status"');
    });
});

/**
 * A fake interactive terminal: like makeTty but with isTTY set on both
 * streams, which is what shouldSkipStarPrompt gates on.
 */
function makeInteractiveTty() {
    const { input, output, frames } = makeTty();
    input.isTTY = true;
    output.isTTY = true;
    return { input, output, frames };
}

// Mirror of AGENT_ENV_VARS in scripts/agent-driven.mjs — keep in sync.
const AGENT_ENV_VARS = [
    'CLAUDECODE',
    'CLAUDE_CODE_ENTRYPOINT',
    'CODEX_THREAD_ID',
    'CODEX_SHELL',
    'CODEX_CI',
    'CURSOR_TRACE_ID',
    'CURSOR_SESSION_TOKEN',
    'AIDER_CHAT',
    'REPL_ID',
    'CI',
    'GITHUB_ACTIONS',
];

/**
 * Delete every agent-harness env var and return a restore function. Vitest
 * isolates test files per worker process, so this cannot leak into sibling
 * files; try/finally protects tests within this file.
 */
function scrubAgentEnv() {
    const saved = {};
    for (const name of AGENT_ENV_VARS) {
        if (name in process.env) {
            saved[name] = process.env[name];
            delete process.env[name];
        }
    }
    return () => {
        for (const [name, value] of Object.entries(saved)) process.env[name] = value;
    };
}

/** A state path with a nested, not-yet-existing parent directory. */
function tmpStateFile() {
    return join(mkdtempSync(join(tmpdir(), 'agbrowse-star-')), 'nested', 'state', 'star-prompt.json');
}

function silentStderr() {
    const frames = [];
    return { frames, stream: { isTTY: true, write: chunk => { frames.push(String(chunk)); return true; } } };
}

describe('shouldSkipStarPrompt', () => {
    const tty = { isTTY: true };
    const noTty = {};

    test('non-TTY streams skip (agents, pipes, CI spawns)', () => {
        expect(shouldSkipStarPrompt({ argv: ['start'], env: {}, stdin: noTty, stdout: tty })).toBe(true);
        expect(shouldSkipStarPrompt({ argv: ['start'], env: {}, stdin: tty, stdout: noTty })).toBe(true);
    });

    test('--json and --help skip even on a TTY', () => {
        expect(shouldSkipStarPrompt({ argv: ['status', '--json'], env: {}, stdin: tty, stdout: tty })).toBe(true);
        expect(shouldSkipStarPrompt({ argv: ['start', '--help'], env: {}, stdin: tty, stdout: tty })).toBe(true);
    });

    test('AGBROWSE_JSON_ERRORS=1 machine consumers skip', () => {
        expect(shouldSkipStarPrompt({ argv: ['status'], env: { AGBROWSE_JSON_ERRORS: '1' }, stdin: tty, stdout: tty })).toBe(true);
    });

    test('AGBROWSE_STAR_PROMPT=0 opts out', () => {
        expect(shouldSkipStarPrompt({ argv: ['start'], env: { AGBROWSE_STAR_PROMPT: '0' }, stdin: tty, stdout: tty })).toBe(true);
    });

    test('CI skips unless explicitly forced', () => {
        expect(shouldSkipStarPrompt({ argv: ['start'], env: { CI: 'true' }, stdin: tty, stdout: tty })).toBe(true);
        expect(shouldSkipStarPrompt({ argv: ['start'], env: { CI: 'true', AGBROWSE_STAR_PROMPT: '1' }, stdin: tty, stdout: tty })).toBe(false);
    });

    test('MCP stdio, help-class, empty, flag, and unknown commands skip', () => {
        const skipped = [
            ['web-ai', 'mcp-server'],
            ['help'],
            ['skills'],
            ['install-skills'],
            ['research', 'plan'],
            [],
            ['--version'],
            ['not-a-command'],
        ];
        for (const argv of skipped) {
            expect(shouldSkipStarPrompt({ argv, env: {}, stdin: tty, stdout: tty })).toBe(true);
        }
    });

    test('an interactive human command does not skip', () => {
        expect(shouldSkipStarPrompt({ argv: ['start'], env: {}, stdin: tty, stdout: tty })).toBe(false);
    });
});

describe('maybeRunStarPrompt (injected streams)', () => {
    test('agent-driven TTY defers to stderr and writes no state', async () => {
        const { input, output, frames } = makeInteractiveTty();
        const stderr = silentStderr();
        const stateFile = tmpStateFile();
        process.env.CODEX_THREAD_ID = 'test-thread';
        let ran;
        try {
            ran = await maybeRunStarPrompt({
                argv: ['start'],
                env: {},
                stdin: input,
                stdout: output,
                stderr: stderr.stream,
                stateFile,
                ghInstalled: () => true,
            });
        } finally {
            delete process.env.CODEX_THREAD_ID;
        }
        expect(ran).toBe(false);
        expect(frames.join('')).toBe('');
        expect(stderr.frames.join('')).toContain('do not answer this yourself');
        expect(existsSync(stateFile)).toBe(false);
    });

    test('human first run prompts once, then stays silent', async () => {
        const restore = scrubAgentEnv();
        const stateFile = tmpStateFile();
        try {
            const first = makeInteractiveTty();
            const pending = maybeRunStarPrompt({
                argv: ['start'],
                env: {},
                stdin: first.input,
                stdout: first.output,
                stderr: silentStderr().stream,
                stateFile,
                ghInstalled: () => true,
            });
            first.input.write('n');
            expect(await pending).toBe(true);
            expect(first.frames.join('')).toContain('Star it on GitHub (via gh)?');
            expect(existsSync(stateFile)).toBe(true);

            const second = makeInteractiveTty();
            const ranAgain = await maybeRunStarPrompt({
                argv: ['start'],
                env: {},
                stdin: second.input,
                stdout: second.output,
                stderr: silentStderr().stream,
                stateFile,
                ghInstalled: () => true,
            });
            expect(ranAgain).toBe(false);
            expect(second.frames.join('')).toBe('');
        } finally {
            restore();
        }
    });

    test('human yes stars through the injected star function', async () => {
        const restore = scrubAgentEnv();
        try {
            const { input, output, frames } = makeInteractiveTty();
            let starCalls = 0;
            const pending = maybeRunStarPrompt({
                argv: ['start'],
                env: {},
                stdin: input,
                stdout: output,
                stderr: silentStderr().stream,
                stateFile: tmpStateFile(),
                ghInstalled: () => true,
                star: () => {
                    starCalls += 1;
                    return { ok: true };
                },
            });
            input.write('y');
            expect(await pending).toBe(true);
            expect(starCalls).toBe(1);
            expect(frames.join('')).toContain('Thanks for the');
        } finally {
            restore();
        }
    });

    test('non-TTY, --json, and opted-out invocations exit before any probe', async () => {
        const cases = [
            { argv: ['start'], env: {}, stdin: {}, stdout: { isTTY: true } },
            { argv: ['status', '--json'], env: {}, stdin: { isTTY: true }, stdout: { isTTY: true } },
            { argv: ['start'], env: { AGBROWSE_STAR_PROMPT: '0' }, stdin: { isTTY: true }, stdout: { isTTY: true } },
        ];
        for (const opts of cases) {
            const ran = await maybeRunStarPrompt({
                ...opts,
                stderr: silentStderr().stream,
                stateFile: tmpStateFile(),
                ghInstalled: () => {
                    throw new Error('must not probe gh on skipped surfaces');
                },
            });
            expect(ran).toBe(false);
        }
    });
});

describe('postinstall direct execution', () => {
    test('node scripts/postinstall.mjs is a silent no-op when non-TTY', () => {
        const res = spawnSync(process.execPath, [postinstallPath], {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 15000,
            env: { ...process.env, CI: '1' },
        });
        expect(res.status).toBe(0);
        expect(res.stdout).toBe('');
    });
});
