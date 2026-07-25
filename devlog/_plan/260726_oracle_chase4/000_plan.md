# 260726 Oracle Chase — Round 5 (backlog exhaustion round)

Date: 2026-07-26
Branch: `dev` (round 4 pushed as `e5623a0`)
Predecessor units: `devlog/_fin/260724_oracle_chase2/`, `devlog/_fin/260725_oracle_chase3/`
Upstream clone: `/tmp/oracle-chase-260724`

## 1. Objective

Close every remaining deferred row, or convert it into a permanent
evidence-backed disposition. After this round the backlog should be empty: no row
may stay in "Deferred" limbo without a stated reason that is not "later".

## 2. Upstream re-verification

```
$ git -C /tmp/oracle-chase-260724 fetch --all --tags
$ git rev-parse origin/main
6009d4ad167b4f09c050ad22f19de5dfaf71504a
$ git log --oneline 6009d4ad..origin/main | wc -l
0
$ git log -1 --format='%ci %h %s' origin/main
2026-07-23 07:37:16 -0700 6009d4ad chore(changelog): open 0.16.2
$ git tag --sort=-creatordate | head -1
v0.16.1
```

**NOOP again.** Third consecutive round with the anchor at `6009d4ad`. Upstream
has been quiet since 2026-07-23; nothing new to port.

## 3. Deferred-row re-triage against the CURRENT tree

Rounds 3 and 4 rewrote large parts of the files these rows were written against,
so every row was re-read before planning. This is the load-bearing part of WP1:
two rows turn out to be already closed, and one is narrower than recorded.

| Row | Recorded gap (round 3) | Current tree | New disposition |
|-----|------------------------|--------------|-----------------|
| G7 | over-broad `includes('thought for')` at `chatgpt.mjs:939-958` | that code is gone, but its replacement at `chatgpt-response-dom.mjs:208` is far NARROWER than upstream — see §3.1 | **Open (code debt)** — WP2 |
| G12 | no anchored `Thought for <duration> [Edit]` predicate | the `( edit)?` group exists but only inside the too-narrow pattern | **Open** — WP2, same grammar |
| G9 | over-broad summary exclusion + unscoped busy signals | busy/shimmer were never adopted (no global-busy false positive to fix), but the anchored grammar is missing upstream's live-trace re-entry rule | **Open** — WP2 |
| G8 | single boolean `isStreaming`, text-only sidecar vetoes as hard as a stop button | still true: `readChatGptStreamingState` returns `boolean` (`chatgpt-response-dom.mjs:60`) and the text-only sidecar branch at `:209-211` returns the same `true` as the stop-button branch at `:90-99` | **Open** — WP2 |
| G11 | wrapperless completion correlation | still true: `resolveTopLevelAssistantTurns` only resolves configured role wrappers (`chatgpt-response-dom.mjs:87-118`) and returns `[]` for wrapperless markdown | **Open** — WP3 |
| G28 | DR wrapper placeholder recognition | still true: `isIncompleteDeepResearchText` matches only first-line status markers and a 120-char floor (`chatgpt-deep-research-report.mjs:10-45`); a tool-call wrapper placeholder is neither | **Open** — WP4 |
| G13c | provider-aware empty-shell | still true: `interstitial.mjs:90` gates `empty-shell` on ChatGPT hosts | **Open** — WP5 |
| G81b | aria-controls from the triggering row | still true: `chatgpt-menu-resolver.mjs` reads `aria-controls` only from plus-button selectors | **Open** — WP6 |
| G25 | zh locale labels | still true: `chatgpt-model.mjs` label tables are en/ko only | **Decide** — WP6 |
| G16 | Work→Chat normalization | still true by design; round 4 recorded it as a product decision | **Decide** — WP7 |
| G10 | weak-evidence aging | superseded upstream by `67da293a` | **Permanently not ported** (unchanged) |

### 3.1 G7/G9/G12 — the triage error, corrected (A-gate round 1, blocker 1)

The first draft of this triage called G7 and G12 **Covered**. That was wrong, and it
was the most damaging error possible in this unit: it would have marked real work as
done and shipped a still-broken grammar. The reviewer measured the actual behavior of
`chatgpt-response-dom.mjs:208`:

```text
Reasoning Thought for 12s     completed=false  (streaming=true)   <- WRONG, hangs forever
Thought for 2 minutes         completed=true
Thought for a moment          completed=false  <- worded duration unhandled
Thought for 1m 5s             completed=false  <- compound duration unhandled
Thought for 2s: Searching...  completed=false  and NOT live either <- worst case
```

Upstream `86d1fb2b:src/browser/actions/thinkingStatus.ts:537-538` is much wider:

```js
/^(?:(?:reasoning|pro thinking)\s*)?thought for (?:\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)(?:\s+\d+(?:\.\d+)?\s*(?:...))*|(?:a|an) [a-z]+(?: [a-z]+){0,2})$/
```

— optional `reasoning`/`pro thinking` heading prefix, decimals, unit aliases,
compound durations, and worded durations (`a moment`, `a few seconds`).

And crucially `:618` adds the re-entry rule our port dropped entirely:

```js
if (isCompletedSummary(visible)) return false;
if (visible.includes('thought for ')) return true;   // a GROWING trace is LIVE
```

That second line is what makes `Thought for 2s: Searching…` read as live. Our port
has no such rule: the string fails the anchored test, then fails the
`includes('thinking')` test, and the panel is reported as no activity at all.

The existing test at `test/unit/web-ai-chatgpt-response-fragments.test.mjs:173` passes
only because its fixture happens to contain the word `Reasoning` elsewhere — a
false-confidence test, which is exactly why the triage was fooled.

**G7, G9 and G12 are therefore Open code debt**, folded into WP2 alongside G8.

## 4. Revised work-phase map (corrected, A-gate round 1 blocker 9)

Seven implementation phases (WP2-WP8), ordered by dependency rather than size:

```
WP1 (this triage)
  │
  ├─ WP2  G7+G9+G12+G8   activity grammar and strata      (owns chatgpt-response-dom activity)
  │     └─ WP3  G11      wrapperless correlation           (needs WP2's transport test harness
  │                                                         and touches the same module)
  ├─ WP4  G28            DR wrapper placeholders           (independent module)
  ├─ WP5  G13c           provider empty-shell              (independent module)
  ├─ WP6  G81b           menu ownership                    (independent module)
  ├─ WP7  G25            zh locale                         (independent module)
  └─ WP8  G16            Work→Chat opt-in normalization    (independent module)
        └────────────── WP9 close-out
```

**WP2 → WP3 is a real dependency**, not a preference: WP3's tests reuse the
transport harness WP2 creates, and both edit the activity/completion path of
`chatgpt-response-dom.mjs`. Running them in one B would violate the
one-work-phase-one-cycle invariant; running WP3 first would mean writing its tests
against a harness that does not exist.

G81b and G25 were originally bundled as "two small rows". Size is not a dependency,
so they are split into WP6 and WP7: they touch different modules
(`chatgpt-menu-resolver.mjs` vs `chatgpt-model.mjs`) and share nothing.

The goalplan `workPhases[]` is amended to match this map.

## 5. Constraints

- Vitest baseline entering this round: **152 files / 1529 tests**.
- Gates: `npm run test:unit`, `npm run docs:drift`, `npm run docs:counts`.
  Playwright smokes fail at baseline (missing Chromium) — never claimed green.
  `typecheck:checkjs-dom` is red repo-wide (186 diagnostics); the bar is zero NEW
  diagnostics in touched files.
- **Serialization rule (round-4 lesson, STRICT):** any function passed to
  `page.evaluate` declares every constant inside its own body and is proven by a
  real transport round trip. A direct in-process call is not evidence.
- **Ownership rule (round-4 lesson):** causality and ownership come from positive
  evidence; "assume it's ours unless proven otherwise" produced a wrong-click path
  in every variant tried.
- `devlog/` is gitignored — `git add -f`.
- Push only at WP9 (the close-out phase), `dev` only, no force-push, no PR.
