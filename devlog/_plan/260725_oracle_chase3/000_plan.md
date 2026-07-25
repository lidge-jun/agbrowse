# 260725 Oracle Chase — Round 4 (backlog closure round)

Date: 2026-07-25
Branch: `dev` (local, ahead of `origin/dev`)
Predecessor unit: `devlog/_fin/260724_oracle_chase2/`
Upstream clone: `/tmp/oracle-chase-260724` (`https://github.com/steipete/oracle`)

## 1. Objective

Round 3 closed the upstream delta `1146107..6009d4ad` and left an explicit deferred
list in `040_gap_matrix.md`. This round does three things:

1. Re-verify the upstream delta from a freshly fetched clone (is there anything new
   to chase?).
2. Close the deferred rows that are real product risk: **G1b**, **G13b**, and the
   **G16-G18** Work-surface unit.
3. Fix the one open GitHub issue (**#81**, ChatGPT connector selection against the
   current popover DOM) and push the accumulated `dev` work to origin.

## 2. Upstream re-verification (WP1 evidence)

```
$ cd /tmp/oracle-chase-260724 && git fetch --all --tags
$ git rev-parse origin/main
6009d4ad167b4f09c050ad22f19de5dfaf71504a
$ git log -1 --format='%ci %h %s' origin/main
2026-07-23 07:37:16 -0700 6009d4ad chore(changelog): open 0.16.2
$ git log --oneline 6009d4ad..origin/main | wc -l
0
$ git tag --sort=-creatordate | head -1
v0.16.1
```

**Verdict: the upstream anchor has not moved.** `steipete/oracle` main HEAD is still
`6009d4ad` — the exact anchor Round 3 closed against — and the newest tag is still
`v0.16.1`. The only commits with newer authorship anywhere in the clone are two
dependabot branch commits (`4a18804b`, `3d63389a`) that are not on `main`.

Consequence: the delta-tracking half of this round is a verified **NOOP**. No new
upstream behavior exists to port, so every implementation work-phase below is sourced
from the Round-3 deferred rows or from the local issue tracker, not from a new diff.
The anchor for Round 5 remains `6009d4ad` until upstream moves.

## 3. Work-phase map (dependency-ordered, PHASE-SPLIT-01)

The ordering is by blast radius on shared detection primitives, so each phase consumes
a settled foundation:

| WP | Doc | Scope | Why here |
|----|-----|-------|----------|
| WP1 | this file + 010/020/030/040 | docs only | roadmap lock, no code |
| WP2 | `010_stop_scope_migration.md` | G1b — migrate remaining page-wide stop/streaming probes onto the scoped primitives from `5e59a9f` | touches the shared detection layer other phases read; goes first |
| WP3 | `020_composer_popover_menu.md` | issue #81 — composer connector/plugin selection on `.popover` DOM | independent surface (composer menu), user-visible bug |
| WP4 | `030_interstitial_grok_gemini.md` | G13b — consume interstitial verdicts on Grok/Gemini submit paths | mirrors the landed ChatGPT wiring |
| WP5 | `040_work_surface_disposition.md` | G16-G18 — Work-surface normalization / detection / fail-closed | re-verify then implement-or-disposition |
| WP6 | (close-out) | promote unit, sync counts, gates, push | last |

## 4. Constraints

- Test runner is Vitest: `npm run test:unit` (baseline 147 files / 1450 tests green).
  Docs gates: `npm run docs:drift`, `npm run docs:counts`. Integration Playwright
  smokes (`post-action-smoke`, `self-heal-smoke`) fail at baseline for a missing
  Chromium binary — pre-existing, never to be reported as a regression or as green.
- `devlog/` is gitignored: add with `git add -f`.
- No push except the explicitly approved final `git push origin dev`. No force-push,
  no other branch, no PR creation.
- Do not commit `.codexclaw/ledger.jsonl`, `.codexclaw/render-observations.jsonl`, or
  the other session's `.codexclaw/goalplans/agbrowse-pr-86-*` directory.
- Every new conditional branch needs a test that actually drives it
  (C-ACTIVATION-GROUNDING-01). "Suite is green" is not activation evidence.

## 5. Out of scope

- Rewriting or amending Round-3 commits `ca3e7dd..6ae8c61`.
- G7-G12 (terminal-gate P2 grammar/strata), G25 (zh locale), G28 (DR wrapper) — still
  deferred, unchanged rationale in Round 3's `040_gap_matrix.md`.
- G10 — deliberately not ported; superseded upstream by `67da293a`.
