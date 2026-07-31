# 260731 — devlog `_plan`/`_fin` 정리와 `00_index.md` 동기화

- unit: `devlog/_plan/260731_devlog_reorg/`
- branch: `dev`
- class: C2 (문서 이관과 인덱스 동기화, 코드 변경 없음)
- 선행 유닛: `devlog/_fin/260731_pr89_issue_triage/`

## 왜 별도 유닛인가

PR #89 triage 유닛에서 분리했다. devlog 정리는 그 작업과 아키텍처 의존이 없는
유지보수 changeset이고, 같이 묶으면 코드 변경과 문서 이관이 한 커밋 흐름에 섞여
어느 한쪽이 막히면 다른 쪽도 닫히지 않는다. 분리 근거는
`devlog/_fin/260731_pr89_issue_triage/003_audit_synthesis.md`.

## 입력

- `devlog/_fin/260731_pr89_issue_triage/001_devlog_inventory.md` — `_plan` 11개
  유닛의 완료 판정과 `00_index.md` 드리프트 인벤토리
- `010_reorg_plan.md`(이 유닛) — 이관 결정표, 4단계 실행 순서, 조건부 조건,
  closeout 형식

## 목표

`devlog/_plan`에 쌓인 종료 유닛을 `_fin`으로 옮기고, `00_index.md`가 실제
디렉터리 상태를 반영하게 만든다.

## 범위

IN: `devlog/_plan` → `devlog/_fin` 이동, 조건부 유닛의 `900_closeout.md` 신규
작성, `devlog/00_index.md` 표 갱신, `devlog/_plan/.DS_Store` 삭제,
`structure/str_func.md` 카운트 갱신.

OUT: 기존 유닛 내부 문서 **수정**, `_fin/mvp/` 아래 파일, 레거시 파일명 소급
개명, 코드 변경 일체.

## work-phase

| WP | 내용 | 선행 |
| --- | --- | --- |
| WP1 | 조건부 4개 유닛의 증거 확인과 `900_closeout.md` 작성 | — |
| WP2 | 이관 실행(무조건 2 + 조건 통과분) + `00_index.md` 갱신 + 게이트 | WP1 |

`010_reorg_plan.md`가 이미 diff-level 계획을 담고 있어 별도 로드맵 사이클을
두지 않는다. 그 문서가 이 유닛의 실행 명세다.

## 수용 기준

1. 무조건 이관 2개(`260625_webai_streaming_recovery_false_complete`,
   `260710_gpt56_update`)가 `_fin`에 있다.
2. 조건부 4개는 각각 조건 충족을 증거로 확인한 뒤에만 이동한다. 미충족은
   `_plan`에 남고 그 사유가 `00_index.md`에 적힌다.
3. `00_index.md`의 `_plan` 표가 실제 폴더와 양방향 1:1이고, 표에 기재된 모든
   `_fin` 경로가 존재한다.
4. `structure/check-doc-drift.sh`와 `structure/verify-counts.sh`가 통과한다.

## 종료 판정

조건 미충족 유닛이 `_plan`에 남는 것은 실패가 아니라 정직한 결과다 — 유닛이
스스로 정한 성공 기준을 사후에 낮춰 통과시키지 않는다(LOOP-CONTINUE-01).
