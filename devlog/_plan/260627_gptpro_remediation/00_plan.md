# 00 — GPT-Pro Remediation (R1–R9): Master Plan

> Goal: agbrowse↔cli-jaw GPT-Pro remediation · created 2026-06-27
> Source: [`../260625_webai_parity_impl/130_gptpro_verdict_remediation.md`](../260625_webai_parity_impl/130_gptpro_verdict_remediation.md)
> Working branch: `dev` (both repos)

## Part 1 — What & Why (plain language)

GPT-Pro reviewed the entire parity port and flagged 9 findings, 4 blockers. The
most ironic: the tier-timeout bug (#2) broke our own GPT-Pro verification.
This goal patches all 9 findings across both repos in 5 PABCD cycles (one per
priority/scope cluster), starting with the smallest confirmed blockers and
ending with docs/test hygiene. Each cycle is a full P→A→B→C→D pass.

## Part 2 — Slice Map (5 PABCD cycles)

| Cyc | Doc | Repo | R# items | Sev | Kind |
|---|---|---|---|---|---|
| **1** | [10_](10_p0_quick_blockers.md) | agbrowse + cli-jaw | **R1** envelope shape, **R2** tier-timeout, **R3** finalUrl parse | **P0** | fix (small, confirmed) |
| **2** | [20_](20_p1_ssrf_redirect.md) | agbrowse | **R4** SSRF: manual redirect loop w/ per-hop DNS validation | **P1** | security fix |
| **3** | [30_](30_p1_lock_redesign.md) | cli-jaw | **R5** session-store + watcher-lock: atomic publish, heartbeat, grace window | **P1** | redesign |
| **4** | [40_](40_p1_wiring_and_guards.md) | agbrowse + cli-jaw | **R6** wire 203.x into fetch ladder + 202 A1–A3 into readiness flow; **R7** DR guard + AX subtree + lease cleanup | **P1** | wiring + fix |
| **5** | [50_](50_p2_hygiene.md) | both | **R8** convergence table correction; **R9** test coverage additions | **P2** | docs + tests |

### Per-cycle PABCD contract (same as parity impl)

Each cycle: P (fill stub) → A (read-only audit) → B (Boss writes, worker verifies) → C (gate green) → D (checkpoint).

### Repo conventions

| Repo | Path | Lang | Gate |
|---|---|---|---|
| agbrowse | `/Users/jun/Developer/new/700_projects/agbrowse` `web-ai/*.mjs`, `skills/browser/adaptive-fetch/*.mjs` | JS (ESM) | `npm run gate:typecheck && npm run gate:tests` |
| cli-jaw | `/Users/jun/Developer/new/700_projects/cli-jaw` `src/browser/web-ai/*.ts` | TypeScript | `npm test` + `npx tsc --noEmit` |

---

## Cycle 1 — P0 Quick Blockers (R1 + R2 + R3)

### R1: envelope shape recognition (agbrowse)

**Problem:** `toWebAiErrorEnvelope` in `failure-diagnostics.mjs:188` checks `e.name === 'WebAiError'`, but `ProviderRuntimeDisabledError` (and any future subclass) overrides `this.name`. Structured fields (errorCode, retryHint, vendor, stage) are silently dropped.

**Fix:**
- MODIFY `web-ai/failure-diagnostics.mjs` line 188:
  - Before: `if (e.name === 'WebAiError' && typeof e.toJSON === 'function')`
  - After: `if (typeof e.errorCode === 'string' && typeof e.toJSON === 'function')`
  - Rationale: all WebAiError subclasses carry `errorCode` (string) + `toJSON`. Shape-based detection is forward-compatible with future subclasses without requiring a name registry.

### R2: tier-timeout threading (cli-jaw)

**Problem:** `send()` in `chatgpt.ts` stores `session.timeoutMs` from tier-aware `resolveTimeoutDefaultSec()`, but `poll()` (line 498), `watch()` (line 787), and `query()` all hardcode `1200` as default timeout. Pro model (3600s tier) times out at 20 minutes.

**Fix:**
- MODIFY `src/browser/web-ai/chatgpt.ts`:
  - `poll()`: replace `input.timeout || 1200` with `input.timeout || (session?.timeoutMs ? session.timeoutMs / 1000 : resolveTimeoutDefaultSec(input, vendor))`
  - `watch()`: same pattern
  - `query()`: inherits through poll, no separate change needed
  - Add test: verify `model:'pro'` poll inherits 3600s, not 1200s

### R3: finalUrl + multi-hop header parse (agbrowse)

**Problem:** `tlsFetchCandidate` in `tls-fetch.mjs:136` sets `finalUrl: rawUrl` instead of the actual resolved URL. `extractFinalUrl` parses concatenated headers incorrectly for multi-hop redirects.

**Fix:**
- MODIFY `skills/browser/adaptive-fetch/tls-fetch.mjs`:
  - `tlsFetch()`: add `--write-out '\n%{url_effective}'` to curl args, parse the effective URL from the output, return it in the result object
  - `tlsFetchCandidate()`: use the returned `effectiveUrl` as `finalUrl` instead of `rawUrl`
  - Remove `extractFinalUrl` or keep as legacy fallback only

---

## Cycle 2 — R4 SSRF Redirect Loop (agbrowse)

**Problem:** `curl -L` follows redirects before post-redirect `validateFetchUrl`, allowing SSRF via open redirect. agbrowse's own `fetcher.mjs` DNS-checks each hop, but the TLS rung doesn't.

**Fix:**
- MODIFY `skills/browser/adaptive-fetch/tls-fetch.mjs`:
  - Remove `-L` from curl args
  - Add `--max-redirs 0` to get the 3xx response
  - Implement `followRedirectsManually(url, maxHops=10)`:
    1. For each hop: validate URL (`validateFetchUrl`), execute single curl request
    2. If 3xx: parse `Location` header (resolve relative URLs via `new URL(location, currentUrl)`)
    3. Validate the new URL before following
    4. Loop until 2xx or maxHops exhausted
  - Return the real `finalUrl` from the last hop

## Cycle 3 — R5 Lock Redesign (cli-jaw)

**Problem:** Both `session-store.ts` and `watcher-lock.ts` have race conditions:
- File appears empty between `openSync('wx')` and metadata write → racer treats as stale → removes
- No heartbeat on session-store lock → 5-min TTL can expire on long operations
- `Atomics.wait` blocking sleep freezes the event loop

**Fix:**
- MODIFY `src/browser/web-ai/session-store.ts`:
  - Atomic publish: write metadata to `<lock>.tmp`, then `renameSync` to `<lock>` (atomic on POSIX)
  - Add heartbeat timer (update `lastHeartbeat` in metadata every 60s while holding lock)
  - Replace `sleepBlockingMs` (`Atomics.wait`) with async retry loop using `setTimeout`
  - Grace window: don't treat lock as stale if file exists but is empty for <2s
- MODIFY `src/browser/web-ai/watcher-lock.ts`:
  - Same atomic publish for `metadata.json` inside the lock dir
  - Decouple heartbeat from poll tick — run independent timer
  - Add grace window for newly-created dirs with missing metadata

## Cycle 4 — R6 Wiring + R7 Guards (agbrowse + cli-jaw)

### R6: Wire 203.x into fetch ladder (agbrowse)

**Problem:** `bm25-filter`, `feed-parser`, `structured-extractor`, `candidate-discovery`, `ytdlp-reader`, `camoufox-session` exist as standalone modules but are NOT imported or invoked in `adaptive-fetch/index.mjs`.

**Fix:**
- MODIFY `skills/browser/adaptive-fetch/index.mjs`:
  - Import the 6 modules
  - Wire into the fetch ladder at appropriate phases:
    - `candidate-discovery` at Phase 01 (before first fetch, to discover alternate URLs)
    - `feed-parser` at Phase 02a (RSS/Atom check before full fetch)
    - `bm25-filter` at Phase 06 (post-scoring reranking when multiple candidates)
    - `structured-extractor` at Phase 06a (table/heading extraction on winning candidate)
    - `ytdlp-reader` at Phase 03a (media URL detection → yt-dlp metadata)
    - `camoufox-session` at Phase 04c (after TLS fetch, before browser escalation)
  - Wire 202 A1–A3 search helpers into readiness/selection flow
  - Raise query cap so era-sweep/disconfirm queries survive

### R7: DR guard + AX subtree + lease cleanup (cli-jaw)

**Problem 1 (DR guard):** `researchActivityObserved` only set by progress selector, not by successful mode+plan → valid runs can end with `deep-research-not-started`.
**Problem 2 (AX subtree):** `getPartialAXTree(fetchRelatives:true)` can return ancestors/siblings outside `rootSelector`, and empty CDP returns empty doc instead of `snapshot.unavailable`.
**Problem 3 (Lease cleanup):** Dead-owner leases counted toward capacity; cleanup lacks `activeCommandTargetIds` exclusions.

**Fix:**
- MODIFY `src/browser/web-ai/chatgpt-deep-research.ts`: set `researchActivityObserved` on mode+plan confirmation, not just progress selector; on timeout, require activity before persisting as report
- MODIFY `src/browser/web-ai/ax-snapshot.ts`: filter CDP results to requested subtree only; return `snapshot.unavailable` on empty CDP response
- MODIFY `src/browser/web-ai/tab-lease-store.ts`: prune dead-PID leases before capacity count; add `activeCommandTargetIds`/`completedSessions` exclusions to cleanup

## Cycle 5 — R8 + R9 Hygiene (both repos)

### R8: Convergence table correction

- MODIFY `devlog/_plan/260625_webai_parity_impl/00_plan.md`: mark resolver-only/unwired/stubbed/user-deferred rows honestly; add missing catalog rows as OPEN

### R9: Test coverage

- Both repos: add targeted tests for each R1–R7 fix
  - TLS redirect harness with mock server
  - Pro-tier timeout end-to-end
  - DR symmetric guard
  - AX subtree scoping
  - Envelope field survival
  - Lock race condition stress test
  - 203 ladder invocation integration test

## Convergence tracker

| Cyc | Status | Commit(s) | Gate |
|---|---|---|---|
| 1 | ✅ DONE | agbrowse `a9729c8` (R1) `74c85a3` (R3) · cli-jaw `cd4732f0` (R2) | agbrowse gate:typecheck+tests PASS; cli-jaw tsc 0 + 4903/4903 pass |
| 2 | ✅ DONE | agbrowse `3d7b42a` (R4) | agbrowse gate:typecheck+tests PASS |
| 3 | ✅ DONE | cli-jaw `fa5f4ebc` (R5) | cli-jaw tsc 0 + 4903/4903 pass |
| 4 | ✅ DONE | agbrowse `ed188ec` (R6) · cli-jaw `1e92dee4` (R7) | agbrowse gate:typecheck+tests PASS; cli-jaw tsc 0 + 4903/4903 pass |
| 5 | ⬜ PENDING | — | — |
