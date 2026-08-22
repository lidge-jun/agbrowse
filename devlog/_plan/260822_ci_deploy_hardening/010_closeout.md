# 010 - Closeout: CI/deploy hardening

## What changed

### .github/workflows/release.yml
- actions/checkout v4.3.1, actions/setup-node v4.0.2: SHA-pinned (mutable tag refs were the tj-actions attack vector)
- Removed npm install -g npm@latest (unpinned supply-chain surface)
- Added npm/node version assert: npm >=11.5.1 AND node >=22.14.0 (npm trusted-publishers docs requirement; reviewer blocker folded)
- Added permissions rationale comments (contents/id-token/actions scopes explained)

### .github/workflows/contract-drift.yml
- Added permissions: contents: read (was inheriting repo default — least-privilege violation)
- Added concurrency group with cancel-in-progress
- Added timeout-minutes: 15
- SHA-pinned both actions

### .github/workflows/pages.yml
- SHA-pinned all 6 action refs (checkout, setup-node, configure-pages, upload-pages-artifact, deploy-pages)
- Added timeout-minutes: 15 on validate + deploy jobs

## Release script audit (read-only, no changes needed)

- scripts/release.sh gate ordering correct under set -euo pipefail (reviewer confirmed lines 166-172)
- release-preview.sh delegates to release.sh via exec — failure propagates
- Pre-existing caveat (not in scope): pack dry-run precedes count refresh, so the exact post-refresh commit contents are not validated by the local pack check. Flagged for future unit.

## Verification evidence

| Gate | Result |
|------|--------|
| js-yaml parse (3 files) | OK |
| grep SHA-pin pattern | 10 uses lines pinned, 0 unpinned remaining |
| grep contract-drift permissions | present |
| grep unpinned npm install | absent |
| typecheck | exit=0 |
| npm test | 199 files / 2280 tests passed / 2 skipped, exit=0, 200s |
| npm run gate:all | All 17 gates PASS |
| npm run pack:dry | exit=0, entryCount=879 |
| npm run smoke:bins | exit=0, agbrowse + agbrowse-vision-click OK |

## Luna trend synthesis source quality

5 lanes, all hardcoded gpt-5.6-luna, reasoning_effort low. Strongest claims verified against primary sources (docs.github.com, docs.npmjs.com, github.blog changelog). T1-T9 recorded in 000_plan.md claim ledger.

## Outcome

DONE. Commit + push to origin/dev follows.
