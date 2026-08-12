import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
const STORE_MODULE_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../../web-ai/session-store.mjs')).href;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-watch-deadline-write-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    vi.resetModules();
});

afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
});

describe('watcher transient-timeout store writes', () => {
    it('does not restore polling when the stored deadline passes behind the store lock', async () => {
        const { createSession, getSession, updateSession } = await import('../../web-ai/session.mjs');
        const { restorePollingBeforeDeadline } = await import('../../web-ai/watcher.mjs');
        const deadlineAt = new Date(Date.now() + 700).toISOString();
        const created = createSession({ vendor: 'chatgpt', prompt: 'deadline race' }, { deadlineAt });
        updateSession(created.sessionId, { status: 'timeout', warnings: [] });
        const holder = await holdStoreLock(1_000);

        const losingWrite = restorePollingBeforeDeadline(created.sessionId, deadlineAt, {
            status: 'polling',
            warnings: ['watcher-transient-poll-timeout:30s'],
        });
        await holder.done;
        await losingWrite;

        expect(getSession(created.sessionId)).toMatchObject({ status: 'timeout', warnings: [] });
    }, 10_000);

    it('restores polling while the stored deadline is still live', async () => {
        const { createSession, getSession, updateSession } = await import('../../web-ai/session.mjs');
        const { restorePollingBeforeDeadline } = await import('../../web-ai/watcher.mjs');
        const deadlineAt = new Date(Date.now() + 10_000).toISOString();
        const created = createSession({ vendor: 'chatgpt', prompt: 'live control' }, { deadlineAt });
        updateSession(created.sessionId, { status: 'timeout', warnings: [] });
        const holder = await holdStoreLock(100);

        const write = restorePollingBeforeDeadline(created.sessionId, deadlineAt, {
            status: 'polling',
            warnings: ['watcher-transient-poll-timeout:30s'],
        });
        await holder.done;
        await write;

        expect(getSession(created.sessionId)).toMatchObject({
            status: 'polling',
            warnings: ['watcher-transient-poll-timeout:30s'],
        });
    }, 10_000);
});

async function holdStoreLock(holdMs) {
    const script = `
        import { withStoreLockAsync } from ${JSON.stringify(STORE_MODULE_URL)};
        await withStoreLockAsync(async () => {
            process.stdout.write('LOCKED\\n');
            await new Promise(resolve => setTimeout(resolve, ${holdMs}));
        });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, BROWSER_AGENT_HOME: tmpHome },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    await new Promise((resolve, reject) => {
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', chunk => {
            if (chunk.includes('LOCKED')) resolve();
        });
        child.once('error', reject);
        child.once('exit', code => {
            if (code !== 0) reject(new Error(`lock holder exited ${code}: ${stderr}`));
        });
    });
    return {
        done: new Promise((resolve, reject) => {
            child.once('exit', code => code === 0 ? resolve() : reject(new Error(`lock holder exited ${code}: ${stderr}`)));
            child.once('error', reject);
        }),
    };
}
