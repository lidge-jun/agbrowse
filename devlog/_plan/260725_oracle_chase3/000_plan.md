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

The real dependency shape is a fan-out, not a chain:

```
WP1 (roadmap lock) ──┬── WP2  G1b        (shared stop/streaming primitives)
                     ├── WP3  issue #81  (composer menu surface)
                     ├── WP4  G13b       (provider interstitial wiring)
                     └── WP5  G16-G18    (Work-surface detection)
                                   └──── WP6 (close-out: promote, gates, push)
```

WP2-WP5 touch disjoint modules and may run in any order; only WP1 (which locks the
roadmap) and WP6 (which consumes all of them) are ordering constraints. They are listed
WP2→WP5 for execution bookkeeping, not because each consumes the previous one.

| WP | Doc | Scope | Why here |
|----|-----|-------|----------|
| WP1 | this file + 010/020/030/040 | docs only | roadmap lock, no code |
| WP2 | `010_stop_scope_migration.md` | G1b — migrate remaining page-wide stop/streaming probes onto the scoped primitives from `5e59a9f` | touches the shared detection layer other phases read; goes first |
| WP3 | `020_composer_popover_menu.md` | issue #81 — composer connector/plugin selection on `.popover` DOM | independent surface (composer menu), user-visible bug |
| WP4 | `030_interstitial_grok_gemini.md` | G13b — consume interstitial verdicts on Grok/Gemini submit paths | mirrors the landed ChatGPT wiring |
| WP5 | `040_work_surface_disposition.md` | G16-G18 — Work-surface normalization / detection / fail-closed | re-verify then implement-or-disposition |
| WP6 | (close-out) | promote unit, sync counts, gates, push | last |

## 4. Constraints

- Test runner is Vitest: `npm run test:unit` (baseline 147 files / 1450 tests green,
  independently re-run by the A-gate reviewer this round: 147/1450, exit 0).
  Docs gates: `npm run docs:drift`, `npm run docs:counts`. WP5 additionally runs
  `npm run typecheck:checkjs-dom`. Integration Playwright
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

## 6. Audit amendments (A-gate round 1, reviewer Schrodinger — Sol, independent)

Verdict of round 1 was **FAIL** with 10 blockers (3 High, 6 Medium, 1 Low). All 10 were
verified against source by the main agent and folded back:

| # | Sev | Where folded |
|---|-----|--------------|
| 1 | High | `040` §6.1 — probe rewritten to aggregate anchors, exact id, same-origin |
| 2 | High | `040` §6.3 — fail-closed on unresolved at the model-mutation boundary |
| 3 | Med | `040` §6.4 — G16 rebuttal corrected: product deferral, not architectural bar |
| 4 | High | `020` §5 — composer-owned container resolution replaces page-global selectors |
| 5 | Med | `030` §5 — dead new-chat wiring dropped; behavioral tests replace string checks |
| 6 | Med | `040` §6.5 — `'conversation'` ui kind dropped; consumers traced |
| 7 | Med | `040` §6.2 — single bounded `evaluate` |
| 8 | Med | `010` §5 — shared helper exported so the predicate is testable |
| 9 | Med | `010` §5, `020` §5 — helper diffs written in full |
| 10 | Low | anchors corrected in `020` §5, `030` §5, `040` §6.6 |

The reviewer also independently confirmed the upstream NOOP claim
(`rev-list --count 6009d4ad..origin/main` = 0), that issue #81 is still open with no
comments, and that `jsdom` is a devDependency (package.json:94, 26.1.0).

## 7. Audit amendments (A-gate round 2, same reviewer)

Round 2 verdict was again **FAIL**, with 4 blockers — all of them consequences of the
round-1 amendments themselves, and all accepted after source verification:

| # | Sev | Finding | Where folded |
|---|-----|---------|--------------|
| 1 | High | `closest('form')` anchoring cannot see the repo's own menu layout (fixture `chatgpt-gpt56-chat.html:48-63` puts the menu outside the form) and `CSS.escape` does not exist in Node | `020` §6.1 — open-delta container resolution + Node-safe id selector |
| 2 | High | `probe-failed` / `no-evaluate` were treated as "on a conversation", which would fail-close existing passing tests (`chatgpt-model.test.mjs:944-947`) and transient navigation | `040` §7.1 — URL established in Node before evaluating; guard keys off a positively parsed `conversationId` |
| 3 | Med | pinning the `More` lookup to the parent container breaks sibling/portaled submenus (fixture `:138-140`) | `020` §6.2 — re-resolve the submenu by post-expansion delta |
| 4 | Med | `detect(...).catch(...)` breaks on a sync detector, and the seam rode on public `input` | `030` §6.1 — `Promise.resolve().then(...)`, `typeof` guard, seam moved to internal `deps` |

Round 2 also confirmed the round-1 fixes landed: blockers 1, 3, 5, 6, 7, 8, 9 and the
anchor corrections are closed, `ensureWorkSurface` ordering is correct
(`chatgpt-work-picker.mjs:237-239` returns for `surface==='work'` before the legacy throw
at `:241-249`), and the fan-out phase map is dependency-accurate.

## 8. Audit round 3 — LOOP-REPAIR-01 replan

Round 3 returned **FAIL** with 2 blockers. Round-2 blockers 3 and 4 were confirmed closed
(`deps` is in lexical scope at `grok-live.mjs:102-155` and `gemini-live.mjs:140-201`; the
promise normalization covers sync/throw/reject), but the composer-menu fix failed a third
consecutive round on the same theme: *how do we know which menu is ours*.

Three failed repairs of one failure is the LOOP-REPAIR-01 threshold, so WP3's approach was
replanned rather than patched again (`020` §7):

| Round | Approach | Why it died |
|-------|----------|-------------|
| 1 | page-global `.popover` selectors | any unrelated popover suppresses the plus click / wrong-row click |
| 2 | `closest('form')` ancestry | the repo's own fixture puts the menu outside the form; portals break it |
| 3 | before/after visible-container fingerprints | fingerprint coordinate systems differ; unrelated container can look "new" |
| **4 (now)** | **one in-page evaluation returning a row index, ownership tiers, ambiguity fails closed** | no cross-snapshot identity, no ancestry, no geometry |

The fourth shape removes the class of bug rather than another instance of it: node identity
is resolved where identity is free (inside the page), and any residual ambiguity produces
the existing "not selected" warning instead of a guessed click.

Round-3 blocker 2 (`040` §8.1) is separate and accepted: the conversation precheck now
parses `pathname` with an anchored match and passes the expected id into the probe, so
query/fragment lookalikes are excluded and a navigation between check and probe fails closed
as `navigation-race`.

## 9. Audit round 4 — fresh reviewer, final amendments

The replanned WP3 went to a **fresh** reviewer (REVIEW-DECORRELATE-01: the previous one had
shaped the redesign and could not judge it independently). Verdict FAIL, 7 blockers, each
with an executed reproduction rather than an argument. All accepted:

| # | Sev | Finding | Where folded |
|---|-----|---------|--------------|
| 1 | High | `page.evaluate(stringExpression, arg)` silently drops the argument, so the Work probe would have thrown `ReferenceError` on **every** conversation and blocked all model mutation | `040` §9.2 — probe is a real exported function |
| 2 | High | `unique-label` ownership tier let a lone unrelated popover holding a "GitHub" row be clicked without opening the composer menu | `020` §8.2 — tier deleted; ownership is positive evidence only |
| 3 | High | nested `.popover > [role="menu"]` collected the same row twice -> spurious `ambiguous` on an ordinary menu | `020` §8.2 — per-node dedup via `Map` |
| 4 | Med | jsdom returns all-zero rects, so the planned resolver tests could not run | `020` §8.2/§8.5 — injectable `isVisible` predicate |
| 5 | Med | helper diffs missing; empty-label contract contradicted the resolver | `020` §8.3 — complete Node side, guard clauses, contract defined |
| 6 | High | the private URL regex rejected GPT-prefixed conversations that `conversation-url.mjs` accepts, and `page.url()` was uncaught | `040` §9.1 — reuse `extractDurableConversationId`, wrap in try/catch |
| 7 | Med | Grok/Gemini empty-shell was claimed but `empty-shell` is host-gated to ChatGPT | `030` §7 — scope narrowed to challenge/login; empty-shell becomes G13c, deferred |

Blockers 1 and 6 are the ones worth remembering: both would have shipped as silent
regressions of a path that currently works, and neither was reachable by reading the plan —
the reviewer found them by executing the transport and diffing against the repo's own
parser contract.

### Audit history for this work-phase

| Round | Reviewer | Verdict | Blockers | Outcome |
|-------|----------|---------|----------|---------|
| 1 | Schrodinger (Sol) | FAIL | 10 | folded |
| 2 | Schrodinger | FAIL | 4 | folded |
| 3 | Schrodinger | FAIL | 2 | LOOP-REPAIR-01 replan of WP3 |
| 4 | Mill (Sol, fresh) | FAIL | 7 | folded; final specs in `020` §8, `040` §9, `030` §7 |
| 5 | Mill | FAIL | 2 | folded; ownership completed in `020` §9, checkJs in `040` §10 |
| 6 | Mill | FAIL | 4 | folded; DOM marks replaced by a page-local registry in `020` §10 |
| 7 | Mill | FAIL | 3 | folded; serialization + liveness corrections in `020` §11 |
| 8 | Mill | **GO-WITH-FIXES (1)** | 1 | folded; type narrowing in `020` §12 — **A gate exits here** |

Round 5 executed the round-4 specification and found the decisive gap: the tightened
ownership rule closed the wrong-row click but returned `no-owned-menu` for the **issue-#81
DOM itself** — a connector-only popover with no `aria-controls` and no tool phrase. The fix
would have shipped without fixing the bug it exists for. `020` §9 adds a third ownership
source: containers are marked in-page before the plus click, and the container that appears
unmarked afterwards is ours (`appeared-on-open`, ranked between `aria-controls` and
`menu-text`). Identity comparison stays inside one page context, so the round-3
cross-snapshot failure mode does not return.

Round 5 also compiled both final code blocks and found four TS7006/TS2339/TS2304 errors that
would fail `npm run typecheck:checkjs-dom` — now a required gate for WP3 and WP5
(`020` §9.3, `040` §10).

Round 6 confirmed every happy path of the round-5 design (issue-#81 resolves as
`appeared-on-open`, the marked-unrelated case excludes correctly, `marksApplied:false` fails
closed, both earlier reproductions unchanged, and the type amendments compile clean with an
empty error list) but found four defects in the *bookkeeping*: a failed mark evaluation
silently enabled the causal tier, the marker recorded hidden pre-rendered menus, cleanup
could leak or replace the primary error, and the tier ranking was never actually implemented
in the dedup map. `020` §10 replaces DOM attributes with a page-local `WeakSet` registry
plus an explicit rank map: a failed snapshot yields no token and disables the tier, the
snapshot applies the same visibility predicate as the resolver, and there is no cleanup path
to leak because nothing is written to the document.

Round 7 is the round that justifies the whole exercise. Running §10 through **real
Playwright** instead of direct jsdom calls produced
`ReferenceError: REGISTRY_KEY is not defined` for both browser-context functions:
`page.evaluate` serializes a function body, not its module bindings. Every jsdom test would
have passed while production silently disabled the ownership tier and left issue #81 broken.
`020` §11 makes both serialized functions closed over nothing, adds mandatory real-transport
tests for every browser-context helper in this unit, disables the causal tier when any
snapshotted container was replaced (round-7's `cloneNode` reproduction produced a wrong-row
click), and fixes the `TS7015` `Window` indexing with a narrowed scope cast.

**Rule adopted for this repo going forward:** a function passed to `page.evaluate` must
declare every constant it uses inside its own body, and must be proven by a real transport
round trip — a direct in-process call is not evidence that it works in a page.

Round 8 verified the round-7 fixes by execution: real Playwright transport returns
`{"ok":true,"token":1,"count":0}` and then `{"index":0,"ownership":"appeared-on-open"}` for
the issue-#81 DOM with no `ReferenceError`; the `cloneNode` replacement reproduction now
returns `no-owned-menu`; all seven direct-call scenarios are unchanged; jsdom 26.1.0
supports `isConnected`; and a real navigation destroys the registry. The single remaining
blocker was a `TS18048` narrowing issue, folded as `020` §12.

**A-gate exit: near-pass.** Eight rounds, 33 blockers, every one verified against source or
by execution before folding, none rebutted on grounds the reviewer disputed. The two
reviewers between them caught six defects that would have shipped as silent regressions —
most importantly the `page.evaluate` serialization failure, which would have left issue #81
broken while the entire test suite stayed green.

Four FAIL rounds on a docs-only phase is itself the finding: this unit's value was never the
prose, it was catching six would-be shipped regressions before a single line of production
code existed.
