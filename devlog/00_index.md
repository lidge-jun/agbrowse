# agbrowse devlog — index (v2, post-critique)

Phased plan derived from the 2026-05-01 GPT-5.5 Pro peer review and the
follow-up phase critique. Each phase file is diff-level: every MODIFY entry
shows actual before/after snippets and every NEW file shows the exported API
surface plus a 10-line skeleton.

## Reading order

1. This file (`00_index.md`).
2. `context/260501_gpt_pro_peer_review.md` — verbatim peer review with citations.
3. `context/260501_gpt_pro_phase_critique.md` — verbatim phase critique with diff sketches.
4. `context/260501_gpt_pro_phase4plus_research.md` — Phase 4+ expansion research (Vercel/Stagehand/Playwright MCP).
5. Phase files in numbered order.

## Phases

| Phase | File | Theme | Sub-PRs | Engineer-days |
| --- | --- | --- | --- | ---: |
| 0 | `01_phase0_papercuts.md` | Papercuts | 1 | 1–1.5 |
| 2 | `03_phase2_errors.md` | Typed error taxonomy (core first) | 2 | 2.5–4 |
| 1 ⭐ | `02_phase1_sessions.md` | Session IDs + resume | 3 | 5–7 |
| 3 | `04_phase3_capabilities.md` | Capability probe rows | 2 | 3–5 |
| 4 | `05_phase4_diagnostics.md` | DOM diagnostics (`web-ai doctor`) | 2 | 3–4 |
| 5 | `06_phase5_adoption.md` | Adoption hardening | 3 | 2.5–4 |
| 6 | `07_phase6_watcher.md` | Watcher reattach (deferred) | TBD | TBD |
| 7 | `08_phase7_snapshot_substrate.md` | Agent snapshot substrate | 2 | 3–5 |
| 8 | `09_phase8_self_healing.md` | Self-healing selectors + action cache | 2 | 4–6 |
| 9 | `10_phase9_visual_fallback.md` | Visual fallback / annotated screenshot | 1 | 1–2 |
| 10 | `11_phase10_mcp_bridge.md` | MCP / AI SDK bridge | 2 | 3–5 |
| 11 | `12_phase11_eval_harness.md` | DOM churn eval harness | 2 | 2–3 |

Total core estimate (Phase 0–6): 17–25 engineer-days.
Total extended estimate (Phase 7–11): 13–21 engineer-days.
Grand total: 30–46 engineer-days.

## Sequencing (revised after critique)

```
Phase 0
   ↓
Phase 2 PR1 (errors core)        ← move before Phase 1 so session failures
   ↓                               can use WebAiError from day one
Phase 1 PR1 (session-store)
   ↓
Phase 1 PR2 (provider --session)
   ↓
Phase 1 PR3 (sessions list/show/resume)
   ↓
Phase 2 PR2 (convert call sites) ← parallel allowed with Phase 3 PR1
   ↓
Phase 3 (capability probes)
   ↓
Phase 4 (doctor)
   ↓
Phase 5 (adoption)
```

Reasons:

- Phase 4 reuses Phase 3 probes; cannot run in parallel.
- Phase 2 PR1 (errors core) before Phase 1 because session failures need
  structured shape from the start.
- Phase 2 PR2 (call-site rewrites) can be parallelized with Phase 3 PR1
  because they touch different files (provider throws vs capability probes).

## 4-week sprint cut order (if shipping must compress)

1. Drop Phase 5 churn-log + adoption extras.
2. Drop Phase 4 disk/diff/status integration.
3. Trim Phase 3 to host/composer/model rows only.
4. Drop `reattach` and the top-level sessions wrapper.

Keep: Phase 0 + minimal Phase 1 (store + resume) + Phase 2 JSON errors.

## Phase 7–11 sequencing (extended roadmap)

Added 2026-05-01 based on GPT Pro and Grok research into Vercel Labs
agent-browser, Stagehand, Playwright MCP, Browser-Use, AgentQL, and
WebVoyager. Full research at `context/260501_gpt_pro_phase4plus_research.md`.

```
Phase 5 (adoption)
   ↓
Phase 7 PR1 (ax-snapshot + ref-registry)
   ↓
Phase 7 PR2 (observe-targets + vendor-editor-contract)
   ↓
Phase 8 PR1 (self-heal resolver)       ← uses Phase 7 snapshot/refs
   ↓
Phase 8 PR2 (action-cache + trace)
   ↓
Phase 6 (watcher)                      ← now uses snapshot hashes
   ↓
Phase 9 (visual fallback)              ← parallel with Phase 6
   ↓
Phase 10 (MCP bridge)                  ← needs Phase 7+8 stable
   ↓
Phase 11 (eval harness)                ← uses all prior phases
```

Key insight from research: the progression is "DOM hash" → "agent repair
substrate". Accessibility snapshots + @eN refs become the primary agent
interface; raw DOM selectors become fallback.

## Out of scope (current iteration)

- Watcher dashboard / web UI.
- New providers (Claude, Perplexity).
- API-mode fallback when login is missing.
- Docker / cloud profile sync.
- `agbrowse churn report` summarization command (Phase 5 leaves JSONL for
  downstream tools).
- `bin/agbrowse-sessions.mjs` shortcut (route through `web-ai sessions`).
- Cloud LLM-based selector re-resolution (Stagehand-style AI self-heal).
  Local deterministic resolution only for Phase 8.

## Conventions

- One phase per file. Every PR is one bullet list of files changed.
- Each phase file contains: decisions, diffs, public-surface changes, test
  plan, smoke plan, exit criteria, risks.
- Diffs use real before/after snippets when the call site is known; otherwise
  marked "schematic".
- Source of truth for diff sketches is `context/260501_gpt_pro_phase_critique.md`;
  this devlog mirrors the relevant slices only.

## Dual-repo patching strategy

Every phase ships to **both** repos in lockstep:

- `agbrowse` — `/Users/jun/Developer/new/700_projects/agbrowse` (`.mjs`),
  `npm install -g agbrowse`. Standalone consumer.
- `cli-jaw` — `/Users/jun/Developer/new/700_projects/cli-jaw` (`.ts`,
  HTTP-routed). Production runtime; richer existing infrastructure.

Each phase file ends with a `## cli-jaw mirror` section that maps:

- **Ports as-is** — same change, just `.mjs` ↔ `.ts` translation.
- **Already exists** — cli-jaw is further ahead; the phase aligns shape, not
  builds from scratch.
- **Not applicable** — agbrowse-only fix that does not reproduce in cli-jaw
  (e.g. Phase 0 ChatGPT baseline fallback because cli-jaw keys by
  `targetId`).
- **Skill docs** — `cli-jaw/skills_ref/{browser,web-ai}/SKILL.md` (a separate
  submodule with its own remote at `lidge-jun/cli-jaw-skills`) updates next
  to the runtime change.

Phase 0 was the proof of the pattern: shipped to agbrowse `main` (`3c1ea8e`,
`1b4b238`, `32618a7`) and cli-jaw `master` (`3d54c1f`) plus skills_ref `main`
(`256956c`) on the same day.

Plan close-out signed off by GPT-5.5 Pro on 2026-05-01 at conversation
`https://chatgpt.com/c/69f3d889-fe30-83ab-be42-ebf2d9fd692f`. Verbatim
record at `context/260501_gpt_pro_plan_closeout.md`. Non-blocking
clarifications absorbed into Phase 1, 2, 3, 4, 5, and 6 mirror sections.

Sequence inside one phase:

1. Implement in agbrowse first (lighter surface, faster feedback).
2. Run agbrowse unit tests + live smoke.
3. Mirror to cli-jaw with the differences listed in the phase's mirror
   section.
4. Run cli-jaw `npm run typecheck` + targeted unit tests.
5. Update `cli-jaw/skills_ref/web-ai/SKILL.md` (submodule commit) and bump
   the submodule pointer in cli-jaw.
6. Two commits per repo at most: one feature commit + one docs/devlog commit.

If a phase only applies to one repo, the mirror section says so explicitly
and the other repo is skipped.
