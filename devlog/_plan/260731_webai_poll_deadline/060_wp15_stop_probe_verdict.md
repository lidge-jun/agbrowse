# 060 — WP15 stop probe의 관측 실패 분리 (B04)

- unit: `devlog/_plan/260731_webai_poll_deadline/`
- work-phase: WP15
- 선행: 없음 — 예산 계약과 독립
- 대상: `021` 3절의 B04. **WP14가 OPEN으로 등록한 항목이다.**

## 왜 이제 하는가

WP14 처방 초판에서 나는 B04를 "상대적으로 안전"이라고 적었다가 **감사 지적으로
철회**했다. 근거는 `021:250`의 "catch → 다음 probe"였는데, 그건 주 poll의
`readActivityState`(`chatgpt.mjs:1230-1234`)에만 해당한다. 거기서는 stop probe가
실패해도 DOM probe로 넘어가고 WP10의 `'unknown'`이 받는다.

**`anyStopButtonVisible`은 공유 producer다.** 다른 소비자 셋은 그 `false`를
완료 판정에 직접 쓴다.

## 결함

`chatgpt-response-dom.mjs:67-104`. 모든 실패 경로가 `false`로 수렴한다.

```
:73   locator.all().catch(() => [])          → 노드 없음으로 보임
:76   node.isVisible().catch(() => false)    → 안 보이는 것으로 보임
:85   firstOfEmpty.isVisible().catch(...)    → 동일
:90   locator.count().catch(() => 0)         → 0개로 보임
:95   node.isVisible().catch(() => false)    → 동일
:104  return false
```

**"stop 버튼이 없다"와 "볼 수 없었다"가 같은 값이다.** 그리고 stop 버튼이
없다는 것은 이 코드베이스에서 **생성이 끝났다는 신호**다.

### 소비자별 결과

| 소비자 | `false`의 의미 | 결과 |
| --- | --- | --- |
| `chatgpt.mjs:1232` 주 poll | DOM probe로 진행 | **안전** — WP10의 `unknown`이 받는다 |
| `chatgpt-multi-turn.mjs:104` | `latest && !streaming` | 1.5초 후 **완료 반환** |
| `chatgpt-deep-research.mjs:288` | `count > baseline && !streaming && !progress` | 5초 후 **리포트 추출** |
| `chatgpt-deep-research.mjs:275`, `:405` | 진행 중 판정 | 조기 종료 |
| `chatgpt-work-picker.mjs:1024` | `stopVisible \|\| thinkingVisible` | 아래 참조 — **이미 fail-closed** |
| `chatgpt-work-picker.mjs:768` | `hasRunningEvidence` | 실행 중인 Work를 놓친다 |

multi-turn과 deep-research가 특히 나쁘다. 생성 중인데 visibility 읽기가
실패하면 **부분 답변을 최종 답변으로 반환**한다.

### work-picker도 fail-open이다 — 내 초판 판단이 틀렸다

처방 초판에서 "이미 fail-closed"라고 썼다. `:1060`의 `'unknown'` 분기만 보고
멈춘 탓이다. **그 앞에 Copy 게이트가 있다.**

```
:1029  if (stopVisible || thinkingVisible) → 'running'
:1041  const copyVisible = ...
:1043  if (copyVisible) → 'complete'          ← 여기서 빠져나간다
:1060  → 'unknown'                             ← 도달하지 않는다
```

Copy 버튼은 **이전 assistant turn에도 보인다.** 그러니 현재 응답이 생성 중인데
stop을 못 읽으면 `stopVisible=false` → Copy 보임 → **`'complete'`** 다.
`'unknown'` throw에는 닿지도 않는다.

처방을 바꾼다.

```
thinkingVisible                       → 'running'  (독립 증거, 유지)
stopProbe === 'unknown'               → 'unknown'  ← Copy 검사보다 먼저
stopProbe === 'absent' && copyVisible → 'complete'
```

즉 **완료는 stop이 확실히 없을 때만** 허용한다.

`:768`은 탐색 경로라 차단이 과하다. 관측 실패만 기록한다.

## 처방

WP10·WP11·WP14와 같은 형태다. 관측 실패를 값으로 분리한다.

```
probeStopButton(scope) → 'visible' | 'absent' | 'unknown'
```

**원칙: `visible`이라는 확정 증거를 찾지 못했는데 셀렉터/노드를 완전히
열거·검사하지 못했다면 전부 `unknown`이다.**

| 상황 | verdict |
| --- | --- |
| 보이는 stop 노드를 찾음 | `visible` |
| 모든 셀렉터를 조사했고 보이는 노드 없음 | `absent` |
| `all()` 또는 `isVisible()`이 throw | `unknown` |
| `scope`가 locator를 제공하지 않음 | `unknown` |
| **`scope.locator(selector)` 자체가 동기 throw** | `unknown` |
| **`all()`이 배열이 아닌 값을 반환** | `unknown` |
| **locator에 `all()`이 없음** | `unknown` (아래) |
| **매치된 node에 `isVisible()`이 없음** | `unknown` |

아래 넷은 감사가 찾은 것이다. 초판은 throw와 scope 부재만 다뤘는데, 이들도
"조사 완료"가 아니다. `:68`의 `return false`도 "이 스코프로는 볼 수 없다"이지
"stop 버튼이 없다"가 아니다.

### count/nth fallback을 없앤다

현재 producer에는 `all()`이 없는 locator를 위한 `count()`/`nth()` 경로가
있다(`:88-101`). 이 경로에서 unknown을 제대로 판정하려면 `count()` throw,
malformed count(`NaN`/음수/문자열), `nth()` throw, node의 `isVisible()` 부재를
전부 다뤄야 한다 — 검증 표면이 본 경로보다 넓다.

**그 경로는 부분 locator double을 위한 것이지 실제 Playwright를 위한 것이
아니다.** 실제 locator는 항상 `all()`을 갖는다. 없애고 `all()`이 없으면
`unknown`으로 단순화한다.

영향받는 테스트 double이 있으면 `all()`을 추가하면 된다 — double이 실물과
같은 API를 갖는 편이 낫다.

### `scopeToMainRegion`도 던질 수 있다

`chatgpt-response-dom.mjs:120`의 `page?.locator?.('main')`이 동기 throw하면
`probeStopButton`에 **도달조차 못 한다.** Work 경로가 raw error로 빠지고
`provider.work-state-unknown` 계약이 적용되지 않는다. Work 호출부가 이것을
structured unknown으로 받아야 한다.

**부분 실패도 `unknown`이다.** WP14에서 배운 것 — 셀렉터 A가 throw하고 B가
정상적으로 0개를 찾았다면, A에만 매치되는 stop 버튼을 놓쳤을 수 있다.
단, **보이는 노드를 하나라도 찾으면 즉시 `visible`이다.** 그건 확정적 증거이고
다른 셀렉터의 실패가 뒤집지 못한다.

### `anyStopButtonVisible`은 남긴다

boolean 소비자를 위해 wrapper로 남기되 `probeStopButton`으로 구현한다
(`'visible'`만 true). WP11의 `isTabAlive`/`probeTabAlive`와 같은 패턴이다.

**다만 wrapper만 남기면 아무것도 고쳐지지 않는다.** WP11에서 그 실수를 했다.
소비자를 전부 옮긴다.

### 소비자별 처방

소비 지점은 여섯이 아니라 **일곱**이다. deep-research의 셋은 성격이 각각
다르므로 한 줄로 묶으면 안 된다.

| # | 위치 | `unknown` 처리 |
| --- | --- | --- |
| 1 | `chatgpt.mjs:1232` 주 poll | `strength: 'unknown'` 반환. WP10이 이미 그 값을 안다 |
| 2 | `multi-turn.mjs:104` | 완료 금지, 안정 상태 초기화, 다음 tick 재시도 |
| 3 | `deep-research.mjs:275` DR 시작 대기 | bounded main poll 진입만 허용. **`researchActivityObserved = true`의 증거로 쓰지 않는다** — 못 읽은 것은 활동의 증거가 아니다 |
| 4 | `deep-research.mjs:288` DR 완료 판정 | 안정 상태 초기화, **리포트 추출 금지** |
| 5 | `deep-research.mjs:405` DR resume | 안정 상태 초기화 후 데드라인까지 재시도 |
| 6 | `work-picker.mjs:768` Work commit | 다른 확정 증거(thinking 등)로 commit되면 warning에 보존. timeout이면 typed error의 evidence에 verdict 보존 |
| 7 | `work-picker.mjs:1024` Work state | Copy 검사 **앞에서** `status: 'unknown'` (위 참조) |

3번이 중요하다. `researchActivityObserved`는 "DR이 실제로 돌았다"의 증거로
쓰이는데, 관측 실패를 그 증거로 세면 없었던 활동을 있었다고 기록한다.

`readWorkTaskState`의 `status`에 새 값을 추가하지 않는다. 이미 `'unknown'`이
있고 호출부(`:928`)가 그것을 `provider.work-state-unknown`으로 바꾼다 —
바꾸는 것은 **그 분기에 도달하는 조건**이다.

## 검증

| # | 시나리오 | 관측 |
| --- | --- | --- |
| Y1 | 보이는 stop 노드 | `visible` |
| Y2 | 모든 셀렉터 조사, 노드 없음 | `absent` |
| Y3 | `all()`이 throw | `unknown` |
| Y4 | `isVisible()`이 throw | `unknown` |
| Y5 | 일부 셀렉터 실패 + 다른 셀렉터 정상 빈 결과 | `unknown` |
| Y6 | 일부 셀렉터 실패 + 다른 셀렉터가 **보이는 노드** 발견 | `visible` (확정 증거 우선) |
| Y7 | `scope`에 locator 없음 | `unknown` |
| Y8 | multi-turn에서 `unknown` | 완료 반환 안 함 |
| Y9 | multi-turn에서 `absent` | 기존 완료 동작 유지 |
| Y10a | DR `:275` `unknown` | main poll 진입 허용, **`researchActivityObserved` 안 세움** |
| Y10b | DR `:288` `unknown` | 리포트 추출 안 함 |
| Y10c | DR `:405` `unknown` | 안정 초기화 후 재시도 |
| Y11 | deep-research에서 `absent` | 기존 동작 유지 |
| Y12 | work-picker `unknown` + **Copy 보임** | `status: 'unknown'` → throw. Copy가 완료로 만들지 못한다 |
| Y12b | work-picker `absent` + Copy 보임 | `status: 'complete'` (과잉 차단 방지) |
| Y12c | work-picker `unknown` + thinking 보임 | `status: 'running'` (독립 증거 우선) |
| Y13 | 주 poll에서 `unknown` | `strength: 'unknown'` (WP10 경로 보존) |
| Y14 | `scope.locator()`가 동기 throw | `unknown` |
| Y15 | `all()`이 배열 아닌 값 반환 | `unknown` |
| Y17 | 매치 node에 `isVisible()` 없음 | `unknown` |
| Y16 | locator에 `all()`이 없음 | `unknown` (count/nth fallback 제거) |
| Y18a | `submitWorkPrompt`에서 `scopeToMainRegion` throw | 다른 증거로 commit되면 warning, 아니면 typed error |
| Y18b | `readWorkTaskState`에서 `scopeToMainRegion` throw | `status: 'unknown'` → `provider.work-state-unknown` |
| Y19a | `:768` `unknown` + thinking으로 commit | 성공 + warning에 verdict |
| Y19b | `:768` `unknown`이 데드라인까지 지속 | typed error의 `evidence.stopProbe === 'unknown'` |

Y2·Y6·Y9·Y11·Y12b·Y12c가 과잉 차단 방지다. **WP10~WP14에서 이 짝이 없으면 mutation이
GREEN으로 남는 일이 반복됐다.**

### mutation proof

| mutation | RED |
| --- | --- |
| `probeStopButton`의 `unknown`을 `absent`로 | Y3·Y4·Y5 |
| 부분 실패를 `absent`로 | Y5 |
| malformed/API 부재를 `absent`로 | Y15·Y16·Y17 |
| multi-turn의 unknown 가드 삭제 | Y8 |
| DR `:275`가 unknown을 활동 증거로 셈 | Y10a |
| DR `:288`의 unknown 가드 삭제 | Y10b |
| work-picker의 unknown 게이트를 Copy 뒤로 이동 | Y12 |
| DR `:405`의 unknown 가드 삭제 | Y10c |
| 주 poll이 unknown을 `'none'`으로 | Y13 |
| scope throw를 raw error로 흘림 | Y18a·Y18b |
| `:768`의 verdict 기록 삭제 | Y19a·Y19b |

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `web-ai/chatgpt-response-dom.mjs` | `probeStopButton` 신규 export, `anyStopButtonVisible`을 그 위에 재구현 |
| `web-ai/chatgpt.mjs` | `readActivityState`(`:1232`)가 verdict를 직접 소비 |
| `web-ai/chatgpt-multi-turn.mjs` | `isStreaming`(`:55`) verdict화, `:104` 가드 |
| `web-ai/chatgpt-deep-research.mjs` | `isStreaming`(`:76`) verdict화, `:275`·`:288`·`:405` 가드 |
| `web-ai/chatgpt-work-picker.mjs` | `:1024`의 unknown 게이트를 Copy 검사 앞으로, `:768`은 verdict를 warning/evidence에 기록, `scopeToMainRegion` 실패 수용 |
| 테스트 | Y1~Y19 |

`readWorkTaskState`의 `status` 소비자는 `:926`(work poll 루프) 하나이고
`'unknown'`을 이미 typed error로 처리한다 — 확인했다.

## 실행 결과 (2026-08-01)

커밋 셋: `d2a99c5`(producer + 소비자 7곳), `14a576c`(R1 blocker 반영),
`b3f7612`(T12d 세션 격리).

### 감사가 잡은 것

처방 3라운드 + 구현 1라운드. 내 오판이 둘 나왔다.

| # | 내용 |
| --- | --- |
| 1 | **work-picker가 이미 fail-closed라는 초판 주장** — `:1060`의 unknown 분기만 보고 멈췄는데 `:1043`의 Copy 게이트가 먼저 빠져나간다. Copy는 이전 turn에도 보이므로 생성 중 stop을 못 읽으면 `complete`가 됐다 |
| 2 | **`scopeToMainRegion`의 page fallback** — throw를 삼키면서 `page`를 반환했더니 main-scoping의 존재 이유(사이드바·dictation 오탐 차단)를 우회했다. `null`로 바꿔 probe가 `unknown`으로 받게 했다 |

2번은 **내가 R1 blocker를 고치면서 만든 새 구멍**이다. 감사가 다음 라운드에서
잡았다.

### 검증 환경 — 작업트리 오염

전체 스위트 검증 중 `web-ai/chatgpt.mjs`에 **내가 작성하지 않은 미커밋 변경
약 194줄**(hard poll deadline: `RECOVERY_RESERVE_MS`, `POLL_EXPIRED`,
`buildHardTimeoutResult`)이 있는 것을 발견했다. `git stash pop` 이후 나타났고
`HEAD`에는 없다.

**손대지 않았다.** 대신 `git worktree add --detach HEAD`로 격리 검증했다.

```
detached worktree @ 14a576c + T12d 격리 수정
  npx vitest run test/unit test/integration   2062 passed, 0 FAIL
  npm run test:unit                            1821 passed, exit 0
  npm run gate:all                             17/17, exit 0
  check-doc-drift                              164 passed
```

T12d 실패는 실제 내 결함이었다 — `findActiveSession`이 URL/target 불일치 시
`active.at(-1)`로 폴백하므로 앞선 테스트가 남긴 세션을 입양한다. fake page마다
고유 conversation URL을 주는 것으로 고쳤다.

### mutation proof

| mutation | RED |
| --- | --- |
| producer `unknown` → `absent` | Y3·Y4·Y5·Y14~Y17 (8건) |
| work-picker unknown 게이트 삭제 | Y12 |
| DR resume `!== 'absent'` → `=== 'visible'` | Y10c |

## 이 work-phase가 닫는 것과 닫지 않는 것

닫는 것: **B04**. `021` 3절 fail-open 목록에서 마지막 남은 것이다.

닫지 않는 것:

- B04의 **데드라인**. `isVisible()`은 여전히 무한 대기 가능하고 그건 예산
  계약이다.
- G1·G2·G4.
- c7의 데드라인 인지 부분.

**c7을 met으로 적지 않는다.**
