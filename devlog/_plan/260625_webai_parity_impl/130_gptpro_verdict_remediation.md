# 130 — Cycle 12 GPT-Pro Verdict + Remediation Roadmap

> Part of [00_plan.md](00_plan.md) · Goal `68727b6d-d01` (system-closed) · **Status: RECORDED (remediation deferred — record-only per user 2026-06-26). Working branch = `dev` (both repos).**

## How the verdict was obtained (and the completion caveat)
The Cycle-12 GPT-Pro pass ran via `agbrowse web-ai send --new-tab --model pro --file <zip>` against a fresh ChatGPT-Pro tab, with the full diff zip + both pushed `dev` URLs in the prompt. GPT-Pro browsed the live `dev` branches (it cited `raw.githubusercontent.com/.../dev/...`).

**Completion caveat (must read):** the goal auto-flipped to `[complete]` when the FIRST watcher bgtask *returned* — but that bgtask **timed out** (the `watch`/`poll` resume path used a ~20-min default, NOT the session's pro-tier 60-min deadline; see finding #2 below, which is the very bug that broke our own verification). The real verdict was captured on a later re-open of the saved conversation. **So "complete" reflects the bgtask-return mechanism, not a passing verdict.** Per-cycle "DONE = green unit tests" was *mechanical*; GPT-Pro correctly found that integration/wiring is incomplete and the convergence table overstated closure.

## Verdict: **CONCERNS — not mainline-ready**

## Ranked findings (GPT-Pro) + maintainer triage

| # | Finding (file) | GPT-Pro severity | Triage |
|---|---|---|---|
| 8 | provider-adapter `ProviderRuntimeDisabledError` sets `name='ProviderRuntimeDisabledError'`; `failure-diagnostics.toWebAiErrorEnvelope` only recognizes `name==='WebAiError'` → errorCode/retryHint/vendor/stage **dropped** (`web-ai/provider-adapter.mjs:56`, `web-ai/failure-diagnostics.mjs:188`) | blocker | **CONFIRMED real** (verified). Self-inflicted across my 201#6/#7 ports. 1-line fix (envelope recognizes WebAiError subclasses by shape, not name). |
| 2 | tier-timeout (105.4) stored on session at `send` but `poll()`/`watch()`/`query()` default to 1200s independently → `model:'pro'` query times out at 20m not 60m (`src/browser/web-ai/chatgpt.ts:289,734` wire send only) | blocker | **CONFIRMED real** (verified send-only wiring; it broke our verification). Thread `session.timeoutMs` through poll/watch/query/resume. |
| 1 | TLS rung: `tlsFetchCandidate.finalUrl` always = original URL; `-L -i` multi-hop but only first `\r\n\r\n` parsed (30x headers → body); relative `Location` mishandled; SSRF — curl `-L` follows redirects **before** the post-redirect `validateFetchUrl`; `index.mjs` promotes to `strong_ok` + clears challenge w/o reclassify (`skills/browser/adaptive-fetch/tls-fetch.mjs`, `index.mjs`) | blocker | **Real** (finalUrl/parse are port defects; SSRF is faithful-to-cli-jaw-source but a genuine regression vs agbrowse `fetcher.mjs` which DNS-checks each hop). Replace curl `-L` with a manual, per-hop-validated redirect loop. |
| 3 | session-store lock: empty/unreadable metadata treated stale → transient empty file (between `openSync wx` and write) unlinkable by a racer; `withSessionCommandLock` writes no heartbeat yet `isStaleLock` applies 5-min TTL even when PID alive → >5-min command can have its lock stolen (`src/browser/web-ai/session-store.ts:154+`) | blocker | **Real concurrency risk** (plausible; needs multi-process stress test). Atomic metadata publish + independent heartbeat. |
| 4 | watcher-lock: mkdir atomic but `metadata.json` written after → missing/partial JSON classified stale + recursive rm; heartbeat at tick start before a process-global serialized poll queue → long/queued poll exceeds 5-min stale while healthy (`src/browser/web-ai/watcher-lock.ts`, `watcher.ts:108`) | blocker | **Real** (same class as #3). Same redesign. |
| 5 | Deep-Research guard asymmetric: `researchActivityObserved` set only by progress selector/iframe (not by successful mode+plan) → valid run can end `deep-research-not-started`; timeout path persists "completed" text w/o requiring activity, and report completion ≈ `≥120 chars` w/o short-marker blacklist → long ordinary answer saved as report at timeout | high | **Needs verification** (contradicts my shallow CLEAN review; GPT-Pro's asymmetry argument is plausible). Make the guard symmetric on complete+timeout. |
| 6 | AX CDP fallback: `getPartialAXTree(fetchRelatives:true)` returns node + ancestors + siblings; root chosen as "absent from all childIds" can be a page ancestor → controls outside `rootSelector` satisfy contract-audit/self-heal; empty CDP → empty doc instead of `snapshot.unavailable` (`src/browser/web-ai/ax-snapshot.ts:243+`) | high | **Needs verification** (plausible per CDP semantics). Scope strictly to the requested subtree. |
| 7 | annotated-screenshot nominal: `drawHighlightOverlay` returns input unmodified; dims always `0×0` but `highlightCount` may be >0; passes `quality` to a PNG + undocumented `maxDimension` (`web-ai/annotated-screenshot.mjs`) | medium | **Faithful-to-source** (cli-jaw is also a TODO stub). Not a regression; but the capability claim is overstated → either finish or downgrade the claim + add a regression test. |
| 9 | lease capacity counts dead-owner active leases without pruning → stale records block new work; cleanup closes every dead-PID active lease but lacks 106.12 `activeCommandTargetIds`/`completedSessions` exclusions → a target rebound by another process can be closed in the death/rewrite race (`src/browser/web-ai/tab-lease-store.ts:350+,518+`) | high | **Needs verification** (my CLEAN review missed the capacity-counts-dead + missing-exclusions angle). Prune dead before counting; add in-use exclusions. |

**Structural (real):** 203.2–203.7 (bm25/feed/structured/candidate/ytdlp/camoufox) landed as standalone modules + tests but are **NOT wired into `adaptive-fetch/index.mjs`** → importable, not fetch-ladder capabilities. Same for 202 A1–A3 helpers (not enforced in the main readiness/selection flow; default query cap can slice off late-added era-sweep/disconfirm queries).

**Faithfulness gaps (catalog rows not actually closed):** missing — 101#3 failure DOM+screenshot artifact, 101#4/106.3 resumeDeepResearch, 101#5 new-tab reattach, 101#6 model-pill mount-wait+retry, 101#8 DR resume routing, 103 search B1/B3/B4, 104.2 readSessionCommandLock, 104.4 profile heartbeat lock, 104.7 legacy-Pro reject, 105.2 CLI flag surface, 106.12/106.14/106.15. Partial/different — 104.1/104.3 (unsafe locks), 105.4 (resolver-only), 201#3 (stub), 201#4 (declares `loading`, never returns it), 202 A1–A3 (helpers not enforced), 203.2–203.7 (unwired). **Scope-decisions (user-deferred, NOT defects):** 104.7, 202 A4/A6/A7 — but the tracker must stop representing them as "converged."

> Non-blocker (GPT-Pro agrees): structured-extractor `language:''` quirk — defensible parity mirror; record as a known shared defect + regression test, don't present as correct extraction.

## Remediation plan (priority order — NOT yet started; record-only)

**P0 — confirmed quick blockers (small, high-confidence):**
- R1 (#8): `toWebAiErrorEnvelope` recognize WebAiError subclasses by shape (`typeof toJSON==='function' && typeof errorCode==='string'`), not exact `name`.
- R2 (#2): thread `session.timeoutMs` through `poll`/`watch`/`query`/resume in cli-jaw `chatgpt.ts` (+ agbrowse equivalents); test that a no-explicit-timeout `model:'pro'` keeps the 3600s deadline end-to-end.
- R3 (#1 partial): set `tlsFetchCandidate.finalUrl` to the real final URL; fix multi-hop header parse.

**P1 — design blockers (larger):**
- R4 (#1 SSRF): replace curl `-L` with a manual redirect loop validating + DNS-checking each hop (both repos).
- R5 (#3/#4): redesign both lock families — atomic metadata publish (write-then-rename), independent heartbeat decoupled from work queues, don't treat partial/empty as stale until a grace window.
- R6 (structural): wire 203.2–203.7 into `adaptive-fetch/index.mjs` (and 202 A1–A3 into the readiness/selection flow + raise/seat the query cap so era-sweep/disconfirm survive).
- R7 (#5/#6/#9): symmetric DR guard; strict AX subtree scoping (+ empty→`snapshot.unavailable`); prune-dead-before-count + in-use exclusions in lease cleanup.

**P2 — honesty/scope hygiene:**
- R8: correct the convergence table in `00_plan.md` — mark resolver-only/unwired/stubbed/user-deferred rows as such (NOT "converged"); add the missing catalog rows (101#3/#4/#5/#6/#8, 104.2/.4/.7, 105.2, 106.12/.14/.15, 201#3/#4, 103 B1/B3/B4) as explicit OPEN items.
- R9: add the under-tested coverage GPT-Pro listed (TLS redirect harness, multi-process lock stress, pro-timeout end-to-end, DR symmetric, AX subtree, real-Playwright annotated-screenshot, envelope field-survival, lease interleave, 203-ladder-invocation, live-browser smokes).

## Working agreement (2026-06-26)
- Both repos consolidated on **`dev`** (cli-jaw merged by user; agbrowse merged here). Remediation work happens on `dev`.
- This turn = **record only** (no code fixes), per user.
