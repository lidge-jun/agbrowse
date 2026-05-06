# Phase 8 — Self-healing selectors + local action cache

When a provider changes their DOM, agbrowse should recover automatically
instead of failing with `TARGET_UNRESOLVED`. This phase adds a
deterministic resolution chain that tries cached selectors, snapshot refs,
and provider CSS fallbacks before giving up.

Inspired by Stagehand's self-healing act() and action caching, but
restricted to **local deterministic resolution** — no cloud LLM
re-resolution. Provider UI is a sensitive surface; AI-based selector
guessing is opt-in at best, off by default.

Depends on Phase 7 (snapshot substrate provides refs and observe-targets).

## PR plan

| PR | Scope | Files |
| --- | --- | --- |
| **PR1** | Self-heal resolver | NEW `web-ai/self-heal.mjs`; MODIFY `web-ai/browser-primitives.mjs`; unit tests. |
| **PR2** | Action cache + trace | NEW `web-ai/action-cache.mjs`; NEW `web-ai/action-trace.mjs`; MODIFY `web-ai/session.mjs`; MODIFY churn-log; unit tests. |

## Resolution order

1. **Cached selector** — check action-cache for `(provider, intent, domHashPrefix)`. If found, validate the cached selector still matches the expected role/name.
2. **Latest snapshot ref** — semantic match from the current `WebAiSnapshot` refs.
3. **Provider CSS fallback** — the hardcoded selector arrays (existing code).
4. **Observe-target ranked candidates** — `observeProviderTargets()` produces candidates ranked by role/name similarity.
5. **Fail** — `WebAiError` with `errorCode='TARGET_UNRESOLVED'` and a doctor hint.

## Diffs (PR1)

### NEW `web-ai/self-heal.mjs`

API surface:

```js
export async function resolveActionTarget(page, options) {}
export async function validateResolvedTarget(page, target, criteria) {}
```

Skeleton:

```js
import { observeProviderTargets, rankTargetCandidates } from './observe-targets.mjs';

export async function resolveActionTarget(page, {
    provider,
    intent,
    actionKind,
    selectors,
    semanticTarget,
    snapshot,
    cache,
}) {
    // 1. cached selector + semantic validation
    if (cache) {
        const cached = cache.get(provider, intent);
        if (cached) {
            const valid = await validateResolvedTarget(page, cached.target, semanticTarget);
            if (valid) return { ...cached.target, resolution: 'cache' };
        }
    }

    // 2. snapshot ref semantic match
    if (snapshot) {
        for (const ref of Object.values(snapshot.refs)) {
            if (semanticTarget.roles?.includes(ref.role) &&
                semanticTarget.names?.some(p => p.test(ref.name))) {
                return { ref: ref.ref, role: ref.role, name: ref.name, selector: ref.selector, resolution: 'snapshot-semantic' };
            }
        }
    }

    // 3. provider CSS fallback
    for (const sel of selectors) {
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
            const visible = await page.locator(sel).first().isVisible().catch(() => false);
            if (visible) return { selector: sel, resolution: 'css-fallback' };
        }
    }

    // 4. observe-target ranked candidates
    if (snapshot) {
        const targets = await observeProviderTargets(page, { provider, snapshot });
        const feature = Object.keys(targets).find(k => intent.startsWith(k));
        if (feature && targets[feature].length > 0) {
            const ranked = rankTargetCandidates(targets[feature], semanticTarget);
            if (ranked.length > 0) return { ...ranked[0], resolution: 'observe-ranked' };
        }
    }

    // 5. fail
    return null;
}

export async function validateResolvedTarget(page, target, {
    expectedRole,
    expectedNamePatterns,
    mustBeVisible = true,
    mustBeEnabled = true,
} = {}) {
    if (!target.selector) return false;
    const el = page.locator(target.selector).first();
    const visible = await el.isVisible().catch(() => false);
    if (mustBeVisible && !visible) return false;
    const enabled = await el.isEnabled().catch(() => false);
    if (mustBeEnabled && !enabled) return false;
    return true;
}
```

### MODIFY `web-ai/browser-primitives.mjs` — trace wrappers

Add traced action wrappers:

```js
export async function clickResolvedTarget(page, resolvedTarget, traceCtx) {
    const before = traceCtx?.snapshotHash;
    if (resolvedTarget.selector) {
        await page.locator(resolvedTarget.selector).first().click();
    }
    if (traceCtx) traceCtx.record({ action: 'click', target: resolvedTarget, before });
}

export async function fillResolvedTarget(page, resolvedTarget, value, traceCtx) {
    if (resolvedTarget.selector) {
        await page.locator(resolvedTarget.selector).first().fill(value);
    }
    if (traceCtx) traceCtx.record({ action: 'fill', target: resolvedTarget });
}
```

## Diffs (PR2)

### NEW `web-ai/action-cache.mjs`

Cache entry shape:

```json
{
  "schemaVersion": 1,
  "provider": "chatgpt",
  "intent": "composer.fill",
  "actionKind": "fill",
  "urlHost": "chatgpt.com",
  "pageFingerprint": {
    "domHashPrefix": "abc123",
    "axHashPrefix": "def456"
  },
  "target": {
    "selector": "div[contenteditable='true']",
    "role": "textbox",
    "name": "Message ChatGPT",
    "signatureHash": "sha256:..."
  },
  "validation": {
    "mustBeVisible": true,
    "mustBeEnabled": true,
    "namePatterns": ["message", "prompt"]
  },
  "stats": {
    "hitCount": 12,
    "lastValidatedAt": "2026-05-01T..."
  }
}
```

API surface:

```js
export function loadActionCache(homeDir) {}
export function saveActionCache(homeDir, cache) {}
export function getCachedTarget(cache, provider, intent) {}
export function updateCacheEntry(cache, provider, intent, target, fingerprint) {}
```

Storage: `$BROWSER_AGENT_HOME/action-cache.json`. JSON, not JSONL — small
file, fully replaced on write. Stale entries pruned on load (> 30 days
without validation).

### NEW `web-ai/action-trace.mjs`

Action trace entry shape:

```json
{
  "stepId": "01J...",
  "ts": "2026-05-01T...",
  "action": "copy.lastResponse",
  "target": {
    "ref": "@e17",
    "selector": "button[aria-label='Copy']",
    "resolution": "snapshot-semantic"
  },
  "snapshotHashBefore": "sha256:...",
  "snapshotHashAfter": "sha256:...",
  "status": "ok"
}
```

API surface:

```js
export function createTraceContext(sessionId) {}
export function recordTraceStep(ctx, step) {}
export function getSessionTrace(ctx) {}
```

Traces are per-session, stored in session JSON (not separate files).

### MODIFY `web-ai/churn-log.mjs` — healing fields

Churn-log entries gain healing metadata:

```json
{
  "healing": {
    "cacheHit": false,
    "resolution": "snapshot-semantic"
  }
}
```

## Public-surface changes

- Self-heal is **transparent** — existing CLI commands automatically use
  the resolution chain. No new flags needed.
- Action cache file: `$BROWSER_AGENT_HOME/action-cache.json` (auto-created).
- Session JSON gains `trace[]` array (internal, visible via
  `sessions show --json`).
- Churn-log entries gain `healing` field.

## Test plan

- Unit: `resolveActionTarget` returns cache hit when cache contains valid
  entry for the fingerprint.
- Unit: `resolveActionTarget` falls through cache → snapshot → css → observe
  when each fails.
- Unit: `validateResolvedTarget` rejects invisible or disabled elements.
- Unit: `action-cache` prunes entries older than 30 days.
- Unit: `action-trace` records steps and returns ordered trace.

## Exit criteria

- When ChatGPT renames `#prompt-textarea` to `#composer-textarea`, agbrowse
  still finds the composer via snapshot semantic match or observe-targets,
  and the next run uses the cache.
- `sessions show <id> --json` includes the resolution method used for each
  action step.

## Risks

- **Most likely:** cached selector becomes wrong selector (same position,
  different element after a major UI redesign). Mitigated by validation
  checking role + name, not just visibility.
- **Secondary:** observe-targets returns too many candidates, picking the
  wrong one. Mitigated by requiring role AND name match, not just role.

## cli-jaw mirror

| Item | cli-jaw status |
| --- | --- |
| `self-heal` | **Port as-is** to `src/browser/web-ai/self-heal.ts`. |
| `action-cache` | **Port as-is**; storage under `JAW_HOME`. |
| `action-trace` | **Port as-is**; integrate with existing session store. |
| Churn-log healing | **Extend** existing churn-log schema. |
