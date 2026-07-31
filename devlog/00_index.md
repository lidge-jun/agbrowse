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
| `_fin/_legacy/` | Pre-rewrite changelogs / plans / research dumps, closed as historical records. |
| `context/` | Verbatim Pro / Grok peer reviews and gap audits. |

## `_plan/` active or deferred work

| Topic | Folder | Status |
| --- | --- | --- |
| cli-jaw web-ai parity mirror | `_plan/260621_cli_jaw_webai_parity/` | 📄 문서 전용 미러. closeout 권한이 cli-jaw 쪽에 있어 여기서 닫지 않는다. |
| Parity impl (Cycle 1–12) | `_plan/260625_webai_parity_impl/` | 🔧 Cycle 1–12 실행 완료, Cycle 12 verdict = CONCERNS. 후속은 `260627_gptpro_remediation`. |
| GPT-Pro remediation (R1–R9) | `_plan/260627_gptpro_remediation/` | 🔧 5 PABCD 사이클 실행 완료. R2 verdict의 CONCERNS 5 / FAIL 2 미해소. |
| Post-MVP gap close | `_plan/260705_gapclose/` | 🔧 기능 트랙(Phase 10/20/30/40) 구현 완료. 런칭 트랙 Phase 100/110/120이 잔존(`10_roadmap.md:97-140`). |
| web-ai 폴링 데드라인 계약 (#88) | `_plan/260731_webai_poll_deadline/` | 🔧 WP10 fail-open 교정 완료 — B03/B06이 fail-closed(`6742949`, `45aa702`, `21e229c`). 예산 계약 WP1~WP9는 미착수, 후보 A가 reversal gate G1~G4에 걸려 조건부. |
| web-ai 아티팩트·finalizer 하드닝 (#88 자매) | `_plan/260731_webai_artifact_finalizer/` | 🔧 WP11 fail-open 교정 완료 — B24/B36이 fail-closed(`2cfb668`~`25f6985`). B25는 fail-visible까지, B23은 관측만. 예산 계약 WP1~WP7은 미착수. |
| Strict migration | `_plan/strict-migration/` | ⏸ Deferred. 실행 소스는 여전히 `.mjs`, TS는 declaration만. |

`_plan/`에 있는 폴더는 위가 전부다. 유닛을 닫으면 같은 커밋에서 `_fin/`으로
옮기고 이 표에서 지운다. 일부 오래된 유닛은 2자리 접두사(`00_`, `10_`)를 쓰는
레거시 번호 체계이며, 새 유닛은 3자리(`000_`, `010_`)를 쓴다.

## Recent `_fin/` closeouts

| Topic | Folder | Closeout signal |
| --- | --- | --- |
| devlog 정리 | `_fin/260731_devlog_reorg/` | `900_closeout.md` — `_plan` 11→6, 조건부 4개 증거 확인 후 이관. 릴리스 stop condition 실행, 이관으로 깨진 참조 정정. |
| PR #89 / 이슈 #87·#88 triage | `_fin/260731_pr89_issue_triage/` | #87 probe/MCP 갭 수정(`76e4793`)과 #88 정체 경계 표본·예산 계약 확정. #88 방어 구현과 devlog 정리는 후속 유닛으로 분할 — `003_audit_synthesis.md` 참조. |
| QA round 6 | `_fin/260726_qa_round6/` | 13개 work-phase closeout — `090_closeout.md`. |
| Oracle chase 4 | `_fin/260726_oracle_chase4/` | 상류 델타 재검증 종료. |
| agbrowse QA | `_fin/260726_agbrowse_qa/` | CLI QA 라운드 종료. |
| Oracle chase 3 | `_fin/260725_oracle_chase3/` | 종료. |
| Oracle chase 2 | `_fin/260724_oracle_chase2/` | 종료. |
| PR #86 repomix dev rebuild | `_fin/260723_pr86_repomix_dev_rebuild/` | dev 재구축 후 closeout. |
| Oracle chase | `_fin/260712_oracle_chase/` | 종료. |
| Upload reliability | `_fin/260711_upload_reliability/` | `900_closeout.md` — 전체 스위트 179파일 1946건 0 failure로 기준 1 재검증. |
| Release 0.1.17 | `_fin/260711_release_017/` | `900_closeout.md` — workflow success, GitHub/npm 게시, fresh registry install + 두 bin smoke 재현 완료. |
| GPT-5.6 UI update | `_fin/260710_gpt56_update/` | `00_index.md:3-12` 전량 실행, root closeout `devlog/21_gpt56_ui_update.md:110-116`. |
| Competitive research | `_fin/260628_competitive_research/` | `900_closeout.md` — research superseded by `260705_gapclose`, 미해결 질문 5개 disposition 기록. |
| Search skill | `_fin/260627_search_skill/` | `900_closeout.md` — 5개 계획 사이클의 산출물이 모두 배포됨을 사후 대조. |
| Streaming recovery false-complete | `_fin/260625_webai_streaming_recovery_false_complete/` | `30_completion_audit.md:31-52` 전 요구사항 Met + 독립 검증 DONE. |
| Oracle stability gap analysis | `_fin/260608_oracle_stability_gap/` | 31–35 backlog implemented (v0.1.16-preview); 05/07/08·profile-copy·ZIP deferred by decision. |
| Timeout adaptive scaling | `_fin/260619_timeout_adaptive_scaling/` | 종료. |
| Watch notification gaps | `_fin/260619_watch_notification_gaps/` | 종료. |
| Post-MVP competitive gap closeout | `_fin/260506_post_mvp_gap_closeout/` | Historical competitive-gap plan set closed; any unshipped capabilities must be re-opened as fresh focused plans. |
| UX blocker fixes | `_fin/260507_ux-blockers-p0p1/` | README maps fixes to implemented commits `ccb7051`, `1a4743b`, and `f7b0e97`. |
| Oracle parity feature batch | `_fin/260508_oracle_parity/` | Implemented by `fe359a9` and follow-up commits. |
| web-ai session rebinding hardening | `_fin/260510_webai_session_rebind_diff_plan.md` | Implemented by `276aeac`. |
| Oracle ZIP browser bundle proposal | `_fin/260513_oracle_zip_bundle_proposal/` | External upstream proposal draft closed as reference material; no local agbrowse implementation authority. |
| Oracle follow-up guardrails | `_fin/260513_oracle_followup_guardrails_diff_plan.md` | Implemented by `085cc83`. |
| Adaptive Fetch v1 / Insane Search mirror | `_fin/260514_insane_search_adaptive_fetch/` | README status `implemented-v1`; shipped by `39708a3` and follow-ups. |
| Adaptive Fetch v2 | `_fin/260515_adaptive_fetch_v2/` | Index status `implemented`; hardening follow-up closed in `_fin/260515_adaptive_fetch_v2_hardening/`. |
| Adaptive Fetch v2 hardening | `_fin/260515_adaptive_fetch_v2_hardening/` | Follow-up hardening research/patch matrix closed as planning evidence. |
| Competitor skill trigger research | `_fin/260519_competitor_skill_trigger_research/` | Competitive, media, MCP, Runway, and skill-trigger research corpus closed; future work should fork focused implementation plans. |
| Provider expansion | `_fin/260519_provider_expansion/` | Claude, Perplexity, and Gemini alias expansion plans closed as roadmap/reference material. |
| Shared web-ai target lock | `_fin/260525_shared_web_ai_target_lock/` | Implemented by `602a700` and `e28f66e`. |
| Runway MCP parity expansion | `_fin/260528_runway_mcp_parity_expansion/` | Implemented by `7458f64` and Runway continuity follow-ups. |
| Codebase audit backlog | `_fin/260603_codebase_audit/` | Historical audit and issue tracker closed; current priorities now live in focused plan folders. |
| K-BrowseComp search gap analysis | `_fin/260608_kbrowsecomp_search_gap/` | Research/spec and staged search-skill implementation plans closed as reference material. |
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
| npm Trusted release automation | `_fin/260621_npm_trusted_release_automation/` | GitHub Actions OIDC Trusted Publishing shipped; `agbrowse@0.1.15` published and tagged by release run `27892124575`. |
| Poll stderr heartbeat | `_fin/260621_poll_stderr_heartbeat/` | Implemented by `8c7b0a3`: `web-ai/chatgpt.mjs` emits stderr `[poll]` progress lines during long streaming/stabilizing polls. |
| Agent-safe update notice | `_fin/260622_update_notice/` | Stderr-only npm latest-version advisory shipped with JSON/MCP/CI/help skip policy and cached `BROWSER_AGENT_HOME/update-check.json`. |
| Historical legacy docs | `_fin/_legacy/` | Pre-rewrite changelog/plan/research dumps relocated out of active root layout. |
| Legacy MVP phase plans | `_fin/legacy_mvp_phase_plans/` | Pre-closeout phase 8.1/9 planning references relocated as historical closeout material. |

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

## Post-MVP root devlogs

| # | File | Status |
| --- | --- | --- |
| 21 | `21_gpt56_ui_update.md` | ✅ Done — GPT-5.6 UI 전면 개편 대응. 계약 재설계·Work send v1·timeout 3분리·141/1261 green. Plan: `_fin/260710_gpt56_update/`. |

## Forbidden

- Editing files under `_fin/mvp/` after MVP  they are evidence ofmerge 
  shipped state. New work must go in a new devlog under `_plan/` or a new
  topic folder.
- Adding `ready` claims that are not also reflected in
  `structure/CAPABILITY_TRUTH_TABLE.md` and the cli-jaw mirror in the same
  commit.
