# 103 — cli-jaw `search` should leverage agbrowse `research` (agbrowse → cli-jaw)

Date: 2026-06-25 · Parent: [100](100_agbrowse_to_clijaw_overview.md)
Source (agbrowse code): `skills/browser/search-research/*.mjs`, CLI wiring `skills/browser/browser.mjs:2075-2208`, `skills/browser/adaptive-fetch/`, `web-ai/cli.mjs`
Target (cli-jaw policy): `skills_ref/search/SKILL.md` (single prose file, no `references/`)

## Architecture relationship (important)
The two sit at **different layers**: cli-jaw `search` is an **agent-orchestration skill** (4-tier escalation: built-in WebSearch → cli-jaw browser CDP → progrok → web-ai), while agbrowse `research` is a **deterministic code pipeline** that re-implements the Tier-1/Tier-2 query-rewrite + fetch-evidence + browse-escalation logic. agbrowse `web-ai` is cli-jaw's **Tier 4 executor** (this is explicit: agbrowse `skills/web-ai/SKILL.md:73` "aligned with cli-jaw registry shape", `:171` cli-jaw bgtask row).

**The skill cites only `research plan` (optional) and fences off the rest** — but `normalize-results`/`enrich-fetch`/`browse-plan` do **not** execute Exa/Tavily/Perplexity/Brave (they *consume* native-search JSON), so they fall **outside** the skill's "don't use agbrowse for providers" ban and are safe to adopt. This doc is **doc-only guidance** for a future cli-jaw `search` SKILL.md edit (no agbrowse code changes).

## Gaps — agbrowse coded capabilities the skill under-leverages

| # | Capability | agbrowse source | cli-jaw search status | Pri |
| --- | --- | --- | --- | --- |
| B1 | `research` 4-command pipeline (plan→normalize-results→enrich-fetch→browse-plan) as a deterministic Korean rewrite + evidence engine | `browser.mjs:2075-2208`; `search-research/*.mjs` | Under-leveraged — only `research plan` cited (L171-179); 3 of 4 subcommands unmentioned | **High** |
| B3 | `enrich-fetch` constraint-ledger evidence engine (fetch each candidate via adaptive-fetch; mark constraints supported/pending; emit `nextStep`) | `search-research/fetch-enrichment.mjs` + `constraint-ledger.mjs` | Missing — "fetch a primary source before `sufficient`" enforced only by agent discipline; agbrowse makes it a verifiable ledger | **High** |
| B4 | `browse-plan` browse-escalation router (weak/empty/Naver/dynamic/table candidate → explicit `new-tab/snapshot/text/get-dom/network` commands w/ reason + priority) | `search-research/browse-escalation.mjs` | Conceptually present (Tier-2 prose) but emits no command plan; agbrowse computes the exact command list | **High** |
| B2 | `normalize-results` snippet→URL-candidate normalizer (dedupe, drop invalid, `resultRole:url-candidates`, `evidencePolicy:snippets-are-not-final-evidence`) | `search-research/normalizer.mjs` | Missing as a tool — stated in prose, done by hand | Med |
| B5 | Korean route selector + source-hint detection (`naver/namuwiki/bookstore/academic/official/structured/date` → route URL builder) | `search-research/korean-routes.mjs` | Missing as code — source hints in prose (L156-159) only | Med |
| B7 | ChatGPT Deep Research mode (`--research deep`, iframe plan-card auto-confirm, report artifact) as a concrete deep-synthesis executor | `web-ai/cli.mjs` (`research:'deep'`), `chatgpt-deep-research*.mjs` | Partial — Tier 4 mentions GPT Pro/Deep Think + bgtask but not `web-ai query --research deep` | Med |
| B6 | `adaptive-fetch` ladder (23 endpoint resolvers, TLS rotation, Jina reader, CDP, content-scorer, challenge-detector) | `skills/browser/adaptive-fetch/` | Already used as cli-jaw's own `browser fetch` (parallel impl) — no gap unless cli-jaw wants to delegate to `agbrowse fetch` | Low |
| B8 | web-ai per-capability probe (`web-ai status --json` → `capabilities[]` w/ state/evidence/next) | `web-ai/SKILL.md:65-86`, `capability.mjs` | Tier-4 gate is binary (`web-ai status --vendor`); richer probe not surfaced | Low |
| B9 | MCP server surface for research/browse/web-ai | `web-ai/mcp-server.mjs` | Not referenced; only relevant if cli-jaw wants MCP-based tier execution | Low (OOS) |

## Recommendation
**Highest leverage:** have cli-jaw search **Tier 2** reference `agbrowse research enrich-fetch` + `browse-plan` as the deterministic evidence/escalation step (B3 + B4), and **Tier 1** reference `normalize-results` (B2). These operationalize three rules the skill currently enforces only by agent discipline (snippet→candidate, fetch-before-`sufficient`, when/how to escalate) and are provider-ban-safe. This is a **cli-jaw SKILL.md doc edit**, tracked here but executed in the cli-jaw repo separately.

## Two-way vocabulary alignment (see also [202](202_search_discipline_to_agbrowse.md))
cli-jaw evidence statuses `sufficient/partial/browse-needed/insufficient` vs agbrowse `complete/insufficient-evidence` + fetch `verdict` + `nextStep`. Aligning the label vocabulary lets the orchestrator consume agbrowse `research` JSON without a translation layer.
