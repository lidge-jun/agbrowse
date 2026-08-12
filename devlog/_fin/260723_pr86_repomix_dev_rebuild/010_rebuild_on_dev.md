# 010 — wp2: Rebuild PR #86 on dev

## Branch + cherry-pick

Branch `codex/pr86-repomix-on-dev` from `origin/dev`. Cherry-pick, preserving
fromiron authorship, in order:

1. 29d2038 Add optional context transform pipeline
2. a90c769 Expose context transform in web-ai CLI
3. 5232a6b Document context transform modes
4. e276241 Refresh repository structure snapshots
5. ff063f0 Harden context transform validation
6. ae32475 Finalize Repomix context transform support
7. dc26011 Harden Repomix selector and inline rendering
8. 3b34d56 Harden Repomix attachment and config reporting

Squash is NOT used (attribution). If cherry-pick granularity fights the
conflicts, fall back to a single `git merge origin/pr-86` on the branch and
resolve once — same tree either way; prefer cherry-pick, note the fallback in D.

## Conflict resolution invariants (STRICT — dev behavior wins where they collide)

### web-ai/chatgpt-attachments.mjs + web-ai/chatgpt-upload-surface.mjs + web-ai/chatgpt.mjs

dev (19c793e) rewrote upload with size-aware timeouts:
- KEEP dev signatures: `computeAttachmentTimeouts(files, options)` → budgets
  (`handoffMs`, `totalBytes`), `setInputFilesResilient(page, inputSel, paths,
  { timeoutMs, totalBytes, ... })`, `setFilesViaUploadSurface(..., uploadTarget,
  { uploadTimeoutMs, totalBytes })`.
- KEEP dev fail-closed sent-verification.
- GRAFT from the PR: repomix multi-artifact upload path — artifacts uploaded
  directly (NOT re-zipped), filename + Repomix order preserved, and the
  `waitForChatGptRepomixAttachmentCount`-style sent verification for N artifacts.
- Every NEW repomix upload call site must route through dev's timeout budget
  helpers; no raw `setInputFiles` without budgets survives.

### web-ai/cli.mjs

KEEP both: PR's `--context-transform raw|repomix` parsing/validation and any
dev-side CLI changes since merge-base. Default stays `raw`; raw mode must not
touch/import Repomix (issue #85 contract).

### web-ai/gemini-live.mjs

PR adds repomix artifact upload for Gemini; dev touched adjacent live paths.
KEEP dev's live-session flow, GRAFT multi-artifact upload. Grok paths stay
repomix-unsupported per issue contract.

### test/unit/chatgpt-attachments.test.mjs

dev added ~51 lines of timeout-config tests (dee7122); the PR adds ~130 lines
of repomix attachment tests. KEEP dev's timeout-config coverage, GRAFT the PR's
repomix attachment tests — an ours/theirs shortcut that drops either side is a
resolution failure. Both sets must run green in C.

## Realpath test fix (MODIFY, test-side only)

`test/unit/web-ai-context-transformer.test.mjs` `createTemporaryProject()` and
the temp-dir helper used by `test/unit/web-ai-context-pack.test.mjs`:

```js
// before
const cwd = await mkdtemp(join(tmpdir(), prefix));
// after
const cwd = await realpath(await mkdtemp(join(tmpdir(), prefix)));
```

(import `realpath` from `node:fs/promises`). Also realpath the `pathRoot` decoy
mkdtemp in the "prefers the project-local package" test if it feeds assertions.
Implementation code is NOT changed for this — realpathing cwd is correct behavior.

## Accept criteria (C-phase)

- `npx vitest run` on the branch: only the environment baseline failures remain
  (post-action-smoke, self-heal-smoke, cli-lifecycle stale-PID — same as main).
- `rg "setInputFilesResilient\("` shows all upload call sites (raw + repomix)
  passing timeout budgets.
- `node bin/agbrowse.mjs web-ai context-dry-run --context-transform raw --json`
  works without Repomix installed (no repomix import in raw path).
