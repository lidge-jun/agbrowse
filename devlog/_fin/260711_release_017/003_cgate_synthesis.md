# C-gate synthesis

Reviewer: fresh Sol (`gpt-5.6-sol`, medium)
Round 1 verdict: FAIL

## Findings and dispositions

1. New `.codexclaw` history in the release tree: accepted. A corrective delete
   would still expose unpushed objects after push and would mutate intentionally
   recorded local provenance. The release is instead reconstructed on a clean
   `origin/dev` worktree by applying the committed product diff with
   `:(exclude).codexclaw`, then overlaying the explicit release manifest. The
   clean branch must have zero `.codexclaw` paths in `origin/dev..HEAD`.
2. Missing final evidence: accepted as phase timing, not rebutted. The review
   arrived while the full suite was still running. Evidence is written only
   after every gate completes. The first full run produced 1,428 passes with
   three failures: two local browser-executable environment failures and one
   stale frozen package manifest expectation. The manifest test is updated;
   browser smokes rerun against installed Chrome without downloading another
   Playwright browser.

## New release-contract regression

The package exclusion changes the frozen `package.json#files` contract, so
`test/integration/bin-shim-contract.test.mjs` now explicitly requires the
negated redesign path. The test is also added to the release staging manifest.

## Round 2 fold-back

Round 2 verdict: FAIL.

The clean worktree was correct, but the first staging manifest listed only the
dirty follow-up paths and omitted 89 files reconstructed from the committed
GPT-5.6/Work product diff. The manifest was regenerated from the complete union
of `git diff --name-only origin/dev` and untracked release files. It now contains
176 explicit leaf paths, including every Work runtime, GPT-5.6 fixture/test,
timeout, docs, extract, search, skill, release record, and Pages asset. It still
contains zero `.codexclaw/` paths.
