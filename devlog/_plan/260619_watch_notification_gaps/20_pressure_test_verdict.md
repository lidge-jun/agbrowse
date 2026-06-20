# Watch/Notify — Pressure-Test Verdict (2026-06-20)

> Adversarial review of `01_root_cause.md` + `10_solution_plan.md`. Outcome: **~75% premature optimization + 1 misdiagnosis, around one genuine cheap consolidation win.** The MVV is even smaller than the plan claimed — and most of the folder should close to `_fin`.

## Verdict per claim

| Claim | Verdict | Why |
|------|---------|-----|
| 1 · 15s poll latency → adaptive polling | **DROP** | Premature vs the documented `send→watch→bgtask` fire-and-forget workflow — no human/agent is staring at the screen, so 15s is invisible. The pro back-off half belongs to `260619_timeout_adaptive_scaling`, not here. |
| 2 · URL self-heal / watcher reuse existing tolerance | **KEEP** | Real asymmetry; fix is even smaller than stated (see below). The "already exists, just unused" win — same shape as skill-envelope's `--system`. |
| 3 · Per-provider conversation-id registry (gemini/grok) | **DROP** | Misdiagnosed: gemini/grok poll paths never call the `/c/{id}` regex; their guard is host + CDP target-id (`gemini-live.mjs:415`, `grok-live.mjs:243`). `extractConversationId` is chatgpt-local. Nothing broken → YAGNI. |
| 4 · Tier 2 CDP early-nudge | **DROP** | User already vetoed as risky; devlog itself made it opt-in default-off; it optimizes a latency claim 1 shows is invisible. Pure cost. |
| 5 · Reattach requires `--navigate` (#77) | **DOWNSCOPE** | Real in-repo P0 row (`docs/production-readiness.md:41`) but internal, not an external report. The watch-path half is fixed for free by claim 2. |

## The decisive finding (fix is smaller than the plan said)

The watcher **already routes through the self-healing resolver** — `watchSessionOnce` wraps `withSessionPage` (`watcher.mjs:176`) → `resolveSessionPage(... allowNavigate:true)` (`tab-recovery.mjs:392`), which self-heals root→`/c/` drift and returns the **updated** session (`tab-recovery.mjs:314-318`). But the watcher's callback destructures only `{ page, targetId }` (`watcher.mjs:176`), **discards the healed `session`**, then runs `ensureWatcherAttached(page, session, options)` (`:179`) against the **stale** `session` captured at `:116` using the strict hash-only `urlsEquivalentForWatch` (`:559-569`). So it re-introduces the very mismatch the resolver just healed and surfaces it as `status:'reattach-mismatch'` (`:183`).

→ The fix is **deletion/consolidation, not new code.**

## Already-exists-just-unused (the cheap real win)

- `resolveSessionPage` self-heal (`tab-recovery.mjs:314-325`) runs **inside** the watcher already — then is overridden by a redundant strict re-check reading a stale session.
- `shouldPreferCurrentProviderUrl` + `urlsCompatible` (`tab-recovery.mjs:230-243,412-425`) already encode host-alias / trailing-slash / root-drift tolerance. The watcher's `urlsEquivalentForWatch` is a strictly-weaker duplicate to retire.

## Minimal Viable Version

Two micro-edits in `web-ai/watcher.mjs`:
1. Destructure and **use the resolved `session`** the resolver already healed (instead of closing over the stale outer `session` from `:116`).
2. Delete the redundant `ensureWatcherAttached` strict re-check (`:398-412`) / retire `urlsEquivalentForWatch`; keep `--navigate` governing only a genuinely *different* conversation (different target/host, no id match).

Plus one table-driven unit test (drifted `/` → `/c/<id>` yields no `reattach-mismatch` and rewrites `conversationUrl`) on the existing fake-provider harness. **Stop there.** ≈ 30-line consolidation PR.

**Cut entirely:** adaptive interval (1A), conversation-id registry (1B — misdiagnosed), all of Tier 2 CDP nudge.

## Recommendation

DOWNSCOPE hard; close most of the folder to `_fin`. Keep only the ~30-line watcher consolidation (retires the watch-path half of #77). The "15s too slow" framing fails the user-visible test under the bgtask workflow; the only latency concern with teeth is the *opposite* (pro hammering), already owned by the timeout folder. `10_solution_plan.md` is **superseded by this verdict**; `01_root_cause.md` stays as background.
