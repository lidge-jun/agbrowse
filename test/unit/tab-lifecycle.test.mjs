import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDuration, selectProviderTabsForCleanup, selectTabsForCleanup } from '../../skills/browser/tab-lifecycle.mjs';
import { createTempBrowserEnv } from '../helpers/temp-env.mjs';
import { checkoutPooledLease, cleanupLeasedTabs, listLeases, parseProviderLimitEnv, ProviderActiveCapacityError, recordActiveLease, releaseCompletedLease } from '../../web-ai/tab-lease-store.mjs';
import { probeTabAlive } from '../../skills/browser/tab-manager.mjs';
import { recoverSessionTab, resolveSessionPage, verifySessionTab, withSessionPage } from '../../web-ai/tab-recovery.mjs';
import { createSession, getSession } from '../../web-ai/session.mjs';
import { runSessionsCommand } from '../../web-ai/cli-sessions.mjs';
import { buildSessionDoctorReport } from '../../web-ai/session-doctor.mjs';
import { TabMonitor } from '../../skills/browser/tab-monitor.mjs';

/**
 * Several lease tests mean "the tab is gone" and used to express it by pointing
 * at a port nothing listens on. That only worked while an unreachable endpoint
 * was read as proof of absence — which is the very conflation issue #88 is about.
 * Serve a readable, empty tab list instead: same intent, stated directly.
 */
function serveEmptyTabList() {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify([]), {
        headers: { 'content-type': 'application/json' },
    });
    return () => { globalThis.fetch = previousFetch; };
}

describe('tab lifecycle cleanup selection', () => {
    it('parses duration strings used by tab-cleanup UX', () => {
        expect(parseDuration('500ms')).toBe(500);
        expect(parseDuration('2s')).toBe(2000);
        expect(parseDuration('3m')).toBe(180000);
        expect(parseDuration('1h')).toBe(3600000);
        expect(parseDuration('bad')).toBe(1800000);
    });

    it('selects idle tabs but preserves pinned and active-session tabs', () => {
        const now = 1_000_000;
        const selected = selectTabsForCleanup({
            now,
            idleTimeoutMs: 10_000,
            maxTabs: 10,
            tabs: [
                { targetId: 'idle', lastActiveAt: now - 20_000 },
                { targetId: 'active-session', lastActiveAt: now - 20_000 },
                { targetId: 'pinned', lastActiveAt: now - 20_000 },
                { targetId: 'fresh', lastActiveAt: now - 1000 },
            ],
            activeSessionTargetIds: new Set(['active-session']),
            pinnedTargetIds: new Set(['pinned']),
        });

        expect(selected.map(tab => tab.targetId)).toEqual(['idle']);
        expect(selected[0].cleanupReason).toBe('idle-timeout');
    });

    it('preserves active-command tabs during cleanup selection', () => {
        const now = 1_000_000;
        const selected = selectTabsForCleanup({
            now,
            idleTimeoutMs: 10_000,
            maxTabs: 2,
            tabs: [
                { targetId: 'idle', lastActiveAt: now - 20_000 },
                { targetId: 'active-command', lastActiveAt: now - 20_000 },
                { targetId: 'newer', lastActiveAt: now - 1000 },
            ],
            activeCommandTargetIds: new Set(['active-command']),
        });

        expect(selected.map(tab => tab.targetId)).toEqual(['idle']);
    });

    it('enforces max-tabs by closing the oldest closeable tabs', () => {
        const selected = selectTabsForCleanup({
            now: 10_000,
            idleTimeoutMs: 60_000,
            maxTabs: 3,
            tabs: [
                { targetId: 'oldest', lastActiveAt: 100 },
                { targetId: 'active-session', lastActiveAt: 200 },
                { targetId: 'middle', lastActiveAt: 300 },
                { targetId: 'newest', lastActiveAt: 400 },
                { targetId: 'pinned', lastActiveAt: 50 },
            ],
            activeSessionTargetIds: new Set(['active-session']),
            pinnedTargetIds: new Set(['pinned']),
        });

        expect(selected.map(tab => tab.targetId)).toEqual(['oldest', 'middle']);
        expect(selected.every(tab => tab.cleanupReason === 'max-tabs')).toBe(true);
    });

    it('only closes untracked tabs when includeUntracked is explicit', () => {
        const base = {
            now: 10_000,
            idleTimeoutMs: 1000,
            maxTabs: 10,
            tabs: [{ targetId: 'untracked', lastActiveAt: null }],
        };

        expect(selectTabsForCleanup(base)).toEqual([]);
        expect(selectTabsForCleanup({ ...base, includeUntracked: true })).toMatchObject([
            { targetId: 'untracked', cleanupReason: 'untracked' },
        ]);
    });

    it('does not close untracked tabs for max-tabs unless includeUntracked is explicit', () => {
        const base = {
            now: 10_000,
            idleTimeoutMs: 1000,
            maxTabs: 1,
            tabs: [
                { targetId: 'untracked', lastActiveAt: null },
                { targetId: 'tracked', lastActiveAt: 9000 },
            ],
        };

        expect(selectTabsForCleanup(base).map(tab => tab.targetId)).toEqual(['tracked']);
        expect(selectTabsForCleanup({ ...base, includeUntracked: true }).map(tab => tab.targetId)).toEqual(['untracked']);
    });

    it('selects extra inactive provider tabs while protecting active commands and sessions', () => {
        const selected = selectProviderTabsForCleanup({
            vendor: 'chatgpt',
            keep: 1,
            tabs: [
                { targetId: 'newest', url: 'https://chatgpt.com/c/new', lastActiveAt: 400 },
                { targetId: 'old', url: 'https://chatgpt.com/c/old', lastActiveAt: 100 },
                { targetId: 'active-command', url: 'https://chatgpt.com/c/run', lastActiveAt: 50 },
                { targetId: 'active-session', url: 'https://chatgpt.com/c/session', lastActiveAt: 25 },
                { targetId: 'other', url: 'https://example.com', lastActiveAt: 1 },
            ],
            activeCommandTargetIds: new Set(['active-command']),
            activeSessionTargetIds: new Set(['active-session']),
        });

        expect(selected.map(tab => tab.targetId)).toEqual(['old']);
        expect(selected[0].cleanupReason).toBe('provider-overflow');
    });

    it('counts only owned closeable leases toward managed max-tabs when lease metadata is present', () => {
        const leaseByTargetId = new Map([
            ['pooled-old', { targetId: 'pooled-old', owner: 'web-ai', state: 'pooled' }],
            ['active', { targetId: 'active', owner: 'web-ai', state: 'active-session' }],
        ]);
        const selected = selectTabsForCleanup({
            now: 10_000,
            idleTimeoutMs: 60_000,
            maxTabs: 1,
            leaseByTargetId,
            tabs: [
                { targetId: 'untracked-a', lastActiveAt: null },
                { targetId: 'untracked-b', lastActiveAt: null },
                { targetId: 'active', lastActiveAt: 100 },
                { targetId: 'pooled-old', lastActiveAt: 200 },
            ],
        });

        expect(selected.map(tab => tab.targetId)).toEqual([]);
    });

    it('does not pass Array.map index as tab display timestamp', () => {
        const source = readFileSync(new URL('../../skills/browser/browser.mjs', import.meta.url), 'utf8');
        expect(source).toContain('const displayed = tabDisplayState(tab)');
        expect(source).not.toContain('.map(tabDisplayState)');
    });

    it('reuses startup about:blank tabs before creating provider tabs', () => {
        const source = readFileSync(new URL('../../skills/browser/tab-manager.mjs', import.meta.url), 'utf8');
        expect(source).toContain('function isReusableBlankTab');
        expect(source).toContain('opts.reuseBlank !== false');
        expect(source).toContain('reusedBlank: true');
        expect(source).toContain('newBrowserCDPSession');
        expect(source).toContain('createRawBrowserCdpSession');
        expect(source).toContain('createTargetWithWindowFallback');
    });

    it('persists tab pool across CLI processes and checks out pooled tabs once', () => {
        const source = readFileSync(new URL('../../web-ai/tab-pool.mjs', import.meta.url), 'utf8');
        const leaseSource = readFileSync(new URL('../../web-ai/tab-lease-store.mjs', import.meta.url), 'utf8');
        expect(source).toContain('checkoutPooledLease');
        expect(source).toContain('releaseCompletedLease');
        expect(leaseSource).toContain('web-ai-tab-leases.json');
        expect(leaseSource).toContain('withLeaseLock');
        expect(leaseSource).toContain('leaseKey');
        expect(leaseSource).toContain('closeTab(port, lease.targetId)');
    });

    it('requires force when tab-cleanup includes untracked tabs', () => {
        const source = readFileSync(new URL('../../skills/browser/browser.mjs', import.meta.url), 'utf8');
        expect(source).toContain("values['include-untracked'] === true && values.force !== true");
        expect(source).toContain('tab-cleanup --include-untracked requires --force');
    });

    it('wires tab-cleanup UX through durable lease pool cleanup', () => {
        const source = readFileSync(new URL('../../skills/browser/browser.mjs', import.meta.url), 'utf8');
        expect(source).toContain("import { cleanupPoolTabs } from '../../web-ai/tab-pool.mjs'");
        expect(source).toContain('const leaseResult = await cleanupPoolTabs(getPort())');
        expect(source).toContain('leaseClosed');
    });

    it('wires active command ownership into tab and lease cleanup', () => {
        const lifecycleSource = readFileSync(new URL('../../skills/browser/tab-lifecycle.mjs', import.meta.url), 'utf8');
        const leaseSource = readFileSync(new URL('../../web-ai/tab-lease-store.mjs', import.meta.url), 'utf8');
        expect(lifecycleSource).toContain('activeCommandTargetIds');
        expect(lifecycleSource).toContain('!activeCommandTargets.has(tab.targetId)');
        expect(leaseSource).toContain('activeCommandTargetIds');
        expect(leaseSource).toContain('!activeTargets.has(lease.targetId)');
        expect(leaseSource).toContain('isPidAlive');
        expect(leaseSource).toContain('owner-pid-dead');
        expect(lifecycleSource).not.toContain('activeCommandTargetIds({ browserProfileKey: String(port) }).catch');
        expect(leaseSource).not.toContain('activeCommandTargetIds({ browserProfileKey }).catch');
        expect(lifecycleSource).toContain('selectProviderTabsForCleanup');
        expect(lifecycleSource).toContain('providerClosed');
    });

    it('records provider leases before binding sessions to tabs', () => {
        const chatgptSource = readFileSync(new URL('../../web-ai/chatgpt.mjs', import.meta.url), 'utf8');
        const geminiSource = readFileSync(new URL('../../web-ai/gemini-live.mjs', import.meta.url), 'utf8');
        const grokSource = readFileSync(new URL('../../web-ai/grok-live.mjs', import.meta.url), 'utf8');

        expectOrder(chatgptSource, "sessionType: 'send-poll'", 'recordActiveLease', 'bindSessionToTab');
        expectOrder(chatgptSource, "sessionType: 'deep-research'", 'recordActiveLease', 'bindSessionToTab');
        expectOrder(geminiSource, "sessionType: 'send-poll'", 'recordActiveLease', 'bindSessionToTab');
        expectOrder(grokSource, "sessionType: 'send-poll'", 'recordActiveLease', 'bindSessionToTab');
    });

    it('uses finite tab caps and current provider lease docs', () => {
        const cliSource = readFileSync(new URL('../../web-ai/cli.mjs', import.meta.url), 'utf8');
        const lifecycleSource = readFileSync(new URL('../../skills/browser/tab-lifecycle.mjs', import.meta.url), 'utf8');
        const browserSource = readFileSync(new URL('../../skills/browser/browser.mjs', import.meta.url), 'utf8');
        const skillSource = readFileSync(new URL('../../skills/web-ai/SKILL.md', import.meta.url), 'utf8');
        const readmeSource = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

        expect(cliSource).not.toContain('maxTabs: Number.POSITIVE_INFINITY');
        expect(cliSource).toContain('maxTabs: DEFAULT_MAX_TABS');
        expect(lifecycleSource).toContain("process.env.AGBROWSE_MAX_TABS || '20'");
        for (const source of [cliSource, browserSource]) {
            expect(source).not.toContain('TTL=15m');
            expect(source).toContain('TTL=30m');
            expect(source).toContain('AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY');
        }
        expect(skillSource).toContain('| TTL per pooled tab | 30 min |');
        expect(skillSource).toContain('| Max tabs | 20 |');
        expect(readmeSource).toContain('| Max tabs | 20 |');
    });

    it('removes dead pooled lease metadata during checkout', async () => {
        const temp = createTempBrowserEnv('agbrowse-lease-dead-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        const restoreFetch = serveEmptyTabList();
        try {
            const port = 65_531;
            await recordActiveLease({
                port,
                vendor: 'chatgpt',
                targetId: 'dead-pooled',
                sessionId: 'session-dead',
                url: 'https://chatgpt.com/c/dead',
            });
            await releaseCompletedLease(port, {
                port,
                vendor: 'chatgpt',
                targetId: 'dead-pooled',
                sessionId: 'session-dead',
                url: 'https://chatgpt.com/c/dead',
            });

            const checkedOut = await checkoutPooledLease(port, {
                port,
                vendor: 'chatgpt',
                url: 'https://chatgpt.com/c/dead',
            });

            expect(checkedOut).toBeNull();
            expect(await listLeases()).toEqual([]);
        } finally {
            restoreFetch();
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('records owner pid on active leases', async () => {
        const temp = createTempBrowserEnv('agbrowse-owner-pid-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        try {
            await recordActiveLease({
                port: 65_532,
                vendor: 'chatgpt',
                targetId: 'active-with-owner',
                sessionId: 'session-owner',
                url: 'https://chatgpt.com/c/owner',
            });

            const [lease] = await listLeases();
            expect(lease.ownerPid).toBe(process.pid);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('rejects active leases above the per-key cap but allows same-session replacement', async () => {
        const temp = createTempBrowserEnv('agbrowse-active-per-key-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        try {
            for (const id of ['one', 'two']) {
                await recordActiveLease({
                    port: 65_533,
                    vendor: 'chatgpt',
                    targetId: `target-${id}`,
                    sessionId: `session-${id}`,
                    url: `https://chatgpt.com/c/${id}`,
                    activeMaxPerKey: 2,
                    activeGlobalMax: 10,
                });
            }

            await expect(recordActiveLease({
                port: 65_533,
                vendor: 'chatgpt',
                targetId: 'target-three',
                sessionId: 'session-three',
                url: 'https://chatgpt.com/c/three',
                activeMaxPerKey: 2,
                activeGlobalMax: 10,
            })).rejects.toBeInstanceOf(ProviderActiveCapacityError);

            await recordActiveLease({
                port: 65_533,
                vendor: 'chatgpt',
                targetId: 'target-one-rebound',
                sessionId: 'session-one',
                url: 'https://chatgpt.com/c/one-rebound',
                activeMaxPerKey: 2,
                activeGlobalMax: 10,
            });

            expect((await listLeases()).map(lease => lease.targetId).sort()).toEqual(['target-one-rebound', 'target-two']);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('rejects active leases above the browser-profile global cap', async () => {
        const temp = createTempBrowserEnv('agbrowse-active-global-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        try {
            await recordActiveLease({
                port: 65_534,
                vendor: 'chatgpt',
                targetId: 'target-chatgpt',
                sessionId: 'session-chatgpt',
                url: 'https://chatgpt.com/c/global',
                activeMaxPerKey: 10,
                activeGlobalMax: 1,
            });

            await expect(recordActiveLease({
                port: 65_534,
                vendor: 'gemini',
                targetId: 'target-gemini',
                sessionId: 'session-gemini',
                url: 'https://gemini.google.com/app/global',
                activeMaxPerKey: 10,
                activeGlobalMax: 1,
            })).rejects.toMatchObject({
                errorCode: 'provider.active-capacity',
                stage: 'provider-capacity',
            });
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('completed-session cleanup is scoped to the current browser profile', async () => {
        const temp = createTempBrowserEnv('agbrowse-lease-profile-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        const restoreFetch = serveEmptyTabList();
        try {
            writeFileSync(join(temp.homeDir, 'web-ai-tab-leases.json'), JSON.stringify({
                version: 1,
                leases: [
                    completedLease('current-profile', '111'),
                    completedLease('other-profile', '222'),
                ],
            }));

            const result = await cleanupLeasedTabs(111, {
                completedSessions: true,
                browserProfileKey: '111',
            });

            expect(result.closed).toBe(0);
            expect((await listLeases()).map(lease => lease.targetId)).toEqual(['other-profile']);
        } finally {
            restoreFetch();
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('cleanup close counts do not count already-dead metadata as closed tabs', async () => {
        const temp = createTempBrowserEnv('agbrowse-lease-close-count-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        const restoreFetch = serveEmptyTabList();
        try {
            writeFileSync(join(temp.homeDir, 'web-ai-tab-leases.json'), JSON.stringify({
                version: 1,
                leases: [
                    {
                        ...completedLease('expired-pooled', '333'),
                        state: 'pooled',
                        pooledAt: '2026-05-03T00:00:00.000Z',
                        poolExpiresAt: '2026-05-03T00:01:00.000Z',
                    },
                ],
            }));

            const result = await cleanupLeasedTabs(333, {
                now: Date.parse('2026-05-03T00:02:00.000Z'),
            });

            expect(result.closed).toBe(0);
           expect(await listLeases()).toEqual([]);
       } finally {
           restoreFetch();
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
           else process.env.BROWSER_AGENT_HOME = previousHome;
           temp.cleanup();
       }
   });
});

describe('provider lease env limit parsing', () => {
    it.each([
        ['whitespace around valid', ' 7 ', 7],
        ['valid integer', '12', 12],
        ['zero', '0', 5],
        ['negative', '-1', 5],
        ['decimal', '2.5', 5],
        ['exponent', '1e2', 5],
        ['suffix', '5junk', 5],
        ['overflow', String(Number.MAX_SAFE_INTEGER + 1), 5],
        ['empty', '   ', 5],
        ['undefined', undefined, 5],
    ])('%s for positive active limits', (_name, raw, expected) => {
        expect(parseProviderLimitEnv(raw, 5)).toBe(expected);
    });

    it.each([
        ['zero disables', '0', 0],
        ['whitespace zero disables', ' 0 ', 0],
        ['valid pool limit', '8', 8],
        ['negative falls back', '-1', 3],
        ['decimal falls back', '2.5', 3],
        ['exponent falls back', '1e2', 3],
        ['suffix falls back', '5tabs', 3],
        ['overflow falls back', String(Number.MAX_SAFE_INTEGER + 1), 3],
    ])('%s for non-negative pool limits', (_name, raw, expected) => {
        expect(parseProviderLimitEnv(raw, 3, { allowZero: true })).toBe(expected);
    });

    it('routes all four provider limit envs through the strict parser', () => {
        const source = readFileSync(join(process.cwd(), 'web-ai', 'tab-lease-store.mjs'), 'utf8');
        expect(source).not.toMatch(/parseInt\(process\.env\.AGBROWSE_PROVIDER_/);
        for (const name of [
            'AGBROWSE_PROVIDER_POOL_MAX_PER_KEY',
            'AGBROWSE_PROVIDER_POOL_GLOBAL_MAX',
            'AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY',
            'AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX',
        ]) {
            expect(source).toMatch(new RegExp(`parseProviderLimitEnv\\(\\s*process\\.env\\.${name}`));
        }
    });

    it('closes instead of pooling when per-key pool limit is zero', async () => {
        const temp = createTempBrowserEnv('agbrowse-pool-zero-perkey-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        try {
            const port = 65_529;
            await recordActiveLease({
                port,
                vendor: 'chatgpt',
                targetId: 'pool-zero-target',
                sessionId: 'session-pool-zero',
                url: 'https://chatgpt.com/c/pool-zero',
            });
            const result = await releaseCompletedLease(port, {
                port,
                vendor: 'chatgpt',
                targetId: 'pool-zero-target',
                sessionId: 'session-pool-zero',
                url: 'https://chatgpt.com/c/pool-zero',
                maxPerKey: 0,
            });
            expect(result.pooled).toBe(false);
            const leases = await listLeases();
            expect(leases.filter(row => row.state === 'pooled')).toEqual([]);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('drains every pooled lease when the global pool limit is zero', async () => {
        const temp = createTempBrowserEnv('agbrowse-pool-zero-global-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        const restoreFetch = serveEmptyTabList();
        try {
            const port = 65_528;
            await recordActiveLease({
                port,
                vendor: 'chatgpt',
                targetId: 'pool-zero-global',
                sessionId: 'session-pool-zero-global',
                url: 'https://chatgpt.com/c/pool-zero-global',
            });
            await releaseCompletedLease(port, {
                port,
                vendor: 'chatgpt',
                targetId: 'pool-zero-global',
                sessionId: 'session-pool-zero-global',
                url: 'https://chatgpt.com/c/pool-zero-global',
                maxPerKey: 3,
                globalMax: 0,
            });
            const leases = await listLeases();
            expect(leases.filter(row => row.state === 'pooled')).toEqual([]);
        } finally {
            restoreFetch();
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });
});

function completedLease(targetId, browserProfileKey) {
    return {
        owner: 'web-ai',
        vendor: 'chatgpt',
        sessionType: 'send-poll',
        origin: 'https://chatgpt.com',
        browserProfileKey,
        targetId,
        sessionId: `session-${targetId}`,
        url: `https://chatgpt.com/c/${targetId}`,
        state: 'completed-session',
        leasedAt: '2026-05-03T00:00:00.000Z',
        pooledAt: null,
        finalizedAt: '2026-05-03T00:00:00.000Z',
        poolExpiresAt: null,
        leaseDisposition: 'close',
        updatedAt: '2026-05-03T00:00:00.000Z',
        leaseKey: `web-ai:chatgpt:send-poll:https://chatgpt.com:${browserProfileKey}`,
    };
}

function expectOrder(source, anchor, first, second) {
    const anchorIndex = source.indexOf(anchor);
    expect(anchorIndex).toBeGreaterThanOrEqual(0);
    const snippet = source.slice(Math.max(0, anchorIndex - 220), anchorIndex + 420);
    expect(snippet.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(snippet.indexOf(second)).toBeGreaterThanOrEqual(0);
    expect(snippet.indexOf(first)).toBeLessThan(snippet.indexOf(second));
}

/**
 * Tab liveness sentinels (issue #88, boundary B36).
 *
 * `isTabAlive` used to answer `false` for two very different facts: "the tab is
 * gone" and "I could not read the tab list". Since the reader is a single fetch
 * to the CDP port, one transient failure marked EVERY tab dead at once — and the
 * consumers act on that by closing tabs and deleting lease records.
 */
describe('tab liveness probing distinguishes gone from unreadable (B36)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('U6: an unreadable tab list is unknown, not gone', async () => {
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        await expect(probeTabAlive(9222, 'target-a')).resolves.toBe('unknown');
    });

    it('U9: a readable list without the tab is gone', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'other', type: 'page' }]), {
            headers: { 'content-type': 'application/json' },
        });
        await expect(probeTabAlive(9222, 'target-a')).resolves.toBe('gone');
    });

    it('reports alive when the tab is listed', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'target-a', type: 'page' }]), {
            headers: { 'content-type': 'application/json' },
        });
        await expect(probeTabAlive(9222, 'target-a')).resolves.toBe('alive');
    });

    it('a refused connection is still unknown, not gone', async () => {
        // Tempting to call this proof of death — nothing was listening. But it
        // proves only that the endpoint was silent at that instant, and the
        // consumers of `gone` delete leases and open replacement tabs. Reclaiming
        // after a real browser exit needs lifecycle evidence, not one failed fetch.
        const refused = new Error('fetch failed');
        refused.cause = { code: 'ECONNREFUSED' };
        globalThis.fetch = async () => { throw refused; };
        await expect(probeTabAlive(9222, 'target-a')).resolves.toBe('unknown');
    });

    it('U7: cleanup keeps leases whose tabs it could not observe', async () => {
        const temp = createTempBrowserEnv('agbrowse-lease-unknown-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        try {
            writeFileSync(join(temp.homeDir, 'web-ai-tab-leases.json'), JSON.stringify({
                version: 1,
                leases: [completedLease('unreadable', '9222')],
            }));

            await cleanupLeasedTabs(9222, { browserProfileKey: '9222' });

            // A deleted lease cannot be recovered; an unknown one is re-probed on
            // the next cleanup.
            expect((await listLeases()).map(lease => lease.targetId)).toEqual(['unreadable']);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('U9b: cleanup still drops leases whose tabs are confirmed gone', async () => {
        // The paired case: over-applying the guard would leak every lease.
        const temp = createTempBrowserEnv('agbrowse-lease-gone-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        globalThis.fetch = async () => new Response(JSON.stringify([]), {
            headers: { 'content-type': 'application/json' },
        });
        try {
            writeFileSync(join(temp.homeDir, 'web-ai-tab-leases.json'), JSON.stringify({
                version: 1,
                leases: [completedLease('vanished', '9222')],
            }));

            await cleanupLeasedTabs(9222, { browserProfileKey: '9222' });

            expect(await listLeases()).toEqual([]);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('U14: an unverifiable tab is reported unverified, not recovered', async () => {
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        const result = await verifySessionTab(
            { getPort: () => 9222 },
            { sessionId: 'session-x', targetId: 'target-x' },
        );
        // `needsRecovery: false` alone would make resolveSessionPage label this
        // `strategy: 'recovered'` — a tab it never recovered.
        expect(result).toMatchObject({ valid: false, needsRecovery: false, liveness: 'unknown' });
    });

    it('U14b: a confirmed-gone tab still requests recovery', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify([]), {
            headers: { 'content-type': 'application/json' },
        });
        const result = await verifySessionTab(
            { getPort: () => 9222 },
            { sessionId: 'session-x', targetId: 'target-x' },
        );
        expect(result).toMatchObject({ valid: false, needsRecovery: true, liveness: 'gone' });
    });
});

/**
 * The two destructive consumers of tab liveness, tested directly.
 *
 * Both act on "not alive" by discarding state a later probe cannot rebuild: one
 * deletes the lease record, the other tells listeners the tab closed. Neither
 * had a test, so reverting either guard left the suite green.
 */
describe('unreadable liveness does not destroy lease or health state (B36)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('U11: a failed close plus an unreadable probe keeps the lease', async () => {
        // `closeTab` throwing means the tab may well still be open. Recording it
        // as closed drops the lease while the tab lives on, ownerless.
        const temp = createTempBrowserEnv('agbrowse-close-unknown-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        globalThis.fetch = async (input) => {
            // Close attempt fails, and the follow-up liveness read is unreadable.
            if (String(input).includes('/json/close/')) throw new Error('close refused');
            throw new Error('socket hang up');
        };
        try {
            writeFileSync(join(temp.homeDir, 'web-ai-tab-leases.json'), JSON.stringify({
                version: 1,
                leases: [completedLease('close-failed', '9222')],
            }));

            await cleanupLeasedTabs(9222, { completedSessions: true, browserProfileKey: '9222' });

            expect((await listLeases()).map(lease => lease.targetId)).toEqual(['close-failed']);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('U11b: a failed close with the tab confirmed gone drops the lease', async () => {
        // The paired case: the guard must not keep leases for tabs that are gone.
        const temp = createTempBrowserEnv('agbrowse-close-gone-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        globalThis.fetch = async (input) => {
            if (String(input).includes('/json/close/')) throw new Error('close refused');
            return new Response(JSON.stringify([]), { headers: { 'content-type': 'application/json' } });
        };
        try {
            writeFileSync(join(temp.homeDir, 'web-ai-tab-leases.json'), JSON.stringify({
                version: 1,
                leases: [completedLease('already-gone', '9222')],
            }));

            await cleanupLeasedTabs(9222, { completedSessions: true, browserProfileKey: '9222' });

            expect(await listLeases()).toEqual([]);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('U13: the monitor stays silent when it cannot read the tab list', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'watched', type: 'page' }]), {
            headers: { 'content-type': 'application/json' },
        });
        const monitor = new TabMonitor(9222);
        /** @type {string[]} */
        const events = [];
        monitor.on('tab:closed', () => events.push('closed'));
        monitor.on('tab:recovered', () => events.push('recovered'));

        monitor.startMonitoring('watched', 60_000);
        await new Promise(resolve => setImmediate(resolve));

        // Baseline: the first check has no previous entry, so its transition is
        // not what this test is about.
        events.length = 0;

        // Now the tab list becomes unreadable. The tab itself did not change.
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        await monitor.checkOnce('watched');

        expect(events).toEqual([]);
        expect(monitor.healthStatus.get('watched')?.alive).toBe(true);
        monitor.stopMonitoring('watched');
    });

    it('U13b: the monitor still reports a tab that is confirmed gone', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'watched', type: 'page' }]), {
            headers: { 'content-type': 'application/json' },
        });
        const monitor = new TabMonitor(9222);
        /** @type {string[]} */
        const events = [];
        monitor.on('tab:closed', () => events.push('closed'));

        monitor.startMonitoring('watched', 60_000);
        await new Promise(resolve => setImmediate(resolve));

        events.length = 0;

        globalThis.fetch = async () => new Response(JSON.stringify([]), {
            headers: { 'content-type': 'application/json' },
        });
        await monitor.checkOnce('watched');

        expect(events).toEqual(['closed']);
        monitor.stopMonitoring('watched');
    });
});

/**
 * The remaining two destructive consumers: pool checkout and session recovery.
 *
 * Both were left unguarded by tests, so reverting either guard kept the suite
 * green. Checkout discards lease records it believes are dead; recovery opens a
 * replacement tab and rebinds the session to it.
 */
describe('unreadable liveness does not discard pooled leases or rebind sessions (B36)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('U8: checkout neither reuses nor forgets a lease it could not observe', async () => {
        const temp = createTempBrowserEnv('agbrowse-checkout-unknown-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        try {
            const port = 9222;
            await recordActiveLease({
                port, vendor: 'chatgpt', targetId: 'pooled-unknown',
                sessionId: 'session-unknown', url: 'https://chatgpt.com/c/unknown',
            });
            await releaseCompletedLease(port, {
                port, vendor: 'chatgpt', targetId: 'pooled-unknown',
                sessionId: 'session-unknown', url: 'https://chatgpt.com/c/unknown',
            });

            const checkedOut = await checkoutPooledLease(port, {
                port, vendor: 'chatgpt', url: 'https://chatgpt.com/c/unknown',
            });

            // Conservative on reuse, conservative on bookkeeping: skip the
            // candidate, but keep the record so a later probe can settle it.
            expect(checkedOut).toBeNull();
            expect((await listLeases()).map(lease => lease.targetId)).toEqual(['pooled-unknown']);
        } finally {
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('U8b: checkout still forgets a lease whose tab is confirmed gone', async () => {
        const temp = createTempBrowserEnv('agbrowse-checkout-gone-');
        const previousHome = process.env.BROWSER_AGENT_HOME;
        process.env.BROWSER_AGENT_HOME = temp.homeDir;
        const restoreFetch = serveEmptyTabList();
        try {
            const port = 9222;
            await recordActiveLease({
                port, vendor: 'chatgpt', targetId: 'pooled-gone',
                sessionId: 'session-gone', url: 'https://chatgpt.com/c/gone',
            });
            await releaseCompletedLease(port, {
                port, vendor: 'chatgpt', targetId: 'pooled-gone',
                sessionId: 'session-gone', url: 'https://chatgpt.com/c/gone',
            });

            const checkedOut = await checkoutPooledLease(port, {
                port, vendor: 'chatgpt', url: 'https://chatgpt.com/c/gone',
            });

            expect(checkedOut).toBeNull();
            expect(await listLeases()).toEqual([]);
        } finally {
            restoreFetch();
            if (previousHome === undefined) delete process.env.BROWSER_AGENT_HOME;
            else process.env.BROWSER_AGENT_HOME = previousHome;
            temp.cleanup();
        }
    });

    it('U12: recovery does not open a replacement tab it cannot justify', async () => {
        // Creating a tab here rebinds the session target, abandoning a live
        // conversation because one fetch failed.
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        const result = await recoverSessionTab(
            { getPort: () => 9222 },
            {
                sessionId: 'session-x',
                targetId: 'target-x',
                vendor: 'chatgpt',
                conversationUrl: 'https://chatgpt.com/c/live',
                status: 'polling',
            },
        );
        expect(result).toMatchObject({ recovered: false, strategy: 'unverified', liveness: 'unknown' });
    });
});

/**
 * The public contract for an unverifiable tab, and the callers that consume it.
 *
 * `verifySessionTab` returning `liveness: 'unknown'` is only half the fix — every
 * guard above it could be deleted with the suite still green. These pin the
 * observable envelope instead of the internal verdict.
 */
describe('unverified liveness reaches callers as its own outcome (B36)', () => {
    const originalFetch = globalThis.fetch;

    function makeSessionRecord(targetId = 'target-live') {
        return createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId,
                conversationUrl: 'https://chatgpt.com/c/live',
                deadlineAt: new Date(Date.now() + 600_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
    }

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    it('U14: resolveSessionPage reports unverified rather than a mismatch', async () => {
        let probes = 0;
        globalThis.fetch = async () => { probes += 1; throw new Error('socket hang up'); };
        const session = makeSessionRecord();

        const resolved = await resolveSessionPage(
            { getPort: () => 9222 },
            session.sessionId,
            { allowNavigate: true },
        );

        // `mismatch: true` alone would send every caller down the "wrong tab"
        // path; the discriminator is what keeps them out of it.
        expect(resolved).toMatchObject({
            strategy: 'unverified',
            liveness: 'unknown',
            recovered: false,
            page: null,
        });
        // It returned on the first verdict rather than falling through to a
        // recovery attempt that happened to fail the same way.
        expect(probes).toBe(1);
    });

    it('U15: withSessionPage raises a retryable typed error, not a generic mismatch', async () => {
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        const session = makeSessionRecord();

        await expect(withSessionPage(
            { getPort: () => 9222 },
            session.sessionId,
            async () => 'never runs',
        )).rejects.toMatchObject({
            errorCode: 'cdp.unreachable',
            retryHint: 'retry',
            evidence: expect.objectContaining({ liveness: 'unknown' }),
        });
    });

    it('U15b: a forced re-resolve that loses liveness is still typed', async () => {
        // U15 exits at the first probe, before recovery is ever attempted. This
        // drives the other order: the tab reads alive, page lookup fails, and the
        // recovery probe then cannot read it — so the unverified verdict has to
        // survive `recoverSessionTab` and the forceRecover branch as well.
        //
        // The final `withSessionPage` guard after a page death needs a live
        // browser to reach and is defence-in-depth over this same policy.
        let listReads = 0;
        globalThis.fetch = async () => {
            listReads += 1;
            if (listReads === 1) {
                return new Response(JSON.stringify([{ id: 'target-dies', type: 'page' }]), {
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error('socket hang up');
        };
        const session = makeSessionRecord('target-dies');

        await expect(withSessionPage(
            { getPort: () => 9222 },
            session.sessionId,
            async () => { throw new Error('Target closed'); },
        )).rejects.toMatchObject({
            errorCode: 'cdp.unreachable',
            retryHint: 'retry',
            evidence: expect.objectContaining({ liveness: 'unknown' }),
        });
    });

    it('U12b: a confirmed-gone tab still takes the recovery path', async () => {
        // Over-applying the guard would strand every genuinely closed tab.
        globalThis.fetch = async () => new Response(JSON.stringify([]), {
            headers: { 'content-type': 'application/json' },
        });
        const session = makeSessionRecord('target-closed');

        // Liveness was established as gone, so recovery may open a replacement.
        // The unverified short-circuit returns cleanly BEFORE tab creation, so
        // failing inside `createTab` is itself the evidence we got past it.
        const outcome = await recoverSessionTab(
            { getPort: () => 9222 },
            /** @type {any} */ (getSession(session.sessionId)),
        ).then(result => result.strategy, err => `threw:${err?.message || 'unknown'}`);

        expect(outcome).not.toBe('unverified');
        // It got as far as dialling CDP to make the replacement tab, which is
        // strictly past the short-circuit.
        expect(String(outcome)).toMatch(/connectOverCDP|CDP session/);
    });
});

/**
 * Policies added by this work-phase, pinned at the surfaces users actually see.
 *
 * Each is an independent decision, not something the resolver contract enforces:
 * reattach must not open a replacement tab, the CLI must not advise navigating,
 * and the doctor must not recommend recovery. Deleting any one of them leaves
 * the lower-level tests green.
 */
describe('callers advise retry, not replacement, when liveness is unknown (B36)', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        vi.restoreAllMocks();
    });

    function unreadableSession(targetId = 'target-live') {
        globalThis.fetch = async () => { throw new Error('socket hang up'); };
        return createSession(
            { vendor: 'chatgpt', prompt: 'q', attachmentPolicy: 'inline-only' },
            {
                targetId,
                conversationUrl: 'https://chatgpt.com/c/live',
                deadlineAt: new Date(Date.now() + 600_000).toISOString(),
                envelopeSummary: { assistantCount: 0 },
            },
        );
    }

    it('U16: reattach --navigate does not replace a tab it could not read', async () => {
        const session = unreadableSession();

        const result = await runSessionsCommand(
            ['reattach', session.sessionId],
            { navigate: true },
            { getPort: () => 9222 },
            { navigate: true },
        );

        expect(result.status).toBe('reattach-unverified');
        // The session must still point at the original tab.
        expect(getSession(session.sessionId).targetId).toBe('target-live');
    });

    it('U17: the doctor recommends retrying rather than recovering', async () => {
        const session = unreadableSession('target-doctor');

        const report = await buildSessionDoctorReport(
            { getPort: () => 9222 },
            session.sessionId,
            { navigate: true },
        );

        expect(report.summary).toContain('liveness');
        expect(report.recommendations.join(' ')).not.toContain('--navigate');
        expect(report.recommendations.join(' ')).toMatch(/retry/i);
    });
});
