# 900 — devlog 정리 유닛 종료 (2026-07-31)

## 실행 결과

`_plan` 11개 → 6개. 6개를 `_fin`으로 이관했다.

| 유닛 | 판정 근거 |
| --- | --- |
| `260625_webai_streaming_recovery_false_complete` | 무조건 — `30_completion_audit.md:31-52` 전 요구사항 Met |
| `260710_gpt56_update` | 무조건 — `00_index.md:3-12` 전량 실행 + root closeout |
| `260711_upload_reliability` | 조건부 충족 — 전체 스위트 179파일 1946건 0 failure 재실행 |
| `260711_release_017` | 조건부 충족 — fresh install + 두 bin smoke 재현 |
| `260627_search_skill` | 조건부 충족 — 5개 계획 사이클 산출물 배포 대조 |
| `260628_competitive_research` | 조건부 충족 — 미해결 질문 5개 disposition |

각 조건부 유닛에 `900_closeout.md`를 새로 썼다. 조건을 못 채운 유닛은 없었다.

`_plan`에 남은 6개(reorg 유닛 포함)는 모두 실제 미완이다 — cli-jaw 미러는 외부
저장소 소유, parity impl은 Cycle 12 CONCERNS, GPT-Pro remediation은 R2의
FAIL 2, gapclose는 런칭 트랙 Phase 100/110/120 잔존, strict-migration은 런타임
`.ts` 0개.

## 감사에서 고친 것

2라운드를 받았고 실제 결함이 둘 나왔다.

**릴리스 stop condition을 면제할 뻔했다.** `260711_release_017`의 fresh install +
bin smoke를 "시점이 지나 재현 불가"로 넘기고 종료 판정했는데, 계획이 명령까지
적어둔 검증이었고 실행에 3분도 안 걸렸다. 실행해서 통과시켰다. 유닛이 스스로
정한 기준을 사후에 낮추지 않는다는 원칙이 이 지점에서 시험됐다.

**이관이 참조를 깨뜨렸다.** `_plan` 경로를 가리키던 곳 중 **현재 탐색 경로**만
`_fin`으로 고치고 실행 당시 manifest는 남겼다. 그 구분이 중요하다 — 과거 위치는
git 이력이 보존하지만, 지금 따라가라고 적힌 경로는 존재해야 한다.

`00_index.md`에서도 자기모순 둘을 찾았다. Adaptive Fetch v2 행이 hardening을
`_plan`에 있다고 하면서 바로 아래 `_fin` 경로를 나열했고, gapclose 행이
"04·05·06·09 PLANNED"라고 요약했는데 실제 잔여는 런칭 트랙이었다.

## 게이트

```
bash structure/check-doc-drift.sh    All structure drift checks passed (164).
bash structure/verify-counts.sh      All structure count checks passed (76).
npm run typecheck                    exit 0
_plan 표 ↔ 실제 폴더 양방향 diff      일치
표 기재 _fin 경로 존재 검사           전부 존재
```

코드 변경 0줄.

## 남은 것

- `devlog/_plan/.DS_Store`가 남아 있다. `.gitignore:2`에 걸려 tracked가 아니고,
  이 세션 샌드박스가 `rm`을 차단해 삭제하지 못했다. 계획은 삭제를 요구했으므로
  "실행했다"고 적지 않는다.
- 릴리스 smoke용 임시 디렉터리(`/var/folders/2r/.../tmp.tcMdK464Xa`, 약 38MB)도
  같은 이유로 남아 있다. 둘 다 사용자 재량 정리 대상이다.
- `260627_search_skill/900_closeout.md`의 Cycle 2·3 인용이 usage 주석을 가리켜
  증거 품질이 약하다. 실제 구현은 `skills/browser/search.mjs:60-65,124-150`과
  `:93-99,199-225`에 있다. 종료 판정을 뒤집지는 않는다.

## 판정

**DONE.** 이 유닛도 `_fin`으로 이관한다.
