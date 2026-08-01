import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withStoreLock, withStoreLockAsync } from '../../web-ai/session-store.mjs';

/**
 * The store lock is what keeps the hard poll deadline from being a real bound
 * (#88, G1). `withStoreLock` waits with `Atomics.wait`, so a contended acquire
 * stops the event loop entirely: the deadline timer cannot run, and the time
 * the caller was promised simply is not counted.
 *
 * These tests contend the lock for real — a fresh, non-stale holder — and watch
 * whether a timer armed beforehand ever fires.
 */
describe('the session store lock and the event loop (#88 G1)', () => {
    const ORIGINAL_HOME = process.env.BROWSER_AGENT_HOME;
    let tmpHome;
    let lockPath;

    beforeEach(() => {
        tmpHome = mkdtempSync(join(tmpdir(), 'agbrowse-store-lock-'));
        process.env.BROWSER_AGENT_HOME = tmpHome;
        mkdirSync(tmpHome, { recursive: true });
        lockPath = `${join(tmpHome, 'web-ai-sessions.json')}.lock`;
        // A holder with fresh metadata, so the staleness rule does not simply
        // break the lock and let the acquire through.
        const fd = openSync(lockPath, 'wx');
        writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
        closeSync(fd);
    });

    afterEach(() => {
        if (ORIGINAL_HOME === undefined) delete process.env.BROWSER_AGENT_HOME;
        else process.env.BROWSER_AGENT_HOME = ORIGINAL_HOME;
        rmSync(tmpHome, { recursive: true, force: true });
    });

    it('L1: an awaited acquire lets timers keep running', async () => {
        let firedAfterMs = null;
        const armed = Date.now();
        const timer = setTimeout(() => { firedAfterMs = Date.now() - armed; }, 50);

        const started = Date.now();
        await expect(withStoreLockAsync(() => 'unreachable')).rejects.toThrow(/failed to acquire lock/);
        const elapsed = Date.now() - started;
        clearTimeout(timer);

        // The point is not that it waited; it is that the loop stayed alive
        // while it did.
        expect(elapsed).toBeGreaterThan(100);
        expect(firedAfterMs).not.toBeNull();
        expect(firedAfterMs).toBeLessThan(elapsed);
    }, 30_000);

    it('L2: the blocking acquire is what stops them', async () => {
        // The paired case. Without it, L1 would pass on an implementation that
        // never contends at all, and the difference it is asserting would be
        // invisible.
        let firedAfterMs = null;
        const armed = Date.now();
        const timer = setTimeout(() => { firedAfterMs = Date.now() - armed; }, 50);

        const started = Date.now();
        expect(() => withStoreLock(() => 'unreachable')).toThrow(/failed to acquire lock/);
        const elapsed = Date.now() - started;
        clearTimeout(timer);

        expect(elapsed).toBeGreaterThan(100);
        // Never ran, despite being due 50ms in.
        expect(firedAfterMs).toBeNull();
    }, 30_000);

    it('L3: the awaited lock still excludes a second holder', async () => {
        // Not blocking is only useful if it is still a lock. The holder from
        // `beforeEach` is released here so the acquire can succeed, then a
        // nested acquire must fail rather than run inside the first.
        rmSync(lockPath, { force: true });
        let nested = 'not-attempted';
        const outcome = await withStoreLockAsync(async () => {
            await withStoreLockAsync(() => 'inner').then(
                () => { nested = 'entered'; },
                () => { nested = 'refused'; },
            );
            return 'outer';
        });

        expect(outcome).toBe('outer');
        expect(nested).toBe('refused');
    }, 30_000);
});
