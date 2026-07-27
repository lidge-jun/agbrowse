import { describe, expect, test } from 'vitest';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { interactiveConfirm } from '../../scripts/interactive-confirm.mjs';
import { isAgentDriven } from '../../scripts/agent-driven.mjs';

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
        const markIndex = source.indexOf('await markPrompted()');
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
