# 260621 cli-jaw Web-AI Parity Mirror

## Objective

Bring cli-jaw's `src/browser/web-ai/` TypeScript modules to functional parity
with agbrowse's `web-ai/` JavaScript modules for the core command surface.
agbrowse owns evolution; cli-jaw mirrors stabilized pieces.

## 2026-06-25 — Bidirectional parity (numbered docs)

This folder is now the **bidirectional** agbrowse↔cli-jaw parity tracker. A
2026-06-25 cross-repo gap analysis (3 independent read-only analyzers) split the
work into two numbered series. **Docs-only — no code changes in either repo, no push.**

| Series | Direction | Docs |
| --- | --- | --- |
| **100** | agbrowse → cli-jaw (cli-jaw mirrors agbrowse) | [100 overview](100_agbrowse_to_clijaw_overview.md) · [101 stability patches 31–35](101_webai_stability_patches.md) · [102 remaining modules + OOS](102_webai_remaining_modules.md) · [103 search: cli-jaw should leverage agbrowse research](103_search_agbrowse_research_for_clijaw.md) |
| **200** | cli-jaw → agbrowse (reverse — deliberate agbrowse evolution) | [200 overview](200_clijaw_to_agbrowse_overview.md) · [201 capability-registry + tools](201_webai_capability_registry_and_tools.md) · [202 search discipline → research](202_search_discipline_to_agbrowse.md) |

**Top of each backlog:** 100 → P0 `session-artifacts` foundation, then `chatgpt-files` + response-observer; 200 → P1 declarative capability-registry cluster + annotated-screenshot + interstitial detector.

### Convergence log (analysis exhaustiveness)

The gap analysis is driven to **convergence**: parallel cross-repo sub-agent passes run repeatedly until 2 consecutive passes surface nothing new (the analysis "admits" exhaustion), capped at 5 passes. Each pass widens scope beyond the prior one.

| Pass | Scope/lens | New gaps found | Dry? |
| --- | --- | --- | --- |
| 0 | initial 3-agent analysis (web-ai modules + search), both directions | 100: 31–35 + remaining modules; 200: capability-registry cluster + 3 tools; search both ways | — |
| 0b | known-missing sweep (WIP that landed mid-analysis) | +101 #9 streaming false-complete + watcher streaming-recovery (cff76ed) | — |
| 1 | 3 agents: shared-module **line-diff** + adjacent layers (skills/browser, adaptive-fetch) + non-ChatGPT vendors | **~27 new** → [104](104_webai_shared_module_divergences.md) (18 shared/vendor, 100-dir) + [203](203_adaptive_fetch_and_misc.md) (9 fetch-ladder/misc, 200-dir) | **No** |
| 2 | 2 agents: remaining-modules sweep + completeness critic ("what did 0–1 miss?") | **2 systemic surfaces** → [105](105_systemic_parity_surfaces.md) (error-code taxonomy 33v15 + CLI flag delta 73v37 incl. inline prompt-channel); remaining-modules **near-dry** (resolved/upgraded [102](102_webai_remaining_modules.md) "verify" rows: navigation-ready→P1, tab-inspect/candidate-reconcile/session-doctor/control-summary confirmed — enrichment, ~0 brand-new) | **No** |
| 3+ | re-sweep modules (dry-check) + 2nd completeness lens (more systemic surfaces?) | _pending_ | _pending_ |

Convergence = 2 consecutive passes with **0 new gaps after dedup**. Status updated each pass.

> **Pass 1 takeaway:** the initial analysis was NOT exhaustive — line-diffing shared modules surfaced 18 agbrowse→cli-jaw behavioral gaps the spot-check missed (session/model/code-mode/composer/attachments/watcher/vendor probes), and the adjacent-layer lens surfaced a whole cli-jaw→agbrowse **fetch-ladder** dimension (TLS-impersonation, yt-dlp, camoufox, feed-parser, BM25). Not converged; continue.

> **Pass 2 takeaway:** the *module* well is drying — Agent D found ~0 brand-new modules (only resolved/enriched existing 102 "verify" rows). But the completeness critic found a new *axis*: **cross-cutting contract surfaces** (error-code vocabulary, CLI flag surface) that no per-module doc tracked. Verified by direct count (agbrowse 33 codes/73 flags vs cli-jaw 15/37; the agent's flag count was corrected down — ~15 of the 36 flag-deltas are eval/policy/trace OOS). Mostly derivative of documented module gaps, but the inline `--system`/`--context` prompt-channel + `cdp.headless`/`cdp.unreachable` codes are genuinely new. Not converged (found a new surface class); Pass 3 must check for *more* systemic surfaces before declaring dry.

> Note: the original Phase 1–4 scope below predates the analysis. cli-jaw now
> **has** `chatgpt-tools.ts`, `chatgpt-deep-research.ts`, `chatgpt-multi-turn.ts`,
> `chatgpt-model.ts`, `cli-sessions.ts` — so those items are largely done (deep-research
> is now BEHIND, not absent; model is BEHIND on pill-wait/retry). The current,
> authoritative gap is the 100/200 series above; the section below is kept as the
> original seed.

## Scope

### Phase 1: chatgpt-model i18n + session-target-guard (C1)

**chatgpt-model.ts** — add Korean labels to `CHATGPT_SIMPLIFIED_INTELLIGENCE_OPTIONS`.
agbrowse has `['Instant', '즉시']`, `['Medium', '중간']`, `['High', '높음']`,
`['Extra High', '매우 높음']`, `['Pro Extended', 'Pro 확장', '프로 확장']`.
cli-jaw has English-only arrays.

**session-target-guard.ts** — new file. Port from agbrowse `session-target-guard.mjs`:
- `normalizeWebAiVendor()`
- `sanitizeSessionCandidate()`
- `activeProviderSessionCandidates()`
- `resolveImplicitSessionSelection()`
- `ambiguousSessionTargetError()`
- `sessionPollRecoveryCommand()` (adapted for cli-jaw CLI)
- `buildTargetMismatchResult()`

### Phase 2: chatgpt-tools + chatgpt-deep-research (C2)

**chatgpt-tools.ts** — new file. Port from agbrowse `chatgpt-tools.mjs`:
- `TOOL_ALIASES`, `TOOL_LABELS`, `PLUGIN_LABELS`
- `resolveChatGptComposerToolRequests()`
- `selectChatGptComposerTools()`
- Intent heuristics (`looksLikeImageGeneration`, `looksLikeDeepResearch`, etc.)

**chatgpt-deep-research.ts** — new file. Port from agbrowse `chatgpt-deep-research.mjs`:
- `DEEP_RESEARCH_SELECTORS`
- `autoConfirmPlan()`
- `sendDeepResearch()`
- Helper functions (countAssistants, readLatestAssistant, isStreaming, etc.)

### Phase 3: chatgpt-multi-turn (C1)

**chatgpt-multi-turn.ts** — new file. Port from agbrowse `chatgpt-multi-turn.mjs`:
- `sendMultiTurn()`
- `renderMultiTurnTranscript()`
- Types: `TurnResult`, `MultiTurnResult`

### Phase 4: CLI surface + integration (C2)

**bin/commands/browser-web-ai.ts** — no new CLI commands yet (agbrowse-owned
surfaces like `snapshot`, `eval`, `mcp-server` stay agbrowse-only). Only wire
existing `send`/`query` to use the new modules when flags are provided:
- `--tool <name>` / `--auto-tools` flags → chatgpt-tools
- `--research deep` flag → chatgpt-deep-research
- `--follow-up <text>` flag → chatgpt-multi-turn
- Implicit session resolution via session-target-guard on `poll`/`stop`

## Out of Scope

- chatgpt-attachments multi-file batch (PRD32.7 Phase B — deferred, agbrowse-owned)
- code-mode is already mirrored in cli-jaw
- eval, mcp-server, project-sources commands (agbrowse-only)
- policy/, trace/, claim-audit (agbrowse-only infrastructure)
- No git push

## Verification

- `npx tsc --noEmit` in cli-jaw
- Run existing unit tests: `npm test -- tests/unit/browser-web-ai-*.test.ts`
- New unit tests for session-target-guard, chatgpt-tools resolver, chatgpt-model i18n
