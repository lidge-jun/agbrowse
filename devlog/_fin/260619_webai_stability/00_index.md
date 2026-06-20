# 260619 — Web-AI Stability & Concurrency: Index + Locked Decisions

> Coordinating doc for the four 2026-06-19 devlog folders. This round is **documentation only** (root-cause + plan); no code is committed. Trigger: gallery feedback (쿠마방와) on agbrowse's web-AI driver — timeout granularity, tab-parallel instability, skill/attachment envelope, and a response-complete notification hook.

## The four work folders

| # | Folder | Theme |
|---|--------|-------|
| 1 | `260619_timeout_adaptive_scaling/` | Per-(model, effort) timeout table; intermediate-"thinking" false-completion; adaptive poll backoff |
| 2 | `260619_tab_parallel_stability/` | Multi-agent CDP sharing: TOCTOU, lease↔session race, send+poll mutex, crashed-lease leak |
| 3 | ~~`260619_skill_envelope_integration/`~~ → **closed** | Capability already exists (`--system` + `--file`). Reclassified code→docs-only, moved to `_fin/260620_skill_envelope_already_capable.md`. Fix = small SKILL.md + `--help` upgrade. |
| 4 | `260619_watch_notification_gaps/` | Lower completion-detection latency; format-agnostic URL; optional CDP early-nudge |

**Scope update (2026-06-20):** Only areas 1, 2, 4 are real code work. Area 3 (skill envelope) was found to be already-capable — a discoverability/UX problem, not architecture — and is closed to `_fin`.

## Pressure-test synthesis (2026-06-20)

All four areas were adversarially pressure-tested ("is this REALLY needed?"). The skill-envelope pattern repeated everywhere: **existing mitigations under-credited, plans over-engineered.** Net — the four elaborate plans collapse to a handful of small, surgical fixes. Locked decisions (pro=3600s, vendor5/global12-16) still hold; only the *implementation surface* shrank.

| Area | Original plan | Survived (MVV) | Verdict |
|------|---------------|----------------|---------|
| **timeout** | new `timeout-policy.mjs` + 20-row table + thinking-indicator state machine + adaptive backoff | 4-entry tier-default map + export `pro=3600` + 1 doc line + 1 test | DOWNSCOPE ~80%; claims 2/3/4 dropped (`--timeout` + action-button signal already exist) |
| **tab** | atomic-acquire + per-session mutex + heartbeat/TTL unification + admission/FIFO/priority | record-before-bind reorder + active-count cap (revert `maxTabs:Infinity`) + PID reaper + doc fix | DOWNSCOPE & split; **the real work for the multi-agent goal.** Claims 1/3 already mitigated by `active-command.target-owned` cross-process mutex; claim 5 out-of-scope |
| **skill envelope** | `buildEnvelope` refactor + trust-tier sections + manifest | docs: `--help` + SKILL.md (done, `e88a520`) | CLOSED → `_fin` |
| **watch** | adaptive interval + per-provider id registry + CDP nudge (Tier1+2) | ~30-line watcher consolidation (use the healed session it already discards) | DOWNSCOPE ~75%; 15s latency invisible under bgtask; registry misdiagnosed; Tier2 vetoed |

**Bugs the pressure-test found in the plans themselves:** (a) timeout sketch reuses `pollTimeoutSec`, which is already the watcher's per-iteration timeout (name collision); (b) the watcher already routes through the self-healing resolver but discards the healed `session` and re-checks a stale one — so the watch fix is *deletion*, not new code.

**Revised cross-cut:** the 3-TTL unification is now **deferred/out-of-scope** — `tab` needs only the single `pro=3600` constant exported from `timeout`, not the full TTL program. The dependency between areas 1 and 2 is now one constant, not a coupled rewrite.

Each `260619_*` folder has a `20_pressure_test_verdict.md` with the per-claim KEEP/DOWNSCOPE/DROP table and evidence; the `10_solution_plan.md` files are retained as full background but **superseded for scope** by the verdicts.

## Implementation status (2026-06-21)

Per the user directive "patch everything except tab, close to _fin, push":

| Area | Status | Where |
|------|--------|-------|
| **skill envelope** | docs patched (`e88a520`) | `_fin/260620_skill_envelope_already_capable.md` |
| **timeout** | code patched (`1d86985`) — tier-aware default, `pro=3600` | `_fin/260619_timeout_adaptive_scaling/` |
| **watch** | code patched (`1d86985`) — watcher reuses healed session (#77 watch-path) | `_fin/260619_watch_notification_gaps/` |
| **tab** | code patched — record-before-bind, active-session caps, PID reaper, stale TTL docs | `_fin/260619_tab_parallel_stability/` + `_fin/260621_tab_stability_mvv_closeout/` |

Verification for the timeout+watch patch: vitest 837/837 unit + 14/14 affected + 6/6 integration; `npm run gate:all` 16/16. Verification for the tab MVV closeout is recorded in `_fin/260621_tab_stability_mvv_closeout/00_plan.md`.

Each folder has: `00_overview.md` (problem framing), `01_root_cause.md` (verified, with `file:line` + real code), `10_solution_plan.md` (design + code sketch + test strategy + risks).

## Locked decisions (2026-06-19 interview)

1. **Scope** — all four areas are documented to devlog with *clear root-cause analysis*. No code implementation this round.
2. **Concurrency target** — **vendor ≤ 5, global 12–16** concurrent sessions on one Chrome (today: vendor 3 / global 8). Sized for "jaw 직원 3명 + boss" sharing one CDP.
3. **Timeout strategy** — **hardcoded mapping table** (no history-learning). Tiers: instant ≈ 120s, thinking/standard ≈ 600s, **pro / heavy / deep-research = 3600s** (one hour, explicit user choice).

## ⚠️ Cross-cutting insight (independently confirmed by a sub-agent AND the Backend employee)

The single biggest risk to the multi-agent goal is **TTL drift under a pro=3600s wait**. Today three independent TTLs govern a live session and none of them knows about pro=3600s:

| TTL | Value today | Source | Failure at pro=3600s |
|-----|-------------|--------|----------------------|
| Session command lock | 35 min | `session-store.mjs:50` | Expires mid-pro-wait → another command can seize the session |
| Active-command heartbeat | 2 min | `active-command-store.mjs:37` | Expires mid-poll → cleanup stops protecting the tab |
| Active-session lease | **none** | `tab-lease-store.mjs:221-236` | Crashed session locks a tab forever |

**Therefore decision #3 (timeout table) is a prerequisite for decision #2 (scale to 12–16):** the pro=3600s value must become the *single source of truth* for a model-aware deadline, and all three TTLs must derive from it + a 60s heartbeat, **before** raising the concurrency caps. Folders 1 and 2 are coupled — see `260619_timeout_adaptive_scaling/10_solution_plan.md` (§ deadline table) and `260619_tab_parallel_stability/10_solution_plan.md` (§ C lease TTL + § E scaling).

## Test coverage (area 5) — woven, not separate

The originally-listed "5. test coverage gaps" is **not** a standalone folder; each plan's `## Test Strategy` section absorbs the relevant cases (concurrency, mutex, lease TTL, mid-stream pause, URL drift, fallback-to-poll). Existing harnesses to extend: `test/integration/web-ai-fake-chatgpt.test.mjs`, `test/unit/web-ai-session-store.test.mjs`, `test/unit/web-ai-watcher.test.mjs`, `test/unit/web-ai-question.test.mjs`, `test/unit/content-boundary.test.mjs`.

## Open reference

- Issue **#77** (P0) — web-AI durable session recovery matrix, incl. "root-to-conversation URL drift". Confirmed in `docs/production-readiness.md:41`. Folder 4 closes the watch-path half of it.
