# 001 — devlog 디렉터리 실태 인벤토리 (2026-07-31)

`devlog/_plan`의 기존 11개 폴더(이 유닛 `260731_pr89_issue_triage`를 더하면 12개)와
`devlog/00_index.md` 상태표를 대조한 결과다. 조사는
읽기 전용으로 수행했고, 모든 판정에 파일 경로와 인용 라인을 붙였다. 이 문서는
리서치 문서라 diff를 포함하지 않는다(LEXICO-SPLIT-01).

## A. `_plan` 유닛별 실태

| 폴더 | 문서 수 | 마지막 커밋 | 판정 | 근거 |
| --- | ---: | --- | --- | --- |
| `260621_cli_jaw_webai_parity` | 12 | 2026-06-25 | 조사 완료, 기능 미구현(외부 미러) | `devlog/_plan/260621_cli_jaw_webai_parity/00_plan.md:13` 문서 전용 명시, 같은 파일 `:48-57` 최종 verdict |
| `260625_webai_parity_impl` | 14 | 2026-06-27 | 부분 완료 — Cycle 12 verdict CONCERNS | `devlog/_plan/260625_webai_parity_impl/00_plan.md:128-141` |
| `260625_webai_streaming_recovery_false_complete` | 5 | 2026-06-25 | 완료 | `devlog/_plan/260625_webai_streaming_recovery_false_complete/30_completion_audit.md:31-39`, `:43-52` |
| `260627_gptpro_remediation` | 12 | 2026-06-27 | 미완료 — R2 CONCERNS 5 / FAIL 2 잔존 | `devlog/_plan/260627_gptpro_remediation/60_gptpro_r2_verdict.md:5-21` |
| `260627_search_skill` | 1 | 2026-06-27 | 완료(추정) — closeout 문서 없음 | `skills/browser/search.mjs:4-29`, `skills/search/SKILL.md:88-106` (배포 근거) |
| `260628_competitive_research` | 2 | 2026-06-28 | 리서치 완료, 구현 미착수 | `devlog/_plan/260628_competitive_research/01_agent_browser_analysis.md:106-158` |
| `260705_gapclose` | 16 | 2026-07-11 | 부분 완료 — 04·05·06·09 PLANNED 잔존 | `devlog/_plan/260705_gapclose/` 아래 `04_gap_schema_extract.md:1-3`, `05_gap_positioning_docs.md:1-3`, `06_gap_webai_showcase.md:1-3`, `09_launch_awareness.md:1-3` |
| `260710_gpt56_update` | 11 + assets | 2026-07-10 | 완료 | `devlog/_plan/260710_gpt56_update/00_index.md:3-12`, `devlog/21_gpt56_ui_update.md:110-116` |
| `260711_release_017` | 4 + 1 txt | 2026-07-11 | 검증 완료, publish 별도 | `devlog/_plan/260711_release_017/010_release_evidence.md:19-32` |
| `260711_upload_reliability` | 4 | 2026-07-11 | 기능 완료, **성공 기준 1 미충족** | focused suite 통과 `030_verification.md:8-35`, 그러나 전체 스위트 2파일 실패 `:37-46`이고 성공 기준은 0 failure를 요구한다 `010_plan.md:59-60` |
| `strict-migration` | 43 | 2026-05-06 | Deferred | `devlog/00_index.md:30`, `devlog/_plan/strict-migration/01-strategy.md:49-72` |

판정 방법: (a) 유닛 문서 내부의 상태/closeout 표기, (b)
`git log --oneline -20 -- devlog/_plan/<folder>`의 최신 활동, (c) 해당 기능이
실제 소스에 반영되었는지 `rg` 확인. `260627_search_skill`과
`260628_competitive_research`는 명시적 closeout이 없어 "추정"으로 남긴다.

## B. `00_index.md` 드리프트

1. `_plan/ active or deferred work` 표(`devlog/00_index.md:22-30`)의 Oracle
   stability 행이 `_fin/260608_oracle_stability_gap/` 경로를 가리킨다. `_plan`
   표에 `_fin` 항목이 들어 있어 표 제목과 내용이 어긋난다.
2. 실제 `_plan` 11개 중 표에 개별 기재된 것은 4개다. 나머지 7개는
   "Other grouped planning folders"(`devlog/00_index.md:32-33`) 한 줄로 뭉뚱그려져
   있다.
3. `260625_webai_parity_impl` 행(`devlog/00_index.md:28`)은 "11/12 cycles DONE"이라
   적었지만 계획 문서는 Cycle 12를 `DONE (verdict: CONCERNS)`로 기록한다
   (`_plan/260625_webai_parity_impl/00_plan.md:141`).
4. `260627_gptpro_remediation` 행(`devlog/00_index.md:29`)은 Active지만 내부
   tracker는 5개 cycle 모두 DONE이고 잔여는 R2 verdict 쪽에 있다
   (`_plan/260627_gptpro_remediation/00_plan.md:157-161`, `60_gptpro_r2_verdict.md:5-21`).
5. Recent `_fin/` 표의 "Folder" 열 3개 항목이 디렉터리가 아니라 파일이다:
   `devlog/00_index.md:42`, `:44`, `:61`.
6. `_fin`에 실제로 있으나 Recent 표에 행이 없는 유닛이 다수다(아래 C절 포함).

## C. `_fin`에 있으나 index에 없는 최근 유닛

1. `devlog/_fin/260712_oracle_chase/`
2. `devlog/_fin/260723_pr86_repomix_dev_rebuild/`
3. `devlog/_fin/260724_oracle_chase2/`
4. `devlog/_fin/260725_oracle_chase3/`
5. `devlog/_fin/260726_agbrowse_qa/`
6. `devlog/_fin/260726_oracle_chase4/`
7. `devlog/_fin/260726_qa_round6/`

추가로 `260508_chrome_singleton_fix.md`, `260515_adaptive_fetch_v1.md`,
`260619_timeout_adaptive_scaling/`, `260619_watch_notification_gaps/`,
`260620_skill_envelope_already_capable.md`도 표에 행이 없다.

## D. 파일명 규약

번호 접두사가 없는 bare 문서는 `_plan/strict-migration/` 아래 7개다
(`_gpt-pro-arbitration-*.md` 5개, `_subagent-*.md` 2개). 2자리/3자리 혼용은
`260621_cli_jaw_webai_parity`, `260625_webai_parity_impl`,
`260627_gptpro_remediation`, `strict-migration`에 있다.

판단: 이들은 모두 과거에 종료되었거나 deferred된 유닛의 내부 파일이다. 규약은
새 유닛에 강제되고 기존 종료 유닛의 이름을 소급 변경하면 이 문서들을 참조하는
커밋 메시지와 다른 devlog 링크가 깨진다. 따라서 이번 유닛에서는 개명하지 않고
`030`에서 index 표에만 "레거시 번호 체계" 주석을 남긴다.

비문서 아티팩트로 `devlog/_plan/.DS_Store`가 있다. 이건 삭제 대상이다.

## E. 보류

- `git log` 날짜는 경로의 마지막 커밋 활동이지 기능 배포 시각이 아니다.
- `rg` 확인은 정적 반영 증거이며 런타임 성공을 증명하지 않는다.
- `_fin` 유닛이 index에 없는 것은 closeout 실패가 아니라 index 갱신 누락이다.
