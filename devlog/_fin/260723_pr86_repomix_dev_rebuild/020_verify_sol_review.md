# 020 — wp3: Verify (release gates + Sol adversarial review)

## Gates (must all PASS on the rebuild branch)

```bash
npm run gate:typecheck
npm run docs:counts
npm run docs:drift
```

`structure/` snapshots were refreshed by the PR on a main base; after the dev
rebuild, re-run `npm run fix:counts` if docs:counts fails and commit the refresh.

## Sol review packet

Dispatch via agbrowse web-ai:

```bash
agbrowse web-ai status --vendor chatgpt --json   # readiness preflight
agbrowse web-ai query --vendor chatgpt --model thinking --effort high \
  --family gpt-5.6-sol --isolated \
  --system "You are an adversarial code reviewer. Find correctness bugs, lost \
behaviors from either parent, and contract violations. End with a normalized \
final line: VERDICT: PASS | GO-WITH-FIXES (blockers=N) | FAIL, plus numbered blockers." \
  --file /tmp/pr86-dev-rebuild.diff \
  --prompt "Review this diff: PR #86 (Repomix context transform) rebuilt onto dev \
whose upload pipeline was rewritten (size-aware timeouts, fail-closed sent \
verification). Contract: raw default unchanged; repomix opt-in; artifacts uploaded \
directly, order+names preserved; selector cap requires repomix>=1.0.0; staging-root \
confinement; symlink escapes rejected; Grok unsupported."
```

`/tmp/pr86-dev-rebuild.diff` = `git diff origin/dev...HEAD`.

## Blocker handling

- PASS / GO-WITH-FIXES: fold or rebut each blocker in the D record, proceed.
- FAIL: repair loop per LOOP-REPAIR-01 (2 failed repairs → root-cause mode),
  re-review with the same Sol session thread if available, else fresh isolated run.
