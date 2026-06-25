# 202 — cli-jaw Search Discipline → agbrowse `research`

Date: 2026-06-25 · Parent: [200](200_clijaw_to_agbrowse_overview.md)
Source (cli-jaw policy): `skills_ref/search/SKILL.md` (single prose file)
Target (agbrowse code): `skills/browser/search-research/{search-strategy,constraint-ledger,normalizer,fetch-enrichment,browse-escalation,korean-routes}.mjs`

## Scope caveat (read first)
The cli-jaw `search` skill is **~90% agent-orchestration prose** — tier order, per-tier gates, "never silently chain fallbacks", anti-snippet-consensus, effort-matching. That **does not port** to agbrowse, which is a code library with no tier concept and no progrok tier; those decisions belong to the calling agent and correctly stay in cli-jaw. Only the **algorithmic** pieces port. This doc is doc-only guidance for a future agbrowse `search-research` enhancement (no code changes now).

## Portable (algorithmic) gaps — cli-jaw → agbrowse

| # | Capability | cli-jaw source | agbrowse target status | Pri |
| --- | --- | --- | --- | --- |
| A1 | **M1–M5 candidate-space discipline**: anchor on the rarest clue, enumerate 3+ rivals, candidate×constraint matrix, disconfirmation pass, WEAK-match flag | SKILL.md "Candidate-space discipline" L73-126 | **Partial** — `constraint-ledger.mjs` has the constraint×candidate matrix + `supported/pending`, but no *anchor-rarest*, no *rivals[]*, no *disconfirmation*, no *weak* flag | **Med** (highest-value port) |
| A2 | **Era-sweep** for cultural-phenomenon clues (inject `원조/최초/시초` + decade-qualified queries to beat recency bias) | SKILL.md L93-100 | **Missing** — `search-strategy.mjs` `extractDateTerms`/`buildAtomicQueries` add explicit dates only when present; never *injects* era-sweep variants | Low-Med |
| A3 | **Disconfirmation query generation** (auto-emit a "find a DIFFERENT entity" query) | SKILL.md M4 L101-103 | **Missing** in `buildAtomicQueries` (only discovery/verification/source-restricted specs) | Low |
| A4 | **Bounded-effort fallback ladder** (cap enum 3–5, 1–2 disconfirm searches, "shallow matrix beats deep single-candidate", degrade rules) | SKILL.md L110-126 | **Missing as policy** — `maxQueries`/`maxResults`/`maxActions` caps exist but no degrade-and-flag semantics | Low (mostly agent judgment) |
| A6 | **Evidence-status vocabulary** (`sufficient/partial/browse-needed/insufficient`) | SKILL.md L300-308 | **Diverged** — agbrowse uses `complete/insufficient-evidence` + fetch `verdict` (`strong_ok/weak_ok/blocked`) + `nextStep` | Low (align labels) |
| A7 | Model-gated parallel research lanes (`official/community/realtime/fetch`, merge into matrix) | SKILL.md "Model-gated parallel research" L40-62 | **Missing** — `research` is single-pass; lane *classes* exist in prose only | Low (only the lane taxonomy is data-portable) |

> A5 (4-tier escalation order + per-tier gates) is **N/A — does not port**: agbrowse has no progrok tier and no "tier order" notion; it owns only the executors. Correctly lives in the orchestrator.

## Recommendation
**Highest-leverage port:** extend `constraint-ledger.mjs` with `anchorConstraintId`, a `rivals[]` slot, a disconfirmation pass, and a `weak` evidence flag (A1) — these are genuinely algorithmic and the ledger already has the matrix substrate. Add `purpose:'era-sweep'` / `purpose:'disconfirm'` query specs to `buildAtomicQueries` (A2/A3). These strengthen `research plan` output without touching agent-orchestration concerns.

## Two-way alignment (see also [103](103_search_agbrowse_research_for_clijaw.md))
Align the **evidence-status vocabulary** (A6): map agbrowse `complete/insufficient-evidence` + fetch `verdict` to cli-jaw `sufficient/partial/browse-needed/insufficient` so the orchestrator consumes agbrowse `research` JSON without a translation layer. This benefits BOTH directions and is the one shared cleanup worth doing first.
