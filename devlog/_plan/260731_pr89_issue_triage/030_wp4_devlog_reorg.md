# 030 — WP4: devlog `_plan`/`_fin` 정리와 `00_index.md` 동기화

선행: WP1(인벤토리). 코드 work-phase와 독립.

## 이관 결정

`001_devlog_inventory.md`의 판정을 근거로 각 `_plan` 유닛의 처분을 정한다.

| 유닛 | 처분 | 근거 |
| --- | --- | --- |
| `260625_webai_streaming_recovery_false_complete` | `_fin`으로 이관 | `30_completion_audit.md:31-52` 전 요구사항 Met + 독립 검증 DONE |
| `260710_gpt56_update` | `_fin`으로 이관 | `00_index.md:3-12` 전량 실행, root closeout `devlog/21_gpt56_ui_update.md:110-116` |
| `260711_release_017` | `_fin`으로 이관 | `010_release_evidence.md:19-32` 16/16 게이트 통과. 같은 문서가 post-publish 증거를 요구하므로(`:72-74`) 이관 시 실제 게시된 `v0.1.17` 릴리스를 확인해 근거로 적는다. |
| `260711_upload_reliability` | **조건부** — 아래 참조 | 성공 기준 1이 "focused + 전체 `npm test` 0 failures"인데(`010_plan.md:59-60`) 기록은 전체 스위트 2파일 실패다(`030_verification.md:37-46`) |
| `260627_search_skill` | `_fin`으로 이관 + 종료 감사 추가 | 기능은 `skills/browser/search.mjs:4-29`, `skills/search/SKILL.md:88-106`으로 배포됨. 단 문서는 5개 미래 cycle 형태로 남아 있어(`00_plan.md:32-75`) closeout이 없다 — 이관과 함께 `900_closeout.md`를 새로 쓴다. |
| `260628_competitive_research` | `_fin`으로 이관 | 리서치 산출물이고, 후속이 `260705_gapclose`임이 그 유닛에 명시되어 있다(`_plan/260705_gapclose/00_index.md:5-7`). 미해결 질문 5개(`02_schema_bound_extraction.md:212-218`)는 gapclose가 승계했다. |
| `260621_cli_jaw_webai_parity` | `_plan` 유지 | 외부 cli-jaw 미러 — closeout 권한이 이 저장소에 없음 |
| `260625_webai_parity_impl` | `_plan` 유지 | Cycle 12 verdict CONCERNS, 후속이 `260627_gptpro_remediation` |
| `260627_gptpro_remediation` | `_plan` 유지 | R2 CONCERNS 5 / FAIL 2 미해소 |
| `260705_gapclose` | `_plan` 유지 | 04·05·06·09가 PLANNED로 남아 있다(각 파일 `:1-3`) |
| `strict-migration` | `_plan` 유지 | Deferred — 실행 소스는 여전히 `.mjs` |

## 조건부 이관 (증거 없으면 옮기지 않는다)

아래 넷은 이관 전에 충족해야 할 조건이 있다. 조건이 안 채워지면 `_plan`에 남기고
그 사실을 `00_index.md`에 적는다. 결론을 먼저 쓰고 근거를 나중에 맞추지 않는다.

| 유닛 | 조건 |
| --- | --- |
| `260711_upload_reliability` | 전체 `npm test`를 다시 돌려 0 failure를 얻거나(Playwright Chromium 설치 후), 환경 실패를 허용하도록 성공 기준을 수정한 판정을 유닛 안에 남긴다. 둘 다 못 하면 `_plan` 유지 |
| `260627_search_skill` | `900_closeout.md`에 5개 계획 cycle 대 실제 배포 대조표를 채운다. 미이행 cycle이 있으면 그 사실을 적고, 남은 게 실질적이면 `_plan` 유지 |
| `260628_competitive_research` | 미해결 질문 5개(`02_schema_bound_extraction.md:212-218`)의 disposition 표를 closeout에 넣는다. gapclose의 일반적 승계 선언만으로는 부족하다 — 근거는 배포된 소스에 있다(아래 표) |
| `260711_release_017` | post-publish 증거 요구(`010_release_evidence.md:72-74`)를 실제 게시된 릴리스로 충족한 기록을 남긴다 |

무조건 이관 대상은 둘이다: `260625_webai_streaming_recovery_false_complete`
(`30_completion_audit.md:31-52` 전 요구사항 Met + 독립 검증 DONE),
`260710_gpt56_update`(`00_index.md:3-12` + root closeout
`devlog/21_gpt56_ui_update.md:110-116`).

### competitive_research 미해결 질문 disposition (선조사)

`900_closeout.md`에 넣을 표다. 각 근거를 구현 시 재확인하고 채운다.

| 질문 | 판정 | 근거 |
| --- | --- | --- |
| Ajv vs Zod | 해결 — 자체 validator 채택, Zod는 비목표 | `skills/browser/extract.mjs:38`이 `web-ai/extract-schema.mjs`의 자체 validator를 쓴다. `260705_gapclose/20_phase10_extract_impl.md:30`이 "Zod/TS 타입 추론"을 non-goal로 명시 |
| LLM DOM 전달 토큰 예산 | 해결 — HTML 12,000자로 제한 | `skills/browser/extract.mjs:496` `html.replace(...).slice(0, 12_000)` |
| 캐시 전략 | 비목표 | `260705_gapclose/20_phase10_extract_impl.md:30`이 server cache를 non-goal로 명시 |
| web-ai 세션 기본값 | 해결 — Grok | `skills/browser/extract.mjs:60` `vendor: { type: 'string', default: 'grok' }` |
| 다국어 instruction 범위 | **deferred/비목표** — 해결 아님 | 현재 CLI에 instruction 옵션 자체가 없다(`skills/browser/extract.mjs:53-64`). "지원 범위 결정"이 아니라 "기능 미도입" 상태다 |

마지막 행을 "해결"로 적지 않는다 — 질문이 사라진 게 아니라 전제가 아직 없다.

## 실행 순서

무조건 이동과 조건부 이동을 명령 수준에서 분리한다. 조건 판정이 실패했는데
명령을 그대로 실행하면 미완료 유닛이 `_fin`으로 들어간다.

**1단계 — 무조건 이동 (2개).**

```
git mv devlog/_plan/260625_webai_streaming_recovery_false_complete devlog/_fin/
git mv devlog/_plan/260710_gpt56_update devlog/_fin/
```

**2단계 — 조건부 유닛의 closeout 작성.** closeout은 유닛이 아직 `_plan`에 있을
때 `devlog/_plan/<unit>/900_closeout.md`로 쓴다. `_fin` 경로에 먼저 만들면 뒤의
디렉터리 `git mv`와 충돌한다.

```
devlog/_plan/260627_search_skill/900_closeout.md
devlog/_plan/260628_competitive_research/900_closeout.md
devlog/_plan/260711_release_017/900_closeout.md
devlog/_plan/260711_upload_reliability/900_closeout.md
```

새 closeout 파일 추가는 이 문서 OUT 범위의 "기존 문서 **수정**"에 해당하지
않는다. 기존 파일은 건드리지 않는다.

**3단계 — 조건을 통과한 유닛만 이동.** 각 closeout의 판정이 "종료"인 것만
옮긴다. 통과하지 못한 유닛은 `_plan`에 남고, `00_index.md`의 `_plan` 표에 그
상태와 이유를 적는다.

```
# 판정이 종료인 것만 실행
git mv devlog/_plan/<통과한 유닛> devlog/_fin/
```

`_fin/mvp/` 아래는 건드리지 않는다.

`devlog/_plan/.DS_Store`는 삭제하고, `.gitignore`에 이미 있는지 확인한다.

## NEW `devlog/_fin/260627_search_skill/900_closeout.md`

이 유닛만 closeout 문서가 없다. 이관 전에 쓴다. 아래는 골격이고, 각 항목의
근거는 구현 시 실제 소스/테스트를 확인해 채운다 — 추측한 증거를 적지 않는다.

```markdown
# 900 — search skill 유닛 종료 감사 (2026-07-31)

`00_plan.md`는 5개 PABCD 사이클을 계획했지만 사이클별 실행 기록을 남기지 않았다.
이 문서는 계획 대비 실제 배포 상태를 사후 확인한 결과다.

## 계획 대비 실제

| 계획 사이클 | 계획 산출물 | 현재 상태 | 근거 |
| --- | --- | --- | --- |
| Cycle 1 core search 명령 | `skills/browser/search.mjs` | 배포됨 | (실제 경로:라인) |
| Cycle 2~5 | (00_plan.md에서 확인) | (확인 결과) | (근거) |

## 테스트 증거

(`rg -l "search" test/`로 찾은 실제 스위트와 그 실행 결과)

## 미이행 항목

(계획에 있었으나 배포되지 않은 것. 없으면 "없음"이라고 적는다)

## 판정

(위 대조표를 채운 뒤에 쓴다. 미이행 항목이 없으면 `_fin`으로 옮기고, 실질적인
미이행이 남으면 `_plan`에 유지하며 그 이유를 적는다. 조사 전에 결론을 쓰지 않는다.)
```

`030`의 OUT 범위는 "기존 유닛 내부 문서의 **수정**"이다. 이 문서는 새로 추가하는
closeout이므로 그 범위와 충돌하지 않는다.

## `00_index.md` 개편

현재 `_plan` 표(`devlog/00_index.md:22-33`)는 실제 디렉터리와 어긋난다. 표를
"실제 `_plan` 폴더 전부"로 바꾸고, `_fin` 항목은 표에서 제거한다.

MODIFY `devlog/00_index.md` — `## _plan/ active or deferred work` 절 전체 교체:

```diff
 | Topic | Folder | Status |
 | --- | --- | --- |
-| Oracle stability gap analysis | `_fin/260608_oracle_stability_gap/` | ✅ Done — ... |
-| cli-jaw web-ai parity mirror | `_plan/260621_cli_jaw_webai_parity/` | ... |
-| Parity impl (Cycle 1–12) | `_plan/260625_webai_parity_impl/` | ... |
-| GPT-Pro remediation (R1–R9) | `_plan/260627_gptpro_remediation/` | ... |
-| Strict migration | `_plan/strict-migration/` | ... |
-
-Other grouped planning folders under `_plan/` remain until they receive a
-separate closeout audit.
+| cli-jaw web-ai parity mirror | `_plan/260621_cli_jaw_webai_parity/` | 📄 문서 전용 미러. closeout 권한은 cli-jaw 쪽에 있다. |
+| Parity impl (Cycle 1–12) | `_plan/260625_webai_parity_impl/` | 🔧 Cycle 1–12 실행 완료, Cycle 12 verdict = CONCERNS. 후속은 `260627_gptpro_remediation`. |
+| GPT-Pro remediation (R1–R9) | `_plan/260627_gptpro_remediation/` | 🔧 5 사이클 실행 완료. R2 verdict의 CONCERNS 5 / FAIL 2 미해소. |
+| Post-MVP gap close | `_plan/260705_gapclose/` | 🔧 Phase 10/20/30/40 구현 완료. 04·05·06·09는 PLANNED 잔존. |
+| PR #89 / 이슈 #87·#88 처리 | `_plan/260731_pr89_issue_triage/` | 🔧 진행 중 — 이 유닛. |
+| Strict migration | `_plan/strict-migration/` | ⏸ Deferred. 실행 소스는 여전히 `.mjs`, TS는 declaration만. |
+
+`_plan/`에 있는 폴더는 위가 전부다. 유닛을 닫으면 같은 커밋에서 `_fin/`으로 옮기고
+이 표에서 지운다. 일부 오래된 유닛은 2자리 접두사(`00_`, `10_`)를 쓰는 레거시
+번호 체계이며, 새 유닛은 3자리(`000_`, `010_`)를 쓴다.
```

`Recent _fin/ closeouts` 표에는 **실제로 이동한 유닛만** 추가한다. 아래 표는
최대치이고, 조건 미통과 유닛의 행은 쓰지 않는다. 인벤토리 C절의 누락 7개는
무조건 추가한다. 행은 최신이 위로 오도록 날짜 역순으로 정렬한다.

추가할 행(요지):

| Topic | Folder | Closeout signal |
| --- | --- | --- |
| PR #89 / 이슈 #87·#88 triage | `_plan/260731_pr89_issue_triage/` | (WP5에서 `_fin` 이관 시 기재) |
| QA round 6 | `_fin/260726_qa_round6/` | 13개 work-phase closeout, `090_closeout.md` |
| Oracle chase 4 | `_fin/260726_oracle_chase4/` | 상류 델타 재검증 종료 |
| agbrowse QA | `_fin/260726_agbrowse_qa/` | CLI QA 라운드 종료 |
| Oracle chase 3 | `_fin/260725_oracle_chase3/` | 종료 |
| Oracle chase 2 | `_fin/260724_oracle_chase2/` | 종료 |
| PR #86 repomix dev rebuild | `_fin/260723_pr86_repomix_dev_rebuild/` | dev 재구축 후 closeout |
| Oracle chase | `_fin/260712_oracle_chase/` | 종료 |
| Upload reliability | `_fin/260711_upload_reliability/` | `030_verification.md` 검증 완료 |
| Release 0.1.7 | `_fin/260711_release_017/` | 16/16 게이트 통과 |
| GPT-5.6 UI update | `_fin/260710_gpt56_update/` | root closeout `devlog/21_gpt56_ui_update.md` |
| Streaming recovery false-complete | `_fin/260625_webai_streaming_recovery_false_complete/` | `30_completion_audit.md` 전 요구사항 Met |
| Search skill | `_fin/260627_search_skill/` | `skills/search/SKILL.md`로 배포 |
| Competitive research | `_fin/260628_competitive_research/` | 리서치 종료 |

각 행의 실제 문구는 구현 시 해당 유닛의 closeout 문서를 읽고 확정한다. 추측한
closeout 신호를 쓰지 않는다. closeout 문서가 없는 `260627_search_skill`은 위
결정표대로 `900_closeout.md`를 먼저 쓴 뒤 그 경로를 근거로 적는다.

"Folder" 열이 파일을 가리키는 3개 행(`devlog/00_index.md:42`, `:44`, `:61`)은 열
이름을 `Path`로 바꿔 파일/폴더를 모두 담을 수 있게 한다.

## 검증

```
ls devlog/_plan
ls devlog/_fin
rg -n '_plan/' devlog/00_index.md
```

표의 모든 `_plan/` 경로가 실제로 존재하고, `ls devlog/_plan` 결과의 모든 폴더가
표에 있어야 한다. 양방향 확인이다.

`bash structure/check-doc-drift.sh`도 돌린다 — devlog 경로를 참조하는 문서가 있으면
이관으로 깨질 수 있다.

## 범위 경계

- IN: `devlog/00_index.md`, `devlog/_plan` → `devlog/_fin` 이동, `.DS_Store` 삭제.
- OUT: 기존 유닛 내부 문서의 내용 수정, 레거시 파일명 소급 개명
  (`001_devlog_inventory.md` D절의 판단), `_fin/mvp/` 수정.
