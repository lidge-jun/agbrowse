# 00 — agbrowse↔cli-jaw web-ai parity: implementation master plan

> Goal ID `68727b6d-d01` · created 2026-06-25 · PABCD goal-mode (autonomous, checkpoint-gated)
> Source catalog: [`../260621_cli_jaw_webai_parity/`](../260621_cli_jaw_webai_parity/00_plan.md) (~60 grep-verified gaps, both directions, convergence loop terminated at 5-pass cap)

## Part 1 — plain explanation (what & why)

The previous goal *documented* ~60 behavioral gaps between two parallel ChatGPT/web-AI
automation stacks: **agbrowse** (`.mjs`) and **cli-jaw** (`.ts`). This goal *implements*
that catalog. Most gaps are agbrowse features cli-jaw lacks (DOM streaming-recovery,
session-artifact capture, watcher locks, plus two real **data-corruption bugs** in
cli-jaw's deep-research and multi-turn code) — those get ported **into the cli-jaw repo**.
A smaller set are cli-jaw ideas agbrowse lacks (declarative capability-registry,
TLS-impersonation fetch ladder, search discipline) — those get ported **into agbrowse**.
Work is sliced into **12 PABCD cycles** (11 implementation + 1 final verification), each
landing small atomic commits behind that repo's own green gates, with a final GPT-Pro
review pass over the whole diff registered as a background task.

## Part 2 — structure, conventions, slice map

### Two repos, two languages (load-bearing fact)

| Direction | Meaning | Target repo | Lang | Branch | Gate command |
|---|---|---|---|---|---|
| **100-series** | agbrowse → cli-jaw (cli-jaw lacks it) | `/Users/jun/Developer/new/700_projects/cli-jaw` `src/browser/web-ai/*.ts` | TypeScript | `feat/webai-parity-100-260625` off `dev` | `npm test` (`tsx tests/run.mts`) + `npx tsc --noEmit` |
| **200-series** | cli-jaw → agbrowse (agbrowse lacks it) | `/Users/jun/Developer/new/700_projects/agbrowse` `web-ai/*.mjs` | JS (ESM) | `feat/webai-parity-200-260625` off `main` | `npm run gate:typecheck && npm run gate:tests && npm run docs:drift && npm run docs:counts` |

- **Repo conventions read & reused**: both repos use `devlog/_plan/<YYMMDD_topic>/` decade
  numbering; agbrowse has `structure/` doc-drift + counts gates + `scripts/release-gates.mjs`;
  cli-jaw uses Node test runner via `tsx tests/run.mts` on branch `dev` (live product v2.2.2).
- **No new source-of-truth folders.** This `260625_webai_parity_impl/` plan folder is the
  only new devlog dir; cli-jaw-side cycles append impl notes to the same stub docs (referenced
  by path), not a new cli-jaw devlog tree, unless a cli-jaw cycle's diff is large enough to
  warrant its own note (decided at that cycle's B-phase).
- **Commit discipline**: small atomic commits per gap-cluster; **local only, no push/publish**
  without explicit user approval (confirmed user default). Feature branches keep both repos'
  mainlines clean and the whole effort revertable.

### Sequencing rationale (severity-first, repo-grouped)

The user chose *both directions, entire catalog (P3-deep), ≥10 cycles, alternating*. Strict
per-cycle repo alternation was **traded for severity-ordering + repo-grouping** because:
1. **All 7 P0 and ~all P1 correctness/stability gaps are 100-series (cli-jaw)** — the two
   data-corruption bugs (106.1/106.2) must land first regardless of direction.
2. Thrashing between `.ts`/`.mjs` + two test runners every cycle is error-prone; grouping
   cli-jaw cycles (1–8) then agbrowse cycles (9–11) is faster and safer.
3. Both directions are still fully covered, ending with the cross-repo GPT-Pro gate.

If you want strict alternation instead, say so and I'll re-order the stub docs.

### The 12-cycle slice map

| Cyc | Doc | Repo | Gaps (catalog refs) | Sev | Kind |
|---|---|---|---|---|---|
| **1** | [10_](10_cycle1_dr_multiturn_fixes.md) | cli-jaw | **106.1/.2/.5** DR saves non-report as report; multi-turn drops history + corrupts indices | **P1** | fix (modules exist) |
| **2** | [20_](20_cycle2_session_artifacts_foundation.md) | cli-jaw | **101 #1** session-artifacts foundation + chatgpt-files capture | **P0** | new module |
| **3** | [30_](30_cycle3_response_observer_dom.md) | cli-jaw | **101 #2** response-observer (MutationObserver early-wake + 3rd-tier recovery) + chatgpt-response-dom + **106.13** descendant de-dup | **P0** | new module |
| **4** | [40_](40_cycle4_streaming_recovery_watcher.md) | cli-jaw | **101 #9** streaming false-complete (`cff76ed`) + watcher streaming-recovery + **105.5** persisted streaming fields | **P1** | new+modify |
| **5** | [50_](50_cycle5_p1_infra.md) | cli-jaw | **104.3** watcher cross-process lock · **104.19** AX-tree CDP fallback · **105.4** tier→timeout table | **P1** | modify |
| **6** | [60_](60_cycle6_shared_module_divergences.md) | cli-jaw | **104.1–.18** session/active locks, model evidence+Korean i18n+legacy-pro reject, code-mode nav, composer resolved-targets, attachment filename-verify, vendor capability+model probes | P1/P2 | modify |
| **7** | [70_](70_cycle7_ax_contract_systemic.md) | cli-jaw | **104.20–.22** occurrenceIndex/observation-bundle/contract-audit 7-feat · **105.1/.2/.6/.7/.8/.9** error-code taxonomy, CLI flag delta, retryHint, stage vocab, selector arrays, warning shape | P2/P3 | modify |
| **8** | [80_](80_cycle8_remaining_modules.md) | cli-jaw | **102** images/archive/project-sources/upload-surface/navigation-ready/tab-inspect · **106** chatgpt-tools More-submenu, tab-lease capacity/dead-PID | P2/P3 | new+modify |
| **9** | [90_](90_cycle9_agbrowse_tls_fetch.md) | agbrowse | **203** TLS-impersonation (JA3/curl_cffi) + adaptive-fetch ladder core | **P1** | new+modify |
| **10** | [100_](100_cycle10_agbrowse_capability_registry.md) | agbrowse | **201** declarative capability-registry + annotated-screenshot + interstitial detector + product-surfaces | P2 | new module |
| **11** | [110_](110_cycle11_agbrowse_search_fetch_rest.md) | agbrowse | **202** search discipline M1–M5 · **203** rest: yt-dlp, camoufox, RSS/feed parser, BM25 reranker, table extractor, lane discovery | P2/P3 | new+modify |
| **12** | [120_](120_cycle12_gptpro_verification.md) | both | **FINAL GATE** — GPT-Pro verification pass over the full diff via agbrowse web-ai, registered as server-owned `bgtask` | — | verify |

### Per-cycle PABCD contract (each of cycles 1–11)

Each cycle is its own P→A→B→C→D micro-pass under the active goal:
- **P**: fill that cycle's stub doc with diff-level precision (exact files, before/after) —
  done at cycle start because catalog already has file/line evidence.
- **A**: read-only audit of the cycle's plan against the *live* target repo (CLI sub-agent or
  employee, advisory/non-blocking per user) — verify the claimed gap still exists & file paths hold.
- **B**: Boss writes all code; small atomic commits; new TS is strict-compatible; new modules
  ported from agbrowse `.mjs` → cli-jaw `.ts` idioms (or vice-versa).
- **C**: that repo's gate command green (table above) + `tsc --noEmit` for cli-jaw.
- **D**: `cli-jaw goal update` checkpoint with evidence (commit hash + gate output path);
  mark the cycle row ✅ in this tracker.

### Completion definition (explicit)

Goal is **NOT** complete on employee sign-off (per user: employee verification is advisory).
Goal completes only when:
1. Every catalog gap is implemented + behind green gates in its target repo, **and**
2. Cycle 12 runs a **GPT-Pro verification pass over the implemented changes via agbrowse
   web-ai**, registered as a server-owned `bgtask` (e.g. `cli-jaw bgtask add --preset web-ai
   --session $SID --prompt "<verify the parity port diff>"`), **and that bgtask returns its verdict.**
   Exact agbrowse web-ai GPT-Pro invocation is resolved at Cycle 12 (verify `agbrowse web-ai`
   CLI surface then).

### Risk register

| Risk | Mitigation |
|---|---|
| cli-jaw is the **live product (v2.2.2)** — regressions ship | Feature branch off `dev`, never push; full `npm test` + `tsc` gate per cycle; no main writes |
| `.mjs`→`.ts` port introduces type errors | strict `tsc --noEmit` in every cli-jaw C-phase |
| 106.1/106.2 are correctness bugs → wrong fix corrupts data further | Cycle 1 first; targeted unit tests reproducing the bug before fixing (TDD) |
| Scope creep across 60 gaps / 12 cycles / multi-session | This tracker is the single source of truth; each cycle checkpoints via `cli-jaw goal update`; convergence = all rows ✅ + Cycle 12 verdict |
| Two repos' gates diverge | Gate command pinned per repo in the table above |

## Convergence tracker (filled per cycle)

| Cyc | Status | Commit(s) | Gate | Checkpoint |
|---|---|---|---|---|
| 1 | ⬜ PENDING | — | — | — |
| 2 | ⬜ PENDING | — | — | — |
| 3 | ⬜ PENDING | — | — | — |
| 4 | ⬜ PENDING | — | — | — |
| 5 | ⬜ PENDING | — | — | — |
| 6 | ⬜ PENDING | — | — | — |
| 7 | ⬜ PENDING | — | — | — |
| 8 | ⬜ PENDING | — | — | — |
| 9 | ⬜ PENDING | — | — | — |
| 10 | ⬜ PENDING | — | — | — |
| 11 | ⬜ PENDING | — | — | — |
| 12 | ⬜ PENDING | — | — | — |
