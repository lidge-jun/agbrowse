# 010 — Phase 1 (v0119-release-audit-fix)

> DIFFLEVEL-ROADMAP-01: write this doc to full diff-level precision (exact paths,
> NEW/MODIFY/DELETE, before/after diffs) BEFORE P -> A. An empty scaffold does not
> satisfy the rule; the A-phase reviewer FAILS outline-only phase docs.

## MODIFY / NEW / DELETE map

MODIFY `package-lock.json` (only file). Apply via `npm audit fix` on a clean
`main` checkout (`npm ci` first). Expected hunks (verified in the detached
worktree `tmp.EWNMJnxRwX/main-check` against `origin/main` = `1463a53`):

```diff
 "node_modules/brace-expansion": {
-  "version": "2.1.0",
+  "version": "2.1.4",
 "node_modules/nanoid": {
-  "version": "3.3.11",
+  "version": "3.3.17",
 "node_modules/postcss": {
-  "version": "8.5.12",
+  "version": "8.5.25",
   "dependencies": {
-    "nanoid": "^3.3.11",
+    "nanoid": "^3.3.16",
```

(plus matching `resolved`/`integrity` lines; 20 changed lines total.)

Then, in order:

1. `git switch main` in a worktree that is not the dirty `dev` checkout — use a
   dedicated worktree (`git worktree add <tmp> main`) to avoid touching dev's
   dirty state.
2. `npm ci && npm audit fix` -> confirm diff is lockfile-only, matching above.
3. Local gates mirroring release.yml order: `npm audit --audit-level=high`,
   `npm run typecheck`, `npm test`.
4. Commit: `fix(release): bump transitive brace-expansion/postcss past audited advisories` on `main`, push `origin main`.
5. `gh workflow run release.yml -f version=0.1.19 -f tag=latest -f dry-run=false`
6. `gh run watch <id>` to completion.

## TESTS

No new test files: the change is lockfile-only. Existing suites (`npm test`,
typecheck) must stay green locally and in CI; the release workflow's full gate
chain (mcp/source-audit/trace-policy/release-gates/eval fixtures/gate:all) is
the regression net.

## Verification (C)

- `npm audit --audit-level=high` -> exit 0 (esbuild low may remain)
- `gh run list --workflow=release.yml -L 1` -> `completed success`
- `npm view agbrowse version` -> `0.1.19`
- `gh release view v0.1.19` -> exists; `git ls-remote --tags origin v0.1.19` -> present
