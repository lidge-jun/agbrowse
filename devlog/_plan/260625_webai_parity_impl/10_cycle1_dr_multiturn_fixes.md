# 10 — Cycle (cli-jaw (.ts))

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` · **Status: ⬜ PENDING (stub — diff-level detail filled at this cycle's P/B phase)**

## Target
- **Repo / lang:** cli-jaw (.ts)
- **Severity:** P1
- **Gate command:** `npm test + npx tsc --noEmit`

## Gaps in scope
106.1 deep-research persists a non-report as a 'report'; 106.2 multi-turn drops prior history + corrupts indices on resume; 106.5 related secondary

## Plan (A-phase audit confirmed — both bugs REAL in live cli-jaw)

Ordered atomic slices (each its own commit, behind `npm test` + `tsc --noEmit`):

- **1.0 — schema prerequisite (audit-flagged, NOT in catalog).** `src/browser/web-ai/types.ts`:
  add `turns?: WebAiTurnRecord[]` + `followUpCount?: number` to `WebAiSessionRecord`; extend the
  session persistence path (`session.ts`/`cli-sessions.ts` `updateSessionResult`) to accept/persist
  them. Without this the multi-turn merge has nothing to read/write. Additive optional fields →
  backward-compatible.
- **1.1 — multi-turn history+index fix (106.2/106.5).** `chatgpt-multi-turn.ts`: replace
  `let turnIndex = 0` → `const existingTurns = session.turns ?? []; let turnIndex = existingTurns.length`;
  render transcript + return from `allTurns = [...existingTurns, ...turns]`; persist `turns: allTurns`
  + `followUpCount`. Mirrors agbrowse `chatgpt-multi-turn.mjs:138-216`.
- **1.2 — deep-research not-started guard + completeness (106.1).** Port NEW
  `chatgpt-deep-research-report.ts` (`chooseDeepResearchReportRead`, `isIncompleteDeepResearchText`,
  120-char + status-marker regexes) from agbrowse; in `chatgpt-deep-research.ts` add
  `researchActivityObserved` tracking (set on progress UI / frame read), return
  `status:'failed' + warnings:['deep-research-not-started']` when still false at stable-answer point,
  and have `extractResearchReport` yield a `completed` flag so incomplete reads keep waiting and the
  timeout path persists only `completed ? text : null`. Mirrors agbrowse `chatgpt-deep-research.mjs:242-369`.
- **1.x — TDD:** each slice gets a failing unit test reproducing the bug first, then the fix.

## Build log (cli-jaw branch `feat/webai-parity-100-260625` off `dev`)

- **Slice 1.0 + 1.1 — multi-turn history+index fix (106.2/106.5)** — ✅ DONE — cli-jaw `0d80a71f`
  - `types.ts`: + `WebAiTurnRecord`, + `turns?`/`followUpCount?` on `WebAiSessionRecord`.
  - `session.ts`: `updateSessionResult` accepts + persists `turns`/`followUpCount`.
  - `chatgpt-multi-turn.ts`: `existingTurns = session.turns ?? []`, `turnIndex = existingTurns.length`,
    merge `[...existing, ...new]` into transcript + every persist; `TurnResult` aliases `WebAiTurnRecord`.
  - Gate: `tsc --noEmit` 0 errors; new regression `tests/unit/browser-web-ai-multi-turn.test.ts`
    (BWAI-MULTITURN-001) green.
  - Deferred: 106.6 transcript-artifact-save on partial → Cycle 2 (needs `session-artifacts.ts`).
- **Slice 1.2 — deep-research not-started guard + completeness (106.1)** — ⬜ PENDING (next).
  Port NEW `chatgpt-deep-research-report.ts` + add `researchActivityObserved` guard +
  `completed` flag in `chatgpt-deep-research.ts`.

## Verification
**A-phase audit (2026-06-25, 3 parallel read-only sub-agents vs live cli-jaw repo):**
- 106.1 DR non-report-as-report → **REAL** (no `researchActivityObserved`/`completed` guard;
  `chatgpt-deep-research.ts:121-147,228-269`; no `chatgpt-deep-research-report.ts`).
- 106.2/106.5 multi-turn → **REAL** (`chatgpt-multi-turn.ts:108,111,134-176` hardcoded `turnIndex=0`,
  new-turns-only, never persists `turns`; `types.ts` `WebAiSessionRecord` has no `turns` field).
- Verdict: **CYCLE-1 PLAN VALID, NEEDS-ADJUST** → schema prerequisite (slice 1.0) added above.
- C-phase gate result: _pending._
