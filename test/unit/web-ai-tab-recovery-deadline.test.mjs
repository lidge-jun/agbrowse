import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const tabState = vi.hoisted(() => ({ page: null }));
vi.mock('../../skills/browser/tab-manager.mjs', () => ({
    createTab: vi.fn(),
    probeTabAlive: vi.fn(async () => 'alive'),
    getPageByTargetId: vi.fn(async () => tabState.page),
    waitForPageByTargetId: vi.fn(),
    listManagedTabs: vi.fn(),
    closeTab: vi.fn(),
}));

const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
const STORE_MODULE_URL = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../../web-ai/session-store.mjs')).href;
let tmpHome;

beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-tab-recovery-deadline-'));
    process.env.BROWSER_AGENT_HOME = tmpHome;
    tabState.page = providerPage('https://chatgpt.com/c/recovered');
    vi.clearAllMocks();
    vi.resetModules();
});

afterEach(() => {
    tabState.page = null;
    if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
    else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
    rmSync(tmpHome, { recursive: true, force: true });
    vi.resetModules();
});

describe('deadline-aware tab recovery binding', () => {
    it('refuses the binding and reports unavailable recovery after the predicate expires behind the lock', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { recoverSessionTab } = await import('../../web-ai/tab-recovery.mjs');
        const deadlineAt = new Date(Date.now() + 700).toISOString();
        const session = createSession({ vendor: 'chatgpt', prompt: 'recover' }, {
            targetId: 'target-existing',
            originalUrl: 'https://chatgpt.com/',
            conversationUrl: 'https://chatgpt.com/',
            deadlineAt,
        });
        const holder = await holdStoreLock(1_000);

        const recovery = recoverSessionTab(
            { getPort: () => 9222 },
            session,
            { stillActive: () => Date.now() < Date.parse(deadlineAt) },
        );
        await holder.done;
        const result = await recovery;

        expect(result).toMatchObject({ recovered: false, strategy: 'existing-tab', reason: 'deadline-passed' });
        expect(getSession(session.sessionId)).toMatchObject({
            targetId: 'target-existing',
            conversationUrl: null,
        });
    }, 10_000);

    it('preserves the legacy synchronous binding write when no predicate is supplied', async () => {
        const { createSession, getSession } = await import('../../web-ai/session.mjs');
        const { recoverSessionTab } = await import('../../web-ai/tab-recovery.mjs');
        const session = createSession({ vendor: 'chatgpt', prompt: 'legacy recover' }, {
            targetId: 'target-existing',
            originalUrl: 'https://chatgpt.com/',
            conversationUrl: 'https://chatgpt.com/',
        });

        const result = await recoverSessionTab({ getPort: () => 9222 }, session);

        expect(result).toMatchObject({ recovered: true, strategy: 'existing-tab', targetId: 'target-existing' });
        expect(getSession(session.sessionId)?.conversationUrl).toBe('https://chatgpt.com/c/recovered');
    });
});

function providerPage(url) {
    return {
        url: () => url,
        goto: vi.fn(),
        locator: () => ({ first: () => ({ waitFor: vi.fn(async () => undefined) }) }),
    };
}

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
