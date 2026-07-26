import { describe, expect, it } from 'vitest';
import {
    fetchViaCamoufox,
    camoufoxBudgetMs,
    CAMOUFOX_LAUNCH_HEADROOM_MS,
} from '../../skills/browser/adaptive-fetch/camoufox-session.mjs';

// Parity catalog 203.3 (P2): Camoufox stealth-browser fallback.
describe('adaptive fetch camoufox session', () => {
    it('bails to null before spawning when the signal is already aborted', async () => {
        // Guaranteed-safe path: an aborted signal short-circuits before any python/camoufox
        // spawn. (The unavailable-binary no-op is covered by the faithful mirror + design,
        // not asserted here to avoid spawning a real browser if camoufox happens to exist.)
        const controller = new AbortController();
        controller.abort();
        const result = await fetchViaCamoufox('https://example.com/', { signal: controller.signal });
        expect(result).toBeNull();
    });

    // The caller's abort signal and the lane's own process timeout both come
    // from this, so a drift between them is a bug in one place instead of two.
    // Signalling at `timeoutMs` aborted mid-launch and cost a render.
    describe('attempt budget', () => {
        it('adds launch headroom on top of the per-attempt timeout', () => {
            expect(camoufoxBudgetMs(15_000)).toBe(15_000 + CAMOUFOX_LAUNCH_HEADROOM_MS);
            expect(camoufoxBudgetMs(30_000)).toBe(30_000 + CAMOUFOX_LAUNCH_HEADROOM_MS);
        });

        it('rounds to whole seconds the way the spawned script does', () => {
            // The Python side takes seconds, so a signal derived from raw
            // milliseconds fires up to 999ms before the process budget.
            expect(camoufoxBudgetMs(1500)).toBe(2000 + CAMOUFOX_LAUNCH_HEADROOM_MS);
            expect(camoufoxBudgetMs(1001)).toBe(2000 + CAMOUFOX_LAUNCH_HEADROOM_MS);
            expect(camoufoxBudgetMs(50)).toBe(1000 + CAMOUFOX_LAUNCH_HEADROOM_MS);
        });

        it('stays inside the AbortSignal.timeout ceiling', () => {
            // Adding headroom near 2^32 turned into a cause-less RangeError,
            // which the scheduler now rethrows as a programming fault.
            const budget = camoufoxBudgetMs(4_294_940_000);
            expect(budget).toBeLessThanOrEqual(2_147_483_647);
            expect(() => AbortSignal.timeout(budget)).not.toThrow();
        });

        it('falls back to the default timeout when none is given', () => {
            expect(camoufoxBudgetMs(undefined)).toBe(30_000 + CAMOUFOX_LAUNCH_HEADROOM_MS);
        });
    });

    // An abort is the caller's deadline firing, not "this source had nothing".
    // The lane returned null for it, so the failure vanished with no attempt and
    // no warning — exactly the shape the scheduler stopped tolerating.
    it('surfaces an abort instead of reporting an empty render', async () => {
        await expect(fetchViaCamoufox('https://example.com/', {
            timeoutMs: 50,
            detect: async () => true,
            execFileImpl: async () => {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                throw error;
            },
        })).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('still reports an ordinary spawn failure as a no-op', async () => {
        const result = await fetchViaCamoufox('https://example.com/', {
            timeoutMs: 50,
            detect: async () => true,
            execFileImpl: async () => { throw new Error('python3 exited with code 1'); },
        });
        expect(result).toBeNull();
    });

    it('passes the shared budget to the spawned process', async () => {
        let seen;
        await fetchViaCamoufox('https://example.com/', {
            timeoutMs: 1500,
            detect: async () => true,
            execFileImpl: async (_bin, _args, opts) => {
                seen = opts?.timeout;
                return { stdout: '{"ok":true,"title":"T","html":"<p>x</p>","url":"https://example.com/"}' };
            },
        });
        expect(seen).toBe(camoufoxBudgetMs(1500));
    });
});
