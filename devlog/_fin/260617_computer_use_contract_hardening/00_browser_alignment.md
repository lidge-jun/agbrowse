# Browser Computer Control Alignment

Date: 2026-06-17
Status: P-phase plan

## Objective

Align agbrowse browser control with the shared computer-use contract while preserving its existing ref-first design.

Shared master spec:

- `/Users/jun/Developer/codex/23_computer_use/devlog/_plan/260617_computer_use_contract_hardening/00_shared_contract_spec.md`

## Scope

Target repository:

- `/Users/jun/Developer/new/700_projects/agbrowse`

Primary surfaces:

- `agbrowse snapshot --interactive`
- `agbrowse observe-bundle --screenshot --boxes --json`
- `agbrowse observe-actions <instruction> --json`
- `agbrowse-vision-click`
- `agbrowse mouse-click`

## Current State

agbrowse already has the right top-level preference order:

1. accessibility snapshot refs
2. locator/ref actions
3. observe-bundle boxes
4. screenshot/coordinate fallback
5. vision-click for no-ref targets

The hardening work should keep that order and strengthen the fallback path.

## Contract Mapping

### Observation

Existing equivalents:

- `snapshot --interactive` -> refs
- `observe-bundle` -> refs, boxes, optional screenshot, viewport, DPR
- `screenshot --json` -> screenshot path, viewport, DPR, optional clip

Required additions:

- stable observation/capture id inside vision-click flow
- explicit target id/url freshness check for coordinate fallback
- screenshot clip metadata preserved through candidate resolution

### Candidate

Existing equivalents:

- snapshot ref
- observe-action candidate
- vision-click coordinate result

Required additions:

- `vision_bbox` candidate with bbox, point, confidence, and reason
- candidate can reconcile to a nearby ref when possible
- low confidence becomes a failure, not a click

### Action

Existing actions:

- `click <ref>`
- `mouse-click <x> <y>`

Required policy:

- prefer ref click
- use coordinate click only when no usable ref exists
- require vision bbox verification before coordinate click

### Verification

Existing verification:

- optional verify crop in vision-click
- post-click snapshot best effort

Required additions:

- pre-click viewport/clip bounds validation
- bbox center must remain inside verified crop
- optional `elementFromPoint` or nearby-ref reconciliation before click
- post-click snapshot or caller-provided assertion for risky actions

## Non-Goals

- Do not replace Playwright locator/ref actions.
- Do not make vision-click the default browser action path.
- Do not add browser-level desktop permissions.
- Do not modify JWC or jawcode.

## Open Design Defaults

Adopt these defaults unless audit finds a blocker:

- bbox confidence threshold: 0.75 for normal targets
- require verify crop for coordinate fallback in dense UI
- reject ambiguous target descriptions instead of clicking
- keep existing `--clip` and `--region` flags, but preserve their coordinate basis explicitly
