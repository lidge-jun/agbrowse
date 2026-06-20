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
