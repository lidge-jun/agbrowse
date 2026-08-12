import { describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Star-prompt machine-surface contract (spawned CLI proofs).
 *
 * The one-time GitHub star prompt fires on the first INTERACTIVE CLI run.
 * Every machine-readable surface must stay byte-clean: --json output, JSON
 * error envelopes, MCP stdio, and the help fallback for unknown commands.
 * Each case asserts a positive reachability signal first (the CLI really got
 * there), then the absence of prompt prose.
 */

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), '..', '..');
const BIN = resolve(root, 'bin', 'agbrowse.mjs');

const STAR_PROSE = /Star it on GitHub|Enjoying agbrowse|isn't starred/;

function run(args, env = {}) {
    return spawnSync(process.execPath, [BIN, ...args], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env: { ...process.env, AGBROWSE_UPDATE_CHECK: '0', ...env },
    });
}

describe('star prompt never touches machine surfaces', () => {
    it('status --json emits parseable JSON and no star prose', () => {
        const res = run(['status', '--json']);
        expect(res.status).toBe(0);
        const parsed = JSON.parse(res.stdout);
        expect(typeof parsed.running).toBe('boolean');
        expect(res.stdout).not.toMatch(STAR_PROSE);
    });

    it('AGBROWSE_JSON_ERRORS=1 failure envelope stays clean', () => {
        const res = run(['research', 'plan', '--json'], { AGBROWSE_JSON_ERRORS: '1' });
        expect(res.status).toBe(1);
        const parsed = JSON.parse(res.stdout);
        expect(parsed.ok).toBe(false);
        expect(parsed.error.errorCode).toBe('input.invalid-arguments');
        expect(res.stdout).not.toMatch(STAR_PROSE);
    });

    it('unknown command prints the help banner and no star prose', () => {
        const res = run(['not-a-command']);
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('agbrowse <command>');
        expect(res.stdout).not.toMatch(STAR_PROSE);
    });

    it('web-ai mcp-server answers initialize with no star prose on stdout', async () => {
        const child = spawn(
            process.execPath,
            [BIN, 'web-ai', 'mcp-server'],
            {
                cwd: root,
                env: { ...process.env, AGBROWSE_UPDATE_CHECK: '0' },
                stdio: ['pipe', 'pipe', 'pipe'],
            },
        );
        try {
            const responseLine = await new Promise((resolvePromise, rejectPromise) => {
                let stdoutBuf = '';
                const timer = setTimeout(
                    () => rejectPromise(new Error(`mcp-server produced no initialize response; stdout so far: ${stdoutBuf.slice(0, 200)}`)),
                    15000,
                );
                child.stdout.on('data', chunk => {
                    stdoutBuf += chunk;
                    const newline = stdoutBuf.indexOf('\n');
                    if (newline !== -1) {
                        clearTimeout(timer);
                        resolvePromise({ line: stdoutBuf.slice(0, newline), all: stdoutBuf });
                    }
                });
                child.on('error', err => {
                    clearTimeout(timer);
                    rejectPromise(err);
                });
                child.stdin.write(
                    `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'star-prompt-test', version: '0.0.0' } } })}\n`,
                );
            });
            const parsed = JSON.parse(responseLine.line);
            expect(parsed.id).toBe(1);
            expect(parsed.result).toBeDefined();
            expect(responseLine.all).not.toMatch(STAR_PROSE);
        } finally {
            child.kill('SIGKILL');
        }
    }, 20000);
});
