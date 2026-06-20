# Browser Vision Upgrade Verification Report

Date: 2026-06-17
Status: B-phase implementation verification
Branch: `dev-vision-upgrade`

## Implementation Commit

- `/Users/jun/Developer/new/700_projects/agbrowse`: `3392adc feat: harden vision coordinate fallback`
- `/Users/jun/Developer/new/700_projects/agbrowse`: `2b03e74 fix: wire vision candidate reconciliation`
- `/Users/jun/Developer/new/700_projects/agbrowse`: `f7e8cd0 refactor: split vision candidate helpers`

## Implemented Scope

- Added `vision-candidate-v1` parsing with bbox, point, confidence, and risk flags.
- Kept legacy `{found,x,y}` parsing but marks it as point-only and lower confidence.
- Added candidate validation for finite bbox/point and viewport/clip bounds.
- Added `candidate-reconcile.mjs` for bbox-to-ref reconciliation.
- Extended ObservationBundleV1 with `observationId`, `targetId`, and `basis`.
- Wired `--bundle` into `agbrowse-vision-click` so a vision bbox can prefer a matching ref, fail on ambiguous refs, or fall back to coordinates.
- Added stale ObservationBundle rejection before coordinate fallback.
- Added `url` and `targetId` to `screenshot --json` so freshness checks use the same basis as `observe-bundle`.
- Updated docs for ref-first, coordinate-last browser control.
- Added focused fixtures and unit tests.
- Split vision candidate parsing/validation helpers into `skills/vision-click/vision-candidate.mjs` so touched vision-click modules remain under 500 lines.

## Commands Run

From `/Users/jun/Developer/new/700_projects/agbrowse`:

```bash
git branch --show-current
```

Result:

```text
dev-vision-upgrade
```

```bash
npx vitest run test/unit/vision-core.test.mjs test/unit/candidate-reconcile.test.mjs test/unit/g06-observation-bundle.test.mjs
```

Result:

```text
PASS: 3 files, 36 tests, 0 failures
```

```bash
npm run typecheck:checkjs
```

Result:

```text
PASS
```

```bash
npm run docs:drift
```

Result:

```text
PASS: 144 checks
```

```bash
git diff --check
```

Result:

```text
PASS
```

```bash
wc -l skills/vision-click/vision-core.mjs skills/vision-click/vision-candidate.mjs skills/vision-click/vision-click.mjs web-ai/candidate-reconcile.mjs
```

Result:

```text
PASS: touched vision-click modules are <= 500 lines (`vision-core.mjs` 341, `vision-candidate.mjs` 249, `vision-click.mjs` 434, `candidate-reconcile.mjs` 74)
```

## Real Browser Smoke

Run on 2026-06-17 with linked global `agbrowse` binaries.

Setup:

- `npm ls -g --depth=0 agbrowse` shows `agbrowse@0.1.14 -> /Users/jun/Developer/new/700_projects/agbrowse`.
- `agbrowse start` launched Chrome on CDP `9222`.
- Test page was a data URL with one accessible button and one canvas-only green `CANVAS` target.

Smoke results:

- `agbrowse screenshot --json` returned `url`, `targetId: cdp:9222`, `dpr: 2`, viewport, and path; `sips` confirmed screenshot pixels were `2880x1604` for viewport `1440x802`.
- `agbrowse observe-bundle --screenshot --boxes --json` initially exposed a bug: snapshot refs were `eN`, while `ObservationBundle` kept only `@eN`, producing `refs: []`.
- After patch, `observe-bundle` preserved `e2` and captured its box: `{ x: 71, y: 119, width: 222, height: 67 }`.
- Stale bundle check failed closed before click with `COMPUTER_OBSERVATION_STALE: observation URL does not match current page`.
- Canvas no-ref fallback succeeded: `agbrowse-vision-click "green CANVAS rectangle" --clip 300 90 500 330 --verify-before-click` clicked `(515,224)`, and `agbrowse text` changed to `canvas-clicked`.
- Accessible button with bundle initially showed a second bug: reconciliation compared raw image pixels to CSS boxes and ran before verification, so a full-page candidate missed the ref box and coordinate fallback did not click the button.
- After patch, bundle click succeeded: `agbrowse-vision-click "Blue Test Button" --bundle /tmp/agbrowse-vision-bundle-fixed2.json` verified the crop, re-reconciled in CSS space, used the ref path, and `agbrowse text` changed to `blue-clicked`.

Smoke limitations:

- `agbrowse evaluate` was denied by policy, so DOM state was checked via `agbrowse text`.
- Ambiguous target live smoke remains future work; ambiguity behavior is covered by `test/unit/candidate-reconcile.test.mjs`.
