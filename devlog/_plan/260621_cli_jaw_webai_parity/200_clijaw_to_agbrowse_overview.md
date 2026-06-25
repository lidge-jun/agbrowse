# 200 — cli-jaw → agbrowse Porting Overview

Date: 2026-06-25
Direction: **cli-jaw features worth bringing INTO agbrowse** (the reverse of the parity default)
Source: `/Users/jun/Developer/new/700_projects/cli-jaw/src/browser/web-ai/` (`.ts`) + `skills_ref/search/`
Target: `/Users/jun/Developer/new/700_projects/agbrowse/web-ai/` (`.mjs`) + `skills/browser/search-research/`
Method: cross-repo gap analysis (3 independent read-only analyzers, 2026-06-25)

## What this covers

The parity model is "agbrowse owns evolution," so the interesting finds are **genuine capabilities cli-jaw has that agbrowse lacks** — not Electron/CLI/IPC glue. The analysis confirms agbrowse is the superset on every shared module (chatgpt, chatgpt-model, cli-sessions are all larger in agbrowse), so there are **no shared-module fixes to back-port**. The real backlog is a small set of cli-jaw-only capabilities.

| Doc | Scope |
| --- | --- |
| [201_webai_capability_registry_and_tools.md](201_webai_capability_registry_and_tools.md) | cli-jaw-only web-ai capabilities: declarative capability registry cluster, annotated/set-of-mark screenshot, unified interstitial detector, product-surface detector, richer diagnostics taxonomy, provider-adapter interface |
| [202_search_discipline_to_agbrowse.md](202_search_discipline_to_agbrowse.md) | The *algorithmic* parts of the cli-jaw `search` skill that port to agbrowse's `research` code (M1–M5 candidate-space discipline, era-sweep, disconfirmation) — the orchestration prose does NOT port |
| [203_adaptive_fetch_and_misc.md](203_adaptive_fetch_and_misc.md) | **Pass 1** — cli-jaw's richer **fetch ladder** agbrowse lacks: TLS-impersonation (JA3), yt-dlp, camoufox, feed-parser, BM25 reranker, structured table extractor + lane-classified discovery; plus typed status report + copy-markdown leniency |

## Headline (port priority)

**P1 — genuine capability gaps worth porting to agbrowse:**
1. **Declarative capability registry cluster** (`capability-registry.ts` + `capability-types.ts` + `capability-observation-presets.ts`) — the structural centerpiece. agbrowse has runtime probes (`capability.mjs`) but **no declarative capability inventory/gating model** with status/ownerPrd/browserGate/observation-presets.
2. **Annotated / set-of-mark screenshot** (`annotated-screenshot.ts`: highlight refs, bounding boxes, image hash) — a real visual-grounding capability agbrowse lacks (agbrowse uses inline boundingBox only).
3. **Unified interstitial detector** (`interstitial.ts`: cloudflare / login-wall / empty-shell / loading → typed retryHint) — agbrowse scatters these patterns ad-hoc per vendor with no single typed detector.

**P2:** read-only product-surface detector (`product-surfaces.ts`), richer diagnostics stage taxonomy (enrich agbrowse `failure-diagnostics.mjs`), provider lifecycle adapter interface (`provider-adapter.ts`, light/contract-only), observed-tool-entries inventory, freshness gate.

**Skip (cli-jaw glue or agbrowse already ahead):** notifications (channel-bound), gemini-contract (obsolete — agbrowse already shipped the live `gemini-live.mjs` runtime), context-pack zip-writer (agbrowse uses `archiver`), context-pack/runtime, `index.ts` barrel, chatgpt-response (already present, just laid out differently).

## Ground rules
- **Docs-only here** — no agbrowse code changes, no push.
- agbrowse search lives as **code** (`research`/`adaptive-fetch`); the cli-jaw `search` skill is **prose orchestration** — only its algorithmic pieces port (see [202](202_search_discipline_to_agbrowse.md)). The bulk of the skill (tier order, gates, anti-snippet-consensus) presupposes an agent and correctly stays in cli-jaw.
- This direction is the **opposite** of the 100-series default; treat ports here as deliberate evolution decisions for agbrowse, not routine mirroring.
