import { describe, expect, it } from 'vitest';
import { withPollDeadline } from '../../web-ai/poll-deadline.mjs';

/**
 * `tighten` lets a run hand back its real deadline after the race is already
 * armed — necessary because reading that deadline would have taken the
 * blocking store lock, which is the thing being bounded.
 *
 * Tested here directly. The Work poller's inherited-deadline test exercises the
 * same code but only asserts "under 3s", which both buggy versions also
 * satisfied, so it guarded neither fix.
 */
describe('withPollDeadline tighten', () => {
    /** A run that never settles, so only the deadline can end the race. */
    const stalls = () => new Promise(() => {});

    it('takes an ABSOLUTE deadline, so a slow read is not charged twice', async () => {
        // The value a run computes after a slow read means "this long from
        // NOW". Treating it as a duration from the wrapper's start subtracted
        // the read a second time: a 400ms remainder found 200ms in became a
        // 400ms-from-start deadline, throwing away half of it.
        const started = Date.now();
        await withPollDeadline(
            async (_hardDeadline, token) => {
                await new Promise(resolve => setTimeout(resolve, 200));
                // 400ms remaining as of now.
                token.tighten?.(Date.now() + 400);
                return stalls();
            },
            { timeoutMs: 5_000, onExpired: () => 'expired' },
        );
        const elapsed = Date.now() - started;
        // ~600ms total. The duration-anchored version finished near 400ms.
        expect(elapsed).toBeGreaterThanOrEqual(520);
        expect(elapsed).toBeLessThan(900);
    }, 20_000);

    it('re-arms at once instead of waiting out the pending check interval', async () => {
        // The timer sleeps in 250ms steps. Tightening to a deadline inside the
        // current step used to leave that sleep running, so a 50ms bound still
        // took the rest of the tick.
        const started = Date.now();
        const result = await withPollDeadline(
            async (_hardDeadline, token) => {
                token.tighten?.(Date.now() + 20);
                return stalls();
            },
            { timeoutMs: 500, onExpired: () => 'expired' },
        );
        const elapsed = Date.now() - started;
        expect(result).toBe('expired');
        // Without the re-arm this lands at ~250ms.
        expect(elapsed).toBeLessThan(200);
    }, 20_000);

    it('ignores a deadline that would extend the caller\'s bound', async () => {
        // A bound that can be pushed out is a suggestion, not a bound.
        const started = Date.now();
        const result = await withPollDeadline(
            async (_hardDeadline, token) => {
                token.tighten?.(Date.now() + 10_000);
                return stalls();
            },
            { timeoutMs: 300, onExpired: () => 'expired' },
        );
        expect(result).toBe('expired');
        expect(Date.now() - started).toBeLessThan(1_000);
    }, 20_000);
});
