#  skills/browser/tab-lifecycle.mjsP27 

VERDICT-B per-file ts-check on 190-line tab lifecycle module. All deps already checked (tab-manager, session, tab-lease-store, active-command-store).

## Changes
- Add `// @ts-check`
- Reuse `ManagedTabRow` and `Lease` via `import('...')` typedefs.
- New typedefs: CleanupTab (extends ManagedTabRow), SelectTabsOptions, SelectProviderOptions, CleanupOptions, CleanupSummary.
- JSDoc on 8 exports + 2 helpers.
- `Readonly<Record<string,string>>` for PROVIDER_ORIGINS.
- `Set<string>` annotation on pinnedTabs and activeSessionTargetIds.
- `Set<string | null>` for `activeCommandTargetIds` to match `activeCommandTargetIds()` return shape.
- Inline cast `/** @type {string} */ (vendor)` in PROVIDER_ORIGINS lookup; the `if (!origin) return [];` guards a runtime-equivalent path.
- `await listLeases().catch(() => /** @type { comment-only cast on the existing fallback array.Lease[]} */ ([]))` 

## Runtime invariants
- No `Boolean(...)` wrappers added.
- No new `?.` introduced.
 number` keeps the same `String(value || '').trim()` pipeline.
- Append-only tsconfig.checkjs.json entry: `skills/browser/tab-lifecycle.mjs`.
