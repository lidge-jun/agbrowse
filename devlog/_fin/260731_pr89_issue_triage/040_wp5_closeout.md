# 040 — WP5: 게이트 클로즈아웃과 인계

선행: WP2, WP3.

WP3가 후속 유닛들의 로드맵을 확정하고 **확인된 표본 전체와 접근 방식**을 배정한
뒤에 시작한다. 전수 배정은 달성 조건이 아니다 — `021` §0이 그 이유를 담고 있다.

devlog `_plan`/`_fin` 정리는 이 유닛의 선행이 아니다 — 별도 유닛으로 분리됐다.

## 게이트

이 유닛에서 코드를 바꾸는 것은 WP2뿐이다. WP3는 문서만 만든다.

순서대로 실행하고 각 출력을 이 문서에 기록한다.

```
# WP2 테스트는 새 파일이 아니라 기존 스위트에 추가된다(010 참조).
# 아래 영향권 목록이 그 파일들을 이미 포함한다.

# 변경 파일의 영향권 — WP2가 건드리는 모듈을 덮는 기존 스위트.
npx vitest run test/unit/web-ai-tool-schema.test.mjs \
               test/unit/web-ai-chatgpt-model.test.mjs \
               test/unit/web-ai-tool-validation.test.mjs \
               test/unit/web-ai-capability.test.mjs \
               test/unit/web-ai-timeout-default.test.mjs \
               test/integration/web-ai-cli-contract.test.mjs \
               test/integration/web-ai-policy-mcp.test.mjs \
               test/integration/web-ai-mcp-server.test.mjs

npm run typecheck
npm run fix:counts          # str_func.md 카운트 갱신
bash structure/verify-counts.sh
bash structure/check-doc-drift.sh
npm run gate:all
```

영향권 선정 근거: WP2가 바꾸는 것은 `web-ai/chatgpt-model.mjs` probe,
`web-ai/chatgpt.mjs:120` capability 정의, `web-ai/mcp-server.mjs` submit_prompt
분기다. `rg -l "web_ai_submit_prompt" test/`와
`rg -l "chatGptModelCapabilityProbe" test/`로 영향권을 골랐다.

WP3는 문서만 만들므로 게이트 대상이 아니다. 후속 두 유닛은 각자의 게이트를 갖는다.

`typecheck:checkjs` / `typecheck:checkjs-dom`은 `dev`에 선행 오류가 있으므로
파일별 오류 수를 변경 전후로 비교한다. 새 오류를 도입하지 않았음이 기준이지
전체 clean이 기준이 아니다.

전체 스위트(`npx vitest run test/unit test/integration test/e2e`)는 Playwright
Chromium이 설치된 경우에만 유효한 증거다. 미설치로 skip이 발생하면 그 사실을
그대로 기록하고 "전체 통과"라고 쓰지 않는다.

## 유닛 자체 마감

이 유닛도 종료되면 `_fin`으로 옮기고 Recent `_fin` 표에 행을 추가한다.

```
git mv devlog/_plan/260731_pr89_issue_triage devlog/_fin/
```

MODIFY `devlog/00_index.md` — 현재 `_plan` 표에는 이 유닛 행이 **없다**(그 표는
devlog 정리 유닛이 재작성할 대상이고, 이 유닛은 거기 등록된 적이 없다). 따라서
제거할 행이 없고 `_fin` 행만 추가한다.

Recent `_fin/` 표 맨 위에 행을 추가:

```diff
 | Topic | Path | Closeout signal |
 | --- | --- | --- |
+| PR #89 / 이슈 #87·#88 triage | `_fin/260731_pr89_issue_triage/` | #87 probe/MCP 갭 수정 + #88 경계 인벤토리. #88 방어와 devlog 정리는 후속 유닛으로 분할(`003_audit_synthesis.md`). |
 | QA round 6 | `_fin/260726_qa_round6/` | ... |
```

## 커밋

work-phase마다 하나씩, 로컬만.

```
WP1  docs(devlog): PR #89 / 이슈 #87·#88 처리 로드맵 유닛
WP2  fix(web-ai): make the model probe and MCP honor the requested chat family
WP3  docs(devlog): map every stall boundary and route it to a successor unit
WP5  docs(devlog): close out the PR #89 / issue triage unit
```

`git mv` 후 **goalplan의 `capturedEvidence` 경로도 함께 갱신한다.** c1·c2가
`devlog/_plan/260731_pr89_issue_triage/...`를 가리키고 있어, 이관하면 존재하지
않는 경로가 된다. 증거가 가리키는 곳이 없으면 증거가 아니다.

`git add`는 이 유닛이 만든 경로만 지정한다. `.codexclaw/**`의 기존 더티 파일은
사용자 것이므로 스테이징하지 않는다.

**예외: 이 유닛이 소유한 goalplan은 커밋한다.**
`.codexclaw/goalplans/agbrowse-dev-pr-89-87-88-devlog-pabcd-wp1-docs-o/`는 이
작업이 만든 산출물이고, 후속 유닛 세 개의 총량이 거기 기록된다. 커밋하지 않으면
"분할이 목표 축소가 아니다"라는 주장의 증거가 디스크에만 남는다. 다른 세션의
goalplan 폴더와 `.codexclaw`의 나머지는 계속 제외한다.

push는 하지 않는다(DEV-GIT-PUSH-01).

## 인계 (NEEDS_HUMAN)

이 유닛이 끝나도 원격에는 다음이 남는다. 모두 사용자 결정이 필요하다.

1. **PR #89 처분.** base가 `main`이라 머지해도 `dev`에 반영되지 않는다. dev에는
   #87 배선이 이미 있고, #88 방어는 후속 두 유닛에서 구현한다.
   선택지: (a) 기여를 인정하며 "dev에서 다르게 반영됨"으로 닫기, (b) `main`에
   머지한 뒤 dev와의 정합을 별도로 처리, (c) 기여자에게 dev 대상 재작성을 요청.

   (b)를 고른다면 먼저 확인할 것: 2026-07-31 기준 PR #89의 `mergeStateStatus`가
   `UNSTABLE`이다. 체크 상태를 보고 판단해야 한다.
2. **이슈 #87 클로즈.** dev에 수정이 들어갔지만 릴리스 전이다. 클로즈 시점은
   사용자 판단이다.
   **이슈 #88은 열어 둔다** — 후속 두 유닛이 남아 있다. 인벤토리 결과를 이슈에
   코멘트로 남길지도 사용자가 정한다(원격 쓰기라 이 유닛에서 하지 않는다).
3. **dev↔main 정합.** `main`에 있고 `dev`에 없는 5커밋(v0.1.18/v0.1.19 릴리스,
   #82 fix, postinstall star prompt)은 이 유닛의 범위 밖이다. 실측 5개
(`git log dev..origin/main`).

## 남긴 후속

**후속 유닛 세 개가 이 goal 아래 남는다.** 앞의 둘은 WP3의 7절이 로드맵을 쓰고,
셋째는 `030`이 계획 문서다.

| 유닛 | 범위 |
| --- | --- |
| `#88 DOM deadline 계약` | assistant DOM read · activity · finished · ordering · recovery · copy (`021` 7절 유닛 A) |
| `artifact/finalizer hardening` | 이미지·파일 다운로드, 탭 lease, CDP, diagnostics, sync-IO/lock (`021` 7절 유닛 B) |
| `devlog 정리` | `_plan`→`_fin` 이관, `00_index.md` 동기화, 조건부 closeout 4건 |

이 유닛을 `_fin`으로 옮기는 것은 "#88 완료"가 아니라 "이 유닛 범위 완료"를
뜻한다. 세 후속 유닛이 끝나기 전에는 goal이 닫히지 않는다.

`readActivityState`의 **catch 경로**가 `{ strength: 'none' }`을 돌려준다
(`web-ai/chatgpt.mjs:1049`). 폴링 루프는 `'none'`을 quiet으로 읽어 완료 분기로
들어가므로(`:679-680`, `:710-728`), DOM 예외가 조용한 완료로 이어질 수 있다.

이것은 timeout이 아니라 **예외** 경로이므로 #88의 범위와 겹치되 원인이 다르다.
`021`이 이를 B03으로 기록하고 fail-open 여섯 중 하나로 판정했으며, **유닛 A의
3번 phase**(완료 판정 경로)에 배정했다.

`web-ai/chatgpt-response-observer.mjs:78`의 `observeAssistantResponse`는 이미
`timeoutMs` 예산을 받는다(`web-ai/chatgpt.mjs:626`).

## 실행 결과

### 게이트 (2026-07-31, WP2 완료 시점)

```
npm run typecheck                    exit 0

npx vitest run test/unit/web-ai-chatgpt-model.test.mjs \
               test/unit/web-ai-tool-schema.test.mjs \
               test/unit/web-ai-capability.test.mjs \
               test/unit/web-ai-tool-validation.test.mjs \
               test/unit/web-ai-timeout-default.test.mjs
    Test Files  5 passed (5)
         Tests  129 passed (129)

npx vitest run test/integration/web-ai-mcp-server.test.mjs \
               test/integration/web-ai-cli-contract.test.mjs \
               test/integration/web-ai-policy-mcp.test.mjs
    Test Files  3 passed (3)
         Tests  70 passed (70)

npm run gate:all                     All 16 gate(s) passed.
bash structure/check-doc-drift.sh    All structure drift checks passed (164).
bash structure/verify-counts.sh      All structure count checks passed (76).
```

`scripts/`와 `test/unit/` 카운트 드리프트는 `c7e87c1` baseline에도 있던 선행
상태였고(별도 worktree로 확인) `npm run fix:counts`가 함께 고쳤다. 이 유닛이 만든
드리프트가 아니다.

### 마감 시점 재실행 (2026-07-31, WP5)

위는 WP2 완료 시점 출력이다. 이후 WP3와 이 문서가 devlog를 더 늘렸으므로 마감
시점에 다시 돌렸다.

```
npm run fix:counts                   (devlog 카운트 갱신)
bash structure/verify-counts.sh      All structure count checks passed (76).
bash structure/check-doc-drift.sh    All structure drift checks passed (164).
npm run typecheck                    exit 0
```

문서를 더 고치면 카운트가 또 밀린다. **이관 직전에 `fix:counts`를 한 번 더
실행하는 것이 마감 절차의 마지막 단계다.**

### 커밋 (WP5 착수 전, `c7e87c1..9c9ea88` 17개)

```
65b1e5c  WP1  docs(devlog): PR #89 / 이슈 #87·#88 처리 로드맵 유닛
a338a05       docs(devlog): rescope WP3 to a stall-boundary inventory
b463415       docs(devlog): correct four line citations in the WP3 boundary map
37103f5       docs(devlog): keep #88 implementation inside the unit
20db279       docs(devlog): close the boundary-spec gaps the second audit found
5c46e56       docs(devlog): split #88 into two successor units under the same goal
60b8316       docs(devlog): fix the probe guard hole and split devlog reorg
83de4bb       docs(devlog): unbind successor criteria from docs-only cycles
a4c408e       docs(devlog): fold the near-pass residuals and commit the goalplan
03faf36       docs(structure): refresh the devlog count for the new plan unit
b524453  WP2  docs(devlog): harden the WP2 probe plan before implementing
76e4793       fix(web-ai): make the model probe and MCP honor the requested chat family
286e998  WP3  docs(devlog): map all 22 stall boundaries in the ChatGPT poll path
b812e15       docs(devlog): reopen the closure — 22 boundaries were 34
f1835ef       docs(devlog): stop claiming closure, switch to a budget contract
c9bad92       docs(devlog): close the WP3 contract — isolation, fencing, single-flight
9c9ea88       docs(devlog): make the WP3 contract internally consistent
```

코드를 바꾼 것은 `76e4793` 하나다. 나머지는 문서와 생성된 카운트다.

### 터미널 결과

| 항목 | 결과 |
| --- | --- |
| 이슈 #87 잔여 갭 2건 | **DONE** — probe family 계약 + MCP fail-closed, 테스트로 증명 |
| 이슈 #88 경계 확정 | **부분** — 표본 36개와 예산 계약 명세를 확정했으나 전수는 아니다. `021` §0이 그 한계를 명시한다 |
| 이슈 #88 방어 구현 | **후속 유닛 2개로 이관** (분할이지 축소가 아니다) |
| devlog 정리 | **후속 유닛 1개로 이관** (PR triage와 아키텍처 의존 없음) |
| PR #89 처분 / 이슈 클로즈 | **NEEDS_HUMAN** — 원격 쓰기라 범위 밖 |

## 실패한 것 / 확인하지 못한 것 (LOOP-PESSIMIST-01)

**A 게이트에서 리뷰어 5명에게 누적 14라운드를 받았다(WP1 9, WP2 1, WP3 4).**
verdict 분포는 FAIL 11, GO-WITH-FIXES 3.

WP5는 별도로 2라운드(R1 FAIL, R2 GO-WITH-FIXES)를 더 받았다. 유닛 전체로는
리뷰어 6명, 16라운드, FAIL 12 / GO-WITH-FIXES 4다.

### 죽은 가설

1. "#88 방어 지점을 열거하면 된다" — WP1에서 3회 사망. 매번 새 누락(recovery,
   `isResponseFinished`, diagnostics/copy)이 나왔다.
2. "`page.evaluate`를 한 곳에서 가로채면 전부 덮인다" — Locator API와 외부 모듈
   위임이 남아 사망.
3. "인벤토리를 완전하게 만들면 #88을 한 유닛에서 구현할 수 있다" — 완전한
   인벤토리가 오히려 유닛이 너무 크다는 증거였다.
4. "call graph 폐쇄로 경계를 다 셀 수 있다" — WP3에서 22개 → 34개 → 또 반증.
   `deps.*`가 주입 지점이라 스냅샷이 즉시 낡는다.

WP2에서도 둘이 죽었다.

5. "기존 fake를 그대로 쓰면 된다" — `createFakeModelPage`가 family 서브메뉴 열림을
   모델링하지 않아, 서브메뉴를 여는 코드를 **지워도** 테스트가 통과했다. 거짓
   양성이었다(`010_wp2_family_probe_and_mcp.md` 테스트 배치 절).
6. "미지원 model은 알아서 걸러진다" — 첫 guard가 `!requested && !requestedFamily`
   여서 유효한 family가 잘못된 model을 가렸다. #87이 막으려던 무음 드롭을 model
   축에 새로 만들 뻔했다.

### 확인하지 못한 것

- 예산 계약의 두 모델(in-process sync 제거 vs worker/subprocess 격리) 중 어느
  쪽이 실현 가능한지 — 후속 유닛 0번 phase가 판단한다.
- 경계 표본 36개가 실제로 몇 %인지. "표본"이라고만 말할 수 있다.
- `closeTab`(`skills/browser/tab-manager.mjs:310`) 아래를 더 파지 않았다.

### 이 방향이 틀렸다는 것을 보여줄 증거

후속 유닛 0번 phase가 두 모델 모두 실현 불가로 판정하면, 문제는 `pollWebAi`가
아니라 web-ai 전반의 페이지 접근 규약이다. 그때는 유닛이 아니라 아키텍처를 다시
잡아야 한다.
