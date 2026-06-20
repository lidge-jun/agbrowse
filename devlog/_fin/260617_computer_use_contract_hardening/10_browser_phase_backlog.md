# Browser Computer Control Phase Backlog

Date: 2026-06-17
Status: P-phase plan

## Scope

Target repository:

- `/Users/jun/Developer/new/700_projects/agbrowse`

Companion desktop plan:

- `/Users/jun/Developer/codex/23_computer_use/devlog/_plan/260617_computer_use_contract_hardening/10_desktop_phase_backlog.md`

## Phase 1: Vision Candidate Contract

### Planned Files

Modify:

- `/Users/jun/Developer/new/700_projects/agbrowse/skills/vision-click/vision-core.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/skills/vision-click/vision-click.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/skills/vision-click/SKILL.md`
- `/Users/jun/Developer/new/700_projects/agbrowse/README.md`

Add:

- `/Users/jun/Developer/new/700_projects/agbrowse/test/fixtures/vision-candidates.json`
- `/Users/jun/Developer/new/700_projects/agbrowse/test/fixtures/browser-dpr-clip.json`

### Required Changes

- Change vision output contract from point-only to bbox candidate plus confidence.
- Keep backward-compatible parsing only if needed, but mark point-only as lower confidence.
- Validate bbox and click point are finite and inside viewport or clip.
- Return structured failure when target is not found, low confidence, or ambiguous.

### Verification

- `vitest run test/unit/vision-core.test.mjs`
- new fixture tests for bbox/confidence parsing

## Phase 2: Observation-Bundle Reconciliation

### Planned Files

Modify:

- `/Users/jun/Developer/new/700_projects/agbrowse/skills/browser/browser.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/web-ai/observation-bundle.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/test/unit/g06-observation-bundle.test.mjs`

Add if needed:

- `/Users/jun/Developer/new/700_projects/agbrowse/web-ai/candidate-reconcile.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/test/unit/candidate-reconcile.test.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/test/fixtures/browser-observation-stale.json`
- `/Users/jun/Developer/new/700_projects/agbrowse/test/fixtures/browser-ref-vs-coordinate.json`

### Required Changes

- Reconcile vision bbox with nearby snapshot refs when boxes are available.
- Prefer ref click if reconciliation is strong.
- Preserve observation target id and url in coordinate fallback evidence.
- Reject stale ref/target mismatch before coordinate fallback.
- Map shared browser fixture cases to tests:
  - `browser-ref-vs-coordinate.json` -> ref candidate beats coordinate candidate
  - `browser-observation-stale.json` -> target id or URL mismatch rejects stale fallback
  - `browser-dpr-clip.json` -> DPR plus clip origin produces correct CSS click point

### Verification

- observation bundle fixture tests
- candidate reconciliation fixture tests
- `vitest run test/unit/candidate-reconcile.test.mjs test/unit/g06-observation-bundle.test.mjs`

## Phase 3: Safer Coordinate Fallback

### Planned Files

Modify:

- `/Users/jun/Developer/new/700_projects/agbrowse/skills/vision-click/vision-click.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/skills/browser/browser.mjs`
- `/Users/jun/Developer/new/700_projects/agbrowse/structure/commands.md`

### Required Changes

- Require verify crop by default for low/medium confidence coordinate fallbacks.
- Preserve clip origin and DPR in final clicked evidence.
- Add explicit failure envelopes for stale observation, invalid coordinate, low confidence, and ambiguous target.
- Document ref-first and coordinate-last routing.

### Verification

- unit tests for coordinate conversion and clip handling
- focused browser primitive test if parser/help changes
- `npm run docs:drift`

## Phase 4: Real Browser Smoke

### Planned Files

Add:

- `/Users/jun/Developer/new/700_projects/agbrowse/devlog/_fin/260617_computer_use_contract_hardening/20_verification_report.md`

### Smoke Cases

- accessible button: snapshot ref click, no vision fallback
- no-ref target: vision bbox -> verify crop -> coordinate click
- ambiguous target: reject without click
- DPR/clip target: final CSS coordinate evidence is correct

### Verification

- record exact local commands
- record browser state preconditions
- no fake pass for unavailable Chrome/CDP state

## Release Documentation Impact

If implementation changes public command behavior:

- update `/Users/jun/Developer/new/700_projects/agbrowse/README.md`
- update `/Users/jun/Developer/new/700_projects/agbrowse/skills/vision-click/SKILL.md`
- update `/Users/jun/Developer/new/700_projects/agbrowse/structure/commands.md`
- run `npm run docs:drift`

## Implementation Readiness

Ready for Build only after:

- desktop plan and browser plan are audited together
- shared fixture schema is accepted as the source of contract tests
- no additional user decision is required
