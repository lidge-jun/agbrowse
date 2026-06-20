# dev-vision-upgrade Implementation Plan

Date: 2026-06-17
Status: P-phase implementation plan
Target repo: `/Users/jun/Developer/new/700_projects/agbrowse`
Target branch: `dev-vision-upgrade`

## Objective

Implement the browser-side vision upgrade on `dev-vision-upgrade` while preserving agbrowse's ref-first control model.

The browser implementation should make coordinate fallback safer by turning vision output into a `vision_bbox` candidate with confidence, explicit clip/DPR basis, and fail-closed behavior for low-confidence, stale, or ambiguous targets.

## Confirmed Inputs

- Shared desktop/browser contract:
  - `/Users/jun/Developer/codex/23_computer_use/devlog/_plan/260617_computer_use_contract_hardening/00_shared_contract_spec.md`
- Browser alignment:
  - `00_browser_alignment.md`
- Browser backlog:
  - `10_browser_phase_backlog.md`

## Scope

Modify only this repository on branch `dev-vision-upgrade`.

Primary files:

- `skills/browser/browser.mjs`
- `skills/vision-click/vision-core.mjs`
- `skills/vision-click/vision-click.mjs`
- `skills/vision-click/SKILL.md`
- `web-ai/observation-bundle.mjs`
- new `web-ai/candidate-reconcile.mjs`
- `README.md`
- `structure/commands.md`
- targeted tests and fixtures

Do not modify:

- JWC
- `/Users/jun/Developer/new/700_projects/jawcode/devlog`
- default ref/locator click path except where docs need to say coordinate fallback is last

## Diff Plan

### 1. Vision Candidate Contract

Modify:

- `skills/vision-click/vision-core.mjs`

Add exported helpers:

- `normalizeVisionCandidate(raw, options?)`
- `extractVisionCandidateJson(text)`
- `validateVisionCandidate(candidate, observation)`
- `candidateCenter(candidate)`
- `isLowConfidence(candidate, threshold = 0.75)`

Candidate shape:

```js
{
  schemaVersion: 'vision-candidate-v1',
  found: true,
  kind: 'vision_bbox',
  bbox: { x, y, width, height },
  point: { x, y },
  confidence: 0.0_to_1.0,
  description,
  reason,
  riskFlags: []
}
```

Backward compatibility:

- existing `{found,x,y,description}` responses still parse
- point-only responses become `kind: "coordinate"` with lower confidence and `riskFlags: ["point_only"]`
- point-only responses require verification before click

Prompt change:

- `buildCoordPrompt` asks for bbox + confidence JSON first
- old point JSON is tolerated only as fallback parser input

### 2. Fail-Closed Vision Click

Modify:

- `skills/vision-click/vision-click.mjs`

Changes:

- use `extractVisionCandidateJson`
- fail when `found:false`
- fail when confidence `< 0.75` unless a future explicit override is added; do not add override in this phase
- validate bbox/point are finite and inside clip/capture bounds before DPR conversion
- preserve evidence in result:
  - raw candidate
  - css point
  - dpr
  - clip
  - verification crop
  - `verified`
- require verification for point-only candidates and medium-confidence bbox candidates

### 3. Observation Reconciliation

Add:

- `web-ai/candidate-reconcile.mjs`
- `test/unit/candidate-reconcile.test.mjs`

Modify:

- `skills/browser/browser.mjs`
- `skills/vision-click/vision-click.mjs`
- `web-ai/observation-bundle.mjs`

Function:

- `reconcileVisionCandidate({ candidate, bundle, maxDistance = 32 })`

Behavior:

- if candidate center falls inside a ref box, return `{ action: "ref", ref, reason }`
- if candidate center is near exactly one ref box, return that ref
- if multiple nearby refs compete, return ambiguous failure
- otherwise return coordinate fallback with reason

Observation-bundle changes:

- add optional `observationId`
- add optional `targetId`
- keep existing output compatible
- include `basis` summary with `url`, `viewport`, `dpr`, `capturedAt`

Wiring requirement:

- `browser.mjs` must expose or reuse the reconciliation path wherever an observation bundle with boxes is available.
- `vision-click.mjs` must preserve candidate evidence and use `reconcileVisionCandidate` when a bundle is supplied or produced by the command path.
- If no bundle is available, `vision-click.mjs` must explicitly record `reconciliation: "unavailable"` and continue only through the stricter bbox/confidence/verification gate.

### 4. Fixtures and Tests

Add:

- `test/fixtures/vision-candidates.json`
- `test/fixtures/browser-dpr-clip.json`
- `test/fixtures/browser-observation-stale.json`
- `test/fixtures/browser-ref-vs-coordinate.json`

Modify:

- `test/unit/vision-core.test.mjs`
- `test/unit/g06-observation-bundle.test.mjs`
- `tsconfig.checkjs.json`

Coverage:

- bbox candidate parses from JSON
- point-only candidate is backward-compatible but marked risky
- low confidence rejects
- invalid bbox rejects
- DPR + clip converts to final CSS point
- ref candidate beats coordinate candidate
- ambiguous nearby refs fail
- observation basis carries URL/target/viewport/DPR evidence

Typecheck coverage:

- add `web-ai/observation-bundle.mjs` and `web-ai/candidate-reconcile.mjs` to `tsconfig.checkjs.json`, or replace the checkjs gate with a documented equivalent that actually covers those files.
- Preferred path: update `tsconfig.checkjs.json` so `npm run typecheck:checkjs` validates the new browser-side contract module.

### 5. Docs

Modify:

- `skills/vision-click/SKILL.md`
- `README.md`
- `structure/commands.md`

Docs changes:

- document ref-first, coordinate-last policy
- document bbox/confidence candidate contract
- document `--verify-before-click` as required for point-only/medium-confidence fallback
- keep public command names unchanged

### 6. Verification Report

Add after implementation:

- `devlog/_fin/260617_computer_use_contract_hardening/20_verification_report.md`

Must include:

- exact commands run
- branch name
- skipped real browser smoke reason if CDP/Chrome is unavailable
- audit result

## Verification Commands

Run from `/Users/jun/Developer/new/700_projects/agbrowse`:

```bash
git branch --show-current
npx vitest run test/unit/vision-core.test.mjs test/unit/candidate-reconcile.test.mjs test/unit/g06-observation-bundle.test.mjs
npm run docs:drift
npm run typecheck:checkjs
git diff --check
```

## Commit Plan

Commit on `dev-vision-upgrade` only:

```text
feat: harden vision coordinate fallback
```

Do not push.
