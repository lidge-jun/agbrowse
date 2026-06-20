# Timeout — Pressure-Test Verdict (2026-06-20)

> Adversarial review of `01_root_cause.md` + `10_solution_plan.md`. Same outcome as the skill-envelope review: **the capability mostly already exists; the plan was ~80% over-engineered.** Locked decision (pro=3600s) still holds — but it needs a 4-entry default map, not a 20-row table + DOM state machine + backoff.

## Verdict per claim

| Claim | Verdict | Why |
|------|---------|-----|
| Fixed timeout ignores model/effort → full `TIMEOUT_TABLE` module | **DOWNSCOPE** | `--timeout <sec>` is already a complete, plumbed, documented escape hatch (`cli.mjs:124,331,547,645` → all 3 pollers). Only real value = sane *defaults* for long tiers, deliverable as a 4-entry map. |
| Intermediate "thinking" false-completion → `hasThinkingIndicator` state machine | **DROP** | Theoretical — traced to a user *remark*, no repro/test/trace. Already guarded by `isResponseFinished` action-buttons (`chatgpt.mjs:386-398,558-581`, `finished?1000` fast path) + `PLACEHOLDER_PATTERNS`+`isFinalAnswer` filter (`:62-78,384`). Proposed DOM probe re-derives `finished` and adds a new breakage surface. |
| 500ms fixed poll, no backoff | **DROP** | Pure CPU/efficiency; zero user-visible symptom. The "7200 polls" cost only exists if you build the 3600s wait. Premature optimization. |
| Deep Research same base timeout | **DROP** | Already has its own stability gate (`chatgpt-deep-research.mjs:284-288`, 5000ms + progress indicator) and a `1_200_000`ms internal default; fully `--timeout`-overridable. No gap. |

## ⚠️ Bug the skeptic found in MY plan

`10_solution_plan.md` threads tier timeout as `input.pollTimeoutSec` — but **`pollTimeoutSec` is already taken**: it's the watcher's per-iteration poll timeout (`cli.mjs:685` `pollTimeoutSec: values['poll-timeout']` → `watcher.mjs:282`). Implementing the sketch as written would conflate two different timeouts. Use a different field name (e.g. `resolvedTimeoutSec`) if this is ever built. The collision is itself evidence the table design wasn't checked against existing code.

## Already-mitigated / escape hatches

- `--timeout <sec>` → fully plumbed to all 3 pollers + deep-research + query; documented with a Pro example (`cli.mjs:331`).
- `--deadline <iso>` → second override (`cli.mjs:200`, `session.mjs:330`).
- Action-button done-signal + `finished?1000` fast path = the "missing" positive done-signal, already present.
- `PLACEHOLDER_PATTERNS`+`isFinalAnswer` = already suppresses thinking/placeholder turns.

## Minimal Viable Version

The only user-visible defect: **a pro/heavy run left WITHOUT `--timeout` silently caps at the 1200s default.** Fix exactly that:

1. Tier-aware **default** via a 4-entry map reusing existing normalizers (`normalizeChatGptModelChoice`/`Effort` at `chatgpt-model.mjs:136,146`):
   `TIER_DEFAULT = { instant:120, thinking:600, pro:3600, 'deep-research':3600 }`. Applied in `resolveDeadlineAt` (`session.mjs:329`) + the 3 poller fallbacks. **No new `timeout-policy.mjs` module, no provider×tier×effort matrix.**
2. Export the single `pro = 3600` constant for `tab_parallel_stability` to import (that plan needs only this one value).
3. One doc line in `cli.mjs:124` (defaults auto-scale for pro/heavy/deep-think; `--timeout` overrides).
4. One regression test: `grok:heavy` default ≠ `grok:expert` 600; pro default = 3600.

**Cut entirely:** `timeout-policy.mjs` module, the 20-row table, `hasThinkingIndicator` state machine, no-growth-N-polls rule, adaptive backoff.

## Recommendation

DOWNSCOPE. Keep claim 1 (as the 4-entry default map); drop claims 2/3/4. Net surface ≈ 1 map + 1 export + 1 doc line + 1 test. `01_root_cause.md` analysis stays valid as background; `10_solution_plan.md` is **superseded by this verdict** for the actual scope.
