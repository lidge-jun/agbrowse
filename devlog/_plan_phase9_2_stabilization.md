# Phase 9.2: Stabilization & GA Prep

## Version: 9.2.0
## Date: 2026-05-03
## Status: Planning

---

## 1. Problem Statement

Phase 9.1 implemented multi-tab core (create, bind, recover, serialize). Before GA we need:

1. **Tab creation overhead**: Every `send` creates a new tab. For batch jobs this is wasteful.
2. **Snapshot corruption**: `last-snapshot.json` is global; multi-tab snapshots overwrite each other.
3. **Idle timeout disabled**: `tab-lifecycle.mjs` has `cleanupIdleTabs` but `lastActiveAt` metadata is not tracked durably, so new CLI processes cannot reliably tell which tabs are unused.
4. **No concurrent multi-tab E2E validation**: We have unit tests but no integration test proving parallel send works.
5. **No cleanup UX**: Users can list and manually close tabs, but there is no single command that explains and cleans idle/overflow tabs.

---

## 2. Design Goals

1. **Tab pooling**: Reuse recently-closed vendor tabs instead of creating new ones
2. **Per-tab snapshot isolation**: Store snapshots per targetId
3. **Idle timeout activation**: Track `lastActiveAt` per tab, enable 30-min auto-close
4. **Cleanup UX**: Add `tab-cleanup` plus `tabs --json` idle metadata so users can inspect and clean unused tabs intentionally
5. **E2E parallel send test**: Prove ChatGPT + Gemini + Grok can send simultaneously
6. **Update SKILL.md**: Document multi-tab behavior for agents

---

## 3. Implementation Plan

### PR1: Tab Pooling

**New file:** `web-ai/tab-pool.mjs`

```javascript
const pool = new Map(); // vendor -> [{ targetId, url, closedAt }]

export async function getPooledTab(port, vendor) {
    // Find a recently closed tab for this vendor that is still alive
    // If found, navigate to requested URL and return it
    // Otherwise return null
}

export function releaseTabToPool(port, vendor, targetId, url) {
    // Mark a tab as poolable when session completes
}
```

**Modified:** `skills/browser/tab-manager.mjs`
- Add `listClosedTabs()` or track closed tabs

**Modified:** `web-ai/cli.mjs`
- In `ensureProviderTab`, try pool before `createTab`

### PR2: Per-Tab Snapshot Isolation

**Modified:** `skills/browser/browser.mjs`
- Change `SNAPSHOT_FILE` from global to per-tab:
  `join(homedir(), '.browser-agent', 'snapshots', `${targetId}.json`)`

**Modified:** `web-ai/ax-snapshot.mjs`
- Accept optional `targetId` parameter
- Use per-tab path when `targetId` is provided

**Modified:** `skills/browser/browser.mjs` snapshot command
- Pass targetId through to snapshot builder

### PR3: Idle Timeout Activation

**Modified:** `skills/browser/tab-manager.mjs`
- Persist `lastActiveAt` to `$BROWSER_AGENT_HOME/tab-activity.json`
- `listManagedTabs()` returns real `lastActiveAt` metadata across CLI processes
- Track last activity on `createTab`, `switchToTab`

**Modified:** `skills/browser/tab-lifecycle.mjs`
- Remove "disabled" comment
- Enable idle timeout check in `cleanupIdleTabs`
- Add pure cleanup candidate selection for unit coverage

**Modified:** `skills/browser/browser.mjs`
- `tabs --json` exposes `lastActiveAt`, `idleForMs`, and pinned state
- `tab-cleanup [--idle-after <duration>] [--max-tabs <N>] [--include-untracked] [--json]`
- Human `tabs` output points users to `tab-cleanup`

**Modified:** `web-ai/tab-recovery.mjs`
- Update `lastActiveAt` on every `withSessionPage` access

### PR4: E2E Parallel Send Test

**New file:** `test/e2e/multi-tab-parallel.test.mjs`

```javascript
// Uses fake/fixture pages or real providers in headed mode
// Verifies:
// 1. Three tabs created for three simultaneous sends
// 2. Each session bound to distinct targetId
// 3. No context contamination between tabs
```

### PR5: SKILL.md Update

**Modified:** `skills/browser/SKILL.md`
- Add multi-tab section
- Document `--new-tab` / `--reuse-tab`
- Document tab limits and auto-close

---

## 4. File Changes

### New Files (2)

| File | Purpose |
|------|---------|
| `web-ai/tab-pool.mjs` | Reuse closed vendor tabs |
| `test/e2e/multi-tab-parallel.test.mjs` | Parallel send E2E |

### Modified Files (6)

| File | Changes |
|------|---------|
| `skills/browser/browser.mjs` | Per-tab snapshot path |
| `skills/browser/tab-manager.mjs` | Track `lastActiveAt` |
| `skills/browser/tab-lifecycle.mjs` | Enable idle timeout |
| `skills/browser/browser.mjs` | Add cleanup UX and tab idle visibility |
| `web-ai/ax-snapshot.mjs` | Accept `targetId` |
| `web-ai/cli.mjs` | Try pool before create |
| `skills/browser/SKILL.md` | Document multi-tab |

---

## 5. Exit Criteria

- [ ] Tab pool reduces new tab creation by 50% in batch scenarios
- [ ] Snapshot files stored per targetId, no global overwrite
- [ ] Idle tabs auto-close after 30 minutes
- [ ] `tab-cleanup` gives users an explicit way to clean idle/overflow tabs
- [ ] E2E test: 3-provider parallel send passes
- [ ] SKILL.md documents multi-tab behavior
- [ ] All tests pass (unit + integration + e2e)

---

## 6. Risks

| Risk | Mitigation |
|------|-----------|
| Pool reuses wrong tab (wrong vendor/URL) | Verify vendor match, navigate before return |
| Snapshot path migration breaks existing tools | Keep global fallback for 1 release |
| Idle timeout closes active watcher tab | Exclude pinned / active-session tabs |
| E2E test flaky with real providers | Use fixture pages, skip in CI |
