# WP6 — Round 4 close-out

## 1. Outcome

**DONE.** Six work-phases, each a full PABCD cycle with an independent Sol reviewer at its
A gate. The upstream-delta half of the round is a verified **NOOP**; the value delivered is
the deferred backlog plus the one open issue.

| WP | Scope | Commit | Result |
|----|-------|--------|--------|
| WP1 | roadmap unit (docs only) | `28988e9`, `60ccf29` | 8 audit rounds, 33 blockers folded |
| WP2 | G1b stop-probe scoping | `f361a0b` | shared `anyStopButtonVisible` + `scopeToMainRegion`, 3 callers migrated |
| WP3 | issue #81 connector selection | `6aeb656` | new resolver module, 5 implementation-audit rounds |
| WP4 | G13b Grok/Gemini interstitials | `63dd5d7` | shared classifier, 2 rounds |
| WP5 | G17/G18 Work-surface detection | `4dad538` | conversation probe + fail-closed guard, 2 rounds |
| WP6 | close-out | this doc | gates, promotion, push |

## 2. Gap-row dispositions (updates to Round 3's `040_gap_matrix.md`)

| Row | Round 3 state | Round 4 state |
|-----|---------------|---------------|
| G1b | Deferred | **Implemented** (WP2) |
| G13b | Deferred | **Implemented** for challenge/login (WP4) |
| G16 | Deferred | **Deferred — product/UX decision**, rationale corrected in `040` §6.4 |
| G17 | Deferred | **Implemented** (WP5) |
| G18 | Deferred | **Implemented**, narrowed: fail-closed at the model-mutation boundary only |
| issue #81 | not tracked | **Fixed** (WP3) |

New follow-up rows opened this round:

- **G13c** — provider-aware `empty-shell` for Grok/Gemini. `interstitial.mjs:90` gates that
  verdict on ChatGPT hosts; widening it needs a characterization pass for two providers
  whose loading behavior we have not measured (`030` §7).
- **G81b** — read `aria-controls` from the triggering row, not only the composer plus
  button, if a live probe ever shows a hover-only submenu with no composer-menu text
  (`020` §13.1).

Still deferred, unchanged: G7-G12, G25, G28. G10 remains deliberately not ported.

## 3. What the audits actually bought

Six defects were caught before a single line reached `dev`, each one silent under a green
test suite:

1. **`page.evaluate` serialization** (plan round 7) — module constants do not travel into
   the page. Every jsdom test would have passed while production threw `ReferenceError`,
   permanently disabling composer-menu ownership and leaving issue #81 broken.
2. **String-expression arguments** (plan round 4) — `page.evaluate(stringExpr, arg)` drops
   the argument, which would have made every Work-conversation probe fail and blocked model
   selection on every conversation page.
3. **Ownership that did not fix the bug** (plan round 5) — the tightened rule returned
   `no-owned-menu` for the exact issue-#81 DOM.
4. **Stale epoch clicking an unrelated popover** (impl round 2) — reproduced through the
   public API, not by inspection.
5. **A label-specific open-check** (impl round 3) — broke the `More` path entirely.
6. **An unrelated `role=radio` bypassing conversation detection** (WP5 round 1) — a Work
   conversation read as "no surface" and model mutation was permitted.

Two lessons are worth carrying forward, recorded as repo rules in `000` §8:

- A function passed to `page.evaluate` must declare every constant inside its own body, and
  must be proven by a real transport round trip. A direct in-process call is not evidence.
- Ownership/causality must come from positive evidence. Every "assume it's ours unless
  proven otherwise" variant this round produced a wrong-click path.

## 4. Final gate evidence

```
npm run test:unit    -> Test Files 152 passed (152), Tests 1529 passed (1529), exit 0
npm run docs:drift   -> All structure drift checks passed (164)
npm run docs:counts  -> All structure count checks passed (76)
```

Baseline at the start of the round was 147 files / 1450 tests; this round adds 5 files and
79 cases.

Not run, and deliberately not claimed green: the Playwright integration smokes
(`post-action-smoke`, `self-heal-smoke`) fail here for a missing bundled Chromium, which is
the pre-existing baseline. The new `test/integration/composer-menu-transport.test.mjs` was
verified passing by the A-gate reviewer with `AGBROWSE_CHROMIUM_EXECUTABLE_PATH` pointed at
the installed Chrome (1 file / 2 tests).

`npm run typecheck:checkjs-dom` is red at repo baseline (186 diagnostics) and stays that
way; the criterion this round holds itself to is zero diagnostics in touched files, which
is met (`gemini-live.mjs` keeps its 5 pre-existing ones, `chatgpt-model.mjs` its 25).

## 5. Next round

The anchor for Round 5 is still `6009d4ad`. Refresh `/tmp/oracle-chase-260724` before
comparing — it will be stale by then.
