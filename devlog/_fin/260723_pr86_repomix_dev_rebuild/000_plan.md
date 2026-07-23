# 260723 PR #86 Repomix rebuild on dev — 000_plan

## Objective

PR #86 (fromiron, `feature/context-transform`, head 3b34d56) implements issue #85:
`--context-transform raw|repomix` for web-ai. The PR targets `main` (v0.1.18,
a03de27) but active development lives on `dev` (8 commits ahead of merge-base
5962d81, including the upload-reliability rewrite 19c793e and Oracle chase
hardening eb9e192). Merging to main would fork the feature and guarantee a
dev→main collision later. This unit rebuilds the PR on `dev`, merges it there,
closes PR #86 (superseded) and issue #85, and leaves dev deploy-ready
(release gates green; no publish/tag).

## Known blockers from pre-review (2026-07-23)

1. PR head fails its own new tests on macOS: 3x `test/unit/web-ai-context-transformer.test.mjs`
   + 1x `test/unit/web-ai-context-pack.test.mjs`. Root cause: tests compare
   `mkdtemp(join(tmpdir(), ...))` output (unresolved `/var/folders/...`) against
   implementation-side `fs.realpath` results (`/private/var/folders/...`).
   Fix is test-side: realpath the mkdtemp result in the temp-project helpers.
2. Merge conflicts vs dev (git merge-tree, 6 files):
   `web-ai/chatgpt.mjs`, `web-ai/chatgpt-attachments.mjs`,
   `web-ai/chatgpt-upload-surface.mjs`, `web-ai/cli.mjs`, `web-ai/gemini-live.mjs`,
   `test/unit/chatgpt-attachments.test.mjs`.
3. No CI ran on the PR (statusCheckRollup empty) — local verification substitutes.

## Environment baseline

`main` and the PR head share these environment-dependent failures on this machine
(no Chrome CDP): `test/integration/post-action-smoke.test.mjs`,
`test/integration/self-heal-smoke.test.mjs`, and
`test/integration/cli-lifecycle.test.mjs > stop falls back cleanly when persisted
PID is stale`. These are the accepted baseline, not regressions.

## Work-phase map (dependency-ordered)

| WP | Doc | Content |
|----|-----|---------|
| wp1 | this cycle | Docs-first roadmap (000/010/020/030), Sol plan-audit |
| wp2 | 010 | Rebuild: cherry-pick 8 commits onto dev, resolve 5-file conflicts, fix realpath tests, suite green |
| wp3 | 020 | Verify: release gates + Sol adversarial diff review |
| wp4 | 030 | Merge --no-ff to dev, push, close PR #86 + issue #85, deploy-prep gates |

## Out of scope

- npm publish / release tag / version bump.
- Issue #81 (ChatGPT GitHub connector popover) — unrelated.
- Functional redesign of the repomix feature itself; semantics follow the PR/issue contract.

## Terminal outcomes

DONE = dev HEAD has the feature, suite green (baseline excluded), gates pass,
PR #86 + issue #85 CLOSED, origin/dev updated. BLOCKED = push/GitHub failure.
UNSAFE = conflict resolution would change feature semantics.
