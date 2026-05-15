---
created: 2026-05-15
status: planning
tags: [jawdev, adaptive-fetch, implementation-plan]
---

# agbrowse Patch Plan

## Phase 01 - JSON Output Contract

Goal: `fetch --json` must always emit valid JSON, even when selected content is
large or source text is already JSON.

MODIFY:

- `skills/browser/browser.mjs`
- `skills/browser/adaptive-fetch/index.mjs`
- `skills/browser/adaptive-fetch/reader-adapters.mjs`
- `skills/browser/adaptive-fetch/trace.mjs`

Implementation notes:

- Add a result-output compaction boundary before `JSON.stringify`.
- Preserve full scoring internally, but cap outward `content` to a named limit.
- Add `contentTruncated: true`, `contentBytes`, and `contentLimitBytes` when
  result content is clipped.
- Never truncate the final serialized JSON string.
- Keep traces compact: evidence and attempts can carry summaries, not full raw
  endpoint bodies.
- Ensure public endpoint JSON text is treated as readable content but not dumped
  unbounded into CLI JSON output.

Tests:

- Add or extend integration coverage for a result whose source text exceeds
  64KB, asserting `JSON.parse(stdout)` succeeds.
- Add a unit test that compacts long content while preserving `ok`, `verdict`,
  `source`, `finalUrl`, `attempts`, and `metadata`.

## Phase 02 - Live Classification Contract

Goal: live classifications should be explainable, even when they differ from old
v1 expectations.

MODIFY:

- `skills/browser/adaptive-fetch/content-scorer.mjs`
- `skills/browser/adaptive-fetch/challenge-detector.mjs`
- `skills/browser/adaptive-fetch/waf-profiles.mjs`
- `skills/browser/adaptive-fetch/endpoint-resolvers.mjs`
- `test/unit/browser-adaptive-fetch-content-scorer.test.mjs`
- `test/unit/browser-adaptive-fetch-challenge.test.mjs`
- `test/unit/browser-adaptive-fetch-endpoints.test.mjs`

Implementation notes:

- Separate `blocked`, `challenge_detected`, `auth_required`, and `weak_ok`
  evidence so live smoke output is easier to interpret.
- Do not treat challenge markers as an immediate terminal verdict. They should
  mark the candidate, lower confidence, and allow later ladder phases.
- Re-check npm package URL handling. If registry candidates are intended, ensure
  `www.npmjs.com/package/<name>` produces a registry candidate before the web
  page fetch. If npm blocks API calls, the result should disclose that.
- Re-check Reddit endpoint routing. Public `.json` is legitimate, but the result
  should not overwhelm the output contract.

## Phase 03 - Browser Escalation Reality Check

Goal: prove the v2 value claim with hard live smoke, not just fixtures.

MODIFY:

- `skills/browser/adaptive-fetch/browser-escalation.mjs`
- `skills/browser/adaptive-fetch/browser-session.mjs`
- `skills/browser/adaptive-fetch/human-loop.mjs`
- `test/integration/browser-fetch-command.test.mjs`

Optional NEW:

- `scripts/live-fetch-smoke.mjs`

Implementation notes:

- Keep live smoke out of default CI unless an explicit env flag is set.
- Script should run direct, opt-in reader, isolated browser, and user-session
  probes as separate rows.
- Script should treat `ok=false` blocked/auth/challenge as valid observations,
  not command failures.
- Script should fail only on invalid JSON, command crash, private-network
  leakage, unexpected browser use in `--browser never`, or missing required
  schema fields.

## Phase 04 - Docs And Structure Sync

MODIFY:

- `README.md`
- `skills/browser/SKILL.md`
- `structure/commands.md`
- `structure/CAPABILITY_TRUTH_TABLE.md`
- `structure/str_func.md`
- `docs/migration/module-graph.json` if module graph changes

Verification:

```bash
npm run fix:counts
npm run docs:counts
npm run docs:drift
npm run check:module-graph
npm run pack:dry
```

