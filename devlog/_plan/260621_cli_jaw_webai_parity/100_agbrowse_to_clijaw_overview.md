# 100 — agbrowse → cli-jaw Porting Overview

Date: 2026-06-25
Direction: **agbrowse owns evolution → cli-jaw mirrors stabilized pieces**
Source: `/Users/jun/Developer/new/700_projects/agbrowse/web-ai/` (`.mjs`)
Target: `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/` (`.ts`)
Method: cross-repo gap analysis (3 independent read-only analyzers, 2026-06-25)

## What this covers

The agbrowse → cli-jaw backlog: features agbrowse has that cli-jaw lacks or is behind on. This is the **100-series**. Each detail doc carries covered-vs-missing truth with file/line evidence on both sides plus a port priority.

| Doc | Scope |
| --- | --- |
| [101_webai_stability_patches.md](101_webai_stability_patches.md) | The 31–35 stability patches just shipped in agbrowse v0.1.16-preview + the session-artifacts foundation they depend on |
| [102_webai_remaining_modules.md](102_webai_remaining_modules.md) | Other agbrowse web-ai modules cli-jaw lacks (images, archive, project-sources, upload-surface, navigation-ready, …) + agbrowse-only out-of-scope list |
| [103_search_agbrowse_research_for_clijaw.md](103_search_agbrowse_research_for_clijaw.md) | cli-jaw `search` skill should leverage agbrowse's coded `research`/`enrich-fetch`/`browse-plan` pipeline (it currently cites only `research plan`) |
| [104_webai_shared_module_divergences.md](104_webai_shared_module_divergences.md) | **Pass 1** — 18 shared-module + vendor behavioral gaps found by line-diff (session lock/active, model evidence+i18n, code-mode nav, composer resolved-targets, attachment filename-verify, watcher/profile locks, vendor capability probes) |
| [105_systemic_parity_surfaces.md](105_systemic_parity_surfaces.md) | **Pass 2** — cross-cutting surfaces the per-module analysis missed: error-code taxonomy (33 vs 15 codes), CLI flag delta (73 vs 37 — incl. inline `--system`/`--context` prompt-channel), test-coverage delta |

## Headline (port priority)

**P0 — do first:**
1. `session-artifacts.ts` with `kind:'file'` + `kind:'diagnostics'` descriptors + save helpers — **foundation**; unblocks generic file capture and failure diagnostics (cli-jaw has only in-memory `answer-artifact.ts`/`code-artifact.ts`, no on-disk artifact registry).
2. `chatgpt-files.ts` — generic downloadable-file capture (whole module absent in cli-jaw).
3. Response-observer early-wake + 3rd-tier recovery (cli-jaw `chatgpt-response.ts` is poll-only).

**P1 — next:**
- `tab-recovery.ts` (isSafeChatGptConversationUrl + openConversationInNewTab) → deep-research-report module (target-scope + resume + not-started) → cli-sessions resume-deep + new-tab reattach.
- model-pill mount-wait + bounded retry; failure-diagnostics DOM/screenshot artifact (after the session-artifacts foundation); generated-image capture.

**P2:** archive, project-sources, upload-surface scoring, navigation-ready, session-doctor, tab-inspect — quick "is it folded elsewhere in cli-jaw?" check before porting each.

## Ground rules (carried from 00_plan.md)
- agbrowse owns evolution; cli-jaw mirrors **stabilized** pieces only.
- agbrowse-only infra stays agbrowse-only (eval/, policy/, trace/, mcp-server, cli.mjs, tool-schema, planner-loop, claim-audit) — see 102 §3.
- **Docs-only here** — no code changes in either repo, no cli-jaw writes, no push.
- cli-jaw `capability.mjs` is a **refactor not a gap** (cli-jaw split it into `capability-registry/-types/-freshness/-…`); see [200-series](200_clijaw_to_agbrowse_overview.md).
