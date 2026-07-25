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
   FAIL devlog/ count drift: doc 553 files/77835 lines vs actual 562 files/79855
   ```

   Every implementation phase re-runs `npm run docs:counts` and syncs its own rows
   (`web-ai/`, `test/unit/`, `test/integration/`, per-file line rows). WP9 syncs the
   final `devlog/` row LAST — not because `_plan` → `_fin` changes the file count
   (it does not; the same 9 files are simply counted under a different directory),
   but because writing this close-out's own content changes the line total. Rows to
   touch: `devlog/`, plus any `web-ai/*.mjs` line row the implementation phases moved.
4. **Fresh gates, in this order:** `npm run test:unit`, `npm run docs:drift`,
   `npm run docs:counts`, then scoped `npx tsc --noEmit -p tsconfig.checkjs-dom.json`
   filtered to touched files. Playwright smokes are NOT run and NOT claimed green.
5. **Push:** `git push origin dev`, then `git rev-parse dev` and
   `git rev-parse origin/dev` must match; record both.
6. **Close the FSM** through D and `cxc loop validate`.

## 1. Outcome

WP1-WP8 each reached D with an independent-reviewer PASS. Each row below is a full
PABCD cycle, not a batched edit. WP9's own result is recorded in §3-§4.

| WP | Rows | Commit | Result |
|----|------|--------|--------|
| WP1 | triage | `b799188^..35d747c` + `efe1c95` | 9 docs / 2783 lines; 11 audit rounds, 33 blockers folded. G7/G12 REOPENED as code debt after the reviewer measured the live predicate; G28 REDESIGNED after reading `e7526efa` |
| WP2 | G7/G9/G12/G8 | `8635ad7` | `readChatGptStreamingState` returns `{strength, evidence}` with the full upstream `86d1fb2b` grammar declared body-local, plus `57d4a7af`'s optional `Edit` and the live-trace re-entry rule. Poll loop: stop-probe first, streaming = strong only, `minStableMs` 5000 when weak-active |
| WP3 | G11 | `1b52e5d` | `readAssistantSnapshotSources` — one document-order union across both sources, per-node dedup, DOM-following filter, realm-safe `FOLLOWING`, `ok` flag; wholesale partial rejection and ok-gated fallback |
| WP4 | G28 | `35eeb25` | Upstream `e7526efa`'s marker list and leading-marker semantics ported and adapted — `DR_TOOL_CALL_MARKERS` with our own `normalizeDeepResearchReportText` and a contextual check after the length floor, rather than upstream's `trimBeforeFirstAnswer` + bare `startsWith`. Improved past upstream with a whole-token boundary after the reviewer showed a legitimate "Used Tools in Modern Oncology" report was swallowed |
| WP5 | G13c | `f59d963` | `emptyShellHostKind` with exact hostname sets, one terminal dot stripped before `www`, and `x.com` gated on an exact `/i/grok` path; only graced providers are re-probed, and `graced` never leaks into the public verdict |
| WP6 | G81b | `d1d4398` | Ownership is conferred from a single OBSERVED element id read off the specific More locator — never a selector — and forwarded through both post-More resolutions |
| WP7 | G25 | `edce15e` | zh implemented via canonical label sets with THREE consumer-specific projections, because one shared projection could not preserve three historically different predicates |
| WP8 | G16 | `661e625` | Opt-in `ensureChatSurface`; chat no-op checked BEFORE the legacy throw, inserted before `selectChatGptModel` whose surface guard rejects Work, warning surfaced to the caller |

### 1.1 What the reviewer caught that the implementation missed

Across the implementation phases WP2-WP8, mutation testing repeatedly exposed
assertions that were green against a deliberately broken implementation. The
recurring failure was the same: asserting on source SHAPE (`src.toContain(...)`)
instead of on BEHAVIOUR through the public path. Representative cases:

- **WP8** is the clearest. The send-path tests stopped before completion, so
  deleting the user-facing warning entirely left all 15 tests green. Only a
  harness that runs `sendWebAi` through to `status: 'sent'` can observe
  `result.warnings`.
- **WP4** shipped a predicate that swallowed a legitimate report titled "Used
  Tools in Modern Oncology" — found by the reviewer constructing the adversarial
  fixture, not by mutation.
- **WP6** ownership was proven only once a test observed the real `evaluate`
  payload rather than the resolver's inputs.

WP1 is docs-only and has no such finding; its 11 audit rounds were factual
corrections to the triage, including reopening G7/G12 as code debt.

Two other standing rules were re-confirmed the hard way: `page.evaluate`
serializes a function BODY and not its module bindings, so browser-context
functions must declare every constant inside themselves and be proven by a real
transport round trip; and a test that fails by TIMEOUT proves nothing, so a
mutation must fail on its assertion to count.

## 2. Final gap-matrix state

The backlog is empty. Every row from the round-3 matrix
(`_fin/260724_oracle_chase2/040_gap_matrix.md`, G1-G34) and every follow-up row
opened in rounds 3-4 (G1b, G13b, G13c, G81b, issue #81) now has a terminal
disposition. No row remains in "Deferred" limbo.

### 2.1 Rows this round closed

| Row | Disposition | Where |
|-----|-------------|-------|
| G7 | **Closed** — anchored grammar with heading prefix, decimals, unit aliases, compound and worded durations | WP2 `8635ad7` |
| G8 | **Closed** — activity split into strong/weak/none strata | WP2 `8635ad7` |
| G9 | **Closed** — live-trace re-entry rule adopted; busy/shimmer deliberately not adopted (no false positive to fix) | WP2 `8635ad7` |
| G11 | **Closed** — wrapperless answers correlated at snapshot acquisition | WP3 `1b52e5d` |
| G12 | **Closed** — optional `Edit` affordance inside the anchored predicate | WP2 `8635ad7` |
| G13c | **Closed** — provider-aware empty shell behind a hydration grace | WP5 `f59d963` |
| G16 | **Closed as opt-in** — the objection was never to the capability, only to doing it silently; it now requires `--normalize-surface` | WP8 `661e625` |
| G25 | **Closed** — zh via canonical label sets, 5530-string differential across six consumers showed zero behavioural change for en/ko | WP7 `edce15e` |
| G28 | **Closed** — tool-call placeholder captures rejected, with a whole-token boundary that upstream lacks | WP4 `35eeb25` |
| G81b | **Closed** — submenu ownership from the observed triggering row | WP6 `d1d4398` |

### 2.2 Rows already terminal before this round

Carried forward unchanged; listed so the matrix is complete rather than partial.

| Rows | Terminal state | Closed in |
|------|----------------|-----------|
| G1, G2, G3, G4 | **Implemented** — streaming scope hardening | round 3 |
| G5, G6 | **Implemented** — terminal evidence binding | round 3 |
| G13, G14, G15 | **Implemented** — interstitial hardening | round 3 |
| G20, G22, G27 | **Implemented** — Sol CLI/effort | round 3 |
| G29 | **Implemented** — durable conversation URL | round 3 |
| G30 | **Implemented** — CDP disconnect recovery | round 3 |
| G34 | **Implemented** — strict env parsing | round 3 |
| G19, G21, G24, G26, G32, G33 | **Covered** — no action, path:line proof in the round-3 unit | round 3 |
| G23, G31 | **Not-applicable** — API routing and serve-owned tabs do not exist in a browser-only, shared-page architecture | round 3 |
| G1b | **Implemented** — stop-probe scoping migrated to the remaining callers | round 4 |
| G13b | **Implemented** for challenge/login — Grok/Gemini interstitial wiring | round 4 |
| G17, G18 | **Implemented** — Work-surface detection, G18 narrowed to the model-mutation boundary | round 4 |
| issue #81 | **Fixed** — ChatGPT connector selection against the current popover DOM | round 4 |
| G10 | **Permanently not ported** — superseded upstream by `67da293a`; re-affirmed this round | round 3, unchanged |

Upstream `steipete/oracle` remains at `6009d4ad` (`chore(changelog): open 0.16.2`,
2026-07-23), newest tag `v0.16.1`. Round 3 closed the real `1146107..6009d4ad`
delta; round 4 was the first documented NOOP, so this is the **second consecutive
NOOP** and the third consecutive round anchored at `6009d4ad`. There is nothing
left to port: the entire round was our own accumulated debt.

## 3. Gate evidence

Run fresh at close-out, after the `_plan` → `_fin` promotion:

```
npm run test:unit    -> Test Files 156 passed (156), Tests 1682 passed (1682), exit 0
npm run docs:drift   -> All structure drift checks passed (164)
npm run docs:counts  -> All structure count checks passed (76)
```

The round opened at 152 files / 1529 tests, so it adds 4 files and 153 cases.

Not run and deliberately NOT claimed green: the Playwright integration smokes
(`post-action-smoke`, `self-heal-smoke`) fail here for a missing bundled
Chromium, which is the pre-existing baseline. The Chromium transport tests added
in WP2/WP3/WP7 were each verified by the A-gate reviewer with
`AGBROWSE_CHROMIUM_EXECUTABLE_PATH` pointed at the installed Chrome.

`npm run typecheck:checkjs-dom` is red at repo baseline (184 diagnostics) and
stays that way. The bar this round holds itself to is **zero NEW diagnostics in
touched files**, measured rather than asserted: the WP8 files
(`chatgpt-work-picker.mjs`, `chatgpt.mjs`, `cli.mjs`) carry 25 diagnostics both at
`HEAD` and on a `HEAD~1` worktree, and the new test file contributes none.

## 4. Push

```
$ git push origin dev
To https://github.com/lidge-jun/agbrowse.git
   e5623a0..defb7cc  dev -> dev

$ git fetch origin dev && git rev-parse dev
defb7ccd0369e8917a9b44051efda584b0907ba4
$ git rev-parse origin/dev
defb7ccd0369e8917a9b44051efda584b0907ba4
```

20 commits, `e5623a0..defb7cc`: the round-4 push was the previous remote tip. No
force-push, no PR, `dev` only. `defb7cc` is this close-out commit itself; the §4
block above is therefore recorded in the follow-up commit that carries the push
evidence, since a commit cannot contain its own successor's SHA.

## 5. Next round

Anchor for round 6: upstream `6009d4ad`, local `dev` at the WP9 close-out commit.

The clone at `/tmp/oracle-chase-260724` is still valid but lives in `/tmp`, so
round 6 should re-fetch rather than trust it — and after two consecutive NOOPs the
first question for round 6 is whether upstream has moved at all before any
planning work begins.

With the deferred backlog now empty, round 6 has no inherited queue. Its scope is
whatever upstream ships next, plus anything the reviewer flagged this round as
honestly-unreachable rather than covered.
