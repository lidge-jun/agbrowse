# 005 — Tab lifecycle and concurrency parity (T8 + T10)

Date: 2026-07-24
Scope: Oracle chase round 3, upstream commits `653c621b`, `3fbf0b51`, and `a1aa4328`

## Upstream mechanisms

### T8 — close completed serve-owned tabs

Oracle's remote `serve` path keeps the authenticated shared Chrome process alive by forcing `keepBrowser`, but it separately records whether the client explicitly asked to retain the browser. Under manual-login service operation it now passes `closeOwnedTabOnComplete` unless the client requested retention (`src/remote/server.ts:268-303`). A **serve-owned tab** is therefore a newly created run target owned by that service invocation, not an existing target to which the run attached; the option contract explicitly excludes incomplete and attached-existing tabs (`src/browser/types.ts:143-149`).

The completed target is closed only when all of these hold: the run reached `complete`, the run owns the target, and either ordinary `keepBrowser` is false or the service cleanup policy is true (`src/browser/index.ts:860-872`). In the shared-Chrome case Oracle first ensures another page target exists, closes and confirms disappearance of the owned target, and creates a replacement if retention cannot be verified (`src/browser/index.ts:2428-2472`; `src/browser/chromeLifecycle.ts:561-651`). Cleanup runs inside the lease-release callback, after stale leases are pruned and while the registry lock establishes whether this was the last active lease (`src/browser/tabLeaseRegistry.ts:156-171`; `src/browser/index.ts:2473-2485`). Incomplete runs remain open for reattach, attached/user-owned targets remain untouched, and final blank-tab cleanup occurs only after the last lease while preserving one page target (`src/browser/index.ts:873-893`; `src/browser/index.ts:2451-2468`).

The leak fixed by `653c621b` was one renderer/tab retained per successful remote-service request: `serve` had to keep shared Chrome alive, and the old cleanup predicate interpreted that process-lifetime `keepBrowser` as a reason to retain every completed run-owned tab. The new policy separates Chrome-process ownership from per-run tab ownership.

### T10 — tab-concurrency environment override and validation

`3fbf0b51` adds `ORACLE_BROWSER_MAX_CONCURRENT_TABS` as an environment fallback with precedence **explicit resolved config / CLI-derived config > environment > default** (`src/browser/config.ts:81-83`; `src/browser/config.ts:123-125`). CLI `--browser-max-concurrent-tabs` is parsed into `maxConcurrentTabs` before resolution (`src/cli/browserConfig.ts:229`).

After `a1aa4328`, an environment value is accepted only when:

- the raw value is present;
- surrounding whitespace is removed;
- the entire trimmed value matches `^\d+$` (ASCII decimal digits only; no sign, decimal, exponent, suffix, or embedded whitespace);
- conversion with `Number` produces an integer greater than zero.

Empty/whitespace-only, `0`, negative, fractional, exponent, suffixed, non-numeric, non-integer, and non-finite/overflow values return `null`, so resolution falls through to the default. There is no explicit upper bound (`src/browser/config.ts:182-190`).

## agbrowse current state

### Completed-tab ownership and lifecycle

- `agbrowse web-ai mcp-server` is a long-running stdio server: it reads and handles messages until stdin closes (`web-ai/cli.mjs:54-64`; `web-ai/mcp-server.mjs:448-465`). However, the server itself uses caller-supplied `deps.getPage()` / `deps.getTargetId()` and serializes work for that target; it has no Oracle-style per-request `serve` ownership flag or `closeOwnedTabOnComplete` policy (`web-ai/mcp-server.mjs:233-238`; `web-ai/mcp-server.mjs:361-371`).
- CLI tab acquisition cleans leases/idle tabs, reuses a pooled or inactive provider tab when possible, and otherwise creates a fresh target (`web-ai/cli.mjs:1076-1100`). Thus agbrowse has durable session/tab ownership, but not the narrower Oracle distinction “remote service created this target for exactly this request while retaining shared Chrome.”
- Successful finalization marks the durable session complete and hands its active lease to `poolTab` (`web-ai/tab-finalizer.mjs:50-72`; `web-ai/tab-finalizer.mjs:105-115`; `web-ai/tab-pool.mjs:49-63`). Completion therefore does **not** normally close the tab immediately.
- `releaseCompletedLease` converts the current active-session lease to a pooled lease. Pooling can be disabled with a zero per-key limit; otherwise expired and per-key/global overflow leases are selected and closed (`web-ai/tab-lease-store.mjs:316-359`). The close operation uses CDP and removes confirmed-closed leases while retaining failed closes for retry/accounting (`web-ai/tab-lease-store.mjs:590-616`).
- The default warm-pool bounds are TTL 30 minutes, three tabs per lease key, and eight globally; all are environment-configurable (`web-ai/tab-lease-store.mjs:69-73`). The CLI documents that completed tabs are runtime leases rather than history storage and that expired/overflow tabs are closed (`web-ai/cli.mjs:241-251`). This bounded reuse policy covers the underlying completed-tab accumulation risk, although its product policy intentionally differs from Oracle's immediate close.

### Concurrency configuration

- `tab-pool.mjs` contains no hardcoded cap of its own; it forwards optional `maxPerKey` and `globalMax` values to the durable lease store (`web-ai/tab-pool.mjs:16-25`; `web-ai/tab-pool.mjs:49-63`).
- The authoritative store has configurable warm-pool caps (`AGBROWSE_PROVIDER_POOL_MAX_PER_KEY`, default 3; `AGBROWSE_PROVIDER_POOL_GLOBAL_MAX`, default 8) and active-session concurrency caps (`AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY`, default 5; `AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX`, default 14) (`web-ai/tab-lease-store.mjs:69-73`). Active acquisition enforces both the lease-key and owner/profile-global limits and throws a structured capacity error (`web-ai/tab-lease-store.mjs:243-261`; `web-ai/tab-lease-store.mjs:493-523`).
- The environment convention is direct `process.env.AGBROWSE_*` module-level fallback; `session.mjs` also uses `process.env.BROWSER_AGENT_HOME` for persistent state (`web-ai/session.mjs:54-57`). The CLI exposes these tab-cap environment names in help (`web-ai/cli.mjs:241-248`).
- Validation is weaker than upstream: each cap is read with `parseInt(raw || default, 10)`, so malformed prefixes such as `3tabs` are silently accepted as `3`, while malformed values yielding `NaN` become `-1` in `normalizeLimit` and effectively disable that active bound (`web-ai/tab-lease-store.mjs:69-73`; `web-ai/tab-lease-store.mjs:529-533`). Pool selection also consumes the raw parsed values (`web-ai/tab-lease-store.mjs:540-565`).

## Classification

| Theme | Mechanism | Classification | Priority | Evidence / concrete action |
| --- | --- | --- | --- | --- |
| T8 | Oracle-style immediate close of a completed **serve-owned** request tab while shared Chrome remains alive | **Not-applicable** | P3 defer | agbrowse's long-running MCP loop exists (`web-ai/mcp-server.mjs:448-465`), but it operates on supplied/shared page dependencies and has no per-request service-owned target policy (`web-ai/mcp-server.mjs:233-238`, `web-ai/mcp-server.mjs:361-371`). Do not add an Oracle ownership flag unless MCP later creates isolated targets per request. |
| T8 | Prevent completed owned/session tabs from accumulating indefinitely | **Covered** | P1 risk covered | Completion transfers the current active lease into a bounded warm pool (`web-ai/tab-finalizer.mjs:105-115`; `web-ai/tab-lease-store.mjs:316-359`); TTL/overflow cleanup closes tabs through CDP (`web-ai/tab-lease-store.mjs:590-616`). This is intentional reuse rather than immediate close. |
| T10 | Environment override for active tab-concurrency cap | **Covered** | P2 hardening covered | Active per-key/global caps are configurable through `AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY` and `AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX` (`web-ai/tab-lease-store.mjs:72-73`) and enforced at lease acquisition (`web-ai/tab-lease-store.mjs:493-523`). |
| T10 | Reject malformed/non-positive concurrency environment values as a whole token | **Gap** | P2 hardening | Replace module-level `parseInt` reads in `web-ai/tab-lease-store.mjs:70-73` with one strict positive-decimal parser (trim, `^\d+$`, finite integer, `> 0`) and define explicit fallback behavior; add focused tests for whitespace, zero, negative, decimal, exponent, suffix, overflow, and valid integers. Preserve a deliberate separate rule if `0` must continue to disable pooling. |

## Proposed gap rows

- `G-T8-SERVE-OWNERSHIP | immediate close of completed serve-owned request tab | Not-applicable | web-ai/mcp-server.mjs | long-running loop at web-ai/mcp-server.mjs:448-465, but no per-request target ownership at web-ai/mcp-server.mjs:233-238 and 361-371`
- `G-T8-COMPLETED-LEASE-CLEANUP | bound and close completed session tabs | Covered | web-ai/tab-lease-store.mjs | pooled completion and overflow/expiry close at web-ai/tab-lease-store.mjs:316-359 and 590-616`
- `G-T10-ACTIVE-CAP-ENV | environment override for active tab concurrency | Covered | web-ai/tab-lease-store.mjs | env defaults at web-ai/tab-lease-store.mjs:72-73; enforcement at 493-523`
- `G-T10-STRICT-ENV | reject malformed/non-positive tab-cap environment values | Gap | web-ai/tab-lease-store.mjs | parseInt accepts malformed prefixes at web-ai/tab-lease-store.mjs:70-73 and NaN normalizes to an unbounded sentinel at 529-533`
