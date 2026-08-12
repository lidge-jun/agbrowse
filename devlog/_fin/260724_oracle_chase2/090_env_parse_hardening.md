# 090 — Provider lease env parsing hardening

Date: 2026-07-24  
Format: `DIFFLEVEL-ROADMAP-01`  
Upstream mechanism: `a1aa4328`

## Objective

Replace permissive module-level `parseInt` parsing for provider lease limits with strict decimal-integer parsing. Invalid environment values must deterministically fall back to the documented default instead of accepting prefixes, decimals, exponents, non-finite numbers, or unsafe integer overflow.

## Gaps covered

| Gap | Closure |
| --- | --- |
| G34 | Strictly parse active and pool limit environment variables, preserving the pool's deliberate zero-disables behavior while requiring active caps to be positive. |

## File change map

| Path | Action | Function / section | Verified current anchor |
| --- | --- | --- | --- |
| `web-ai/tab-lease-store.mjs` | MODIFY | module defaults; new exported `parseProviderLimitEnv` beside constants; existing `normalizeLimit` consumption remains unchanged | numeric env reads `:69-73`; active defaults consumed `:255-256`; pool zero-disable branch `:319-359`; cleanup defaults `:388-389`; active cap checks `:493-533` |
| `test/unit/tab-lifecycle.test.mjs` | MODIFY | provider lease env parser cases in `tab lifecycle cleanup selection` | suite begins `:8`; lease-store source assertions `:159-168,183-193` |

## Numeric env inventory and semantics

| Environment variable | Current read | Default | Valid domain after change | Consumption / zero semantics |
| --- | --- | ---: | --- | --- |
| `AGBROWSE_PROVIDER_POOL_TTL` | `parseDuration(... || '30m')` at `tab-lease-store.mjs:69` | `30m` | Existing duration grammar | Not an integer-limit read; keep unchanged. `0` duration means immediate expiry, not pool disable. |
| `AGBROWSE_PROVIDER_POOL_MAX_PER_KEY` | `parseInt(... || '3', 10)` at `:70` | `3` | non-negative safe decimal integer | Preserve deliberate `0` disable: `releaseCompletedLease` sets `leaseDisposition: 'close'` and closes instead of pooling at `:327-347`. |
| `AGBROWSE_PROVIDER_POOL_GLOBAL_MAX` | `parseInt(... || '8', 10)` at `:71` | `8` | non-negative safe decimal integer | Preserve `0`: overflow selection keeps zero pooled tabs via `slice(Math.max(0, globalMax))` at `:561-566`. |
| `AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY` | `parseInt(... || '5', 10)` at `:72` | `5` | positive safe decimal integer | `0` must be invalid and fall back to `5`; `assertActiveCapacity` treats zero as immediate rejection at `:499-511`, not disable. |
| `AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX` | `parseInt(... || '14', 10)` at `:73` | `14` | positive safe decimal integer | `0` must be invalid and fall back to `14`; `assertActiveCapacity` treats zero as immediate rejection at `:513-523`, not disable. |

`AGBROWSE_PROVIDER_POOL_TTL` is enumerated because it is the sibling numeric/duration env read in the same block, but it is intentionally outside this integer parser: values such as `30m` are valid by contract.

## Proposed diffs

### 1. Add one strict parser and replace four permissive reads

Before (`web-ai/tab-lease-store.mjs`, current lines 65-73):

```js
const STORE_VERSION = 1;
const LOCK_RETRY_MS = 25;
const LOCK_RETRY_LIMIT = 200;
const STALE_LOCK_MS = 30_000;
const DEFAULT_POOL_TTL_MS = parseDuration(process.env.AGBROWSE_PROVIDER_POOL_TTL || '30m');
const DEFAULT_POOL_MAX_PER_KEY = parseInt(process.env.AGBROWSE_PROVIDER_POOL_MAX_PER_KEY || '3', 10);
const DEFAULT_POOL_GLOBAL_MAX = parseInt(process.env.AGBROWSE_PROVIDER_POOL_GLOBAL_MAX || '8', 10);
const DEFAULT_ACTIVE_MAX_PER_KEY = parseInt(process.env.AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY || '5', 10);
const DEFAULT_ACTIVE_GLOBAL_MAX = parseInt(process.env.AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX || '14', 10);
```

After:

```js
const STORE_VERSION = 1;
const LOCK_RETRY_MS = 25;
const LOCK_RETRY_LIMIT = 200;
const STALE_LOCK_MS = 30_000;

/**
 * Parse a decimal integer environment limit without accepting numeric prefixes.
 * Pool limits may deliberately use zero to disable pooling; active limits may not.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @param {{ allowZero?: boolean }} [options]
 * @returns {number}
 */
export function parseProviderLimitEnv(value, fallback, options = {}) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return fallback;
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) return fallback;
    if (options.allowZero ? parsed < 0 : parsed <= 0) return fallback;
    return parsed;
}

const DEFAULT_POOL_TTL_MS = parseDuration(process.env.AGBROWSE_PROVIDER_POOL_TTL || '30m');
const DEFAULT_POOL_MAX_PER_KEY = parseProviderLimitEnv(
    process.env.AGBROWSE_PROVIDER_POOL_MAX_PER_KEY,
    3,
    { allowZero: true },
);
const DEFAULT_POOL_GLOBAL_MAX = parseProviderLimitEnv(
    process.env.AGBROWSE_PROVIDER_POOL_GLOBAL_MAX,
    8,
    { allowZero: true },
);
const DEFAULT_ACTIVE_MAX_PER_KEY = parseProviderLimitEnv(
    process.env.AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY,
    5,
);
const DEFAULT_ACTIVE_GLOBAL_MAX = parseProviderLimitEnv(
    process.env.AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX,
    14,
);
```

The explicit `Number.isSafeInteger` check is the overflow boundary. `Number.isFinite` alone would still accept huge rounded integer values; environment caps must remain exactly representable.

Do not change `normalizeLimit` at current lines 529-533. It handles explicit programmatic `LeaseInput` overrides, while this phase hardens environment parsing only. Keeping those boundaries separate avoids silently changing tests/callers that intentionally pass numeric override values.

### 2. Focused table-driven unit tests

Add `parseProviderLimitEnv` to the existing import from `tab-lease-store.mjs`, then add:

```js
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
});
```

Add source-contract assertions that each of the four environment names is passed through `parseProviderLimitEnv` and that no `parseInt(process.env.AGBROWSE_PROVIDER_` remains. Behavioral pool tests already cover close-vs-pool logic; retain them unchanged.

## Test plan

1. `npx vitest run test/unit/tab-lifecycle.test.mjs` — strict parser matrix plus existing pool/active capacity behavior.
2. `npm run typecheck:checkjs` — exported helper JSDoc and call-site options.
3. `rg -n "parseInt\(process\.env\.AGBROWSE_PROVIDER_|AGBROWSE_PROVIDER_(POOL|ACTIVE).*MAX" web-ai/tab-lease-store.mjs test/unit/tab-lifecycle.test.mjs` — prove permissive reads are gone and all four limits are covered.
4. `git diff --check` — whitespace and patch integrity.

## Accept criteria

- Active cap env values are trimmed, match `^\d+$`, convert to a finite safe integer, and are strictly greater than zero; otherwise they fall back to `5`/`14`.
- Pool max env values use the same grammar and finite/safe checks, but preserve valid zero; otherwise they fall back to `3`/`8`.
- Whitespace-wrapped valid integers work; zero, negative, decimal, exponent, suffix, overflow, and empty input have explicit tests.
- `AGBROWSE_PROVIDER_POOL_TTL` remains on its duration parser with default `30m`.
- No caller-visible lease shape, error envelope, or explicit `LeaseInput` normalization changes.

### C-ACTIVATION-GROUNDING-01 scenarios

| Conditional | Activation scenario | Required evidence |
| --- | --- | --- |
| Trim | env is ` 7 ` | Active parser returns `7`. |
| Positive-only active limit | either active env is `0` | Corresponding default (`5` or `14`) is used, preventing accidental capacity lockout. |
| Pool zero-disable | either pool max env is `0` | Parsed value remains `0`; per-key release closes immediately and global overflow retains zero pooled tabs. |
| Decimal grammar | env is `2.5` | Default is used; prefix `2` is never accepted. |
| Exponent grammar | env is `1e2` | Default is used; `100` is never inferred. |
| Suffix grammar | env is `5junk` | Default is used; prefix `5` is never accepted. |
| Negative grammar | env is `-1` | Default is used. |
| Overflow boundary | env is greater than `Number.MAX_SAFE_INTEGER` | Default is used because exact integer representation is not guaranteed. |
| Missing/empty | env is unset or whitespace-only | The variable's stated default is used. |
| Duration sibling | TTL env is `30m` | Existing duration parser still returns 30 minutes; integer parser is not invoked. |

## Risks / rollback

- Risk: users relying on permissive values such as `5tabs`, `2.5`, or `1e2` will now receive defaults. This is the intended hardening; document strict decimal syntax if these envs are exposed in operator docs later.
- Risk: treating pool zero as invalid would break the existing disable switch. Mitigation: `allowZero: true` is explicit only at the two pool call sites and has dedicated tests.
- Risk: exporting a parser enlarges module surface. It is a narrow deterministic pure function used for direct tests; no new module is introduced.
- Rollback: restore the four `parseInt` expressions and remove the helper/tests. No persisted lease migration is involved because defaults are evaluated at process startup only.
