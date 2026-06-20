# Watch/Notification Gaps

## Problem
Watcher relies solely on 15-second interval polling. No CDP event subscriptions for real-time completion detection. Session URL tracking breaks on provider redirects.

## Key Gaps

### Poll-only architecture
- `watcher.mjs:26` — `DEFAULT_WATCH_INTERVAL_MS = 15_000`
- No DOM mutation observer, no CDP network idle detection
- Completion can be delayed up to 15 seconds

### Session URL tracking fragile
- `conversationUrl` only updated at send time (`chatgpt.mjs:290`)
- `extractConversationId()` (`chatgpt.mjs:906-912`) hardcodes `/c/{id}` regex
- Provider URL format changes break session resumption

### Reattach-mismatch common
- Watcher tab URL vs session URL mismatch when provider redirects
- Only auto-recovers with explicit `--navigate` flag
- Documented as issue #77

## Goal
Reduce completion detection latency. Make URL tracking format-agnostic. Evaluate CDP event-based detection feasibility vs. risk.

## Test Coverage Needed
- Watcher behavior when provider redirects conversation URL
- Reattach recovery with and without `--navigate`
- URL extraction against different provider URL formats
- (If implemented) CDP event-based completion detection reliability

## Decision (locked 2026-06-19)
Two tiers. **Tier 1 (safe, do-first):** adaptive poll interval (pro-safe backoff), per-provider conversation-id registry, self-healing URL via the existing `shouldPreferCurrentProviderUrl` (closes Issue #77 watch-path half). **Tier 2 (opt-in `--cdp-nudge`, default off):** CDP event only *nudges* an early poll — poll stays source of truth, so a broken event can never cause a false/missed completion. User's "리스키" stance confirmed correct (networkIdle is unreliable per devtools-protocol #154). See `01_root_cause.md`, `10_solution_plan.md`.

## Pressure-test (2026-06-20) — DOWNSCOPE ~75%, mostly →_fin
15s latency invisible under send→watch→bgtask (adaptive polling dropped); conversation-id registry misdiagnosed (gemini/grok don't use the regex); Tier 2 dropped. Only real win: watcher already self-heals via `resolveSessionPage` but discards the healed session — ~30-line consolidation. See `20_pressure_test_verdict.md`.

## Status — CLOSED 2026-06-20 (implemented → _fin)
- [x] Interview/requirements gathering
- [x] Plan (`10_solution_plan.md`) — superseded for scope
- [x] Pressure-test (`20_pressure_test_verdict.md`)
- [x] Implementation (MVV), two steps:
  - commit `1d86985` — `watcher.mjs` feeds the resolver-healed session to `ensureWatcherAttached` (retires the watch-path half of #77 root-drift)
  - follow-up — completed the MVV's "retire `urlsEquivalentForWatch`": replaced the strict hash-only compare with the canonical tolerant `urlsCompatible` (exported from `tab-recovery.mjs`, shared with the resolver) and deleted `urlsEquivalentForWatch`. Replace-not-delete preserves the genuine-mismatch guard (non-provider landing) that a blind deletion would have stripped — confirmed by an independent completion audit.
- [x] Verification: affected tests 21/21, `npm run gate:all` 16/16 (twice)
