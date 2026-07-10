# WP4 Work surface automation - verification evidence

Date: 2026-07-10
Worker: F (WP4)
Branch: dev

## 1. Targeted test suite (5 WP4 files)

Command: `npx vitest run test/unit/web-ai-product-surfaces.test.mjs test/unit/web-ai-chatgpt-work-picker.test.mjs test/unit/web-ai-tool-schema.test.mjs test/integration/web-ai-cli-contract.test.mjs test/integration/web-ai-mcp-server.test.mjs`

Result: **5 files passed, 107 tests passed, 0 failed**

Breakdown:
- web-ai-product-surfaces.test.mjs: 17 passed (4 original + 13 new detector/radio/availability/error tests)
- web-ai-chatgpt-work-picker.test.mjs: 25 passed (new file: Power mapping, normalizers, picker state, verify, evidence)
- web-ai-tool-schema.test.mjs: 19 passed (includes pre-existing web_ai_work_send schema tests)
- web-ai-cli-contract.test.mjs: 34 passed (28 original + 6 new work send CLI tests)
- web-ai-mcp-server.test.mjs: 12 passed (7 original + 5 new web_ai_work_send MCP tests)

## 2. Full test:unit run

Command: `npm run test:unit`

Result: **139 of 140 test files passed, 1189 of 1200 tests passed**

The single failing file is `test/unit/web-ai-chatgpt-model.test.mjs` (11 failures),
which is Worker D's concurrent territory. All 11 failures are in chatgpt-model
selector policy tests that Worker D is actively editing. No WP4 files fail.

## 3. rg match verification

Command: `rg -l "product-surfaces|work-picker|work send|web_ai_work_send" test/`

Result: 5 files matched:
- test/integration/web-ai-mcp-server.test.mjs
- test/integration/web-ai-cli-contract.test.mjs
- test/unit/web-ai-product-surfaces.test.mjs
- test/unit/web-ai-chatgpt-work-picker.test.mjs
- test/unit/web-ai-tool-schema.test.mjs

## 4. Files changed/created by WP4

Created:
- web-ai/chatgpt-work-picker.mjs (Work picker mutation helpers, ~430 lines)
- test/unit/web-ai-chatgpt-work-picker.test.mjs (25 tests)
- .codexclaw/evidence/260710_wp4_chatgpt_model_patches.md (coordinator patch spec)
- .codexclaw/evidence/260710_wp4_verification.md (this file)

Modified:
- web-ai/product-surfaces.mjs (+128 lines: detector, radio, availability, workSurfaceUnsupportedError)
- web-ai/cli.mjs (+100 lines: 'work' in COMMANDS, runWorkCommand with 2-stage dispatch)
- web-ai/mcp-server.mjs (~60 lines: stub replaced with real handler)
- test/unit/web-ai-product-surfaces.test.mjs (+130 lines: 13 new tests)
- test/integration/web-ai-cli-contract.test.mjs (+40 lines: 6 new tests)
- test/integration/web-ai-mcp-server.test.mjs (+60 lines: 5 new tests)

NOT edited (Worker D territory):
- web-ai/chatgpt-model.mjs
- test/unit/web-ai-chatgpt-model.test.mjs

## 5. chatgpt-model.mjs patch spec

Path: `.codexclaw/evidence/260710_wp4_chatgpt_model_patches.md`
Contains anchored patches for:
1. workSurfaceUnsupportedError (move from product-surfaces.mjs to chatgpt-model.mjs)
2. selectChatGptModel surface guard
3. openModelMenu composer-scoped guard + Work marker check
4. Import adjustment plan

## 6. Contract coverage

- detector: Chat/Work/ambiguous/legacy, availability vs active separation, zero mutations (8 tests)
- workSurfaceUnsupportedError: correct errorCode/stage/retryHint/vendor (1 test)
- Power: 1..6 mapping, invalid/out-of-range rejection, already-selected, numeric string acceptance (10 tests)
- Speed: null=no mutation, standard/fast acceptance, unknown rejection (4 tests)
- Model/Effort normalizers: known labels, null handling (4 tests)
- Picker state: slider reading at Power 1/2/6, fast mode, verification pass/fail (6 tests)
- Evidence: structured output with all required fields (1 test)
- CLI: prompt/power required, power 1..6, speed enum, unknown subcommand (6 tests)
- MCP: schema listing, additionalProperties:false, power range, v1 field exclusion, surface=work rejection (5 tests)

## 7. Deviations from 04

1. workSurfaceUnsupportedError in product-surfaces.mjs (not chatgpt-model.mjs) - Worker D conflict; patch spec written.
2. openModelMenu/selectChatGptModel guard merge deferred to patch spec.
3. Session surface/taskId/taskUrl/responseContract stored via envelopeSummary (additive, no typedef change).
4. Work composer write/submit reuses chatgpt-composer.mjs primitives rather than separate adapter fork.

## 8. Judgement

PASS. All 107 WP4 tests pass. Full suite failures are exclusively in Worker D's
chatgpt-model territory. The implementation covers: 3-state fail-closed detector,
Power 1..6 mapping with WP1 live evidence, keyboard mutation contract (Arrow only,
no Home/End), speed independence, CLI 2-stage dispatch, MCP strict schema with
v1 field exclusion, and response adapter with running/complete/unknown states.
The chatgpt-model.mjs patch spec is ready for coordinator merge.
