# WP9 — Round 5 close-out

Diff-level plan for the close-out cycle. Evidence tables are filled at WP9; the
STEPS below are fixed now so the phase is executable rather than improvised
(A-gate round 2, blocker 7).

## 0. Executable steps

1. **Fill §1-§2** from the goalplan's `capturedEvidence` — no re-derivation from
   memory.
2. **Promote:** `git mv devlog/_plan/260726_oracle_chase4 devlog/_fin/260726_oracle_chase4`
   (the directory is gitignored, so the follow-up `git add -f devlog/_fin/...` is
   mandatory).
3. **Sync counts** in `structure/str_func.md`. The gate is ALREADY red from this
   round's docs — measured at the round-2 audit:

   ```
   FAIL devlog/ count drift: doc 553 files/77835 lines vs actual 562 files/79526
   ```

   Every implementation phase re-runs `npm run docs:counts` and syncs its own rows
   (`web-ai/`, `test/unit/`, `test/integration/`, per-file line rows). WP9 syncs the
   final `devlog/` row LAST, after promotion, because promotion itself changes the
   file count. Rows to touch: `devlog/`, plus any `web-ai/*.mjs` line row the
   implementation phases moved.
4. **Fresh gates, in this order:** `npm run test:unit`, `npm run docs:drift`,
   `npm run docs:counts`, then scoped `npx tsc --noEmit -p tsconfig.checkjs-dom.json`
   filtered to touched files. Playwright smokes are NOT run and NOT claimed green.
5. **Push:** `git push origin dev`, then `git rev-parse dev` and
   `git rev-parse origin/dev` must match; record both.
6. **Close the FSM** through D and `cxc loop validate`.

## 1. Outcome

_(Terminal outcome per work-phase with commit SHAs.)_

| WP | Rows | Commit | Result |
|----|------|--------|--------|
| WP1 | triage | `b799188` + amendments | — |
| WP2 | G7/G9/G12/G8 | | |
| WP3 | G11 | | |
| WP4 | G28 | | |
| WP5 | G13c | | |
| WP6 | G81b | | |
| WP7 | G25 | | |
| WP8 | G16 | | |

## 2. Final gap-matrix state

_(Every row from rounds 3-5 with its terminal disposition. The goal of this round is
that no row remains in "Deferred" without a permanent reason.)_

## 3. Gate evidence

_(Fresh `test:unit`, `docs:drift`, `docs:counts` output; Playwright smokes named as
the pre-existing missing-Chromium baseline; scoped checkJs.)_

## 4. Push

_(`git push origin dev` output plus `rev-parse dev` / `rev-parse origin/dev`.)_

## 5. Next round

_(Anchor for round 6 and whether the clone needs refreshing.)_
