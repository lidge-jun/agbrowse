---
created: 2026-05-06
phase: post-mvp
tags: [agbrowse, post-mvp, gap-closeout, vercel-agent-browser, stagehand, playwright-mcp, browser-use]
source: devlog/context/260506_gpt_pro_competitive_gap_audit.md
---

# Post-MVP gap closeout — diff plan (2026-05-06)

GPT Pro returned **READY_TO_FILE_ISSUES** for an 11-gap competitive audit
against Vercel Labs `agent-browser`, Stagehand, Playwright MCP, browser-use,
AgentQL, and the WebVoyager / WebArena / VisualWebArena / Mind2Web benchmark
families.

This folder is the diff-level execution plan, one file per gap, in Pro's
recommended ship order. Each file is paired with a filed GitHub issue under
`lidge-jun/agbrowse`.

## Forbidden scope (applies to every gap)

- No hosted/cloud runtime — local CDP only.
- No stealth, CAPTCHA bypass, or Cloudflare evasion.
- No external CDP / remote browser (deferred — see `docs/EXTERNAL_CDP.md`).
- No leaderboard score claims without fixed model/planner/env/task set.
- No MCP scope unfreeze beyond `browser_snapshot` + `browser_click_ref` until
  the truth table is intentionally updated.

## Ship order

| # | Gap | Severity | Estimate | Issue | Depends on |
| --- | --- | --- | --- | --- | --- |

| 1 | [G10](01_g10.md) — Cloud-runtime positioning gap, not an implementation gap | P1 | S | [#57](https://github.com/lidge-jun/agbrowse/issues/57) | — |
| 2 | [G04](02_g04.md) — MCP parity intentionally frozen below mainstream MCP | P0 | M | [#58](https://github.com/lidge-jun/agbrowse/issues/58) | G10 |
| 3 | [G02](03_g02.md) — observe()-style action candidate API | P0 | M | [#59](https://github.com/lidge-jun/agbrowse/issues/59) | G10 |
| 4 | [G06](04_g06.md) — Unified multimodal observation bundle | P1 | M | [#60](https://github.com/lidge-jun/agbrowse/issues/60) | G02 |
| 5 | [G03](05_g03.md) — Generic action breadth | P0 | L | [#61](https://github.com/lidge-jun/agbrowse/issues/61) | G02 |
| 6 | [G11](06_g11.md) — Local replay/observability timeline | P1 | M | [#62](https://github.com/lidge-jun/agbrowse/issues/62) | G02, G03 |
| 7 | [G07](07_g07.md) — Persistent action memory / repeatable action cache | P1 | M | [#63](https://github.com/lidge-jun/agbrowse/issues/63) | G02, G06, G11 |
| 8 | [G01](08_g01.md) — First-party autonomous planner loop | P0 | L | [#64](https://github.com/lidge-jun/agbrowse/issues/64) | G02, G03, G06, G11, G04 |
| 9 | [G05](09_g05.md) — Schema-bound page extraction | P1 | M | [#65](https://github.com/lidge-jun/agbrowse/issues/65) | G02, G06, G09 |
| 10 | [G09](10_g09.md) — Model-adapter surface for planner/extractor | P1 | L | [#66](https://github.com/lidge-jun/agbrowse/issues/66) | G01 |
| 11 | [G08](11_g08.md) — Reference benchmark adapters without score claims | P1 | L | [#67](https://github.com/lidge-jun/agbrowse/issues/67) | G06, G02, G03, G01, G11 |

## Cross-cut invariants

- Every gap respecting the forbidden scope must verify with `npm run gate:all`
  staying green; any new gate is added under `scripts/release-gates.mjs`.
- Every gap that touches a publicly-claimed surface must update
  `structure/CAPABILITY_TRUTH_TABLE.md` and the cli-jaw mirror in the same
  commit (enforced by `gate:truth-table-fresh`).
- Trace evidence must redact prompt/answer per existing trace policy.
- All experimental flags must default off and never appear under "ready" in
  `README.md` or comparison docs.

## Cli-jaw mirror plan

| Gap | cli-jaw mirror impact |
| --- | --- |
| G10 | parity required for claim text and skill-surface wording. |
| G04 | none, because cli-jaw does not expose browser MCP tools. |
| G02 | parity required, because target resolver/action-intent are mirrored surfaces. |
| G06 | parity optional unless cli-jaw claims observation-bundle parity. |
| G03 | parity required for any public cross-repo browser-primitive claim. |
| G11 | none; cli-jaw does not mirror trace. |
| G07 | parity required if resolver/cache behavior is claimed cross-repo. |
| G01 | parity required if marketed cross-repo; otherwise parity optional while experimental. |
| G05 | parity optional until cli-jaw publicly claims page-extraction parity. |
| G09 | parity optional until cli-jaw exposes planner/extractor model flags. |
| G08 | none; cli-jaw can consume trajectory bundles later. |
