# A-gate audit synthesis

Reviewer: Sol (`gpt-5.6-sol`, medium)
Round 1 verdict: FAIL

## Blocker dispositions

1. Existing `.codexclaw` history: accepted in part. The plan's original claim
   that orchestration state was wholly out of scope was false because commits
   `2615c0f` and `bd8f8f1` already contain evidence/session files. The amended
   boundary preserves committed provenance, blocks every additional dirty
   `.codexclaw` path from staging, and verifies zero npm package entries. A
   destructive history rewrite or repository deletion is rebutted as outside
   the requested release and unsafe for shared history.
2. Commit range: accepted. Replaced ambiguous `6b1fbe6..bd8f8f1` with
   `origin/dev..bd8f8f1` and named `6b1fbe6` as the first included commit.
3. `dev` versus `main`: accepted. Build/push happens on `dev`; publishing uses a
   separate clean worktree that fast-forwards `main` and invokes the repository's
   OIDC release script.
4. npm design-asset leak: accepted. Add an explicit package exclusion and assert
   all 42 paths disappear from the pack manifest.
5. Staging strategy: accepted. Use an explicit release path manifest and assert
   no cached `.codexclaw` path before commit.
6. Auth boundary: accepted. Replaced local npm/OTP handling with GitHub Actions
   trusted-publisher/OIDC workflow evidence.
7. Post-publish proof: accepted. Added latest dist-tag verification, registry
   install/bin smoke, GitHub tag/release verification, and dist-tag rollback.

## Cross-blocker resolution

The clean-main requirement and dirty local orchestration state are resolved
together by publishing from a separate worktree after the explicit dev commit.
The package leak and already-committed `.codexclaw` evidence are distinct:
`package.json` allowlisting already excludes `.codexclaw`, while the new
negative devlog pattern removes only non-runtime design evidence from npm.

## Round 2 fold-back

Round 2 verdict: GO-WITH-FIXES (blockers=3).

1. Staging determinism: accepted. Added checked
   `002_release_paths.txt`, the exact `git add --pathspec-from-file` command,
   cached-path allowlist assertion, and explicit exclusions for `.codexclaw`
   and the orphaned vision QA fixture.
2. Pack determinism: accepted. Named the exact negated `package.json#files`
   entry, intentionally included devlog subtrees, and filesystem-only untracked
   subtree failure rule.
3. Registry smoke isolation: accepted. Added `mktemp`, prefix installation,
   direct `$tmp/node_modules/.bin/*` execution, installed package version check,
   and scoped cleanup.
