# Timeout Adaptive Scaling — Solution Plan

> ⚠️ **SUPERSEDED for scope by `20_pressure_test_verdict.md` (2026-06-20).** Pressure-test found ~80% of this plan over-engineered (the `--timeout` escape hatch + action-button done-signal already exist; claims 2/3/4 dropped). Real scope = a 4-entry tier-default map + 1 export + 1 doc line + 1 test. Also note the `pollTimeoutSec` name collision flagged in the verdict. Read the verdict first; this file is retained as the full analysis.

> Locked decision: **hardcoded mapping table** (no history-learning). instant ≈ 120s, thinking/standard ≈ 600s, **pro / heavy / deep-research = 3600s**. Documentation only; code sketch is illustrative.

## A. Hardcoded `TIMEOUT_TABLE` (new module `web-ai/timeout-policy.mjs`)

Static mapping keyed by `${provider}:${tier}:${effort||'-'}`, in **seconds**:

```js
export const TIMEOUT_TABLE = {
  // ChatGPT
  'chatgpt:instant:-':          120,
  'chatgpt:thinking:light':     600,
  'chatgpt:thinking:standard':  600,
  'chatgpt:thinking:extended': 1200,
  'chatgpt:thinking:heavy':    1800,
  'chatgpt:pro:standard':      3600,   // pro = 3600s (user choice)
  'chatgpt:pro:extended':      3600,
  'chatgpt:deep-research:-':   3600,
  // Gemini
  'gemini:flash-lite:-':        120,
  'gemini:flash:-':             600,
  'gemini:pro:-':               600,
  'gemini:deep-think:-':       3600,
  // Grok
  'grok:fast:-':                120,
  'grok:auto:-':                600,
  'grok:expert:-':              600,
  'grok:heavy:-':              3600,   // no longer shares 600 with expert
};

const TIER_DEFAULT = { instant: 120, thinking: 600, pro: 3600, 'deep-research': 3600 };

export function resolveTimeoutSeconds({ provider, tier, effort }, vendorDefault) {
  const key = `${provider}:${tier}:${effort || '-'}`;
  if (TIMEOUT_TABLE[key] != null) return { key, seconds: TIMEOUT_TABLE[key], source: 'table' };
  if (TIER_DEFAULT[tier] != null) return { key, seconds: TIER_DEFAULT[tier], source: 'tier-default' };
  return { key, seconds: vendorDefault, source: 'vendor-default' };
}
```

**Precedence (must preserve current behavior):** an explicit `input.timeout` always wins; the table only supplies the *default* when `--timeout` is absent. Keeps `poll --timeout 1800` authoritative and the fake-chatgpt test's `timeout: 2` green.

> This `resolveTimeoutSeconds` is the **single source of truth** for the model-aware deadline that `260619_tab_parallel_stability` reuses for its lease-TTL / session-lock TTL (see that folder's `10_solution_plan.md` §C). Do not duplicate the pro=3600 constant in the lease store — import it.

## B. Tier mapping — where to derive it

`deriveTier(input)` reuses existing normalizers, called at the dispatch layer (`cli.mjs:630-689` / `mcp-server.mjs:207`) so all three providers share one path:
- ChatGPT: `normalizeChatGptModelChoice(input.model)` + `normalizeChatGptEffortChoice(input.reasoningEffort)` (`chatgpt-model.mjs:136,146`); `input.research === 'deep'` → tier `'deep-research'`.
- Gemini: `normalizeGeminiModel` + `isGeminiDeepThinkAlias` (`gemini-model.mjs:74,83`).
- Grok: `GROK_MODEL_ALIASES` lookup (`grok-model.mjs:24`).

Set `input.pollTimeoutSec` at dispatch; each `poll` also falls back to `resolveTimeoutSeconds(deriveTier(input), VENDOR_DEFAULT_TIMEOUT_SEC[vendor])` so a directly-invoked `pollWebAi` (session resume) still scales.

## C. Intermediate-response handling — the hard part (replaces `chatgpt.mjs:386-398`)

Gate completion on a **positive done-signal**, not on absence-of-stop-button. A small state machine:

1. **Authoritative DONE** — `isResponseFinished(page)` true (action buttons on the latest turn) AND text stable → complete now (keep `finished ? 1000` fast path). Trusted regardless of tier.
2. **Authoritative STREAMING** — stop button visible → reset stability, never complete (already at `chatgpt.mjs:480-482`).
3. **Ambiguous (the trap)** — stop button gone, action buttons absent → *possibly still thinking*. Require **tier-scaled `minStableMs`** AND a **no-growth-for-N-polls** rule:
   - `instant` → 1500ms is enough (no hidden thinking phases).
   - `thinking`/`pro`/`deep-research` → `minStableMs` ≈ 8000ms AND text length unchanged across ≥3 polls.
   - **Thinking-indicator probe** `hasThinkingIndicator(page)`: if any `PLACEHOLDER_PATTERNS` text or a reasoning/"thinking" chip is still in the latest turn's DOM, force streaming-equivalent behavior (reset stability) even with the stop button gone. This is the missing link that stops "declared done while between reasoning steps".
4. **Hard deadline** — the tier-scaled timeout (§A) bounds the loop; pro waits up to 3600s but isn't tripped early.

## D. Adaptive poll interval with backoff (replaces fixed 500ms)

Reset on text growth (stay responsive), grow while idle (don't hammer a 3600s wait):

```js
let pollMs = 500; const POLL_MIN = 500, POLL_MAX = 4000;
if (latest !== lastSeen) { pollMs = POLL_MIN; lastSeen = latest; }
else { pollMs = Math.min(POLL_MAX, Math.round(pollMs * 1.5)); }
await page.waitForTimeout(pollMs);
```

At a 4s cap a 3600s pro wait is a few hundred polls instead of ~7200; a fast-streaming instant response still samples at 500ms.

## Code sketch (illustrative — NOT for commit)

```diff
# web-ai/timeout-policy.mjs (NEW) — TIMEOUT_TABLE + resolveTimeoutSeconds + deriveTier

# web-ai/cli.mjs (~641)
+ pollTimeoutSec: values.timeout != null ? Number(values.timeout)
+   : resolveTimeoutSeconds(deriveTier({ vendor: values.vendor, model: values.model,
+       reasoningEffort: values.effort || values['reasoning-effort'], research: values.research }),
+       VENDOR_DEFAULT_TIMEOUT_SEC[values.vendor] ?? 1200).seconds,

# web-ai/chatgpt.mjs:329
- const timeout = Math.max(1, Number(input.timeout || 1200));
+ const timeout = Math.max(1, Number(input.timeout ?? input.pollTimeoutSec
+   ?? resolveTimeoutSeconds(deriveTier(input), 1200).seconds));

# web-ai/chatgpt.mjs:386-398 (stability gate)
+ const thinking = !streaming && await hasThinkingIndicator(page);
+ if (latest && !streaming && !thinking) {
+   const tier = deriveTier(input).tier;
+   const minStableMs = finished ? 1000 : tier === 'instant' ? 1500 : 8000;
+   const enoughNoGrowth = noGrowthPolls >= (tier === 'instant' ? 1 : 3);
+   if (elapsedStable >= minStableMs && (finished || enoughNoGrowth)) { /* complete */ }

# grok-live.mjs:267 / gemini-live.mjs:439 — same default + backoff
```

## Test Strategy (absorbs area-5 test gaps)

Build on `test/integration/web-ai-fake-chatgpt.test.mjs` (its `waitForTimeout` mock already flips `'Pro thinking...'` → `'OK'`) and `test/unit/web-ai-chatgpt-model.test.mjs` (effort matrix at :54-58).

1. **Unit — timeout table per (provider, model, effort).** `resolveTimeoutSeconds`/`deriveTier`: `chatgpt:pro:* → 3600`, `chatgpt:instant → 120`, `chatgpt:thinking:standard → 600`, `chatgpt:deep-research → 3600`, **`grok:heavy → 3600` (regression: must NOT equal `grok:expert`'s 600)**, `gemini:deep-think → 3600`. Assert explicit `input.timeout` overrides the table.
2. **Integration — heavy/pro not timing out early.** Fake page keeps stop button visible past the *old* default but within tier; assert no premature `status:'timeout'` and `deadline` derived from 3600, not 1200.
3. **Integration — instant not over-waiting.** Fake page completes fast (action buttons appear); assert completion well under 120s and `responseStableMs` ≈ short instant grace.
4. **Integration — mid-stream pause then resume (the edge case).** Sequence: partial text ≥500 chars → hide stop button + keep a thinking chip for several polls → resume → final text → action buttons. Assert the result equals the **final** text (not the partial) — proves the thinking-indicator + no-growth gate.
5. **Backoff unit.** Interval resets to 500ms on growth, climbs to 4000ms cap while idle; assert a simulated 3600s idle wait is bounded to hundreds of polls.

## Open Risks / Tradeoffs

- **DOM signal fragility.** The thinking-indicator probe depends on ChatGPT keeping a reasoning/placeholder chip during pauses; if removed, the gate degrades to the tier-scaled no-growth rule (still safer than today). Mitigate with selector-list resilience like the existing stop/finished selectors.
- **3600s pro hard wait** ties up a tab/lease for up to an hour on a hung response. Backoff reduces CPU but the lease is still held — this is exactly why `260619_tab_parallel_stability` must add lease TTL + 60s heartbeat keyed on the same 3600s value (cross-cut).
- **Hardcoded table drift.** Tier values are static by design; a provider tier rename needs a manual one-module edit, unit-tested.
- **Hot-path change.** Threading `pollTimeoutSec` through `cli.mjs` + `mcp-server.mjs` + three pollers is mechanical; explicit-`--timeout`-wins precedence keeps all current callers behavior-compatible.

## References (web)

The copy/action button being the authoritative "response complete" signal (with stop-button + text-stability as supporting layers) is corroborated by ChatGPT streaming/scraping write-ups (theodormarcu.com "How ChatGPT streams responses"; Scrapfly "How to Scrape ChatGPT 2026" / "Find Web Selectors with ChatGPT").
