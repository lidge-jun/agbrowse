VERDICT: PASS

# Final Adversarial Review -- agbrowse GPT-5.6 Update (branch dev)

Date: 2026-07-10
Reviewer: Adversarial code reviewer (8-worker cross-integration audit)
Scope: Entire uncommitted working tree diff (54 files, ~3600 lines changed)
Canon: devlog/_plan/260710_gpt56_update/ docs 01-10, D1-D9 binding decisions
Evidence: .codexclaw/evidence/260710_wp1_live_work_probe.md

## Test Results

- **141 test files, 1237 tests -- ALL PASSED** (vitest 51s)
- No `.skip` in web-ai test suites
- No WP5-PENDING-SHARED markers found
- Structure drift checks: **164/164 PASSED** (check-doc-drift.sh)

---

## 1. Contract Drift Between Layers

### Effort alias parity: tool-schema.mjs <-> cli.mjs <-> chatgpt-model.mjs <-> mcp-server.mjs

**PASS.** All 14 effort aliases in tool-schema.mjs `effort` enum
(`medium, high, xhigh, extra-high, extra_high, extra high, light, low,
standard, normal, regular, default, extended, heavy`) resolve correctly
through `normalizeChatGptEffortChoice()`. Live verified:

| Alias | Normalized |
|-------|-----------|
| medium | medium |
| high | high |
| xhigh | xhigh |
| extra-high | xhigh |
| extra_high | xhigh |
| extra high | xhigh |
| light | medium |
| low | medium |
| standard | medium |
| normal | medium |
| regular | medium |
| default | medium |
| extended | high |
| heavy | xhigh |

- `cli.mjs` parses `--effort` / `--reasoning-effort` as free strings and
  passes to `isSupportedWebAiEffort()` -> `isChatGptEffortSupported()` for
  validation before browser mutation.
- `mcp-server.mjs` calls `validateWebAiToolInput()` -> schema check first,
  then passes through the same normalizer paths.
- `extended` -> `high` remap is consistent everywhere. The warning
  `reasoning-effort-unenforced` fires exactly once for Pro legacy efforts.
  Test at `web-ai-chatgpt-model.test.mjs:124` verifies this.

### Model alias parity

**PASS.** `web_ai_submit_prompt` schema `family` enum matches
`CHATGPT_FAMILY_OPTIONS` keys exactly. `surface` enum is `['chat']` --
correctly excludes `work`. Model aliases in CLI (`isSupportedWebAiModel`)
and normalizer (`MODEL_ALIASES`) are consistent.

### Error codes

**PASS.** The `capability.unsupported` / `provider-surface-preflight` /
`switch-to-chat` triple is used identically in `workSurfaceUnsupportedError()`
(chatgpt-model.mjs:499-506), the MCP `web_ai_submit_prompt` surface guard
(mcp-server.mjs:193-199), and CLI work subcommand validation. No code drift.

---

## 2. Timeout Tier Integrity

### Residual 3600 / 2400 / 40-minute constants

**PASS.** `rg` for `pro=3600`, `2400`, `40-min` found ZERO residual constants
in source. The only matches are **test assertions that verify absence** of
these values:
- `web-ai-timeout-default.test.mjs:260` asserts `not.toMatch(/2400/)`
- `web-ai-tool-schema.test.mjs:161` asserts `not.toMatch(/40\s*min|2400/)`

### TIER_DEFAULT_TIMEOUT_SEC table

**PASS.** session.mjs exports:
```js
{ instant: 120, thinking: 600, 'chatgpt-pro': 5400, 'grok-heavy': 3600, 'deep-research': 3600 }
```
Matches D1 exactly: chatgpt-pro=5400, grok-heavy=3600, deep-research=3600.

### deriveTimeoutTier consumption

**PASS.** `deriveTimeoutTier` is consumed through `resolveTimeoutDefaultSec`
-> `resolveTimeoutBudgetSec` -> `resolveDeadlineAt`. Verified all deadline
creation paths:

| Path | Uses tier-aware resolution | File:line |
|------|---------------------------|-----------|
| chatgpt.mjs sendWebAi | `resolveDeadlineAt(input, 'chatgpt')` | chatgpt.mjs:195 |
| chatgpt.mjs pollWebAi | `resolveTimeoutBudgetSec(input, session, vendor)` | chatgpt.mjs:334 |
| chatgpt.mjs deepResearchWebAi | `resolveDeadlineAt(input, 'chatgpt')` | chatgpt.mjs:771 |
| watcher callVendorPoll | Receives timeout from session budget via watchSessionOnce | watcher.mjs |
| cli-sessions resume | `resolveTimeoutBudgetSec(input, refreshed, vendor)` | cli-sessions.mjs:107,130 |
| deep-research resume | `TIER_DEFAULT_TIMEOUT_SEC['deep-research'] * 1000` | chatgpt-deep-research.mjs |
| MCP session poll | `resolveTimeoutBudgetSec(args, session, vendor)` | mcp-server.mjs:332 |

### Cross-tier contamination

**PASS.** `deriveTimeoutTier('grok', 'heavy')` returns `'grok-heavy'` ->
3600s. Can never reach 5400. The `'chatgpt-pro'` key only activates for
vendor `chatgpt` + model `pro`. Deep-research has its own tier key.
Three-way separation is clean.

---

## 3. Work Surface Safety

### Chat send/query/poll/watch hard-error on work/ambiguous

**PASS.** `selectChatGptModel` calls `assertChatSurfaceForModelMutation(page)`
AFTER the zero-request early return (line 283). This is the correct ordering:
unspecified selection returns `null` without page access, while any real
model/effort/family request hits the surface guard before any menu interaction.

The guard dynamically imports `detectChatGptComposerSurface` from
product-surfaces.mjs, checks `surface === 'work' || 'ambiguous'`, and throws
`workSurfaceUnsupportedError` with `capability.unsupported` /
`provider-surface-preflight` / `switch-to-chat`. Zero mutations before throw.

`web_ai_submit_prompt` MCP handler independently checks `args.surface === 'work'`
and returns `capability.unsupported` before any browser call.

### Work send validates power 1..6 BEFORE browser mutation

**PASS.** Both CLI (`cli.mjs runWorkCommand`) and MCP (`mcp-server.mjs
web_ai_work_send`) call `normalizeWorkPower(Number(values.power))` and
`normalizeWorkSpeed(values.speed)` before `ensureHeadedBrowserForWebAi` /
`deps.getPage()`. These normalizers throw `WebAiError` for invalid input.
Validation ordering is correct.

### Speed unspecified = no speed mutation

**PASS.** `normalizeWorkSpeed(null)` returns `null`.
`setWorkSpeed(page, null)` returns `{ mutated: false, speed: null }` without
any DOM interaction. Documented at chatgpt-work-picker.mjs:64 and :476-483.

### Fail-closed unknown states in chatgpt-work-picker.mjs

**PASS.** `readWorkTaskState` returns `status: 'unknown'` with `answerText: null`
as the final catch-all. The function has three explicit branches: running ->
complete -> unknown. No silent pass-through.

### Detector has no click/press/hover/fill/evaluate

**PASS.** `product-surfaces.mjs` surface detector (`detectChatGptComposerSurface`)
uses only `locator.count()`, `.nth()`, `.isVisible()`, `.textContent()`,
`.getAttribute()`. No `click`, `press`, `hover`, `fill`, or `evaluate` calls.
The only `click` mention in the file is in a JSDoc comment.

---

## 4. Zero-Touch Rule

**PASS.** `selectChatGptModel(page, undefined, {})` returns `null` without
touching the page. Test at web-ai-chatgpt-model.test.mjs:34 uses a Proxy
that throws on any property access -- verified passing.

Guard ordering analysis:
1. `normalizeChatGptFamilyChoice(options.family)` -- pure function, no page
2. `normalizeChatGptModelChoice(model)` -- pure function, no page
3. `normalizeChatGptEffortChoice(...)` -- pure function, no page
4. Early return `if (!requested && !requestedEffort && !requestedFamily) return null`
5. `assertChatSurfaceForModelMutation(page)` -- only reached if step 4 did not return

No other entry point bypasses this guard. `chatGptModelCapabilityProbe` also
returns early with `{ state: 'unknown' }` when model and effort are both
unspecified.

---

## 5. Dead/Duplicated Symbols

### workSurfaceUnsupportedError

**PASS.** Canonical definition in `chatgpt-model.mjs:499`. Re-exported via
`product-surfaces.mjs:187` using `export { workSurfaceUnsupportedError } from './chatgpt-model.mjs'`.

Live import test confirms:
- `chatgpt-model.workSurfaceUnsupportedError === product-surfaces.workSurfaceUnsupportedError` -> `true`
- No duplicate definition, no stale copy.

### Circular import safety

**PASS.** The dependency is:
- `product-surfaces.mjs` -> static re-export from `chatgpt-model.mjs` (line 187)
- `product-surfaces.mjs` -> dynamic `await import('./chatgpt-model.mjs')` (line 108)
- `chatgpt-model.mjs` -> dynamic `await import('./product-surfaces.mjs')` (line 517)

No static circular dependency exists. Both dynamic imports execute after
module initialization. Live test (`node --input-type=module`) confirmed no
TDZ or deadlock.

---

## 6. Test Honesty

### Weakened/relaxed assertions

**PASS.** No `relaxed`, `weakened`, `reduced`, or `simplified.*assert`
markers found in test files. No WP5-PENDING-SHARED markers.

### Skipped tests

**PASS.** The only `.skip` tests are in `test/spec/antigravity-*.test.mjs`
(12 skips) -- these are pre-existing gap-tracking spec placeholders, not
web-ai tests. Zero skips in the actual web-ai test suites.

### Test coverage of contracts

**PASS.** Key contract tests verified:
- Zero-touch test (model.test:34) -- Proxy trap confirms no page access
- 3-split tier table assertion (timeout.test:18) -- exact values
- Effort alias exhaustive mapping (model.test:53+) -- all 14 aliases
- Power 1..6 mapping (work-picker.test) -- exact DOM values
- Tool schema surface enum = `['chat']` only (tool-schema.test)
- No 2400/40min residual in source (timeout.test:252-260, tool-schema.test:161)

---

## 7. Docs/Source Truth Spot-Checks

### Check 1: README timeout table

README.md:550 claims `chatgpt-pro | 5400 | 90 minutes`.
Source: `TIER_DEFAULT_TIMEOUT_SEC['chatgpt-pro'] = 5400`. **MATCH.**

### Check 2: SKILL.md timeout table

skills/web-ai/SKILL.md:116 claims `chatgpt-pro | 5400 | 90 minutes`.
Source: same constant. **MATCH.**

### Check 3: runtime_contracts.md tier values

structure/runtime_contracts.md:63 claims `chatgpt-pro=5400, grok-heavy=3600, deep-research=3600`.
Source: `TIER_DEFAULT_TIMEOUT_SEC` object. **MATCH.**

---

## Findings Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| - | - | No blockers, majors, or cross-worker integration faults found | - |

### MINOR findings (0 blocking)

**MINOR-1** (NIT-level): `web-ai/cli.mjs` usage text at line 657 documents
`pro/deep-research 3600s` as a parenthetical example comment. While technically
correct (this is the grok-heavy AND deep-research value, not chatgpt-pro),
the phrasing `pro/deep-research 3600s` could mislead readers into thinking
ChatGPT Pro is also 3600s. The actual CLI `--timeout` help correctly omits
specific values and says "default scales by model tier". This is cosmetic
only -- the runtime behavior is correct.

**MINOR-2** (NIT-level): `readWorkTaskState` in chatgpt-work-picker.mjs has
no dedicated unit test for the `unknown` (fail-closed) branch. The function
is tested indirectly through integration paths, and the fail-closed structure
is trivially correct, but a direct unit test would strengthen the safety
contract.

---

## Cross-Worker Integration Assessment

The 8-worker parallel build produced clean integration across all layers:

1. **Schema <-> Normalizer <-> Validator**: Effort/model/family enums are
   identical across tool-schema, CLI validation, and chatgpt-model normalizers.
2. **Timeout tiers**: 3-way split (chatgpt-pro/grok-heavy/deep-research)
   is consistently consumed by every deadline-creation and budget-resolution path.
3. **Surface guards**: Chat->Work hard-error and Work->Chat command separation
   are enforced at CLI, MCP, and model-picker levels with consistent error codes.
4. **Work picker**: Power validation precedes all browser mutations in both
   CLI and MCP paths.
5. **Module topology**: The chatgpt-model <-> product-surfaces relationship uses
   dynamic imports to avoid circular deadlock, verified at runtime.
6. **Tests**: 1237 tests pass, no skips in scope, no weakened assertions,
   structure drift gate clean.

---

## Verification Receipt

Recorded: 2026-07-10T21:28 KST

### npm run test:unit (re-run)
```
Test Files  141 passed (141)
     Tests  1237 passed (1237)
  Duration  51.67s
```

### bash structure/check-doc-drift.sh (re-run)
```
All structure drift checks passed (164).
```

### Live module smoke (node --input-type=module)
```
TIER_DEFAULT_TIMEOUT_SEC: {"instant":120,"thinking":600,"chatgpt-pro":5400,"grok-heavy":3600,"deep-research":3600}
All 14 effort aliases resolve: true
workSurfaceUnsupportedError same ref: true
```

All checks green. No blockers, no cross-worker integration faults.
