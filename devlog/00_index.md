# agbrowse  indexdevlog 

agbrowse is a CLI shipped in `bin/` (`agbrowse`, `web-ai`, `skills/browser`).
 Phase 22) is now merged into `main` and is the
release baseline. Per-phase devlogs are filed under `_fin/mvp/<topic>/` and
must be treated as historical  do not edit them after release.evidence 

> Active capability claims live in `structure/CAPABILITY_TRUTH_TABLE.md`
> and `structure/phase_status.md` (single source of truth, gated by
> `gate:truth-table-fresh`). This index is only a navigator.

## Layout

| Folder | Purpose |
| --- | --- |
| `_fin/mvp/` | Shipped MVP phases, grouped by topic (read-only history). |
| `_plan/` | Active or deferred plans not yet shipped. |
| `_legacy/` | Pre-rewrite changelogs / plans / research dumps. |
| `context/` | Verbatim Pro / Grok peer reviews and gap audits. |

## `_fin/mvp/` topics

| Topic | Folder | Phases |
| --- | --- | --- |
 adoption, watcher) | `01_foundation/` | 0, 1, 2, 3, 4, 5, 6 |
| Snapshot substrate + self-heal + visual fallback | `02_substrate/` | 7, 8, 8.1, 9 |
| MCP / AI SDK bridge + frozen scope | `03_mcp_bridge/` | 10, 18, mcp_browser_snapshot_ref |
| Eval harness + trace replay | `04_eval_trace/` | 11, 12 |
| Safety policy + active command ownership | `05_safety_ownership/` | 13, 14 |
| Browser primitives | `06_browser_primitives/` | 15 |
| Semantic resolver + ChatGPT resolver suite | `07_semantic_resolver/` | 16, action-intent, chatgpt composer/send/upload/copy/effort |
| Provider contracts + sourceAudit + answerArtifact | `08_provider_contracts/` | 17, answer-artifact, source-audit-enforcement |
| Benchmark trajectory writer (offline bundles) | `09_benchmarks/` | 20 |
| Release gates + hardening (Phase 22 closeout) | `10_release_gates/` | 21, 22, gate hardening |
| Structure as source of truth | `11_structure_truth/` | structure_source_truth |
| Session isolation + viewport fix | `12_session_isolation/` | 2026-05-02 series |

## Deferred / incomplete

The following were planned but explicitly not in MVP scope and are kept at the
devlog root instead of `_fin/mvp/`:

| Phase | File | Reason |
| --- | --- | --- |
|  remote CDP adapters | `20_phase19_remote_cdp_adapters.md` | Deferred (`docs/EXTERNAL_CDP.md`); no production runtime. |19 

## Forbidden

- Editing files under `_fin/mvp/` after MVP  they are evidence ofmerge 
  shipped state. New work must go in a new devlog under `_plan/` or a new
  topic folder.
- Adding `ready` claims that are not also reflected in
  `structure/CAPABILITY_TRUTH_TABLE.md` and the cli-jaw mirror in the same
  commit.
