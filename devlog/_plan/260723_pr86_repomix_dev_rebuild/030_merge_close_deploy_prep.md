# 030 — wp4: Merge, close, deploy-prep

## Merge + push (user pre-approved this scope: "머지하고 … 이슈랑 pr도 닫고")

```bash
git checkout dev && git merge --no-ff codex/pr86-repomix-on-dev \
  -m "feat(web-ai): Repomix context transform — rebuild of #86 on dev"
git push origin dev
```

Remote check: `gh api repos/:owner/:repo/branches/dev --jq .commit.sha` equals
local `git rev-parse dev`.

## Close PR #86 (superseded, not merged)

Comment (English, evidence-backed) then `gh pr close 86`:
state that the feature landed on dev via the rebuild branch (name merge sha),
why (PR base was main while active development moved to dev; conflicts with the
upload-reliability rewrite; macOS realpath test failures fixed during rebuild),
and credit fromiron's commits as preserved via cherry-pick.

## Close issue #85

Comment referencing the dev merge sha + that the acceptance criteria are
implemented on dev, then `gh issue close 85`.

## Deploy-prep (no publish)

```bash
npm run test:release-gates   # on dev HEAD
```

PASS = dev is deploy-ready; record output. Do NOT run release.ts / npm publish /
version bump — out of scope.

## D-phase records

- Move this unit folder docs to `devlog/_fin/` per repo convention after close-out.
- Goalplan criteria c-merged-pushed / c-pr-issue-closed / c-deploy-ready get
  capturedEvidence from the commands above.
