# Phase 8.1 — Competitor gap analysis + hardening plan

After completing Phase 8 (self-healing selectors + action cache), audit
agbrowse against three direct competitors to identify gaps, verify
resilience claims, and plan hardening before Phase 9.

## Competitors

| Competitor | Relevant capability | agbrowse Phase 8 parity |
|---|---|---|
| **Stagehand** | AI-based selector re-resolution (cloud LLM) | ❌ Explicitly out of scope (local only) |
| **Playwright MCP** | Snapshot/ref contract as MCP tools | ⚠️ Phase 10 planned, not yet wired |
| **Vercel Labs agent-browser** | Screenshot annotate fallback | ⚠️ Phase 9 planned |
| **WebVoyager** | Text-marked interactive elements + eval harness | ⚠️ Phase 11 planned |

## Gap analysis

### Gap 1: Cache poisoning on DOM redesign

**Risk:** Cached selector passes visibility check but points to wrong element after major provider UI redesign.

**Current mitigation:**
- `validateResolvedTarget` checks `isVisible()` + `isEnabled()`
- `checkSemanticMatch` extracts role/label client-side and matches against expected patterns

**Weakness:**
- Semantic match only runs when `target.role && target.name` are missing from the cached entry (line 209 in self-heal.mjs)
- If cache entry has role+name but they're stale (e.g., button became link), validation returns `{ ok: true }` immediately without re-checking DOM

**Hardening (8.1):**
```diff
-    if (target.role && target.name) {
-        return { ok: true };
-    }
+    if (target.role && target.name) {
+        const domRole = await el.evaluate(node => /* extract implicit role */);
+        const domName = await el.evaluate(node => /* extract label */);
+        const roleOk = target.role === domRole;
+        const nameOk = new RegExp(escapeForRegExp(target.name), 'i').test(domName || '');
+        if (!roleOk || !nameOk) return { ok: false, reason: 'stale-role-name' };
+    }
```

### Gap 2: No cache hit-rate telemetry

**Risk:** Cannot measure whether self-healing actually helps in production.

**Current state:** `action-cache.mjs` stores `hitCount` per entry, but no aggregate reporting.

**Hardening (8.1):**
- NEW `web-ai/cache-metrics.mjs` with `reportCacheMetrics(cache)`
- Export: hit rate, miss rate, resolution source distribution, average attempts per resolution
- Integrate into `doctor` command: `agbrowse web-ai doctor --cache-metrics`

### Gap 3: Cross-session cache cold start

**Risk:** Every new CLI invocation starts with empty cache if `BROWSER_AGENT_HOME` is not persisted across machines.

**Current state:** Cache lives in `~/.browser-agent/action-cache.json` — local only.

**Hardening (8.1):**
- Option to export/import cache as encrypted blob (opt-in, privacy-sensitive)
- Or: seed cache from a checked-in `provider-selector-seed.json` for known providers

### Gap 4: Resolution strategy A/B measurement

**Risk:** We assume cache-first is optimal, but no data proves it.

**Current state:** Fixed resolution order: cache → observe → css → fail.

**Hardening (8.1):**
- Add `attempts` telemetry to every resolution (already present)
- NEW metric: `avgResolutionTimeMs` per source
- Report in doctor: which source resolves fastest per provider/intent

### Gap 5: Browser smoke test for DOM churn

**Risk:** All self-heal tests are mocked; no real Playwright page validates the chain.

**Current state:** 44 unit tests, 0 browser integration tests.

**Hardening (8.1):**
- NEW `test/integration/self-heal-smoke.test.mjs`
- Launch local HTTP server with fixture pages that mimic ChatGPT/Gemini/Grok DOM
- Run `resolveActionTarget` against real Playwright page
- Rotate selectors between test runs to simulate provider churn

### Gap 6: Trace persistence incomplete

**Risk:** `action-trace.mjs` records in memory, but session JSON is never updated with trace data.

**Current state:** `session.mjs` has `trace: []` field, but no caller writes to it after action execution.

**Hardening (8.1):**
- MODIFY `browser-primitives.mjs` `clickResolvedTarget` / `fillResolvedTarget` to call `recordTraceStep`
- MODIFY `session.mjs` `updateSession` or add `appendTraceStep(sessionId, step)`
- Ensure trace is saved to session JSON on session end

### Gap 7: Semantic target contract drift

**Risk:** `vendor-editor-contract.mjs` is hand-maintained. Provider accessibility attributes change silently.

**Current state:** Contracts for ChatGPT, Gemini, Grok are static objects.

**Hardening (8.1):**
- NEW `web-ai/contract-audit.mjs`: compare current `doctor --snapshot` output against stored contract
- Report drift: "Expected role 'textbox' for composer, observed 'searchbox'"
- CI check: fail build if contract drift detected against fixture pages

## 8.1 PR plan

| PR | Scope | Files |
|---|---|---|
| **8.1-PR1** | Cache validation hardening + stale role/name check | MODIFY `web-ai/self-heal.mjs`; unit tests |
| **8.1-PR2** | Cache metrics + doctor integration | NEW `web-ai/cache-metrics.mjs`; MODIFY `web-ai/doctor.mjs`; unit tests |
| **8.1-PR3** | Browser smoke harness for DOM churn | NEW `test/integration/self-heal-smoke.test.mjs`; NEW `test/fixtures/provider-dom/*.html`; CI config |
| **8.1-PR4** | Trace persistence wiring | MODIFY `web-ai/browser-primitives.mjs`; MODIFY `web-ai/session.mjs`; unit tests |
| **8.1-PR5** | Contract drift detection | NEW `web-ai/contract-audit.mjs`; NEW CI check; unit tests |

## Exit criteria

- [ ] Cached selector with stale role/name is rejected by validation
- [ ] `doctor --cache-metrics` prints hit rate and resolution source distribution
- [ ] Integration test runs self-heal against real Playwright page with rotated selectors
- [ ] Session JSON contains trace array after actions
- [ ] Contract drift CI check passes against known fixtures

## Questions for GPT Pro

1. Does the cache poisoning mitigation (Gap 1) add too much latency per resolution?
2. Should we prioritize cross-session cache seeding (Gap 3) or browser smoke (Gap 5)?
3. Is contract drift detection (Gap 7) better done as a scheduled GitHub Action or per-PR check?
