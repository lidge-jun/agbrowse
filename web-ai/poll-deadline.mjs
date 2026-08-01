// @ts-check

/**
 * A hard bound on how long a provider poll may take.
 *
 * Extracted from `chatgpt.mjs`, where it was proven over several rounds of
 * review. The other providers each check their deadline only BETWEEN awaited
 * browser probes, so a single never-settling `page.evaluate`, `locator.all` or
 * CDP call defeats `--timeout` entirely — the loop never gets to look at the
 * clock again. Capping the sleeps does not help: the sleep is not where the
 * time goes.
 *
 * The race is the only thing that makes the bound real, because a stalled
 * probe cannot be cancelled. The losing work keeps running; what this
 * guarantees is that the CALLER stops waiting for it.
 */

/** How often the expiry timer re-checks the clock. */
const POLL_EXPIRY_CHECK_MS = 250;

/** Thrown or resolved so an expired run cannot deliver a normal envelope. */
export const POLL_EXPIRED = Symbol('poll-expired');

/**
 * Real elapsed time, immune to a mocked or frozen `Date.now`.
 *
 * @returns {number} milliseconds from an arbitrary origin
 */
export function monotonicNowMs() {
    return Number(process.hrtime.bigint() / 1_000_000n);
}

/**
 * @typedef {Object} PollDeadlineToken
 * @property {boolean} expired flipped once the caller has been answered
 * @property {number} hardDeadline reported-clock deadline in ms
 */

/**
 * Run `runFn` under a hard deadline and return its result, or `onExpired()`.
 *
 * `runFn` receives the deadline and a token whose `expired` flag is set the
 * moment the caller is answered. A run that is still mid-tick can read that
 * flag to refuse starting new side effects — the losing work is not cancelled,
 * so without the flag it would happily finish and write.
 *
 * @template T
 * @param {(hardDeadline: number, token: PollDeadlineToken) => Promise<T>} runFn
 * @param {{ startedAt?: number, monotonicStartMs?: number, timeoutMs: number, onExpired: () => T }} options
 * @returns {Promise<T>}
 */
export async function withPollDeadline(runFn, { startedAt, monotonicStartMs, timeoutMs, onExpired }) {
    // Default to now, but let the caller anchor earlier: work that can block —
    // a session store read, for instance — happens before this function is
    // reached and must not be free time.
    const started = startedAt === undefined ? Date.now() : startedAt;
    const monotonicStart = monotonicStartMs === undefined ? monotonicNowMs() : monotonicStartMs;
    const hardDeadline = started + timeoutMs;
    /** @type {any} */
    let expire = () => undefined;
    /** @type {any} */
    let timer = null;
    const expiry = new Promise(resolve => {
        expire = resolve;
        // Deferring to the reported clock ALONE is unbounded: a frozen or
        // mocked `Date.now` never reaches the deadline, so the timer re-arms
        // forever and the poll returns NOTHING — strictly worse than the
        // overrun this exists to prevent.
        //
        // Two independent ceilings, because `Date.now` is not trustworthy here:
        // tests step it, and a stalled or rewound system clock would otherwise
        // leave the deadline unreachable.
        //
        //   - the reported clock reaching `hardDeadline`
        //   - MONOTONIC time exceeding the same budget
        //
        // The monotonic one is what makes the promise real: whatever the clock
        // claims, the caller waits at most one budget plus a check interval.
        // Tests that step the clock faster than real time still finish on the
        // first ceiling, so they are not cut short.
        const monotonicCeilingMs = timeoutMs + POLL_EXPIRY_CHECK_MS;
        const arm = () => {
            const remaining = hardDeadline - Date.now();
            const monotonicElapsedMs = monotonicNowMs() - monotonicStart;
            if (remaining <= 0 || monotonicElapsedMs >= monotonicCeilingMs) { resolve(POLL_EXPIRED); return; }
            timer = setTimeout(arm, Math.min(remaining, POLL_EXPIRY_CHECK_MS));
        };
        arm();
    });
    /** @type {PollDeadlineToken} */
    const token = { expired: false, hardDeadline };
    try {
        const run = runFn(hardDeadline, token).then(
            // Normalise BOTH settlement paths before the race: a stalled promise
            // that settles just after the deadline can have its continuation
            // scheduled ahead of the timer, and would otherwise deliver a normal
            // result — or a normal error — past the bound.
            result => (Date.now() >= hardDeadline ? POLL_EXPIRED : result),
            err => (Date.now() >= hardDeadline || err === POLL_EXPIRED
                ? POLL_EXPIRED
                : Promise.reject(err)),
        );
        const outcome = await Promise.race([run, expiry]);
        if (outcome !== POLL_EXPIRED) return /** @type {T} */ (outcome);
        return onExpired();
    } finally {
        // Order matters: the loser may still be mid-tick, and this is what makes
        // its next side effect refuse to start instead of writing.
        token.expired = true;
        if (timer) clearTimeout(timer);
        expire(POLL_EXPIRED);
    }
}
