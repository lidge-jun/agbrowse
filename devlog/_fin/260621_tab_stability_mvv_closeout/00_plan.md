# Tab Stability MVV Closeout Plan

Date: 2026-06-21
Branch: `dev-vision-upgrade`
Target: PR to `main`, stop before merge

## Objective

Close the remaining tab-stability work on `dev-vision-upgrade` with the
pressure-tested MVV only:

1. Record the active tab lease before binding the session to the tab.
2. Enforce active-session capacity caps: vendor 5, global 14, hard tab cap 20.
3. Reap active leases owned by dead OS processes.
4. Fix stale provider pool TTL docs from 15m to 30m.

Oracle follow-up stays out of scope. Issue `#79` is linked from the PR body with
`Closes #79`; the issue should close automatically only when the PR is merged.

## Current Evidence

- `devlog/_fin/260619_tab_parallel_stability/20_pressure_test_verdict.md`
  supersedes the earlier broad plan and keeps only MVV work.
- `web-ai/chatgpt.mjs`, `web-ai/gemini-live.mjs`, and
  `web-ai/grok-live.mjs` still bind session-to-tab before recording the durable
  active lease.
- `web-ai/cli.mjs` still calls `cleanupIdleTabs` with
  `maxTabs: Number.POSITIVE_INFINITY`.
- `web-ai/cli.mjs` and `skills/browser/browser.mjs` still document provider pool
  TTL as 15m even though the store default is 30m.
- GitHub issue `#79` is open and there is no existing PR from
  `dev-vision-upgrade` to `main`.

## Implementation Plan

### 1. Lease Store

Modify `web-ai/tab-lease-store.mjs`:

- Add `ownerPid` to `Lease` and `LeaseInput`.
- Add active cap defaults:
  - `AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY` default `5`.
  - `AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX` default `14`.
- Add `ProviderActiveCapacityError` with machine-readable fields.
- Make `recordActiveLease` fail fast when a new active lease would exceed the
  per-key or global active cap.
- Preserve replacement semantics for the same target or same session before
  counting, so rebinding an existing active lease does not self-fail.
- Persist `ownerPid`, defaulting to `process.pid`.
- Reuse the existing `isPidAlive` helper from `skills/browser/profile-lock.mjs`
  and make `cleanupLeasedTabs` mark active-session leases for close only when
  `ownerPid` is known and no longer alive.

### 2. Provider Send Paths

Modify:

- `web-ai/chatgpt.mjs`
- `web-ai/gemini-live.mjs`
- `web-ai/grok-live.mjs`

At each send/deep-research session creation site, record the active lease before
calling `bindSessionToTab`.

If active capacity is exceeded, the send path should fail before the session is
bound to the target. The durable session row may exist for diagnostic purposes,
but it must not claim ownership of a tab. The thrown error should carry a
stable code so CLI/MCP JSON error handling can surface the cap reason.

### 3. Tab Cap and Docs

Modify `web-ai/cli.mjs`:

- Replace `maxTabs: Number.POSITIVE_INFINITY` with the existing
  `DEFAULT_MAX_TABS` from `skills/browser/tab-lifecycle.mjs`.
- Update provider pool help text only for the stale TTL default:
  `TTL=15m` becomes `TTL=30m`. Pool `maxPerKey=3` and `globalMax=8` remain
  pool-specific defaults unless changed by `AGBROWSE_PROVIDER_POOL_*`.
- Add or update help text for active caps separately:
  `AGBROWSE_PROVIDER_ACTIVE_MAX_PER_KEY=5` and
  `AGBROWSE_PROVIDER_ACTIVE_GLOBAL_MAX=14`.

Modify `skills/browser/tab-lifecycle.mjs`:

- Change the canonical `AGBROWSE_MAX_TABS` default from `10` to `20` so
  browser cleanup and web-ai provider tab creation share one tab cap.

Modify `skills/browser/browser.mjs`:

- Update matching provider pool help text to keep `maxPerKey=3`,
  `globalMax=8`, and `TTL=30m`.
- Update `AGBROWSE_MAX_TABS` help to default `20`.

Modify user-facing docs that mention `AGBROWSE_MAX_TABS`:

- `README.md`
- `skills/web-ai/SKILL.md`

Also update `skills/web-ai/SKILL.md` if it still documents the stale provider
pool TTL as 15 minutes.

### 4. Tests

Modify `test/unit/tab-lifecycle.test.mjs`:

- Verify active lease records include `ownerPid`.
- Verify per-key active cap rejects the next new active lease.
- Verify global active cap rejects the next new active lease.
- Verify replacing the same active session does not trip the cap.
- Verify cleanup reaps an active lease with a dead `ownerPid`.

Add source-contract assertions where direct behavior is hard to isolate:

- send paths record active leases before `bindSessionToTab`.
- `ensureProviderTab` no longer uses `Number.POSITIVE_INFINITY` for tab cleanup.
- TTL docs no longer mention the stale `TTL=15m` provider-pool default.
- `AGBROWSE_MAX_TABS` docs and runtime default agree on `20`.

### 5. Devlog Move

After code and gates pass, move completed branch-closeout planning folders to
`devlog/_fin`:

- `devlog/_fin/260621_mcp_wait_response_recovery`
- `devlog/_fin/260621_tab_stability_mvv_closeout`
- `devlog/_fin/260619_tab_parallel_stability`

Keep Oracle follow-up plans in `_plan`.
Move `260621_mcp_wait_response_recovery` only if MCP acceptance gates pass,
because `#79` closure depends on the already-committed `d647d58` timeout
recovery work plus this branch PR, not on the tab-stability MVV alone.

## Verification Gates

Run:

```bash
npm run typecheck
npx vitest run test/unit/tab-lifecycle.test.mjs test/unit/web-ai-provider-session.test.mjs test/unit/web-ai-tool-schema.test.mjs
npm run test:mcp
npm run test:release-gates
git diff --check
```

Then run an independent read-only verification before commit/PR.

## Git/PR Plan

1. Commit implementation and devlog closeout as a stack commit on
   `dev-vision-upgrade`.
2. Push `dev-vision-upgrade` to `origin`.
3. Create a PR targeting `main`.
4. Include `Closes #79` in the PR body.
5. Stop before merge.
