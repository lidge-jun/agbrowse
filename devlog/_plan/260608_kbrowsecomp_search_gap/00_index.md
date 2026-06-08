# K-BrowseComp Search Gap Analysis

Date: 2026-06-08
Target: agbrowse search/research capability backlog
Primary sources:
- Local prior analysis: `/Users/jun/developer/k-browsecomp-analysis/`
- Dataset: `prometheus-eval/k-browsecomp` on Hugging Face
- Code/readme: `prometheus-eval/K-BrowseComp`
- Search API docs: Perplexity Search, Exa Search, Tavily Search, Brave Search

## Scope Boundary

This document set analyzes the public benchmark problems (`problem`) and the
released intended solution metadata (`expected_chain`, `checklist`,
`korean_specific_keyword`). The public dataset does not expose per-model
tool-call strings for each evaluation run, so "actual query" here means the
actual benchmark problem text and expected retrieval chain, not private
model-generated `search_web(...)` logs.

Gold answers are intentionally omitted from the examples in this public
agbrowse repo. The analysis uses row ids, short excerpts, pattern tags, and
source-domain statistics to avoid republishing query-answer pairs.

## Documents

| # | File | Topic | Output |
|---|------|-------|--------|
| 01 | `01_dataset_anatomy.md` | Dataset/query anatomy | Counts, source domains, query-shape distribution |
| 02 | `02_agent_architecture_gap.md` | Harness gap | K-BrowseComp search-only harness vs agbrowse browser runtime |
| 03 | `03_query_generation_patterns.md` | Actual query patterns | Six recurring patterns that break naive search |
| 04 | `04_korean_portal_navigation.md` | Korean source routing | Source-specific browser/navigation requirements |
| 05 | `05_structured_extraction_cases.md` | Structured extraction | Table/list/raw-source/ordinal cases and parser needs |
| 06 | `06_multi_hop_orchestration.md` | Multi-hop state | Decomposition, evidence ledger, budget policy |
| 07 | `07_failure_mode_countermeasures.md` | Failure modes | F0-F8 mapped to agbrowse countermeasures |
| 08 | `08_agbrowse_search_skill_spec.md` | Implementation spec | Prioritized patches and benchmark gates |
| 09 | `09_search_backend_io_contracts.md` | Existing search backend I/O | How Perplexity/Exa/Tavily/Brave queries and responses collapse into snippets |
| 10 | `10_keyword_adjustment_fetch_loop.md` | Minimal keyword + fetch strategy | Small query rewrites that turn search results into fetchable evidence |
| 11 | `11_browse_skill_coverage.md` | Browse fallback coverage | What fetch cannot cover and when browser skills should take over |
| 12 | `12_agbrowse_delta_current_capability.md` | agbrowse delta | What agbrowse can add beyond the current URL-reader/search-only split |
| 13 | `13_provider_cli_query_probe.md` | Provider CLI query probe | Actual Codex/Claude/AGY/Cursor Korean query/result observations |
| 14 | `14_cli_jaw_query_patch_smoke_corpus.md` | cli-jaw query patch smoke corpus | Query-rewrite-first smoke prompts and pass/fail criteria |
| 15 | `15_offline_fixture_contract.md` | Offline fixture contract | Network-free fixture shape for query/fetch/browse trajectory validation |
| 16 | `16_patch_sequence_search_research.md` | Search research patch sequence | P0-P4 implementation sequence from planning core to live harness |
| 17 | `17_cli_jaw_browser_mirror_plan.md` | cli-jaw browser mirror plan | Required browser command parity between cli-jaw and agbrowse |
| 18 | `18_browser_surface_inventory.md` | Browser surface inventory | A/B inventory of cli-jaw-only, agbrowse-only, shared, and drifted command surfaces |
| 19 | `19_standalone_orchestrated_architecture.md` | Standalone/orchestrated architecture | cli-jaw-only, agbrowse-only, and integrated operating modes |
| 20 | `20_p0a_browser_surface_parity_plan.md` | P0a implementation plan | Concrete browser command parity patch plan before research CLI work |
| 21 | `21_p1_research_cli_plan.md` | P1 implementation plan | `agbrowse research plan` CLI and search-result normalizer contract |
| 22 | `22_p3_fetch_enrichment_plan.md` | P3 implementation plan | Fetch original-page evidence from normalized search URL candidates |

## Key Dataset Facts

| Metric | Value |
|--------|-------|
| Verified split | 300 problems |
| Synthetic split | 100 problems |
| All public problems | 400 |
| Type distribution | 213 multi-hop / 187 parallel |
| Verified expected-chain depth | median 4, p75 6, max 11 |
| Verified sources per problem | median 5, p75 6, max 20 |
| Problem length | median 174 chars, p90 309, max 1315 |
| Top expected-chain domain | `namu.wiki` (244 references) |

## Key Query Signals

Heuristic counts over the 400 public `problem` fields:

| Signal | Count | Search implication |
|--------|-------|--------------------|
| Date/time scoped | 256 | Needs temporal filters and stale-source rejection |
| Table/list/ordinal wording | 199 | Snippets are unsafe; full DOM or structured parser needed |
| Variable/arithmetic (`A`, `B`, `X+45`) | 83 | Needs state ledger and deterministic calculation |
| Numbered conditions | 77 | Needs all-constraints checklist before final answer |
| Explicit Naver mention | 16 | Direct Naver route should be preferred |
| Alias/romanization risk | 20 | Needs Korean entity normalization and alias expansion |

## Main Conclusion

K-BrowseComp exposes a search/research gap that is larger than "which search
engine is used." The strongest missing capability is an agent loop that can:

1. Decompose a Korean multi-constraint problem into atomic searches.
2. Route each atomic search through Korean-first sources when appropriate.
3. Visit and parse full pages instead of trusting snippets.
4. Preserve candidate, constraint, and evidence state across hops.
5. Refuse or defer finalization until all required constraints are verified.

agbrowse already has the CDP/browser layer and adaptive URL reading needed for
item 3. The extra research in docs 09-12 sharpens this into a practical route:
keep existing search APIs for URL discovery, make small Korean/source-aware
keyword rewrites, fetch the returned URLs, and use browser skills only when
fetch cannot see the needed page state.

Docs 17-19 add the missing integration constraint: the K-BrowseComp patch plan
must advance cli-jaw browser command parity and agbrowse research planning
together. cli-jaw is the employee orchestrator; agbrowse is the standalone
browser runtime. If the browse command surface diverges, the query/fetch/browse
workflow cannot be taught reliably across both systems. The target architecture
has three valid modes: cli-jaw without agbrowse, agbrowse without cli-jaw, and
the combined cli-jaw + agbrowse workflow.

The provider probe in doc 13 confirms this direction across Codex, Claude,
AGY/Gemini, and Cursor. Internal search query rewrites are generally not
exposed, search outputs are mostly snippets/synthesis/citations, and
search-only evidence was insufficient for the tested Korean tasks. Doc 14 turns
that observation into a cli-jaw prompt-patch smoke corpus focused first on
better query sending, with fetch and browse kept as downstream verification
decisions.
