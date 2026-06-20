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
| `_fin/` | Completed non-MVP closeouts, research outcomes, and shipped implementation plans. |
| `_fin/mvp/` | Shipped MVP phases, grouped by topic (read-only history). |
| `_plan/` | Active or deferred plans not yet shipped. |
| `_legacy/` | Pre-rewrite changelogs / plans / research dumps. |
| `context/` | Verbatim Pro / Grok peer reviews and gap audits. |

## `_plan/` active or deferred work

| Topic | Folder | Status |
| --- | --- | --- |
| Post-MVP competitive gap closeout | `_plan/260506_post_mvp_gap_closeout/` | Deferred backlog; not fully shipped. |
| Oracle ZIP browser bundle proposal | `_plan/260513_oracle_zip_bundle_proposal/` | External upstream proposal draft; no local agbrowse implementation authority. |
| Adaptive Fetch v2 hardening | `_plan/260515_adaptive_fetch_v2_hardening/` | Follow-up planning after v2; not closed. |
| Provider expansion | `_plan/260519_provider_expansion/` | Deferred provider roadmap for Claude, Perplexity, NotebookLM. |
| Codebase audit backlog | `_plan/260603_codebase_audit/` | Historical audit + issue tracker; keep grouped until separately closed. |
| K-BrowseComp search gap analysis | `_plan/260608_kbrowsecomp_search_gap/` | Research/spec complete; implementation deferred. |
| Oracle stability gap analysis | `_plan/260608_oracle_stability_gap/` | Partial follow-up backlog; includes 2026-06-20 Oracle 0.15 delta and 31/32 PABCD follow-up plans. |
| Legacy MVP phase plans | `_plan/legacy_mvp_phase_plans/` | Pre-closeout phase 8.1/9 planning references; grouped for audit hygiene. |
| Strict migration | `_plan/strict-migration/` | Deferred migration planning and arbitration notes. |

Other grouped planning folders under `_plan/` remain until they receive a
separate closeout audit.

## Recent `_fin/` closeouts

| Topic | Folder | Closeout signal |
| --- | --- | --- |
| UX blocker fixes | `_fin/260507_ux-blockers-p0p1/` | README maps fixes to implemented commits `ccb7051`, `1a4743b`, and `f7b0e97`. |
| Oracle parity feature batch | `_fin/260508_oracle_parity/` | Implemented by `fe359a9` and follow-up commits. |
| web-ai session rebinding hardening | `_fin/260510_webai_session_rebind_diff_plan.md` | Implemented by `276aeac`. |
| Oracle follow-up guardrails | `_fin/260513_oracle_followup_guardrails_diff_plan.md` | Implemented by `085cc83`. |
| Adaptive Fetch v1 / Insane Search mirror | `_fin/260514_insane_search_adaptive_fetch/` | README status `implemented-v1`; shipped by `39708a3` and follow-ups. |
| Adaptive Fetch v2 | `_fin/260515_adaptive_fetch_v2/` | Index status `implemented`; hardening follow-up remains in `_plan/`. |
| Shared web-ai target lock | `_fin/260525_shared_web_ai_target_lock/` | Implemented by `602a700` and `e28f66e`. |
| Runway MCP parity expansion | `_fin/260528_runway_mcp_parity_expansion/` | Implemented by `7458f64` and Runway continuity follow-ups. |
| Defuddle reader candidate | `_fin/260610_defuddle_reader/` | Implementation result recorded; shipped by `631615d`. |
| Background runtime hook research | `_fin/260611_background_runtime_hook/` | Research complete; cli-jaw implementation planning relocated. |
| web-ai GPT Code Mode | `_fin/260611_webai_gpt_code_mode/` | ChatGPT-only beta implemented: single zip, multi-zip, JS-only retrieval. |
| Code Mode GPT dev-agent context | `_fin/260611_code_mode_gpt_agent_context/` | Implemented by `7ef4955`, `81af74f`, and `864ae41`. |
| web-ai multi/mixed attachments | `_fin/260611_webai_multi_attach/` | Implemented and live verified by `ef01881`. |
| web-ai skill + cli-jaw mirror | `_fin/260611_webai_skill_cli_jaw_mirror/` | Agent-facing docs and simplified picker mirror closed. |
| Docs Pages and code-mode overhaul | `_fin/260611_docs_pages_overhaul/` | Final goal audit proves local gates, push, and live Pages deployment. |
| ChatGPT composer tool selection probe | `_fin/260615_chatgpt_composer_tools_live_probe.md` | PR #78 evidence and follow-up patches applied. |
| Computer-use contract hardening / vision upgrade | `_fin/260617_computer_use_contract_hardening/` | `dev-vision-upgrade` verification report records implementation and live smoke evidence. |
| Web-AI stability and concurrency closeout | `_fin/260619_webai_stability/`, `_fin/260619_tab_parallel_stability/` | Timeout/watch/skill-envelope closed earlier; tab MVV closed by active lease cap + PID reaper + record-before-bind. |
| MCP wait response recovery | `_fin/260621_mcp_wait_response_recovery/` | GitHub #79 PABCD: session-bound MCP wait/resume recovery and monotonic timeout handling. |
| Tab stability MVV closeout | `_fin/260621_tab_stability_mvv_closeout/` | Final branch closeout plan for tab MVV, verification, push, and PR body `Closes #79`. |

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
