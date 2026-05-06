# Benchmark Adapters — Trajectory Capture Without Score Claims

> **Status: experimental.** agbrowse provides reference benchmark adapters
> for collecting **trajectory bundles only**. agbrowse makes **no leaderboard
> claims, no head-to-head score comparisons, and no published success rates**
> against any of the benchmarks below. This file exists to document what
> we will and will not say.

## Forbidden invariants (binding)

These rules apply to every adapter under `web-ai/eval-adapters/`:

- ❌ Never publish or auto-upload scores or success rates.
- ❌ Never claim "X% on WebVoyager" / "Y on WebArena" / "rank N on Mind2Web" in any user-visible surface (CLI help, README, structure/, devlog/_release/, truth table).
- ❌ Never call external grading services from an adapter.
- ✅ Always set `scoreClaim: null` on every materialised descriptor and dry-run result.
- ✅ Score claims require a fixed planner / fixed model / fixed env / fixed task-set + an explicit release-note review.

## Adapters

| Adapter | Source | Status | Surface |
| --- | --- | --- | --- |
| `webvoyager` | https://github.com/MinorJerry/WebVoyager | experimental dry-run | `web-ai/eval-adapters/webvoyager.mjs` (`parseWebVoyagerJsonl`, `rowToDescriptor`, `dryRunWebVoyager`) |
| `webarena` | https://github.com/web-arena-x/webarena | deferred | not implemented |
| `visualwebarena` | https://github.com/web-arena-x/visualwebarena | deferred | not implemented |
| `mind2web` | https://osu-nlp-group.github.io/Mind2Web/ | deferred | not implemented |

The deferred adapters are documented as scope, not capability. They will
land only when their parent gaps (G06 ObservationBundleV1, G02
observe-actions, G03 action breadth, G01 planner-loop, G11 trace
timeline) all stay green and the adapter can be added without a score
claim.

## Score claim policy

Before any score claim is added to any agbrowse surface:

1. Fixed planner version recorded in trajectory bundle metadata.
2. Fixed model version recorded.
3. Fixed env / browser fingerprint recorded.
4. Fixed task-set + task-set hash recorded.
5. Reviewer (not author) signs `devlog/_release/score-claim-review.md`.

Until all five are met, every adapter must keep `scoreClaim: null` in
its outputs and every release-gate scan must keep `gate:eval-adapters-no-score-claims`
green.

## Gate

`npm run gate:eval-adapters-no-score-claims` walks the adapter directory
and asserts no string match against the forbidden score patterns
(`/leaderboard/i`, `/% on WebVoyager/i`, `/score:\s*\d/i`, `/rank:\s*\d/i`).
It also imports each adapter and asserts every public dry-run result
includes `scoreClaim: null`.
