# WP7 Tests & Fixtures Evidence Receipt (2026-07-10)

Worker: I (leaf agent)
Branch: dev
Timestamp: 2026-07-10T21:16 KST

## 1. Focused test run (new/touched files)

Command: `npx vitest run test/unit/web-ai-provider-dom-contract.test.mjs test/unit/web-ai-eval-fixtures.test.mjs test/unit/web-ai-eval-runner.test.mjs --reporter=verbose`

Result: **3 files, 49 tests, 0 failures**

Breakdown:
- web-ai-provider-dom-contract.test.mjs: 31 tests (16 Chat fixture contract, 15 Work fixture contract)
- web-ai-eval-fixtures.test.mjs: 7 tests (4 existing + 3 new GPT-5.6 config)
- web-ai-eval-runner.test.mjs: 12 tests (8 existing + 4 new GPT-5.6 requiredIntents)

## 2. Full unit suite

Command: `npm run test:unit`

Result: **141 files, 1237 tests, 0 failures**

Baseline was 140 files / 1200 tests. Net gain: +1 file, +37 tests, zero regressions.

## 3. Eval script run

Command: `npm run test:eval-gpt56`

Result: `ok: true`, both fixtures pass.
- gpt56-chat: status=pass, targetResolution=2/2=1, composerFill=1, send.click=resolved, copy.click=missing (expected)
- gpt56-work: status=pass, targetResolution=1/1=1, composerFill=1, send/upload/copy=missing (expected, requiredIntents=[composer.fill])
- regressions: []

## 4. Files created

| Status | Path | Purpose |
| --- | --- | --- |
| NEW | test/fixtures/provider-dom/chatgpt-gpt56-eval.json | Explicit eval config for 5.6 fixtures |
| NEW | test/helpers/provider-dom-contract.mjs | Test-only contract loader (data-eval-key parser) |
| NEW | test/unit/web-ai-provider-dom-contract.test.mjs | 31 fixture integrity tests |
| NEW | .codexclaw/evidence/260710_wp7_regression_matrix.md | Completed regression matrix |

## 5. Files modified

| Path | Change |
| --- | --- |
| web-ai/eval-runner.mjs | requiredIntents support in runOneFixture |
| web-ai/eval/fixtures.mjs | requiredIntents JSDoc in FixtureConfigEntry |
| test/unit/web-ai-eval-fixtures.test.mjs | +3 GPT-5.6 config tests |
| test/unit/web-ai-eval-runner.test.mjs | +4 GPT-5.6 requiredIntents tests |
| test/fixtures/provider-dom/chatgpt-gpt56-chat.html | SVG path fix for scrub phone gate |
| package.json | +test:eval-gpt56 script |

## 6. Regression matrix summary

35 scenario rows closed, 1 deferred (Work Live Smoke -- no CI login).
See .codexclaw/evidence/260710_wp7_regression_matrix.md for full mapping.

## 7. Deviations from 07_tests_fixtures.md

1. Chat fixture SVG path `M6 3.5 10.5 8 6 12.5` -> `M6,3.5L10.5,8L6,12.5` (scrub phone false positive)
2. requiredIntents default = ['composer.fill', 'send.click'] (matches existing gate behavior)
3. Work Live Smoke DEFERRED (no CI auth; WP1 manual evidence exists)
4. Korean 5.6 labels not invented per constraint

## 8. Judgement

PASS. All new tests green. Full suite at 141/1237 (from 140/1200 baseline).
No production source edits. No Korean label invention. No live E2E.
Existing eval behavior preserved (baseline/parallel fixtures unaffected).
requiredIntents feature is backward-compatible: unspecified = existing 2-intent gate.
