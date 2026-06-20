# Fix 4 — Stale Target Ownership: Auto-Expire on Register

**Priority: P0** | **Status: implemented** | **Commit: ccb7051** | **Audit: Rounds 2-4 PASS**

## Files

| File | Action |
|------|--------|
| `web-ai/active-command-store.mjs` | MODIFY |

## Problem

When a command's TTL expires but it's never cleaned up, the ghost `running` entry blocks new commands from registering on the same tab target. This causes `target already owned by active command` errors.

## Diff

### MODIFY `web-ai/active-command-store.mjs`

```diff
     return withActiveCommandLock(async () => {
         const store = readStore();
         const nowMs = Date.now();
+        let changed = false;
+        store.commands = store.commands.map(row => {
+            if (row.status !== 'running') return row;
+            const expiresMs = Date.parse(row.expiresAt || '');
+            if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
+                changed = true;
+                return { ...row, status: 'expired', completedAt: new Date(nowMs).toISOString() };
+            }
+            return row;
+        });
+        if (changed) writeStore(store);
         const targetConflict = command.targetId
             ? store.commands.find(row =>
                 row.status === 'running' &&
-                Date.parse(row.expiresAt || '') > nowMs &&
                 row.targetId === command.targetId &&
                 row.commandId !== command.commandId)
             : null;
```

The expire sweep runs before conflict check, handling NaN `expiresAt` via `!Number.isFinite()`. The redundant `Date.parse` guard in `targetConflict` is removed since the sweep already expired those rows.
