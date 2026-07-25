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
| G7 | over-broad `includes('thought for')` at `chatgpt.mjs:939-958` | that code is GONE — `5e59a9f` replaced it with `readChatGptStreamingState`, which uses a **visible-text** anchored predicate at `chatgpt-response-dom.mjs:208`: `/^thought for \d+[a-z]*( seconds?| minutes?)?( edit)?$/i` | **Covered** — the anchored, visible-text-only grammar the row asked for already exists |
| G12 | no anchored `Thought for <duration> [Edit]` predicate | same line: the `( edit)?` group is present | **Covered** by the same predicate |
| G9 | over-broad summary exclusion + unscoped busy signals | the exclusion is now anchored (above); busy/shimmer signals were never adopted, so there is no global-busy false positive to fix | **Partially covered**; the残 residue is the grammar's own strictness — see §3.1 |
| G8 | single boolean `isStreaming`, text-only sidecar vetoes as hard as a stop button | still true: `readChatGptStreamingState` returns `boolean` (`chatgpt-response-dom.mjs:60`) and the text-only sidecar branch at `:209-211` returns the same `true` as the stop-button branch at `:90-99` | **Open** — WP2 |
| G11 | wrapperless completion correlation | still true: `resolveTopLevelAssistantTurns` only resolves configured role wrappers (`chatgpt-response-dom.mjs:87-118`) and returns `[]` for wrapperless markdown | **Open** — WP3 |
| G28 | DR wrapper placeholder recognition | still true: `isIncompleteDeepResearchText` matches only first-line status markers and a 120-char floor (`chatgpt-deep-research-report.mjs:10-45`); a tool-call wrapper placeholder is neither | **Open** — WP4 |
| G13c | provider-aware empty-shell | still true: `interstitial.mjs:90` gates `empty-shell` on ChatGPT hosts | **Open** — WP5 |
| G81b | aria-controls from the triggering row | still true: `chatgpt-menu-resolver.mjs` reads `aria-controls` only from plus-button selectors | **Open** — WP6 |
| G25 | zh locale labels | still true: `chatgpt-model.mjs` label tables are en/ko only | **Decide** — WP6 |
| G16 | Work→Chat normalization | still true by design; round 4 recorded it as a product decision | **Decide** — WP7 |
| G10 | weak-evidence aging | superseded upstream by `67da293a` | **Permanently not ported** (unchanged) |

### 3.1 G9 residue

The anchored predicate at `chatgpt-response-dom.mjs:208` only skips a panel whose
ENTIRE visible text is the completed summary. Upstream `86d1fb2b` additionally
keeps `Thought for 2s: Searching…` classified as LIVE — which our predicate also
does, because that string does not match the anchored pattern and falls through to
the `includes('thinking')` branch. So the behavior matches; what is missing is a
test proving it. G9's residue is therefore **test debt, not code debt**, and it is
folded into WP2's matrix rather than getting its own cycle.

## 4. Revised work-phase map

Triage collapses the original 7 implementation phases into 5:

```
WP1 (this triage) ──┬── WP2  G8 + G9-residue   activity strata
                    ├── WP3  G11              wrapperless correlation
                    ├── WP4  G28              DR wrapper placeholders
                    ├── WP5  G13c             provider empty-shell
                    ├── WP6  G81b + G25       menu ownership + locale decision
                    └── WP7  G16              normalization decision
                                    └──────── WP8 close-out
```

G7 and G12 need no cycle: they are Covered, and WP2's test matrix pins the
behavior so a future edit cannot silently un-cover them.

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
- Push only at WP8, `dev` only, no force-push, no PR.
